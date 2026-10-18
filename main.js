const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, nativeImage, screen, safeStorage, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { MediaServer, kindOf } = require('./server');
const { defaultConfig } = require('./default-config');
const mpv = require('./mpv');
const emuModules = require('./emu-modules');
const emuInstaller = require('./emu-installer');
const games = require('./games');
const covers = require('./covers');
const youtube = require('./youtube');
const twitch = require('./twitch');
const appInstaller = require('./app-installer');
const selfUpdate = require('./self-update');
const setupScan = require('./setup-scan');
const overlay = require('./overlay');
const dgram = require('dgram');

const P = require('./paths');
const DATA = P.DATA;
const CONFIG_FILE = path.join(DATA, 'config.json');
const PROGRESS_FILE = path.join(DATA, 'progress.dat');      // watched history, encrypted
const OLD_PROGRESS_FILE = path.join(DATA, 'progress.json'); // plain text, from before
const RECENT_FILE = path.join(DATA, 'recent.dat');            // recently played games, encrypted

app.setPath('userData', path.join(DATA, 'electron'));
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// mpv draws into a native child window; with DirectComposition (newer Chromium)
// Electron's own layer would cover it and the video would be black.
app.commandLine.appendSwitch('disable-direct-composition');

let win = null;
let config = null;
let progress = {};
let server = null;

// ---------- Persistence ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadConfig() {
  const defaults = defaultConfig();
  config = readJson(CONFIG_FILE, null);
  const fresh = !config;
  if (!config) {
    config = defaults;
    writeJson(CONFIG_FILE, config);
  }
  // the first-start setup: new installs only (an install from before it already is set up)
  const setupKnown = !!(config.settings && 'setupDone' in config.settings);
  config.settings = { ...defaults.settings, ...(config.settings || {}) };
  if (!fresh && !setupKnown) config.settings.setupDone = true;
  // A new MediaDeck keeps its games in its own folder: Games\<maker>\<console>, one folder per console, made now
  if (fresh) {
    try { emuInstaller.makeStarterFolders(P.GAMES); config.settings.gamesFolder = P.rel(P.GAMES); writeJson(CONFIG_FILE, config); } catch {}
    try { setupScan.makeBiosFolders(P.BIOS); } catch {}
  }
  // The MediaDeck folder moved (drive letter, USB stick): emulator settings pointing into the old folder follow it
  const ROOT_FILE = path.join(DATA, 'root.json');
  const was = (readJson(ROOT_FILE, {}) || {}).root;
  if (was && path.resolve(was).toLowerCase() !== path.resolve(P.ROOT).toLowerCase()) {
    try {
      const moved = require('./relocate').relocate(was, P.ROOT, [P.EMU, P.APPS], P.EMU_BACKUPS);
      console.log(`[moved] ${was} -> ${P.ROOT}: ${moved.length} settings files pointed at the new folder`);
    } catch (e) { console.error('[moved]', e.message); }
  }
  if (was !== P.ROOT) writeJson(ROOT_FILE, { root: P.ROOT });
  config.tiles = config.tiles || [];
  // a tile's program and picture inside MediaDeck's folder are kept relative to it (the folder can move); one
  // still pointing into the folder's old place (another drive letter) is moved along first
  const before = JSON.stringify(config.tiles);
  const oldBase = was ? path.resolve(was).toLowerCase() + path.sep : '';
  const follow = (p) => (oldBase && /^[a-z]:[\\/]/i.test(p) && path.resolve(p).toLowerCase().startsWith(oldBase)
    ? path.join(P.ROOT, path.resolve(p).slice(oldBase.length)) : p);
  for (const t of config.tiles) { if (t.path) t.path = P.rel(follow(t.path)); if (t.image) t.image = P.rel(follow(t.image)); }
  if (JSON.stringify(config.tiles) !== before) writeJson(CONFIG_FILE, config);
  config.favorites = config.favorites || [];
  if (!config.tiles.some((t) => t.builtin === 'youtube')) {
    const at = config.tiles.findIndex((t) => t.builtin === 'media') + 1;
    config.tiles.splice(at, 0, { id: 'youtube', section: 'apps', builtin: 'youtube', name: 'YouTube', subtitle: 'TV app · no ads · SponsorBlock', path: '', args: '', image: '' });
    writeJson(CONFIG_FILE, config);
  }
  if (!config.tiles.some((t) => t.builtin === 'twitch')) {
    const at = config.tiles.findIndex((t) => t.builtin === 'youtube') + 1;
    config.tiles.splice(at, 0, { id: 'twitch', section: 'apps', builtin: 'twitch', name: 'Twitch', subtitle: 'TV app · no ads', path: '', args: '', image: '' });
    writeJson(CONFIG_FILE, config);
  }
  relockAll();
  progress = readProgress();
}

// ---------- Private files: encrypted on disk ----------
// History, favourites and the cover / thumbnail cache key are encrypted, so the files show no file or folder names.
// Portable (Settings → About, the default): locked with a key kept in data\portable.key, so the MediaDeck folder
// works on any PC (a USB stick, another drive). Off: Windows DPAPI - only this Windows account on this PC can read
// them. Files locked either way are always read; a file that can't be read is kept aside, never overwritten.
const PORTABLE_KEY_FILE = path.join(DATA, 'portable.key');
const LOCK_MAGIC = Buffer.from('MDK1');
let portableKey = null;
const portableData = () => !(config && config.settings && config.settings.portableData === false);
function pKey() {
  if (portableKey) return portableKey;
  try { portableKey = Buffer.from(fs.readFileSync(PORTABLE_KEY_FILE, 'utf8').trim(), 'base64'); } catch {}
  if (!portableKey || portableKey.length !== 32) {
    portableKey = crypto.randomBytes(32);
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(PORTABLE_KEY_FILE, portableKey.toString('base64'));
  }
  return portableKey;
}
const isPortableLocked = (buf) => buf.length > 32 && buf.subarray(0, 4).equals(LOCK_MAGIC);
function lock(text) {
  if (!portableData() && safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(text);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', pKey(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([LOCK_MAGIC, iv, c.getAuthTag(), body]);
}
function unlock(buf) {
  if (!isPortableLocked(buf)) return safeStorage.decryptString(buf);
  const d = crypto.createDecipheriv('aes-256-gcm', pKey(), buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]).toString('utf8');
}
// A file locked for another PC / Windows account: kept as <file>.other-pc (back on that PC it can be put back)
function keepUnreadable(file) {
  try { if (!fs.existsSync(file + '.other-pc')) fs.copyFileSync(file, file + '.other-pc'); } catch {}
}
// Files locked the other way are locked again the way the setting says (at start, and when it changes)
function relockAll() {
  const want = portableData();
  for (const file of [PROGRESS_FILE, RECENT_FILE, FAV_FILE, COVER_STATE(), path.join(DATA, 'cache.key')]) {
    try {
      const buf = fs.readFileSync(file);
      if (isPortableLocked(buf) === want) continue;
      const text = unlock(buf);
      fs.writeFileSync(file + '.tmp', lock(text));
      fs.renameSync(file + '.tmp', file);
    } catch {}
  }
}

// ---------- Watched history ----------
function readProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(unlock(fs.readFileSync(PROGRESS_FILE))); }
    catch (e) { console.error('[progress] could not decrypt:', e.message); keepUnreadable(PROGRESS_FILE); return {}; }
  }
  // Older plain-text history: take it over, save it encrypted, remove the readable copy
  const old = readJson(OLD_PROGRESS_FILE, null);
  if (old) {
    writeProgress(old);
    try { fs.rmSync(OLD_PROGRESS_FILE); } catch {}
    return old;
  }
  return {};
}

// Key for the encrypted covers and thumbnail / subtitle cache, itself locked like the other private files.
// One that can't be read (locked for another PC) is kept as cache.key.other-pc and tried again at every start,
// so its covers come back on that PC.
function cacheKey() {
  const file = path.join(DATA, 'cache.key');
  for (const f of [file, file + '.other-pc']) {
    try {
      const key = Buffer.from(unlock(fs.readFileSync(f)), 'base64');
      if (key.length !== 32) continue;
      if (f !== file) { fs.renameSync(file, file + `.other-pc-${Date.now()}`); fs.writeFileSync(file, lock(key.toString('base64'))); fs.rmSync(f); }
      return key;
    } catch {}
  }
  if (fs.existsSync(file)) { keepUnreadable(file); }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, lock(key.toString('base64')));
  return key;
}

// Any other private list (e.g. recently played games), encrypted the same way
function readSecret(file, fallback) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return fallback; }
  try { return JSON.parse(unlock(buf)); } catch { keepUnreadable(file); return fallback; }
}
function writeSecret(file, data) {
  if (!portableData() && !safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(file + '.tmp', lock(JSON.stringify(data)));
  fs.renameSync(file + '.tmp', file);
}
// Played / favourite games: their files are kept relative to MediaDeck's folder when they are in it (Games\…)
const portGame = (g, fn) => ({ ...g, rom: fn(g.rom), ...(typeof g.cover === 'string' && /[\\/]/.test(g.cover) ? { cover: fn(g.cover) } : {}) });
const readGames = (file) => readSecret(file, []).map((g) => portGame(g, P.resolve));
const writeGames = (file, list) => writeSecret(file, list.map((g) => portGame(g, P.rel)));

function writeProgress(data) {
  if (!portableData() && !safeStorage.isEncryptionAvailable()) { console.error('[progress] encryption not available; not saved'); return; }
  const tmp = PROGRESS_FILE + '.tmp';
  fs.writeFileSync(tmp, lock(JSON.stringify(data)));
  fs.renameSync(tmp, PROGRESS_FILE);
}

function setProgress(file, data) {
  if (data) progress[file] = { ...data, t: Date.now() }; else delete progress[file];
  saveProgressSoon();
  return true;
}

let progressTimer = null;
function saveProgressSoon() {
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => writeProgress(progress), 1500);
}

// ---------- Window ----------
// Starts as a 1280x720 window; after that it opens the way it was last left
// (size, position, maximized or full screen).
function createWindow() {
  const saved = config.settings.window || {};
  const bounds = { width: saved.width || 1280, height: saved.height || 720 };
  if (saved.x !== undefined && saved.y !== undefined) {
    const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: bounds.width, height: bounds.height }).workArea;
    const visible = saved.x < area.x + area.width - 100 && saved.x + bounds.width > area.x + 100 && saved.y >= area.y - 20 && saved.y < area.y + area.height - 100;
    if (visible) { bounds.x = saved.x; bounds.y = saved.y; }
  }
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960, minHeight: 540,
    fullscreen: !!config.settings.fullscreen,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'MediaDeck',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (saved.maximized && !config.settings.fullscreen) win.maximize();
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => onShortcut(e, input));
  win.on('closed', () => { win = null; app.quit(); });
  // Leaving the PS menu any other way (back to the game, save state, Alt+Tab): stop being on top
  win.on('blur', () => { if (menuOnTop) holdOnTop(false); win.webContents.send('win-active', false); });
  // The controller only works in MediaDeck while its window really is the active one (Chromium can
  // keep thinking it has focus after a game or another program came to the front)
  win.on('focus', () => win.webContents.send('win-active', true));
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, rememberWindow);
}

function onShortcut(e, input) {
  if (input.type !== 'keyDown') return;
  if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  if (input.key === 'F12') { e.sender.toggleDevTools(); e.preventDefault(); }
}

let windowTimer = null;
function rememberWindow() {
  clearTimeout(windowTimer);
  windowTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const s = config.settings;
    s.fullscreen = win.isFullScreen();
    const prev = s.window || {};
    s.window = { ...prev, maximized: win.isMaximized() };
    if (!s.fullscreen && !win.isMaximized()) Object.assign(s.window, win.getBounds());
    writeJson(CONFIG_FILE, config);
  }, 600);
}

// While the PS menu is open, MediaDeck stays above full-screen games whose window is
// "always on top" (ares); it drops back as soon as the player leaves the menu
let menuOnTop = false;
function holdOnTop(on) {
  menuOnTop = on;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(on, 'screen-saver');
}

function bringToFront() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true, menuOnTop ? 'screen-saver' : 'floating');
  win.focus();
  setTimeout(() => win && !win.isDestroyed() && !menuOnTop && win.setAlwaysOnTop(false), 300);
  win.webContents.send('app-focus');
}

// After a game closes: Windows won't let a program take the focus back by itself, so
// keys.exe (which can) puts our window in front, then the usual bringToFront.
function focusSelf() {
  if (!win || win.isDestroyed()) return;
  bringToFront();
  const hwnd = win.getNativeWindowHandle();
  const id = process.arch === 'x64' ? hwnd.readBigUInt64LE(0).toString() : String(hwnd.readUInt32LE(0));
  keysExe(['focus', id]).then(() => setTimeout(bringToFront, 150));
}

// ---------- Launching apps ----------
function launch(tile) {
  return new Promise((resolve) => {
    const target = P.resolve((tile.path || '').trim());
    if (!target) return resolve({ ok: false, error: 'No program set for this tile.' });
    if (/^[a-z][a-z0-9+.-]+:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
      shell.openExternal(target);
      return resolve({ ok: true });
    }
    if (!fs.existsSync(target)) return resolve({ ok: false, error: `Not found:\n${target}` });
    const ext = path.extname(target).toLowerCase();
    if (ext !== '.exe') {
      shell.openPath(target).then((err) => resolve(err ? { ok: false, error: err } : { ok: true }));
      return;
    }
    if (tile.saveLink) { try { ensureSaveLink(tile.saveLink); } catch (e) { console.error('[saves]', e.message); } }
    // An app from the catalog that hides to the tray when closed (PlexDeck) has its own way to quit for real
    const known = Object.values(appInstaller.CATALOG).find((c) => c.quitArgs && c.exe && path.basename(target).toLowerCase() === c.exe.toLowerCase());
    startProgram(target, splitArgs(tile.args || ''), tile.cwd || path.dirname(target), tile.name, known ? { quitArgs: known.quitArgs } : {}).then(resolve);
  });
}

// A program that keeps its saves in a fixed place outside MediaDeck (GameMaker games: %LOCALAPPDATA%\<game>):
// tile.saveLink = { from: '%LOCALAPPDATA%\\AM2R', to: 'Apps\\AM2RLauncher\\saves' } makes "from" a link (junction)
// to the folder in MediaDeck, so the saves travel with it. Checked at every start (a link only exists on the PC it was
// made on; MediaDeck may have moved). Saves already in "from" are copied over first (and kept as <from>.before-mediadeck)
// - only when the MediaDeck folder has none yet; nothing is deleted.
function ensureSaveLink({ from, to }) {
  const src = path.resolve(String(from || '').replace(/%([^%]+)%/g, (m, v) => process.env[v] || m));
  const dest = path.resolve(P.resolve(to || ''));
  if (!from || !to || /%/.test(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  let st = null;
  try { st = fs.lstatSync(src); } catch {}
  if (st && st.isSymbolicLink()) {
    let now = '';
    try { now = path.resolve(fs.readlinkSync(src)); } catch {}
    if (now.toLowerCase() === dest.toLowerCase()) return;
    fs.unlinkSync(src);                                  // the link only (an old PC / an old MediaDeck folder)
  } else if (st && st.isDirectory()) {
    if (fs.readdirSync(dest).length) { console.warn(`[saves] ${src} and ${dest} both have saves - left as they are`); return; }
    fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: false });
    fs.renameSync(src, `${src}.before-mediadeck`);
  } else if (st) return;                                 // a file of that name: not ours to change
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.symlinkSync(dest, src, 'junction');
}

// ---------- What's running, and the controller combo to get back ----------
// tools\padwatch.exe watches the controllers the whole time MediaDeck runs (only reading them): the PS / Guide
// button (or Back + Start held 1 s) brings MediaDeck back over a game, and on the home screen opens the Exit menu.
let running = null;   // { pid, name }
let padwatch = null;

// YouTube (built in): its window over MediaDeck; the PS button (controller watcher) brings
// MediaDeck back and leaves YouTube paused for "open again"
function openYouTube() {
  youtube.open(win);
  startPadWatch();
  return true;
}
function youtubeHome() {
  youtube.hide();
  focusSelf();
  // the PS menu for YouTube: Back to YouTube / its settings (TizenTube) / Close / Stay
  setTimeout(() => win && !win.isDestroyed() && win.webContents.send('youtube-menu'), 250);
}
function youtubeAction(a) {
  if (a === 'resume') youtube.open(win);
  else if (a === 'tizentube') { youtube.open(win); setTimeout(() => youtube.key('tizentube'), 600); }
  else if (a === 'close') youtube.close();
  // "stay": YouTube waits, paused; the controller watcher is only needed while a game or YouTube is in front
  if (a === 'close' || a === 'stay') { if (!(running && isAlive(running.pid))) stopPadWatch(); }
  return true;
}

// Twitch (built in): SmartTwitchTV's TV interface in its own window, like YouTube. What it would
// play goes to MediaDeck's own player through Streamlink (Apps\Streamlink), which leaves
// Twitch's ads out of live streams; videos (VODs) play straight from Twitch (they have no ads in
// the stream itself). When the player closes, Twitch comes back where it was.
const STREAMLINK = path.join(P.APPS, 'Streamlink', 'bin', 'streamlink.exe');
let twitchPlay = null;   // { key, at, proc }
// Streamlink without an ffmpeg of its own (the bundled copy leaves it out) uses MediaDeck's
const streamlinkFfmpeg = () => {
  const own = path.join(path.dirname(path.dirname(STREAMLINK)), 'ffmpeg', 'ffmpeg.exe');
  const ours = path.join(P.APPS, 'ffmpeg', 'bin', 'ffmpeg.exe');
  return !fs.existsSync(own) && fs.existsSync(ours) ? ['--ffmpeg-ffmpeg', ours] : [];
};

function openTwitch() {
  twitch.open(win);
  startPadWatch();
  return true;
}
function twitchHome() {
  twitch.hide();
  focusSelf();
  setTimeout(() => win && !win.isDestroyed() && win.webContents.send('twitch-menu'), 250);
}
function twitchAction(a) {
  if (a === 'resume') twitch.open(win);
  else if (a === 'close') twitch.close();
  if (a === 'close' || a === 'stay') { if (!(running && isAlive(running.pid)) && !youtube.isShown()) stopPadWatch(); }
  return true;
}

let twitchWasFull = null;  // MediaDeck's own full-screen state while a Twitch stream plays

function stopTwitchStream() {
  if (twitchPlay && twitchPlay.proc) { try { twitchPlay.proc.kill(); } catch {} }
  twitchPlay = null;
  if (twitchWasFull === false && win && !win.isDestroyed()) win.setFullScreen(false);
  twitchWasFull = null;
}
// "1h2m3s" → seconds
const twitchTime = (t) => { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

// The names for the player: streamer's display name, the stream's (or video's) title and game,
// from Twitch's public API (the web client's ID, as SmartTwitchTV and Streamlink use). 4 s at most.
async function twitchInfo(req) {
  const q = req.video
    ? `{video(id:${JSON.stringify(req.video)}){title owner{displayName} game{displayName}}}`
    : `{user(login:${JSON.stringify(req.channel)}){displayName stream{title game{displayName}}}}`;
  try {
    const r = await Promise.race([
      net.fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) }).then((x) => x.json()),
      wait(4000).then(() => null),
    ]);
    const d = r && r.data;
    const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    if (req.video && d && d.video) {
      const v = d.video;
      return { title: tidy(v.title) || 'Twitch video', subtitle: [v.owner && v.owner.displayName, v.game && v.game.displayName, 'Twitch video'].filter(Boolean).join('  ·  ') };
    }
    if (!req.video && d && d.user) {
      const u = d.user, s = u.stream || {};
      return { title: tidy(u.displayName) || req.channel, subtitle: ['Live', s.game && s.game.displayName, tidy(s.title)].filter(Boolean).join('  ·  ') };
    }
  } catch {}
  return req.video ? { title: 'Twitch video', subtitle: 'Twitch' } : { title: req.channel, subtitle: 'Live on Twitch' };
}

async function playTwitch(req) {
  const key = JSON.stringify(req);
  // SmartTwitchTV asks twice for the same channel (new player + "set channel")
  if (twitchPlay && twitchPlay.key === key && Date.now() - twitchPlay.at < 4000) return;
  stopTwitchStream();
  const back = (msg) => {
    if (twitchPlay !== me) return;
    stopTwitchStream();
    twitch.open(win);
    twitch.ended();
    twitch.notice(msg);
  };
  const me = twitchPlay = { key, at: Date.now(), proc: null };
  if (!fs.existsSync(STREAMLINK)) { back('Streamlink is missing (Apps\\Streamlink)'); return; }
  const info = twitchInfo(req);   // asked meanwhile
  // Settings → Twitch → Stream quality: the best the stream has up to that one ('720p60' leaves
  // out 1080p; streams with nothing that low play their lowest), or the sound only
  const q = String(config.settings.twitchQuality || 'best').split(',')[0];
  const pick = q === 'audio_only' ? ['audio_only,worst'] : /^\d{3,4}p\d{0,3}$/.test(q) ? ['--stream-sorting-excludes', `>${q}`, 'best,worst-unfiltered'] : ['best'];
  twitch.hide();
  // full screen like Twitch itself, put back as it was afterwards (twitchRestore)
  if (twitchWasFull === null) { twitchWasFull = win.isFullScreen(); if (!twitchWasFull) win.setFullScreen(true); }
  focusSelf();
  if (req.video) {
    // a video: its playlist straight into the player, so seeking works
    execFile(STREAMLINK, ['--stream-url', ...pick.slice(0, -1), `https://www.twitch.tv/videos/${req.video}`, pick[pick.length - 1]], { windowsHide: true, timeout: 30000 }, async (err, out) => {
      if (twitchPlay !== me) return;
      const url = String(out || '').trim();
      if (err || !/^https:\/\//.test(url)) { back("Couldn't open this video"); return; }
      const i = await info;
      if (twitchPlay !== me) return;
      const r = mpv.open([url], 0, { fromStart: true, ...i, stream: true, start: twitchTime(req.time) });
      if (!r.ok) back(r.error);
    });
    return;
  }
  // live: Streamlink serves the stream (ads left out) on a local address the player reads
  const proc = me.proc = spawn(STREAMLINK, ['--player-external-http', '--player-external-http-interface', '127.0.0.1', '--player-external-http-port', '0',
    '--player-external-http-continuous', 'no', ...streamlinkFfmpeg(), ...pick.slice(0, -1), `https://www.twitch.tv/${req.channel}`, pick[pick.length - 1]], { windowsHide: true });
  let out = '';
  let started = false;
  const onData = async (d) => {
    out += String(d);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
    if (started || !m || twitchPlay !== me) return;
    started = true;
    const i = await info;
    if (twitchPlay !== me) return;
    const r = mpv.open([`http://127.0.0.1:${m[1]}/`], 0, { fromStart: true, ...i, stream: true, live: true });
    if (!r.ok) back(r.error);
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', () => {
    if (twitchPlay !== me) return;
    if (!started) back(/No playable streams/i.test(out) ? `${req.channel} is offline` : `Couldn't open ${req.channel}`);
    else me.proc = null;   // the stream ended: the player reaches its end and closes
  });
}

// ---------- Apps installed from MediaDeck (Settings → Apps; app-installer.js) ----------
// Checked once a day at start (Settings → Apps → Check for updates at start). Streamlink is
// updated by itself (it keeps up with Twitch's changes only when it's current; never while a
// stream plays); for the others MediaDeck says an update is there.
const APP_UPDATES_FILE = path.join(DATA, 'app-updates.json');
let appInstalling = false;

async function installApps(ids, quiet = false) {
  if (appInstalling || installing) return { error: 'An install or update is already running' };
  appInstalling = true;
  const results = [];
  try {
    for (const id of ids || []) {
      try {
        const r = await appInstaller.install(id, {
          net, tempDir: app.getPath('temp'),
          progress: (text, pct) => { if (!quiet && win && !win.isDestroyed()) win.webContents.send('emu-install-progress', { text, pct }); },
        });
        // a new app gets its tile on the Home screen; the bundled player becomes the video player
        if (r.tile && r.tile.path && !config.tiles.some((t) => t.name === r.tile.name || (t.path && path.resolve(P.resolve(t.path)) === path.resolve(r.tile.path)))) {
          config.tiles.push({ id: `app-${id}`, section: 'apps', args: '', image: '', ...r.tile, path: P.rel(r.tile.path) });
        }
        writeJson(CONFIG_FILE, config);
        results.push({ ...r, ok: true });
      } catch (err) { results.push({ id, name: (appInstaller.CATALOG[id] || {}).name || id, ok: false, error: err.message }); }
    }
  } finally { appInstalling = false; }
  return { results, config };
}

// MediaDeck itself, at every start (the built app; from source it's a git pull): a new version → the update window,
// once MediaDeck is in front and nothing of ours runs (never over a game)
// MediaDeck's own update: checked at start and every 6 hours while it runs (on a TV it can run for days). A new
// version is offered once per version, when MediaDeck is in front and free (no game, video or other window open);
// it keeps waiting for that, without a time limit.
let selfUpdateOffered = '';
let selfUpdateWaiting = null;
async function selfUpdateAtStart() {
  if (!app.isPackaged || config.settings.checkMediaDeckUpdates === false) return;
  let me;
  try { me = await selfUpdate.check(net); } catch { return; }
  if (!me.update || me.latest === selfUpdateOffered) return;
  clearTimeout(selfUpdateWaiting);
  const tell = async () => {
    selfUpdateWaiting = null;
    if (!win || win.isDestroyed()) return;
    let busy = (running && isAlive(running.pid)) || mpv.isOpen() || !win.isFocused();
    // another window (a menu, a message) open in MediaDeck: wait until it is closed
    if (!busy) busy = await win.webContents.executeJavaScript('!!(window.UI && UI.isOpen) || App.current !== Home').catch(() => false);
    if (busy) { selfUpdateWaiting = setTimeout(tell, 15000); return; }
    selfUpdateOffered = me.latest;
    win.webContents.send('mediadeck-update', { latest: me.latest, notes: me.notes || [] });
  };
  tell();
}

async function appUpdatesAtStart(force = false) {
  const last = readJson(APP_UPDATES_FILE, null);
  if (!force && (!config.settings.checkAppUpdates || (last && Date.now() - Date.parse(last.checked) < 20 * 3600e3))) return { skipped: true };
  const list = await appInstaller.status(net, true);
  const todo = list.filter((x) => x.update && !x.setup);   // (driver installers only matter when installing)
  writeJson(APP_UPDATES_FILE, { checked: new Date().toISOString(), list: todo.map(({ id, name, version, latest }) => ({ id, name, version, latest })) });
  const auto = todo.filter((x) => appInstaller.CATALOG[x.id].auto && !(x.id === 'streamlink' && twitchPlay));
  const done = auto.length ? (await installApps(auto.map((x) => x.id), true)).results || [] : [];
  for (const r of done) if (r.ok && win && !win.isDestroyed()) win.webContents.send('toast', `${r.name} updated to ${r.version}`);
  const rest = todo.filter((x) => !auto.includes(x));
  if (rest.length && win && !win.isDestroyed()) win.webContents.send('app-updates', rest);
  return { updates: todo.map((x) => x.id), auto: done.map((r) => r.id) };
}

function startPadWatch() {
  if (padwatch) return;
  const exe = P.tool('padwatch.exe');
  if (!fs.existsSync(exe)) return;
  padwatch = spawn(exe, [], { windowsHide: true });
  padwatch.stdout.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      if (line.trim() === 'home') homePressed();
      if (line.trim() === 'release') homeReleased();
    }
  });
  const me = padwatch;
  padwatch.on('exit', () => {
    if (padwatch !== me) return;
    padwatch = null;
    if (!quitting) setTimeout(() => { if (!quitting) startPadWatch(); }, 1000);   // stopped by itself: again
  });
}

// Emulators that crash when anything comes over them (MAME32) close after holding PS a while
let holdTimer = null;
function homeReleased() { clearTimeout(holdTimer); holdTimer = null; }

// PS / Guide / Back+Start (from padwatch, or from the test switch)
function homePressed() {
  if (!win || win.isDestroyed()) return;
  if (overlay.isOpen()) return;
  if (youtube.isShown()) { youtubeHome(); return; }
  if (twitch.isShown()) { twitchHome(); return; }
  // a Twitch stream in MediaDeck's player: B / Back there goes back to Twitch
  if (twitchPlay) return;
  const alive = running && isAlive(running.pid);
  if (alive && running.holdToClose) {
    // Nothing may come to the front while it runs: only a long hold closes it, then MediaDeck returns
    if (!holdTimer) holdTimer = setTimeout(async () => { holdTimer = null; await closeRunning(false); bringToFront(); }, running.holdToClose * 1000);
    return;
  }
  if (alive && config.settings.inGameOverlay) { overlay.show(overlayInfo()); return; }
  // At home, MediaDeck in front: the Exit menu (pressed again: it closes)
  if (!alive && !mpv.isOpen() && win.isVisible() && !win.isMinimized() && win.isFocused()) {
    win.webContents.send('power-menu');
    return;
  }
  // nothing of ours running and MediaDeck in the background: another program has the controller - leave it
  if (!alive && !mpv.isOpen()) return;
  if (alive) holdOnTop(true);
  bringToFront();
  // Some full-screen games (Mednafen/SDL) minimise themselves and Windows hands the focus to
  // another program: the menu shows but the controller wouldn't reach it → take it with keys.exe
  if (alive) setTimeout(() => { if (win && !win.isDestroyed() && !win.isFocused()) focusSelf(); }, 400);
  win.webContents.send('running-menu', alive ? { ...overlayInfo(), alive: true } : null);
}

let installing = false;   // an emulator install or update is running

// ---------- Emulator updates: checked once a day at start (if wanted) ----------
// dataemu-updates.json keeps the last check: { checked, list: [{ moduleId, name, installed, latest }] }
const UPDATES_FILE = () => path.join(DATA, 'emu-updates.json');
function readUpdates() { try { return JSON.parse(fs.readFileSync(UPDATES_FILE(), 'utf8')); } catch { return null; } }
function writeUpdates(u) { try { fs.writeFileSync(UPDATES_FILE(), JSON.stringify(u)); } catch {} }
function sendUpdates(fresh) {
  const u = readUpdates();
  if (u && win && !win.isDestroyed()) win.webContents.send('emu-updates', { list: u.list, fresh });
}
async function checkUpdatesAtStart() {
  if (!config.settings.checkEmuUpdates) return;
  const last = readUpdates();
  if (last && Date.now() - new Date(last.checked).getTime() < 20 * 3600e3) return sendUpdates(false);
  try {
    const all = await emuInstaller.checkUpdates(await emuModules.scan(emuDir()), net);
    writeUpdates({ checked: new Date().toISOString(), list: all.filter((x) => x.update).map(({ moduleId, name, installed, latest }) => ({ moduleId, name, installed, latest })) });
    sendUpdates(true);
  } catch {}
}
// After an update (or a manual check) the saved list follows
function rememberUpdates(list) { writeUpdates({ checked: new Date().toISOString(), list: list.filter((x) => x.update).map(({ moduleId, name, installed, latest }) => ({ moduleId, name, installed, latest })) }); }
function forgetUpdates(moduleIds) { const u = readUpdates(); if (u) { u.list = u.list.filter((x) => !moduleIds.includes(x.moduleId)); writeUpdates(u); } }

// ---------- Test switch (only with --test; this PC only; random key per session) ----------
// Lets automated tests do what the player does: start a game, "press" the PS button, pick a
// menu item, and read back what is running.
function startTestSwitch() {
  const key = crypto.randomBytes(12).toString('hex');
  const srv = require('http').createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.searchParams.get('k') !== key) { res.writeHead(403); return res.end(); }
    try {
      if (u.pathname === '/home') { homePressed(); return send({ ok: true }); }
      if (u.pathname === '/release') { homeReleased(); return send({ ok: true }); }
      // Removes games a test started from Recently played (their names match "match")
      if (u.pathname === '/recent-forget') {
        const re = new RegExp(u.searchParams.get('match'), 'i');
        const before = loadRecent().length;
        recent = recent.filter((g) => !re.test(g.title));
        writeGames(RECENT_FILE, recent);
        return send({ removed: before - recent.length, left: recent.map((g) => g.title) });
      }
      if (u.pathname === '/consoles') return send((await consoleList(u.searchParams.has('all'))).map((c) => ({ id: c.id, name: c.name, emulator: c.emulator, emulators: c.emulators.map((e) => e.name), icon: !!c.icon, count: c.count })));
      if (u.pathname === '/covers') {   // download covers for one console (from its chosen emulator)
        const c = (await consoleList(true)).find((x) => x.id === u.searchParams.get('id'));
        const mod = c && await moduleById(c.emulator);
        if (!mod) return send({ error: 'no console' });
        return send(await covers.downloadAll(mod, (await consoleGames(c.id)).list, coverOpts()));
      }
      if (u.pathname === '/console-games') { const r = await consoleGames(u.searchParams.get('id')); return send({ moduleId: r.moduleId, count: r.list.length, first: r.list.slice(0, 3).map((g) => g.title) }); }
      // a whole games folder moved (from -> to): the emulators' game folders, Recently played, favourites, the
      // games folder setting and paths in the emulators' own settings follow it
      if (u.pathname === '/relink-folder') {
        const from = u.searchParams.get('from'), to = u.searchParams.get('to');
        if (!from || !to || !fs.existsSync(to)) return send({ error: 'from / to missing, or to does not exist' });
        const done = await relinkFolder(from, to);
        done.settings = require('./relocate').relocate(from, to, [P.EMU, P.APPS], P.EMU_BACKUPS).map((f) => path.relative(P.ROOT, f));
        const gf = P.resolve(config.settings.gamesFolder || '');
        if (gf && (gf.toLowerCase() === path.resolve(from).toLowerCase() || gf.toLowerCase().startsWith(path.resolve(from).toLowerCase() + path.sep))) {
          config.settings.gamesFolder = P.rel(path.join(to, gf.slice(path.resolve(from).length)));
          writeJson(CONFIG_FILE, config);
          done.gamesFolder = config.settings.gamesFolder;
        }
        gameCache.clear();
        return send(done);
      }
      if (u.pathname === '/scan-games') return send(await win.webContents.executeJavaScript('Home.scanGames().then((r) => ({ added: r.added, removed: r.removed, total: r.total }))'));
      if (u.pathname === '/launch-tile') { const t = config.tiles.find((x) => x.id === u.searchParams.get('id')); return send(t ? await launch(t) : { ok: false, error: 'no such tile' }); }
      if (u.pathname === '/launch') return send(await launchGame(u.searchParams.get('module'), u.searchParams.get('rom')));
      if (u.pathname === '/state') return send({ running: running && isAlive(running.pid) ? { pid: running.pid, name: running.name, emulator: running.emulator } : null, focused: !!(win && !win.isDestroyed() && win.isFocused()), minimized: !!(win && !win.isDestroyed() && win.isMinimized()) });
      // Clicks the menu item whose text contains "label" (the open dialog in MediaDeck)
      if (u.pathname === '/menu') {
        const label = u.searchParams.get('label') || '';
        const r = await win.webContents.executeJavaScript(`(() => {
          const items = [...document.querySelectorAll('#modal-root .menu-item')];
          const b = items.find((x) => x.textContent.toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
          if (b) b.click();
          return { clicked: !!b, items: items.map((x) => x.textContent.trim()) };
        })()`);
        return send(r);
      }
      if (u.pathname === '/relink') return send(await relinkMovedFolders());
      if (u.pathname === '/youtube') return send({ ok: openYouTube() });
      if (u.pathname === '/youtube-action') return send({ ok: youtubeAction(u.searchParams.get('a')) });
      if (u.pathname === '/twitch') return send({ ok: openTwitch() });
      if (u.pathname === '/twitch-action') return send({ ok: twitchAction(u.searchParams.get('a')) });
      // a key press into whichever of MediaDeck's windows has the focus (the player's controls …)
      if (u.pathname === '/focused-key') {
        const w = BrowserWindow.getFocusedWindow();
        if (w) for (const type of ['keyDown', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: u.searchParams.get('key') || 'Escape' });
        return send({ ok: !!w, title: w ? w.getTitle() : null });
      }
      if (u.pathname === '/app-updates') { try { return send(await appUpdatesAtStart(true)); } catch (e) { return send({ error: e.message }); } }
      // installs an emulator for a console, like Settings → Install emulators (it goes through the window's own call)
      if (u.pathname === '/emu-install') return send(await win.webContents.executeJavaScript(`api.installEmulators([${JSON.stringify({ emuId: u.searchParams.get('emu'), consoleId: u.searchParams.get('console') })}]).then((r) => r.results || r)`));
      if (u.pathname === '/apps-install') { const r = await installApps(String(u.searchParams.get('ids') || '').split(',').filter(Boolean)); return send(r.results || r); }
      if (u.pathname === '/apps') return send(await appInstaller.status(net, u.searchParams.has('check')));
      // MediaDeck's own update: check, or (with install) download it, close, update and start again
      if (u.pathname === '/self-update') { try { return send(u.searchParams.has('install') ? await selfUpdate.install(net) : await selfUpdate.check(net)); } catch (e) { return send({ error: e.message }); } }
      // sends install progress like a real download (checks how the progress message behaves)
      if (u.pathname === '/progress-demo') {
        for (let i = 1; i <= 20; i++) { win.webContents.send('emu-install-progress', { text: `Demo: downloading ${i * 5} / 100 MB`, pct: i / 20 - 0.001 }); await wait(150); }
        win.webContents.send('emu-install-progress', { text: 'Demo 1.0 installed', pct: 1 });
        return send({ ok: true });
      }
      if (u.pathname === '/toasts') return send(await win.webContents.executeJavaScript(`(() => { const t = [...document.querySelectorAll('.toast')]; const r = t.map((x) => ({ text: x.textContent.trim(), mark: x.dataset.mark || '', out: x.classList.contains('out') })); t.forEach((x) => { x.dataset.mark = 'seen'; }); return r; })()`));
      // one console's games as MediaDeck lists them (title, region, version, file) — for the duplicates check
      if (u.pathname === '/console-game-list') return send(((await consoleGames(u.searchParams.get('id'))) || { list: [] }).list.map((g) => ({ title: g.title, region: g.region, version: g.version, type: g.type, rom: g.rom })));
      // opens a console's games page
      if (u.pathname === '/open-console') return send({ ok: await win.webContents.executeJavaScript(`Home.showConsoleById(${JSON.stringify(u.searchParams.get('id') || '')})`) });
      // opens a Settings page (and, with run=installEmulators, the emulator installer)
      // the setup / help screens (tests): /open-screen?screen=setup|help&only=bios&step=2&topic=bios
      if (u.pathname === '/open-screen') {
        const scr = u.searchParams.get('screen') === 'help' ? 'Help' : 'Setup';
        const params = { only: u.searchParams.get('only') || undefined, topic: u.searchParams.get('topic') || undefined };
        await win.webContents.executeJavaScript(`App.open(${scr}, ${JSON.stringify(params)})`);
        if (u.searchParams.has('step')) await win.webContents.executeJavaScript(`Setup.show(${Number(u.searchParams.get('step')) || 0})`);
        return send({ ok: true });
      }
      if (u.pathname === '/bios-import') return send(await importBiosFiles([u.searchParams.get('path')]));
      if (u.pathname === '/page-text') return send({ text: await win.webContents.executeJavaScript('document.body.innerText') });
      if (u.pathname === '/open-settings') { await win.webContents.executeJavaScript(`App.open(Settings, ${JSON.stringify({ section: u.searchParams.get('section') || 'general' })})`); return send({ ok: true }); }
      if (u.pathname === '/twitch-key') { twitch.key(u.searchParams.get('a')); return send({ ok: true }); }
      if (u.pathname === '/twitch-play') { playTwitch(u.searchParams.get('video') ? { video: u.searchParams.get('video'), time: u.searchParams.get('time') || '' } : { channel: u.searchParams.get('channel') }); return send({ ok: true }); }
      if (u.pathname === '/twitch-state') return send({ open: twitch.isOpen(), shown: twitch.isShown(), playing: !!twitchPlay, player: mpv.isOpen(), focused: !!(win && !win.isDestroyed() && win.isFocused()) });
      if (u.pathname === '/youtube-focus') { youtube.focusInfo.rules = u.searchParams.has('rules'); return send(await youtube.focusInfo()); }
      if (u.pathname === '/youtube-state') return send({ open: youtube.isOpen(), shown: youtube.isShown(), focused: !!(win && !win.isDestroyed() && win.isFocused()) });
      // per console: the games that have no cover yet (title + file name)
      // covers of games that were moved (a JSON file of [[old path, new path], …])
      if (u.pathname === '/move-covers') return send({ moved: server.moveCovers(JSON.parse(fs.readFileSync(u.searchParams.get('file'), 'utf8'))) });
      if (u.pathname === '/missing-covers') {
        const out = {};
        for (const c of await consoleList(true)) {
          const list = (await consoleGames(c.id)).list.filter((g) => (!g.cover || g.coverIsIcon) && !server.hasCover(g.rom));
          if (list.length) out[c.id] = list.map((g) => ({ title: g.title, file: path.basename(g.rom) }));
        }
        return send(out);
      }
      if (u.pathname === '/auto-covers') { const s = readSecret(COVER_STATE(), {}); s.lastRun = 0; if (u.searchParams.has('fresh')) s.misses = {}; writeSecret(COVER_STATE(), s); await autoCovers(); return send(readSecret(COVER_STATE(), {})); }
      if (u.pathname === '/check-updates') return send(await emuInstaller.checkUpdates(await emuModules.scan(emuDir()), net));
      // Runs the update of one emulator (also when it is already on the latest version)
      if (u.pathname === '/update') {
        if (installing || (running && isAlive(running.pid))) return send({ error: 'busy' });
        const m = (await emuModules.scan(emuDir())).find((x) => x.id === u.searchParams.get('module'));
        if (!m) return send({ error: 'no module' });
        installing = true;
        try {
          const r = await emuInstaller.update(m, { tempDir: app.getPath('temp'), sevenZip: P.tool('7za.exe'), net, emuDir: emuDir(), backupDir: P.EMU_BACKUPS });
          emuModules.setInstaller(m, r);
          forgetUpdates([m.id]);
          await syncEmulators();
          return send({ ok: true, ...r });
        } finally { installing = false; }
      }
      if (u.pathname === '/games') return send((await gamesFor(await moduleById(u.searchParams.get('module')))).slice(0, 2000).map((g) => g.rom));
      res.writeHead(404); res.end();
    } catch (e) { send({ error: e.message }); }
  });
  srv.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(DATA, 'test-switch.json'), JSON.stringify({ port: srv.address().port, key }));
  });
  app.on('will-quit', () => { try { fs.rmSync(path.join(DATA, 'test-switch.json'), { force: true }); } catch {} });
}

// The mouse pointer hides in full-screen programs after this many seconds without moving
// (Settings → General; 0 = never): tools\cursorhide.exe, which puts the pointers back when it stops
let cursorHide = null;
function startCursorHide() {
  stopCursorHide();
  const secs = Number(config.settings.hideCursor) || 0;
  const exe = P.tool('cursorhide.exe');
  if (!secs || !fs.existsSync(exe)) return;
  const me = cursorHide = spawn(exe, [String(secs), String(process.pid)], { windowsHide: true, stdio: 'ignore' });
  me.on('exit', () => { if (cursorHide === me) cursorHide = null; });
}
function stopCursorHide() {
  const exe = P.tool('cursorhide.exe');
  if (cursorHide) { try { cursorHide.kill(); } catch {} cursorHide = null; }
  // killed from outside it can't restore them itself: the normal pointers come back from here
  if (fs.existsSync(exe)) execFile(exe, ['--restore'], { windowsHide: true }, () => {});
}

// It keeps running between games (the PS button opens the Exit menu at home); only quitting stops it
let quitting = false;
function stopPadWatch(force = false) {
  if (!force) return;
  if (padwatch) { const p = padwatch; padwatch = null; try { p.kill(); } catch {} }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Close the running game/app the polite way (like clicking its X, so it can save)
// Does the program (or a program it started) still show a window?
function hasWindow(pid) {
  const ps = `$ids = @(${pid}) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object ProcessId);` +
    `[bool](Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => resolve(/True/i.test(out || ''))));
}

// The main process of a program that is running from this exe (the one not started by another of its own
// processes: Electron apps run several), or null
function mainProcessOf(exe) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `$all = @(Get-CimInstance Win32_Process -Filter "Name=${q(path.basename(exe))}" | Where-Object { $_.ExecutablePath -eq ${q(exe)} });` +
    `$ids = $all | ForEach-Object ProcessId; ($all | Where-Object { $ids -notcontains $_.ParentProcessId } | Sort-Object CreationDate | Select-Object -First 1).ProcessId`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
    const pid = parseInt(String(out || '').trim(), 10);
    resolve(Number.isFinite(pid) && isAlive(pid) ? pid : null);
  }));
}

function killTree(pid, force) {
  return new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true }, (err, out, errOut) => {
    // A polite close of the whole tree is refused when a child (e.g. a console host) can only be
    // ended by force: then nothing gets the message. Ask the program itself instead.
    if (!force && /could not be terminated/i.test(String(errOut || '') + String(out || ''))) {
      execFile('taskkill', ['/PID', String(pid)], { windowsHide: true }, () => resolve());
    } else resolve();
  }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Polite first; if it's still running without any window (nothing the player could answer,
// e.g. old full-screen emulators like ZSNES), close it for real. With a window it may be
// asking something (save?), so then the player decides.
async function closeRunning(force) {
  holdOnTop(false);
  if (!running || !isAlive(running.pid)) { running = null; stopPadWatch(); return { closed: true }; }
  const pid = running.pid;
  // Emulators that ignore Windows' close message in full screen (ares) quit with their own key
  const quitKey = running.hotkeys && running.hotkeys.quit;
  if (!force && quitKey && (await keysExe(['send', String(pid), quitKey]))) {
    for (let i = 0; i < 10 && isAlive(pid); i++) await wait(300);
  }
  if (!isAlive(pid)) {
    if (running && running.pid === pid) { running = null; stopPadWatch(); }
    focusSelf();   // the quit key gave the emulator the focus; when it's gone Windows would pick another window
    return { closed: true, forced: false };
  }
  await killTree(pid, force);
  // An app that only hides to the tray when closed (PlexDeck) quits for real with its own command - no
  // "Are you sure?" to wait for
  if (!force && running && running.quitArgs && running.exe) {
    await wait(600);
    if (isAlive(pid)) {
      try { spawn(running.exe, running.quitArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
      for (let t = 0; t < 24 && isAlive(pid); t++) await wait(250);
    }
  }
  if (force) await wait(800);
  else if (isAlive(pid)) {
    // closed, or asking "Are you sure?" (DuckStation, PCSX2): keys.exe answers it as soon as it shows (it keeps
    // looking up to 4 s, and stops when the program is gone) - the player chose Close
    await keysExe(['confirm', String(pid), (running && running.closeSteps || 1) > 1 ? '0' : '4']);   // (not MAME32's game list)
    for (let t = 0; t < 10 && isAlive(pid); t++) await wait(300);
  }
  // Programs that need more than one close (MAME32: game, then its game list)
  // (MAME32 needs a moment between them, and sometimes one more: keep trying while it's there)
  const steps = (running && running.closeSteps) || 1;
  for (let i = 1; !force && steps > 1 && i < steps + 2 && isAlive(pid); i++) {
    await killTree(pid, false);
    for (let t = 0; t < 10 && isAlive(pid); t++) await wait(300);
  }
  // Some emulators (PCSX2) ask "Are you sure?" first: answer it for the player
  if (!force && isAlive(pid) && (await keysExe(['confirm', String(pid)]))) await wait(1500);
  if (!force && isAlive(pid)) await wait(1500);
  let forced = !!force;
  if (!force && isAlive(pid) && !(await hasWindow(pid))) {
    await killTree(pid, true);
    await wait(800);
    forced = true;
  }
  const alive = isAlive(pid);
  // Only forget this program: a new game may have been started while it was closing
  if (!alive && running && running.pid === pid) { running = null; stopPadWatch(); }
  if (!alive) focusSelf();
  return { closed: !alive, forced };
}

// Back to the game: bring its window forward and step MediaDeck aside
function resumeRunning() {
  holdOnTop(false);
  if (running && isAlive(running.pid)) {
    keysExe(['game', String(running.pid)]);
  }
  setTimeout(() => win && !win.isDestroyed() && win.minimize(), 300);
}

// ---------- In-game overlay ----------
const KEYS_EXE = P.tool('keys.exe');
const RA_COMMANDS = { saveState: 'SAVE_STATE', loadState: 'LOAD_STATE', pause: 'PAUSE_TOGGLE', screenshot: 'SCREENSHOT' };

const keysExe = (args) => new Promise((resolve) => execFile(KEYS_EXE, args, { windowsHide: true }, (err) => resolve(!err)));

function overlayInfo() {
  const r = running || {};
  const can = (a) => (r.control === 'retroarch' ? !!RA_COMMANDS[a] : !!(r.hotkeys && r.hotkeys[a]));
  return {
    name: r.name, emulator: r.emulator || '', theme: config.settings.theme,
    actions: ['resume', ...['saveState', 'loadState', 'pause', 'screenshot', 'options'].filter(can), 'home', 'close'],
  };
}

function retroarchCommand(cmd) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.send(Buffer.from(cmd), 55355, '127.0.0.1', () => { sock.close(); resolve(); });
  });
}

async function overlayAction(action) {
  const r = running;
  if (!r || !isAlive(r.pid)) { overlay.hide(); bringToFront(); return { closed: true }; }
  if (action === 'resume') { overlay.hide(); await keysExe(['game', String(r.pid)]); return { ok: true }; }
  if (action === 'home') { overlay.hide(); bringToFront(); return { ok: true }; }
  if (action === 'close') {
    overlay.hide();
    const res = await closeRunning(false);
    bringToFront();
    // Still running with a window open (maybe asking to save): MediaDeck asks what to do
    if (!win || win.isDestroyed()) return res;
    if (!res.closed) win.webContents.send('running-menu', { name: r.name, alive: true });
    else win.webContents.send('toast', res.forced ? `${r.name} closed (it had no window left)` : `${r.name} closed`);
    return res;
  }
  // Save / load state, pause, screenshot: back to the game, then tell the emulator
  overlay.hide();
  if (r.control === 'retroarch' && RA_COMMANDS[action]) {
    await keysExe(['game', String(r.pid)]);
    await wait(350);
    await retroarchCommand(RA_COMMANDS[action]);
    return { ok: true };
  }
  const combo = r.hotkeys && r.hotkeys[action];
  if (combo) return { ok: await keysExe(['send', String(r.pid), combo]) };
  await keysExe(['game', String(r.pid)]);
  return { ok: false };
}

// Starts a program, minimises MediaDeck, and brings it back when the program closes
function startProgram(exe, args, cwd, name, meta = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      // Some programs (Ryujinx) crash when started without any console: they start attached
      child = spawn(exe, args, { cwd, detached: !(meta && meta.attached), stdio: 'ignore', ...(meta && meta.env ? { env: { ...process.env, ...meta.env } } : {}) });
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    child.once('error', (e) => resolve({ ok: false, error: e.message }));
    child.once('spawn', () => {
      resolve({ ok: true });
      holdOnTop(false);
      running = { pid: child.pid, name: name || path.basename(exe, '.exe'), exe, ...meta };
      startPadWatch();
      // Bring the game's window forward once it exists (Windows doesn't always let it come
      // to the front by itself); tried a few times during the first seconds only
      for (const ms of [1500, 3500, 7000]) setTimeout(() => { if (running && running.pid === child.pid && isAlive(child.pid)) keysExe(['game', String(child.pid)]); }, ms);
      if (config.settings.minimizeOnLaunch !== false) setTimeout(() => win && !win.isDestroyed() && win.minimize(), 400);
    });
    // Come back to the home screen when the program closes (ignore launchers that exit right away;
    // the controller combo keeps working for whatever they started)
    child.once('exit', () => {
      if (Date.now() - started <= 5000) {
        // Gone at once: a program that runs only once (PlexDeck, Audiobookshelf) handed over to the copy
        // already running - follow that one, so the PS button and Close still reach it
        mainProcessOf(exe).then((pid) => {
          if (!pid || !running || running.pid !== child.pid) return;
          running.pid = pid;
          // no 'exit' event for a process we didn't start: look now and then, and come back when it's gone
          const watch = setInterval(() => {
            if (!running || running.pid !== pid) return clearInterval(watch);
            if (isAlive(pid)) return;
            clearInterval(watch);
            running = null;
            stopPadWatch();
            bringToFront();
          }, 2000);
        });
        return;
      }
      // Only the program that is running now: an older one that exits late (after the next
      // game started) must not switch off the PS button for the new one
      if (running && running.pid === child.pid) running = null;
      if (!running) stopPadWatch();
      bringToFront();
    });
    child.unref();
  });
}

// ---------- Games ----------
const gameCache = new Map(); // module id -> { key, list }

async function moduleById(id) {
  return (await emuModules.scan(emuDir())).find((x) => x.id === id) || null;
}

async function gamesFor(mod, fresh) {
  const key = JSON.stringify([mod.romFolders, mod.romExtensions, mod.gameArgs]);
  const hit = gameCache.get(mod.id);
  if (hit && hit.key === key && !fresh) return hit.list;
  const list = await games.scanGames(mod);
  gameCache.set(mod.id, { key, list });
  return list;
}

// ---------- Consoles: one card per console, played with the emulator chosen for it ----------
// A console is found from an emulator's game folders (folder names), or from its system
// when it has no folders (MAME, NeoRAGEx keep their games inside the emulator).
const CONSOLE_ORDER = ['NES', 'SNES', 'N64', 'GameCube', 'Wii', 'Switch', 'Game Boy', 'Game Boy Color', 'GBA', 'DS', '3DS',
  'SG-1000', 'Master System', 'Game Gear', 'Mega Drive', '32X', 'Sega CD', 'Saturn', 'Dreamcast',
  'PS1', 'PS2', 'PS3', 'PSP', 'Atari 2600', 'TurboGrafx-16', 'Neo Geo', 'Neo Geo Pocket', 'Neo Geo Pocket Color', 'Arcade', 'CD-i'];
// Standalone emulators first; RetroArch only when nothing else plays the console
// Default emulator of a console: dedicated standalones first, then all-rounders (they never take
// a console over just by being installed), then old ones, RetroArch last
const emuRank = (m) => (games.isRetroArch(m) ? 0 : /^(zsnes|epsxe)$/i.test(m.name) ? 1 : /^(jgenesis|mednafen|bizhawk)$/i.test(m.name) ? 2 : 3);
const consoleIcon = (system, raDir) => {
  if (!raDir) return null;
  const dir = path.join(raDir, 'assets', 'xmb', 'systematic', 'png');
  const name = { 'Nintendo - Switch': 'Nintendo - Switch', 'Microsoft - DOS': 'DOS' }[system] || system;   // RetroArch's file names
  const file = name && path.join(dir, name + '.png');
  return file && fs.existsSync(file) ? file : null;
};

// Home's maker rows where a console's name doesn't say it
const MAKER_OF = { MAME: 'Arcade', 'Microsoft - DOS': 'PC' };

async function consoleList(all) {
  const mods = (await emuModules.scan(emuDir())).filter((m) => !m.hidden && m.ok);
  // Console logos come from RetroArch's assets, wherever its folder is
  const ra = mods.find((m) => games.isRetroArch(m));
  const raDir = ra && path.dirname(ra.exe);
  const map = new Map();
  for (const m of mods) {
    const where = (m.romFolders || []).length ? m.romFolders.map((f) => games.folderPath(f) + '\\x') : [''];
    for (const w of where) {
      const system = covers.systemFor(m, w);
      const id = system || 'emu:' + (m.system || m.name);
      if (!map.has(id)) {
        const c = covers.consoleOf(m, w);
        map.set(id, { id, system, name: c.console, ratio: c.ratio, icon: consoleIcon(system, raDir), emulators: [] });
      }
      const c = map.get(id);
      if (!c.emulators.some((e) => e.moduleId === m.id)) c.emulators.push({ moduleId: m.id, name: m.name, rank: emuRank(m) });
    }
  }
  const chosen = config.settings.consoleEmu || {};
  const order = (c) => { const i = CONSOLE_ORDER.indexOf(c.name); return i < 0 ? 999 : i; };
  const out = [];
  for (const c of map.values()) {
    c.emulators.sort((a, b) => b.rank - a.rank);
    const pick = c.emulators.find((e) => e.moduleId === chosen[c.id]) || c.emulators[0];
    // How many games the chosen emulator has for it (lists are cached after the first scan)
    const mod = mods.find((m) => m.id === pick.moduleId);
    const list = await gamesFor(mod);
    const count = c.system ? list.filter((g) => covers.systemFor(mod, g.rom) === c.system).length : list.length;
    // The maker, for the rows on Home ("Nintendo - Wii" -> Nintendo; MAME -> Arcade; DOS games are PC games,
    // whatever libretro's "Microsoft - DOS" says)
    const maker = !c.system ? 'Other' : MAKER_OF[c.system] || c.system.split(' - ')[0];
    out.push({ ...c, emulator: pick.moduleId, count, maker });
  }
  // Consoles without games stay out of sight unless the user wants to see them
  return out.filter((c) => c.count > 0 || all || config.settings.showEmptyConsoles)
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

// The games of one console, from the emulator chosen for it
async function consoleGames(consoleId, moduleId, fresh) {
  const c = (await consoleList(true)).find((x) => x.id === consoleId);
  if (!c) return { moduleId: null, list: [] };
  const mod = await moduleById(moduleId && c.emulators.some((e) => e.moduleId === moduleId) ? moduleId : c.emulator);
  if (!mod) return { moduleId: null, list: [] };
  const mine = (rom) => (c.system ? covers.systemFor(mod, rom) === c.system : true);
  const list = (await gamesFor(mod, fresh)).filter((g) => mine(g.rom))
    .map((g) => ({ ...g, ...covers.consoleOf(mod, g.rom), storedCover: (!g.cover || g.coverIsIcon) && server.hasCover(g.rom) }));
  return { moduleId: mod.id, list };
}

// BIOS import (bios-import.js): the user's own BIOS files from a folder / zip, recognised by checksum, into
// BIOS\<console>, then copied to the emulators that need them
async function importBiosFiles(sources) {
  const say = (text) => { if (win && !win.isDestroyed()) win.webContents.send('emu-install-progress', { text, pct: 0 }); };
  const r = await require('./bios-import').importBios(sources, P.BIOS, { sevenZip: P.tool('7za.exe'), tempDir: app.getPath('temp'), progress: say });
  r.copied = r.added.length ? (await setupScan.biosSync(P.BIOS, await emuModules.scan(emuDir()))).length : 0;
  r.added = r.added.map(({ folder, name }) => ({ folder, name }));
  return r;
}

let recent = null; // [{ moduleId, rom, title, region, type, cover, t }]
const loadRecent = () => (recent = recent || readGames(RECENT_FILE));
const FAV_FILE = path.join(DATA, 'favorites.dat');
let favGames = null;
const loadFavs = () => (favGames = favGames || readGames(FAV_FILE));

async function launchGame(moduleId, rom) {
  const mod = await moduleById(moduleId);
  if (!mod) return { ok: false, error: 'This emulator was not found in Emu_modules.' };
  if (!mod.ok) return { ok: false, error: `${mod.name} was not found:\n${mod.exe}` };
  // Only games found in this emulator's own game folders can be started
  const game = (await gamesFor(mod)).find((g) => g.rom === rom);
  if (!game) return { ok: false, error: 'This game is not in the emulator\'s game folders any more.' };
  if (!fs.existsSync(rom)) return { ok: false, error: 'The game file was not found (is its drive connected?).' };
  if (mod.pcGames) {
    // a PC game: the program its .game file names (its saves linked into MediaDeck when it says so)
    const g = readPcGame(rom);
    const exe = g && g.exe ? P.resolve(g.exe) : '';
    if (!exe || !fs.existsSync(exe)) return { ok: false, error: `The game's program was not found:\n${exe || rom}` };
    if (g.saveLink) { try { ensureSaveLink(g.saveLink); } catch (e) { console.error('[saves]', e.message); } }
    const r = await startProgram(exe, splitArgs(g.args || ''), g.cwd ? P.resolve(g.cwd) : path.dirname(exe), game.title, { emulator: 'PC games' });
    if (r.ok) {
      loadRecent();
      recent = [{ moduleId, ...game, t: Date.now() }, ...recent.filter((x) => x.rom !== rom)].slice(0, 20);
      writeGames(RECENT_FILE, recent);
    }
    return r;
  }
  let args;
  try { args = games.launchArgs(mod, rom); } catch (e) { return { ok: false, error: e.message }; }
  // Mednafen keeps its settings in %HOME%\.mednafen when HOME is set (Git Bash, MSYS): always its own folder
  const env = emuInstaller.emuIdOf(mod) === 'mednafen' ? { MEDNAFEN_HOME: path.dirname(mod.exe) } : null;
  const r = await startProgram(mod.exe, args, mod.gameCwd === 'rom' ? path.dirname(rom) : path.dirname(mod.exe), game.title,
    { emulator: mod.name, env, control: mod.control, hotkeys: mod.hotkeys || {}, closeSteps: mod.closeSteps || 1, holdToClose: mod.holdToClose || 0, attached: !!mod.attached });
  if (r.ok) {
    loadRecent();
    recent = [{ moduleId, ...game, t: Date.now() }, ...recent.filter((x) => x.rom !== rom)].slice(0, 20);
    writeGames(RECENT_FILE, recent);
  }
  return r;
}

function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

// ---------- Drives ----------
const DRIVE_PS = `
$bus=@{}; $disks=@{}
Get-Disk -ErrorAction SilentlyContinue | ForEach-Object { $disks[[int]$_.Number] = [string]$_.BusType }
Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | ForEach-Object {
  $bus[[string]$_.DriveLetter] = $disks[[int]$_.DiskNumber]
}
@(Get-CimInstance Win32_LogicalDisk | ForEach-Object {
  $l = $_.DeviceID.Substring(0,1)
  [pscustomobject]@{ letter=$l; label=$_.VolumeName; type=[int]$_.DriveType; size=$_.Size; free=$_.FreeSpace; bus=$bus[$l]; remote=$_.ProviderName }
}) | ConvertTo-Json -Compress
`;

let drives = [];
let driveLetters = '';

function queryDrives() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DRIVE_PS], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(drives);
      let list = [];
      try { list = JSON.parse(stdout || '[]'); } catch {}
      if (!Array.isArray(list)) list = [list];
      resolve(list
        .filter((d) => d && d.size)
        .map((d) => ({
          letter: d.letter,
          path: d.letter + ':\\',
          label: d.label || (d.type === 4 ? (d.remote || 'Network') : 'Local Disk'),
          size: +d.size || 0,
          free: +d.free || 0,
          kind: d.type === 2 || d.bus === 'USB' ? 'usb' : d.type === 4 ? 'network' : d.type === 5 ? 'disc' : 'hdd',
          system: (process.env.SystemDrive || 'C:').startsWith(d.letter),
        })));
    });
  });
}

async function currentLetters() {
  const found = [];
  await Promise.all('CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (l) => {
    try { await fsp.access(l + ':\\'); found.push(l); } catch {}
  }));
  return found.sort().join('');
}

// Only runs while something that needs it (the media player) has asked for it.
let watching = false;
let watchTimer = null;

async function watchDrives() {
  if (!watching) return;
  const letters = await currentLetters();
  if (watching && letters !== driveLetters) {
    const before = new Set(drives.map((d) => d.letter));
    driveLetters = letters;
    drives = await queryDrives();
    if (win && !win.isDestroyed() && watching) {
      const added = drives.filter((d) => !before.has(d.letter));
      win.webContents.send('drives-changed', { drives, added });
    }
  }
  if (watching) watchTimer = setTimeout(watchDrives, 2500);
}

async function setDriveWatch(on) {
  clearTimeout(watchTimer);
  watching = !!on;
  if (!watching) return drives;
  driveLetters = await currentLetters();
  drives = await queryDrives();
  watchTimer = setTimeout(watchDrives, 2500);
  return drives;
}

// ---------- Folders ----------
const SKIP = new Set(['$recycle.bin', 'system volume information', 'desktop.ini', 'thumbs.db', '$windows.~bt', '$windows.~ws', 'recovery', 'msocache', 'config.msi']);

async function listDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const showAll = config.settings.showAllFiles;
  const out = [];
  await Promise.all(entries.map(async (e) => {
    const name = e.name;
    if (SKIP.has(name.toLowerCase()) || name.startsWith('$') || name.startsWith('.')) return;
    const full = path.join(dir, name);
    let isDir = e.isDirectory();
    let st = null;
    try { st = await fsp.stat(full); isDir = st.isDirectory(); } catch { if (!isDir) return; }
    const kind = isDir ? 'folder' : kindOf(name);
    if (!showAll && kind !== 'folder' && !['video', 'audio', 'image'].includes(kind)) return;
    out.push({ name, path: full, kind, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 });
  }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, entries: out };
}

// ---------- Program icons ----------
// Pulls the largest icon out of an .exe (up to 256 px) and caches it as a PNG.
// Requests arriving close together share one PowerShell run.
const ICON_DIR = path.join(DATA, 'cache', 'icons');
const ICON_PS = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class IconX {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string f, int i, int cx, int cy, IntPtr[] h, uint[] id, uint n, uint fl);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
}
"@
$jobs = [Console]::In.ReadToEnd() | ConvertFrom-Json
foreach ($j in @($jobs)) {
  try {
    $h = New-Object IntPtr[] 1; $id = New-Object uint32[] 1
    $n = [IconX]::PrivateExtractIcons($j.src, 0, 256, 256, $h, $id, 1, 0)
    if ($n -ge 1 -and $h[0] -ne [IntPtr]::Zero) {
      $bmp = [System.Drawing.Icon]::FromHandle($h[0]).ToBitmap()
      $bmp.Save($j.out, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose(); [void][IconX]::DestroyIcon($h[0])
    }
  } catch {}
}
`;

let iconBatch = null;

function extractIcon(file) {
  const out = path.join(ICON_DIR, crypto.createHash('sha1').update(file.toLowerCase()).digest('hex') + '.png');
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (!iconBatch) {
    const batch = { jobs: [], waiters: [] };
    iconBatch = batch;
    setTimeout(() => {
      iconBatch = null;
      fs.mkdirSync(ICON_DIR, { recursive: true });
      const ps = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ICON_PS], { windowsHide: true, timeout: 30000 },
        () => batch.waiters.forEach((w) => w()));
      ps.stdin.end(JSON.stringify(batch.jobs));
    }, 60);
  }
  iconBatch.jobs.push({ src: file, out });
  return new Promise((resolve) => iconBatch.waiters.push(() => resolve(fs.existsSync(out) ? out : null)));
}

async function fileIcon(file) {
  file = P.resolve(file);
  if (!file || !fs.existsSync(file)) return null;
  if (path.extname(file).toLowerCase() === '.exe') {
    const png = await extractIcon(file);
    if (png) return nativeImage.createFromPath(png).toDataURL();
  }
  try {
    const img = await app.getFileIcon(file, { size: 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch { return null; }
}

// ---------- Emulators (from the Emu_modules folder) ----------
const emuDir = () => config.settings.emuModulesPath || P.EMU;

// Keeps the emulator cards in step with the modules: one card per visible module,
// existing cards keep their place, name and style
// ---------- Covers ----------
// GameTDB's Switch list (product code + title) for Switch box art: downloaded once a month (3.5 MB zip),
// only codes and titles are kept (data\switchtdb.json)
const SWITCH_TDB = () => path.join(DATA, 'switchtdb.json');
let switchTdb = null;
function switchIndex() {
  if (switchTdb) return switchTdb;
  switchTdb = (async () => {
    const file = SWITCH_TDB();
    let old = null;
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (old && Date.now() - fs.statSync(file).mtimeMs < 30 * 86400e3) return old;
    const work = path.join(app.getPath('temp'), `switchtdb-${Date.now()}`);
    try {
      fs.mkdirSync(work, { recursive: true });
      const r = await net.fetch('https://www.gametdb.com/switchtdb.zip?LANG=EN');
      if (!r.ok) throw new Error(String(r.status));
      fs.writeFileSync(path.join(work, 'tdb.zip'), Buffer.from(await r.arrayBuffer()));
      await new Promise((res, rej) => require('child_process').execFile(P.tool('7za.exe'), ['x', '-y', `-o${work}`, path.join(work, 'tdb.zip')], { windowsHide: true }, (e) => (e ? rej(e) : res())));
      const index = covers.parseSwitchTdb(fs.readFileSync(path.join(work, 'switchtdb.xml'), 'utf8'));
      if (index.length) { fs.writeFileSync(file, JSON.stringify(index)); return index; }
      return old;
    } catch (e) { console.error('[switchtdb]', e.message); return old; }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
  })();
  return switchTdb;
}

// The box art names libretro has for a console (one GitHub question per console, kept a month in
// data\thumb-index\<console>.json) — for covers whose names differ a little from the game files
const thumbIndexes = new Map();
function libretroIndex(system, kind = 'Named_Boxarts') {
  const id = `${system}|${kind}`;
  if (!thumbIndexes.has(id)) thumbIndexes.set(id, (async () => {
    const dir = path.join(DATA, 'thumb-index');
    const file = path.join(dir, system.replace(/[<>:"/\\|?*]/g, '_') + (kind === 'Named_Boxarts' ? '' : ` - ${kind}`) + '.json');
    let old = null;
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (old && Date.now() - fs.statSync(file).mtimeMs < 30 * 86400e3) return old;
    try {
      // the thumbnail server's folder listing (no question limit, unlike GitHub's API)
      const r = await net.fetch(`https://thumbnails.libretro.com/${encodeURIComponent(system)}/${kind}/`);
      if (!r.ok) throw new Error(String(r.status));
      const names = [...(await r.text()).matchAll(/href="([^"?/]+)\.png"/gi)].map((m) => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } });
      if (!names.length) throw new Error('empty');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(names));
      return names;
    } catch {
      if (!old) thumbIndexes.delete(id);   // try again next time
      return old;
    }
  })());
  return thumbIndexes.get(id);
}

// File list of an extra cover collection on GitHub (covers.js EXTRA_SOURCES), kept a month
const extraIndexes = new Map();
function extraIndex(src) {
  const id = `${src.repo}/${src.dir}`;
  if (!extraIndexes.has(id)) extraIndexes.set(id, (async () => {
    const file = path.join(DATA, 'thumb-index', 'extra-' + id.replace(/[<>:"/\\|?*]/g, '_') + '.json');
    let old = null;
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (old && Date.now() - fs.statSync(file).mtimeMs < 30 * 86400e3) return old;
    try {
      const r = await net.fetch(`https://api.github.com/repos/${src.repo}/git/trees/${src.branch}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(String(r.status));
      const files = (await r.json()).tree.map((t) => t.path).filter((p) => p.startsWith(src.dir + '/') && /\.(png|jpe?g)$/i.test(p)).map((p) => p.slice(src.dir.length + 1));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(files));
      return files;
    } catch {
      if (!old) extraIndexes.delete(id);   // try again next time
      return old;
    }
  })());
  return extraIndexes.get(id);
}

// Games whose cover wasn't found (encrypted, as it holds file names) are left alone by the automatic
// download for two weeks; { lastRun, misses: { rom: time } }
const COVER_STATE = () => path.join(DATA, 'covers-auto.dat');
const coverOpts = (extra = {}) => ({
  net, switchIndex, libretroIndex, extraIndex,
  has: (rom) => server.hasCover(rom),
  save: (rom, img) => server.saveCover(rom, img),
  // an Xbox 360 case wrap (back | spine | front) -> its front, the box's shape (0.71)
  cropFront: (buf) => {
    const im = nativeImage.createFromBuffer(buf);
    const { width, height } = im.getSize();
    const w = Math.round(height * 0.7083);
    return width > w * 1.3 ? im.crop({ x: width - w, y: 0, width: w, height }).toJPEG(90) : buf;
  },
  ...extra,
});

// Once a day, a while after start: covers for every console's games that have none yet (new games too)
async function autoCovers() {
  if (config.settings.autoCovers === false) return;
  const state = readSecret(COVER_STATE(), {});
  state.misses = state.misses || {};
  if (Date.now() - (state.lastRun || 0) < 20 * 3600e3) return;
  const recent = (rom) => Date.now() - (state.misses[rom] || 0) < 14 * 86400e3;
  let found = 0;
  for (const c of await consoleList(true)) {
    if (running && isAlive(running.pid)) break;   // never while a game runs
    const mod = await moduleById(c.emulator);
    if (!mod || mod.pcGames) continue;           // PC games: covers are the pictures next to them
    try {
      const r = await covers.downloadAll(mod, (await consoleGames(c.id)).list, coverOpts({
        skip: recent, missed: (rom) => { state.misses[rom] = Date.now(); },
      }));
      found += r.found;
    } catch (e) { console.error('[covers]', e.message); }
  }
  state.lastRun = Date.now();
  writeSecret(COVER_STATE(), state);
  if (found && win && !win.isDestroyed()) win.webContents.send('covers-auto', { found });
}

// ---------- Game folders that moved ----------
// A games folder moved (…\Game's\Nintendo Snes → …\Game's\Nintendo\Nintendo Snes): the emulators'
// game folders, Recently played, favourites and the covers (stored per game path) follow it.
async function relinkFolder(from, to) {
  const base = path.resolve(from), lower = base.toLowerCase();
  const swap = (p) => {
    if (typeof p !== 'string' || !/^[a-z]:\\/i.test(p)) return p;
    const r = path.resolve(p), l = r.toLowerCase();
    return l === lower || l.startsWith(lower + path.sep) ? path.join(to, r.slice(base.length)) : p;
  };
  const deep = (o) => (typeof o === 'string' ? swap(o) : Array.isArray(o) ? o.map(deep)
    : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : o);
  const done = { modules: 0, recent: 0, favourites: 0, covers: 0 };
  for (const m of await emuModules.scan(emuDir())) {
    const next = deep(m.romFolders || []);
    if (JSON.stringify(next) !== JSON.stringify(m.romFolders || [])) { emuModules.setFolders(m, next); gameCache.delete(m.id); done.modules++; }
  }
  for (const [file, load, set] of [[RECENT_FILE, loadRecent, (v) => (recent = v)], [FAV_FILE, loadFavs, (v) => (favGames = v)]]) {
    const before = load(), after = deep(before);
    const n = before.filter((x, i) => JSON.stringify(x) !== JSON.stringify(after[i])).length;
    if (n) { set(after); writeGames(file, after); done[file === RECENT_FILE ? 'recent' : 'favourites'] = n; }
  }
  // covers: each game file in the new place takes the cover of the same file in the old place
  if (server) {
    const walk = async (dir) => {
      let entries = [];
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(p); continue; }
        const old = path.join(base, p.slice(path.resolve(to).length));
        if (server.hasCover(old) && !server.hasCover(p)) { try { fs.renameSync(server.coverFile(old), server.coverFile(p)); done.covers++; } catch {} }
      }
    };
    await walk(path.resolve(to));
  }
  return done;
}

// At start / rescan: a game folder that is gone, while exactly one folder of the same name sits one
// level deeper next to it (a maker folder was put in between), is followed there
async function relinkMovedFolders() {
  const moves = new Map();
  for (const m of await emuModules.scan(emuDir())) {
    for (const f of m.romFolders || []) {
      const p = games.folderPath(f);
      if (!p || fs.existsSync(p) || moves.has(p.toLowerCase())) continue;
      const parent = path.dirname(p);
      if (!fs.existsSync(parent)) continue;   // drive not connected: leave it alone
      let hits = [];
      try { hits = fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => path.join(parent, d.name, path.basename(p))).filter((x) => fs.existsSync(x)); } catch {}
      if (hits.length === 1) moves.set(p.toLowerCase(), [p, hits[0]]);
    }
  }
  const out = [];
  for (const [from, to] of moves.values()) out.push({ from, to, ...(await relinkFolder(from, to)) });
  if (out.length) console.log('[relink]', JSON.stringify(out));
  return out;
}

// PC games: Games\PC\PC games holds one <Name>.game per Windows game (and <Name>.jpg as its cover); the module
// Emu_modules\PC games.emu.json makes it a console. Both are made when they aren't there.
const PC_GAMES_DIR = path.join(P.GAMES, 'PC', 'PC games');
function ensurePcGames() {
  try {
    fs.mkdirSync(PC_GAMES_DIR, { recursive: true });
    const file = path.join(emuDir(), 'PC games.emu.json');
    if (!fs.existsSync(file)) {
      writeJson(file, { name: 'PC games', system: 'PC games', pcGames: true, exe: '', args: '', gameArgs: '',
        romExtensions: ['game'], romFolders: [P.rel(PC_GAMES_DIR)], hidden: false });
    }
  } catch (e) { console.error('[pc games]', e.message); }
}
// A .game file: { exe, args, cwd, saveLink } - exe / cwd relative to MediaDeck's folder when they are in it
const readPcGame = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
function addPcGame(exe, name, image) {
  const clean = String(name || path.basename(exe, path.extname(exe))).replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Game';
  let file = path.join(PC_GAMES_DIR, `${clean}.game`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(PC_GAMES_DIR, `${clean} (${n}).game`);
  fs.mkdirSync(PC_GAMES_DIR, { recursive: true });
  writeJson(file, { exe: P.rel(exe), args: '' });
  if (image && fs.existsSync(image)) fs.copyFileSync(image, file.replace(/\.game$/, path.extname(image).toLowerCase()));
  gameCache.clear();
  return file;
}

async function syncEmulators() {
  ensurePcGames();
  let mods = [];
  try { mods = await emuModules.scan(emuDir()); } catch (e) { console.error('[emu]', e.message); }
  for (const m of mods) { try { emuModules.addKnownExtensions(m); } catch {} }
  const visible = mods.filter((m) => !m.hidden && m.ok);
  const claimed = new Set();
  const next = [];
  for (const t of config.tiles) {
    if (t.section !== 'emulators') { next.push(t); continue; }
    let m = t.moduleId && visible.find((x) => x.id === t.moduleId);
    // Cards from before modules existed take over the module with the same name
    if (!m && !t.moduleId) m = visible.find((x) => !claimed.has(x.id) && x.name.toLowerCase() === (t.name || '').toLowerCase());
    if (!m || claimed.has(m.id)) continue;
    claimed.add(m.id);
    // relative inside the MediaDeck folder, like every tile (it then works on any drive letter)
    next.push({ ...t, moduleId: m.id, path: P.rel(m.exe), args: m.args, system: m.system });
  }
  for (const m of visible) {
    if (claimed.has(m.id) || m.pcGames) continue;      // PC games is a console, not a program to open
    next.push({
      id: 'm-' + m.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase(), section: 'emulators', moduleId: m.id,
      name: m.name, subtitle: m.system, path: P.rel(m.exe), args: m.args, system: m.system, image: '', style: 'plain',
    });
  }
  if (JSON.stringify(next) !== JSON.stringify(config.tiles)) {
    config.tiles = next;
    writeJson(CONFIG_FILE, config);
  }
  return mods;
}

// ---------- Controllers (DS4Windows + drivers) ----------
// Apps\DS4Windows (installed from Settings → Apps); older setups had it in tools\DS4Windows
const DS4_EXE = [path.join(P.APPS, 'DS4Windows', 'DS4Windows.exe'), P.tool(path.join('DS4Windows', 'DS4Windows.exe'))].find((p) => fs.existsSync(p)) || path.join(P.APPS, 'DS4Windows', 'DS4Windows.exe');
// driver installers: downloaded to Apps\Setup when first needed (app-installer.js)
const SETUP_ID = { vigem: 'vigembus', hidhide: 'hidhide' };

function serviceState(name) {
  return new Promise((resolve) => {
    execFile('sc.exe', ['query', name], { windowsHide: true }, (err, out) => {
      if (err && !out) return resolve('missing');
      if (/1060/.test(out)) return resolve('missing');                 // service does not exist
      resolve(/RUNNING/.test(out) ? 'running' : 'installed');
    });
  });
}

function processRunning(exeName) {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], { windowsHide: true }, (err, out) => resolve(!err && out.toLowerCase().includes(exeName.toLowerCase())));
  });
}

async function controllerStatus() {
  const [vigem, hidhide, ds4Running] = await Promise.all([serviceState('ViGEmBus'), serviceState('HidHide'), processRunning('DS4Windows.exe')]);
  const dotnet8 = (() => { try { return fs.readdirSync('C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App').some((v) => v.startsWith('8.')); } catch { return false; } })();
  return {
    vigem, hidhide, dotnet8,
    ds4: fs.existsSync(DS4_EXE) ? (ds4Running ? 'running' : 'installed') : 'missing',
    setup: { vigem: !!appInstaller.exePath('vigembus'), hidhide: !!appInstaller.exePath('hidhide') },
  };
}

function startDs4(minimised) {
  if (!fs.existsSync(DS4_EXE)) return false;
  spawn(DS4_EXE, minimised ? ['-m'] : [], { cwd: path.dirname(DS4_EXE), detached: true, stdio: 'ignore' }).unref();
  return true;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('get-state', () => ({ config, progress, server: server.status() }));
  ipcMain.handle('watch-drives', (e, on) => setDriveWatch(on));
  ipcMain.handle('emu-rescan', async () => { await relinkMovedFolders().catch(() => {}); const mods = await syncEmulators(); return { config, mods, dir: emuDir() }; });
  // New games added while MediaDeck runs: every emulator's game folders are read again (and new emulators found)
  ipcMain.handle('games-rescan', async () => {
    // (counted by game file: two emulators can share a folder)
    const known = new Set([...gameCache.values()].flatMap((v) => v.list.map((g) => g.rom.toLowerCase())));
    gameCache.clear();
    await relinkMovedFolders().catch(() => {});
    const mods = await syncEmulators();
    const now = new Set();
    for (const m of mods.filter((x) => !x.hidden && x.ok)) for (const g of await gamesFor(m, true)) now.add(g.rom.toLowerCase());
    const added = known.size ? [...now].filter((r) => !known.has(r)).length : 0;
    const removed = known.size ? [...known].filter((r) => !now.has(r)).length : 0;
    return { config, total: now.size, added, removed };
  });
  ipcMain.handle('emu-add', async (e, exePath, name) => {
    const id = await emuModules.add(emuDir(), exePath, name);
    await syncEmulators();
    const tile = config.tiles.find((t) => t.moduleId === id);
    return { config, tileId: tile && tile.id };
  });
  ipcMain.handle('emu-hide', async (e, moduleId) => {
    const mods = await emuModules.scan(emuDir());
    const m = mods.find((x) => x.id === moduleId);
    if (m) emuModules.setHidden(m, true);
    await syncEmulators();
    return { config };
  });
  // ROM folders of one emulator: read (with game counts) and save
  ipcMain.handle('emu-folders', async (e, moduleId) => {
    const m = (await emuModules.scan(emuDir())).find((x) => x.id === moduleId);
    if (!m) return null;
    return { name: m.name, system: m.system, romExtensions: m.romExtensions, folders: await emuModules.countGames(m) };
  });
  ipcMain.handle('emu-games', async (e, moduleId, fresh) => {
    const mod = await moduleById(moduleId);
    // storedCover: a downloaded cover is in the encrypted store
    return mod ? (await gamesFor(mod, fresh)).map((g) => ({ ...g, ...covers.consoleOf(mod, g.rom), storedCover: (!g.cover || g.coverIsIcon) && server.hasCover(g.rom) })) : [];
  });
  ipcMain.handle('consoles', () => consoleList());
  ipcMain.handle('console-games', (e, consoleId, moduleId, fresh) => consoleGames(consoleId, moduleId, !!fresh));
  // Covers for an emulator's games, or (with consoleId) only for that console's games
  ipcMain.handle('covers-download', async (e, moduleId, consoleId) => {
    const mod = await moduleById(moduleId);
    if (!mod) return null;
    if (mod.pcGames) return { found: 0, total: 0 };     // PC games: covers are the pictures next to them
    const list = consoleId ? (await consoleGames(consoleId, moduleId)).list : await gamesFor(mod);
    return covers.downloadAll(mod, list, coverOpts({
      progress: (p) => win && !win.isDestroyed() && win.webContents.send('covers-progress', { moduleId, ...p }),
    }));
  });
  ipcMain.handle('game-launch', (e, moduleId, rom) => launchGame(moduleId, rom));
  ipcMain.handle('running-close', (e, force) => closeRunning(!!force));
  ipcMain.handle('running-resume', () => resumeRunning());
  // Save / load state, pause, screenshot from the menu: back to the game, then tell the emulator
  ipcMain.handle('running-action', (e, action) => (['saveState', 'loadState', 'pause', 'screenshot', 'options'].includes(action) ? overlayAction(action) : null));
  ipcMain.handle('running-info', () => (running && isAlive(running.pid) ? { name: running.name } : null));
  ipcMain.handle('recent-games', async () => {
    const mods = await emuModules.scan(emuDir());
    return loadRecent()
      .filter((g) => mods.some((m) => m.id === g.moduleId && !m.hidden))
      .slice(0, 5)
      .map((g) => ({ ...g, emulator: mods.find((m) => m.id === g.moduleId).name }));
  });
  // Favourite games (encrypted like the history)
  ipcMain.handle('fav-games', async () => {
    const mods = await emuModules.scan(emuDir());
    return loadFavs().filter((g) => mods.some((m) => m.id === g.moduleId && !m.hidden))
      .map((g) => ({ ...g, emulator: mods.find((m) => m.id === g.moduleId).name }));
  });
  ipcMain.handle('fav-toggle', (e, game) => {
    loadFavs();
    const has = favGames.some((x) => x.rom === game.rom);
    favGames = has ? favGames.filter((x) => x.rom !== game.rom)
      : [...favGames, { moduleId: game.moduleId, rom: game.rom, title: game.title, region: game.region, type: game.type, cover: game.cover }];
    writeGames(FAV_FILE, favGames);
    return !has;
  });
  ipcMain.handle('recent-remove', (e, rom) => {
    recent = loadRecent().filter((x) => x.rom !== rom);
    writeGames(RECENT_FILE, recent);
    return true;
  });
  ipcMain.handle('emu-cores', async (e, moduleId) => {
    const mod = await moduleById(moduleId);
    if (!mod || !games.isRetroArch(mod)) return null;
    return { cores: games.availableCores(mod), auto: (mod.romFolders || []).map((f) => games.pickCore({ ...mod }, games.folderPath(f) + '\\x', typeof f === 'string' ? f : { path: f.path })) };
  });
  // ---- installing emulators (Settings → Emulators → Install emulators) ----
  // The games folder: where most emulators' game folders already are
  const gamesRoot = async (mods) => {
    // set in Settings → Emulators → Games folder; else guessed from the emulators' game folders
    const set = P.resolve(config.settings.gamesFolder || '');
    if (set && fs.existsSync(set)) return set;
    const count = new Map();
    // (a console folder inside a maker folder counts for the folder above: <root>\Nintendo\Nintendo Snes)
    const makers = new Set(emuInstaller.CONSOLES.map((c) => c.maker.toLowerCase()).concat(['microsoft', 'philips', 'coleco', 'snk', 'sony', 'sega', 'nintendo']));
    for (const m of mods) for (const f of m.romFolders || []) {
      let d = path.dirname(typeof f === 'string' ? f : f.path || '');
      if (makers.has(path.basename(d).toLowerCase())) d = path.dirname(d);
      if (d && d !== '.') count.set(d, (count.get(d) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || '';
  };
  ipcMain.handle('emu-install-catalog', async () => emuInstaller.catalog(await emuModules.scan(emuDir())));
  // (installing: module level, shared with the test switch)
  ipcMain.handle('emu-install', async (e, picks) => {
    if (installing) return { error: 'An install is already running' };
    installing = true;
    const results = [];
    try {
      const mods = await emuModules.scan(emuDir());
      const root = await gamesRoot(mods);
      for (const { emuId, consoleId } of picks || []) {
        try {
          const r = await emuInstaller.install(emuId, consoleId, {
            emuDir: emuDir(), gamesRoot: root, biosDir: P.BIOS, tempDir: app.getPath('temp'),
            sevenZip: P.tool('7za.exe'), net,
            progress: (text, pct) => { if (win && !win.isDestroyed()) win.webContents.send('emu-install-progress', { text, pct }); },
          });
          // its module (written by the scan) gets the console's game folders
          const now = await emuModules.scan(emuDir());
          const m = now.find((x) => path.resolve(x.dir || '') === path.resolve(r.dir));
          if (m && r.romFolders.length && !(m.romFolders || []).length) emuModules.setFolders(m, r.romFolders);
          if (m) emuModules.setInstaller(m, r);
          results.push({ ...r, ok: true });
        } catch (err) { results.push({ emuId, ok: false, error: err.message }); }
      }
      await syncEmulators();
    } finally { installing = false; }
    return { results, config };
  });
  // Updates: which installed emulators have a newer version, and updating them
  ipcMain.handle('emu-check-updates', async () => { const l = await emuInstaller.checkUpdates(await emuModules.scan(emuDir()), net); rememberUpdates(l); return l; });
  ipcMain.handle('emu-update', async (e, moduleIds) => {
    if (installing) return { error: 'An install or update is already running' };
    if (running && isAlive(running.pid)) return { error: 'Close the game first, then update' };
    installing = true;
    const results = [];
    try {
      const mods = await emuModules.scan(emuDir());
      for (const id of moduleIds || []) {
        const m = mods.find((x) => x.id === id);
        try {
          if (!m) throw new Error('Emulator not found');
          const r = await emuInstaller.update(m, {
            tempDir: app.getPath('temp'), sevenZip: P.tool('7za.exe'), net, emuDir: emuDir(), backupDir: P.EMU_BACKUPS,
            progress: (text, pct) => { if (win && !win.isDestroyed()) win.webContents.send('emu-install-progress', { text, pct }); },
          });
          emuModules.setInstaller(m, r);
          forgetUpdates([id]);
          results.push({ ...r, ok: true });
        } catch (err) { results.push({ name: m ? m.name : id, ok: false, error: err.message }); }
      }
      await syncEmulators();
    } finally { installing = false; }
    return { results, config };
  });
  ipcMain.handle('emu-set-folders', async (e, moduleId, folders) => {
    const m = (await emuModules.scan(emuDir())).find((x) => x.id === moduleId);
    if (!m) return false;
    emuModules.setFolders(m, folders);
    gameCache.delete(moduleId);
    return true;
  });
  ipcMain.handle('controller-status', () => controllerStatus());
  // Player 1 = the first controller in every installed emulator that has no controller set (pad-defaults.js)
  ipcMain.handle('pads-setup', async () => {
    const pads = require('./pad-defaults');
    const done = [];
    for (const m of await emuModules.scan(emuDir())) {
      const id = emuInstaller.emuIdOf(m);
      if (id && m.ok && pads.apply(id, path.dirname(m.exe))) done.push(m.name);
    }
    return [...new Set(done)];
  });
  ipcMain.handle('apps-status', (e, check) => appInstaller.status(net, !!check));
  ipcMain.handle('apps-install', (e, ids) => installApps(ids));
  ipcMain.handle('self-check', async () => { try { return await selfUpdate.check(net); } catch (err) { return { error: err.message }; } });
  ipcMain.handle('self-install', async () => {
    try {
      return await selfUpdate.install(net, (text, pct) => win && !win.isDestroyed() && win.webContents.send('emu-install-progress', { text, pct }));
    } catch (err) { return { error: err.message }; }
  });
  // Runs a driver installer; Windows asks the user to allow it (administrator)
  ipcMain.handle('controller-install', async (e, which) => {
    const id = SETUP_ID[which];
    if (!id) return 'Unknown driver';
    if (!appInstaller.exePath(id)) {
      const r = await installApps([id]);
      const x = (r.results || [])[0];
      if (!x || !x.ok) return (x && x.error) || r.error || 'The installer could not be downloaded.';
    }
    return shell.openPath(appInstaller.exePath(id));
  });
  ipcMain.handle('ds4-open', () => startDs4(false));
  // Windows' own "Allow your controller to open Game Bar" (Settings > Gaming > Game Bar).
  // Only changed when the user flips the switch in Settings > Controllers.
  const GAMEBAR_KEY = 'HKCU\\Software\\Microsoft\\GameBar';
  ipcMain.handle('gamebar-get', () => new Promise((resolve) => {
    execFile('reg', ['query', GAMEBAR_KEY, '/v', 'UseNexusForGameBarEnabled'], { windowsHide: true }, (err, out) => {
      const m = !err && /UseNexusForGameBarEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
      resolve(m ? parseInt(m[1], 16) !== 0 : true);   // missing = Windows default (on)
    });
  }));
  ipcMain.handle('gamebar-set', (e, on) => new Promise((resolve) => {
    execFile('reg', ['add', GAMEBAR_KEY, '/v', 'UseNexusForGameBarEnabled', '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f'],
      { windowsHide: true }, (err) => resolve(!err));
  }));
  ipcMain.handle('open-path', (e, p) => shell.openPath(p || emuDir()));
  // First-start setup and BIOS check (setup-scan.js; reads only)
  ipcMain.handle('setup-find', () => setupScan.findGamesFolders([P.ROOT]));
  ipcMain.handle('setup-scan', async (e, root) => setupScan.scanGames(root || await gamesRoot(await emuModules.scan(emuDir())), await emuModules.scan(emuDir())));
  ipcMain.handle('setup-root', async () => gamesRoot(await emuModules.scan(emuDir())));
  // MediaDeck's own Games folder (portable): made with a folder per console when it isn't there
  ipcMain.handle('setup-starter', () => { const made = emuInstaller.makeStarterFolders(P.GAMES); return { path: P.GAMES, made }; });
  ipcMain.handle('bios-status', async (e, systems) => { setupScan.makeBiosFolders(P.BIOS); return setupScan.biosStatus(P.BIOS, await emuModules.scan(emuDir()), systems); });
  ipcMain.handle('bios-sync', async () => setupScan.biosSync(P.BIOS, await emuModules.scan(emuDir())));
  // BIOS import (bios-import.js): the user's own BIOS files from a folder / zip, recognised by checksum, into
  // BIOS\<console>, then copied to the emulators that need them
  ipcMain.handle('bios-import', (e, sources) => importBiosFiles(sources));
  // PC games: a new .game for a program; the folder they are in
  ipcMain.handle('pcgame-add', (e, exe, name) => { try { return { ok: true, file: addPcGame(exe, name) }; } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('pcgame-folder', () => { fs.mkdirSync(PC_GAMES_DIR, { recursive: true }); return shell.openPath(PC_GAMES_DIR); });
  ipcMain.handle('bios-open', (e, sub) => { const d = path.join(P.BIOS, sub || ''); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
  ipcMain.handle('app-info', () => ({ dataDir: DATA, emuDir: emuDir(), appsDir: P.APPS, appDir: P.ROOT, gamesDir: P.GAMES, version: app.getVersion(), electron: process.versions.electron }));
  ipcMain.handle('save-config', (e, next) => {
    // The window's size and full-screen state belong to this process; keep them.
    const { fullscreen, window } = config.settings;
    const hideBefore = config.settings.hideCursor, portableBefore = portableData();
    // the games folder: relative when it is inside MediaDeck's folder (Games), so the folder can move
    config = { ...next, settings: { ...next.settings, fullscreen, window, gamesFolder: P.rel(next.settings.gamesFolder || '') },
      tiles: (next.tiles || []).map((t) => ({ ...t, ...(t.path ? { path: P.rel(t.path) } : {}), ...(t.image ? { image: P.rel(t.image) } : {}) })) };
    writeJson(CONFIG_FILE, config);
    if (config.settings.hideCursor !== hideBefore) startCursorHide();
    if (portableData() !== portableBefore) relockAll();
    return true;
  });
  ipcMain.handle('launch', (e, tile) => launch(tile));
  ipcMain.handle('youtube-open', () => openYouTube());
  ipcMain.handle('youtube-action', (e, a) => youtubeAction(a));
  ipcMain.handle('twitch-open', () => openTwitch());
  ipcMain.handle('twitch-action', (e, a) => twitchAction(a));
  ipcMain.handle('list-dir', (e, dir) => listDir(dir));
  ipcMain.handle('drives', async () => { drives = await queryDrives(); return drives; });
  ipcMain.handle('set-progress', (e, file, data) => setProgress(file, data));
  ipcMain.handle('get-progress', () => progress);
  ipcMain.handle('pick-file', async (e, opts = {}) => {
    const r = await dialog.showOpenDialog(win, {
      title: opts.title || 'Choose a file',
      defaultPath: opts.defaultPath,
      properties: [opts.folder ? 'openDirectory' : 'openFile'],
      filters: opts.filters,
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('file-icon', (e, file) => fileIcon(file));
  ipcMain.handle('image-data', async (e, file) => {
    try { return nativeImage.createFromPath(P.resolve(file)).toDataURL(); } catch { return null; }
  });
  ipcMain.handle('open-external-player', (e, file) => {
    const vlc = config.settings.vlcPath;
    if (vlc && fs.existsSync(vlc)) { spawn(vlc, ['--fullscreen', file], { detached: true, stdio: 'ignore' }).unref(); return true; }
    shell.openPath(file);
    return true;
  });
  ipcMain.handle('open-data-folder', () => shell.openPath(DATA));
  ipcMain.handle('clear-cache', async () => {
    server.clearCache();
    return true;
  });
  ipcMain.handle('toggle-fullscreen', () => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });
  ipcMain.handle('quit', () => app.quit());
  // Restart MediaDeck (the Exit menu): a new copy starts as this one closes
  ipcMain.handle('restart-app', () => { app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--test') }); app.quit(); });
  ipcMain.handle('power', (e, action) => {
    const cmds = { sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']], restart: ['shutdown', ['/r', '/t', '0']], shutdown: ['shutdown', ['/s', '/t', '0']] };
    if (cmds[action]) spawn(cmds[action][0], cmds[action][1], { detached: true, stdio: 'ignore' }).unref();
    return true;
  });
}

// ---------- Startup ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', bringToFront);
  app.whenReady().then(async () => {
    loadConfig();
    // The browser cache would keep thumbnail links, which contain file paths: empty it
    await session.defaultSession.clearCache().catch(() => {});
    await syncEmulators();
    // BIOS files added to BIOS\<console> by hand go to the emulators that need them (only missing ones; in the background)
    setTimeout(async () => {
      try {
        const copied = await setupScan.biosSync(P.BIOS, await emuModules.scan(emuDir()));
        if (copied.length) console.log(`[bios] ${copied.length} BIOS files copied to the emulators: ${copied.slice(0, 8).join('; ')}${copied.length > 8 ? ' …' : ''}`);
      } catch (e) { console.error('[bios]', e.message); }
    }, 8000);
    // PCSX2 folders on a drive that is gone → its own sub folders (relocate.js)
    try {
      for (const m of await emuModules.scan(emuDir())) {
        if (m.ok && emuInstaller.emuIdOf(m) === 'pcsx2') {
          const fixed = require('./relocate').pcsx2Folders(path.dirname(m.exe));
          if (fixed.length) console.log(`[pcsx2] folders fixed: ${fixed.join('; ')}`);
        }
      }
    } catch (e) { console.error('[pcsx2]', e.message); }
    server = new MediaServer({ dataDir: DATA, getSettings: () => config.settings, cacheKey: cacheKey() });
    await server.start();
    // game folders that moved (e.g. into maker folders) are followed, with their covers
    await relinkMovedFolders().catch((e) => console.error('[relink]', e.message));
    registerIpc();
    youtube.init({
      dataDir: DATA,
      onHome: youtubeHome,
      onClosed: () => { if (!(running && isAlive(running.pid))) stopPadWatch(); focusSelf(); },
    });
    twitch.init({
      onHome: twitchHome,
      onPlay: playTwitch,
      onClosed: () => { stopTwitchStream(); if (!(running && isAlive(running.pid)) && !youtube.isShown()) stopPadWatch(); focusSelf(); },
    });
    if (process.argv.includes('--test')) startTestSwitch();
    overlay.init({ focusWindow: (hwnd) => keysExe(['focus', hwnd]), onAction: overlayAction });
    // DS4Windows starts (minimised) together with MediaDeck, if wanted and not running yet
    if (config.settings.startDs4 && !(await processRunning('DS4Windows.exe'))) startDs4(true);
    mpv.init({
      win: () => win,
      config: () => config,
      dataDir: DATA,
      onShortcut,
      getProgress: () => progress,
      setProgress: (file, data) => setProgress(file, data),
      serverStatus: () => server.status(),
      onClosed: () => {
        if (!win || win.isDestroyed()) return;
        // a Twitch stream: back to Twitch where it was
        if (twitchPlay) { stopTwitchStream(); twitch.open(win); twitch.ended(); return; }
        win.focus();
        win.webContents.send('player-closed', progress);
      },
    });
    createWindow();
    startCursorHide();
    startPadWatch();
    // a while after start, so it never slows the home screen down
    setTimeout(() => { if (!process.argv.includes('--test')) selfUpdateAtStart().catch(() => {}); }, 6000);
    setInterval(() => { if (!process.argv.includes('--test')) selfUpdateAtStart().catch(() => {}); }, 6 * 3600e3);
    setTimeout(() => { if (!process.argv.includes('--test')) { checkUpdatesAtStart(); appUpdatesAtStart().catch((e) => console.error('[apps] updates:', e.message)); } }, 15000);
    setTimeout(() => { if (!process.argv.includes('--test')) autoCovers().catch((e) => console.error('[covers]', e.message)); }, 60000);
    // Bring the home screen back from anywhere
    globalShortcut.register('Control+Alt+Home', bringToFront);
  });
  app.on('will-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    mpv.stop();
    stopPadWatch(true);
    stopCursorHide();
    if (server) server.stop();
    clearTimeout(progressTimer);
    writeProgress(progress);
    // Thumbnails and subtitles are only kept between sessions if the user wants that
    if (server && !config.settings.keepThumbnails) server.clearCache();
  });
  app.on('window-all-closed', () => app.quit());
}
