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
const pads = require('./pads');
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
let folderMoved = false;   // this start: the MediaDeck folder is somewhere else than last time (another drive, another PC)
let xboxSetupsForgotten = [];   // this start: setups of Xbox / PlayStation controllers taken out of the config
let progress = {};
let server = null;

// ---------- Persistence ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

// Text saved from the wrong code page: UTF-8 read as Windows-1252 and saved again - "TV app Â· no ads" on E: since
// 2026-10-17, twice over in a copy of it ("Ã‚Â·"). Read back right; other text stays as it is (as Windows-1252 bytes
// it isn't valid UTF-8: "Pokémon").
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
  0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
function unmangle(s) {
  for (let i = 0; i < 3 && /[Â-ô]/.test(s); i++) {
    const bytes = [];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      const b = c < 0x100 ? c : CP1252[c];
      if (b === undefined) return s;
      bytes.push(b);
    }
    let next;
    try { next = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return s; }
    if (next === s) return s;
    s = next;
  }
  return s;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  // on the disk before it takes the old one's place (a power cut right after could leave an empty file)
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function loadConfig() {
  const defaults = defaultConfig();
  config = readJson(CONFIG_FILE, null);
  // there but unreadable (a typo, a cut-off save): kept as config.json.broken-<time>, and MediaDeck starts with
  // its defaults without the first-start setup - it used to be replaced silently, as if new
  const broken = !config && fs.existsSync(CONFIG_FILE);
  if (broken) { try { fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.broken-${Date.now()}`); } catch {} console.error('[config] config.json could not be read; kept as config.json.broken-*'); }
  const fresh = !config && !broken;
  if (!config) {
    config = defaults;
    writeJson(CONFIG_FILE, config);
  }
  // the first-start setup: new installs only (an install from before it already is set up)
  const setupKnown = !!(config.settings && 'setupDone' in config.settings);
  config.settings = { ...defaults.settings, ...(config.settings || {}) };
  if (!fresh && !setupKnown) config.settings.setupDone = true;
  if (broken) config.settings.setupDone = true;
  // A new MediaDeck keeps its games in its own folder: Games\<maker>\<console>, one folder per console, made now
  if (fresh) {
    try { emuInstaller.makeStarterFolders(P.GAMES); config.settings.gamesFolder = P.rel(P.GAMES); writeJson(CONFIG_FILE, config); } catch {}
    try { setupScan.makeBiosFolders(P.BIOS); } catch {}
  }
  // The MediaDeck folder moved (drive letter, USB stick): emulator settings pointing into the old folder follow it
  const ROOT_FILE = path.join(DATA, 'root.json');
  const was = (readJson(ROOT_FILE, {}) || {}).root;
  if (was && path.resolve(was).toLowerCase() !== path.resolve(P.ROOT).toLowerCase()) {
    folderMoved = true;
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
  // the folders chosen in Settings too (Emu_modules, Games, FFmpeg) - a copy on another PC kept reading the full path
  // of the Emu_modules folder it came from, and missed the emulators added since (Eden)
  const settingsBefore = JSON.stringify(config.settings);
  for (const k of ['emuModulesPath', 'gamesFolder', 'ffmpegPath']) if (config.settings[k]) config.settings[k] = P.rel(follow(config.settings[k]));
  if (JSON.stringify(config.tiles) !== before || JSON.stringify(config.settings) !== settingsBefore) writeJson(CONFIG_FILE, config);
  // a setup saved for an Xbox / PlayStation controller (the setup took any pad): forgotten before the page reads the
  // config - the emulators know that controller themselves (its maps leave RetroArch and Dolphin: forgetXboxSetups)
  xboxSetupsForgotten = Object.keys(config.controllers || {}).filter((k) => pads.xboxLike(k, config.controllers[k]));
  if (xboxSetupsForgotten.length) {
    for (const k of xboxSetupsForgotten) delete config.controllers[k];
    writeJson(CONFIG_FILE, config);
  }
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
  // a card's name or subtitle a tool saved from the wrong code page is read back right
  let unmangled = false;
  for (const t of config.tiles) for (const k of ['name', 'subtitle']) {
    const fixed = typeof t[k] === 'string' ? unmangle(t[k]) : t[k];
    if (fixed !== t[k]) { t[k] = fixed; unmangled = true; }
  }
  if (unmangled) writeJson(CONFIG_FILE, config);
  relockAll();
  progress = readProgress();
  // Play history not kept (Settings → Media Player → Browsing): also what a crash left behind is forgotten
  if (config.settings.keepPlayHistory === false && Object.keys(progress).length) { progress = {}; writeProgress(progress); }
  if (config.settings.keepRecentGames === false && fs.existsSync(RECENT_FILE) && loadRecent().length) { recent = []; writeGames(RECENT_FILE, recent); }
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
  let text = null;
  try { text = fs.readFileSync(PORTABLE_KEY_FILE, 'utf8'); } catch (e) {
    // there but not readable right now (held by antivirus / a sync tool): never replaced by a new key, which would
    // lock away the history, favourites and covers for good - this start works without them
    if (e.code !== 'ENOENT') throw new Error(`portable.key can't be read (${e.code})`);
  }
  if (text !== null) portableKey = Buffer.from(text.trim(), 'base64');
  if (!portableKey || portableKey.length !== 32) {
    // a damaged key is kept aside (portable.key.bad-<time>) before a new one is made
    if (text !== null) { try { fs.renameSync(PORTABLE_KEY_FILE, `${PORTABLE_KEY_FILE}.bad-${Date.now()}`); } catch {} }
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
  // a second unreadable one (a third PC) gets its own copy instead of none
  const copy = fs.existsSync(file + '.other-pc') ? `${file}.other-pc-${Date.now()}` : file + '.other-pc';
  try { fs.copyFileSync(file, copy); } catch {}
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
// (not saved this time - the key or the file held for a moment - instead of an error box; the old file stays)
function writeSecret(file, data) {
  if (!portableData() && !safeStorage.isEncryptionAvailable()) return;
  try {
    fs.writeFileSync(file + '.tmp', lock(JSON.stringify(data)));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { console.error('[data]', path.basename(file), 'not saved:', e.message); }
}
// Played / favourite games: their files are kept relative to MediaDeck's folder when they are in it (Games\…)
const portGame = (g, fn) => ({ ...g, rom: fn(g.rom), ...(typeof g.cover === 'string' && /[\\/]/.test(g.cover) ? { cover: fn(g.cover) } : {}) });
const readGames = (file) => readSecret(file, []).map((g) => portGame(g, P.resolve));
const writeGames = (file, list) => writeSecret(file, list.map((g) => portGame(g, P.rel)));

function writeProgress(data) {
  if (!portableData() && !safeStorage.isEncryptionAvailable()) { console.error('[progress] encryption not available; not saved'); return; }
  const tmp = PROGRESS_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, lock(JSON.stringify(data)));
    fs.renameSync(tmp, PROGRESS_FILE);
  } catch (e) { console.error('[progress] not saved:', e.message); }
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
  windowedBounds = { ...bounds };
  const startFull = !!config.settings.fullscreen;
  win = new BrowserWindow({
    ...(startFull ? screen.getDisplayMatching({ x: bounds.x || 0, y: bounds.y || 0, width: bounds.width, height: bounds.height }).bounds : bounds),
    minWidth: 960, minHeight: 540,
    // always borderless: "full screen" is the window covering the screen (setFull), never Chromium's full-screen
    // mode - with disable-direct-composition (for mpv) that leaves duplicate / ghost MediaDeck entries in Windows
    // 11's Alt+Tab. fullscreenable: false keeps pages from switching it on. thickFrame: false - the standard Windows frame
    // Electron keeps on frameless windows (for resizing) showed as a grey bar along the bottom (and sides): in full
    // screen at the bottom of the screen, under the player too. Resizing by the edges works without it.
    frame: false, thickFrame: false, fullscreenable: false, resizable: !startFull,
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
  full = startFull;
  if (!startFull && bounds.x !== undefined) win.once('ready-to-show', () => { restored = { asked: { ...bounds }, got: win.getBounds() }; });
  if (startFull) { coverScreenAgain(); win.once('ready-to-show', coverScreenAgain); win.webContents.once('did-finish-load', coverScreenAgain); }
  if (saved.maximized && !startFull) win.maximize();
  win.webContents.on('did-finish-load', () => win.webContents.send('win-full', full));
  // the title bar's maximize / restore button
  const tellMax = () => { if (!win.isDestroyed()) win.webContents.send('win-max', win.isMaximized()); };
  win.webContents.on('did-finish-load', tellMax);
  for (const ev of ['maximize', 'unmaximize']) win.on(ev, tellMax);
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => onShortcut(e, input));
  // MediaDeck's own page only: a file or link dropped on the window would load there - and get its preload (start
  // programs, power, settings)
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; app.quit(); });
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, () => { padLog(`screen: ${ev}`); coverScreenAgain(); });
  // Leaving the PS menu any other way (back to the game, save state, Alt+Tab): stop being on top
  win.on('blur', () => {
    padLog(`window lost the focus${Date.now() < claimUntil ? ' (taking it back)' : ''}${menuOnTop ? ', PS menu open' : ''}`);
    // just came to the front (PS menu, back from a program) and Windows or the program behind took the focus:
    // focusSelf takes it back - no stepping aside now
    if (Date.now() < claimUntil) { tellActive(false); return; }
    if (menuOnTop) holdOnTop(false);
    tellActive(false);
    // back to a running game (after MediaDeck's menu): let go of the pads again and get out of the way
    if (running && isAlive(running.pid)) {
      thawGame();
      padsToGame(true);
      if (config.settings.minimizeOnLaunch !== false) setTimeout(() => {
        if (win && !win.isDestroyed() && !win.isFocused() && !win.isMinimized() && running && isAlive(running.pid)) win.minimize();
      }, 400);
    }
  });
  // The controller only works in MediaDeck while its window really is the active one (Chromium can
  // keep thinking it has focus after a game or another program came to the front)
  // The media player open over it: the focus goes on to the player's controls (Alt+Tab or the taskbar pick this window,
  // which the player covers - the player then got no button or key, and only a restart brought it back)
  win.on('focus', () => {
    padLog('window got the focus');
    if (mpv.isOpen() && mpv.focus()) { padLog('passed on to the media player'); return; }
    tellActive(true);
  });
  win.webContents.on('did-finish-load', () => { toldActive = null; });
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, rememberWindow);
}

// MediaDeck's own work folders in Temp (an update, an app / emulator install, a BIOS import, the Switch list) that an
// update stopped halfway or a crash left behind - 1.1 GB of old updates was found. Only these names, each with the time
// it was made in it, and only when that is more than 6 hours ago (never one in use).
const TEMP_LEFTOVER = /^(?:mediadeck-update|mediadeck-app-.+|emu-install-.+|emu-update-.+|bios-import|switchtdb)-(\d{13})(?:-\d+)?$/;
async function cleanTempLeftovers() {
  const tmp = app.getPath('temp');
  let names = [];
  try { names = await fs.promises.readdir(tmp); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    const m = TEMP_LEFTOVER.exec(name);
    if (!m || Date.now() - Number(m[1]) < 6 * 3600e3) continue;
    try { await fs.promises.rm(path.join(tmp, name), { recursive: true, force: true }); n++; } catch {}
  }
  if (n) console.log(`[temp] removed ${n} old work folder(s)`);
  return n;
}

function onShortcut(e, input) {
  if (input.type !== 'keyDown') return;
  if (input.key === 'F11') { setFull(!full); e.preventDefault(); }
  if (input.key === 'F12') { e.sender.toggleDevTools(); e.preventDefault(); }
}

let windowTimer = null;
// Full screen = the window exactly covering its screen (Windows hides the taskbar for it); off = its old place.
// A screen change (resolution, another monitor) while full: it covers the screen again.
let full = false;
let windowedBounds = null;
// Opened or put back as a window, at a scale like 180 % (Windows' 150 % × its text size 120 %) it comes out a few
// points bigger than asked - and grew with every F11 and every start. Not moved or resized since: the place and size
// it was asked for are the ones it keeps.
let restored = null;
const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const windowBounds = () => { const now = win.getBounds(); return restored && sameBounds(now, restored.got) ? { ...restored.asked } : now; };
function setFull(on) {
  if (!win || win.isDestroyed() || on === full) return;
  if (on) {
    if (win.isMaximized()) win.unmaximize();
    windowedBounds = windowBounds();
    full = true;
    win.setResizable(false);   // no resize edge: the window is exactly the screen
    win.setBounds(screen.getDisplayMatching(windowedBounds).bounds);
  } else {
    full = false;
    win.setResizable(true);
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const b = windowedBounds && windowedBounds.width < area.width ? windowedBounds
      : { width: 1280, height: 720, x: area.x + Math.round((area.width - 1280) / 2), y: area.y + Math.round((area.height - 720) / 2) };
    win.setBounds(b);
    restored = { asked: { ...b }, got: win.getBounds() };
  }
  win.webContents.send('win-full', full);
  rememberWindow();
}
function coverScreenAgain() {
  if (full && win && !win.isDestroyed()) win.setBounds(screen.getDisplayMatching(win.getBounds()).bounds);
}

function rememberWindow() {
  clearTimeout(windowTimer);
  windowTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const s = config.settings;
    s.fullscreen = full;
    const prev = s.window || {};
    s.window = { ...prev, maximized: win.isMaximized() };
    if (!s.fullscreen && !win.isMaximized()) Object.assign(s.window, windowBounds());
    try { writeJson(CONFIG_FILE, config); } catch (e) { console.error('[config]', e.message); }   // (held by antivirus a moment)
  }, 600);
}

// While the PS menu is open, MediaDeck stays above full-screen games whose window is
// "always on top" (ares); it drops back as soon as the player leaves the menu
let menuOnTop = false;
function holdOnTop(on) {
  menuOnTop = on;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(on, 'screen-saver');
}

// While a game runs, MediaDeck's pages count as hidden, so Chromium lets go of the controllers: while it reads a
// USB pad that isn't Xbox / PlayStation (for MediaDeck's menus), DirectInput gives the game nothing from it (Dolphin
// got no button). backgroundThrottling: false otherwise keeps a minimized / hidden page "visible". On focus, back.
function padsToGame(on) {
  try { if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(on); } catch {}   // the PS menu: overlay.js
}

// The page reads the controller only while it was told MediaDeck is the active window ('win-active'). Told on
// Chromium's focus / blur, and also when Windows itself says MediaDeck is in front (focusSelf): Chromium can miss
// that it came back, and the controller then stayed dead in MediaDeck while the keyboard worked. Only changes are
// sent (each "true" makes the page ignore the buttons held at that moment).
let toldActive = null;
function tellActive(on) {
  if (!win || win.isDestroyed()) return;
  if (on) {
    padsToGame(false);
    try { if (!win.webContents.isFocused()) win.webContents.focus(); } catch {}
  }
  if (toldActive === on) return;
  toldActive = on;
  padLog(on ? 'controller on in MediaDeck' : 'controller off in MediaDeck');
  win.webContents.send('win-active', on);
}

// The controller log, data\controller-log.txt: focus changes, PS presses, controllers connecting, the buttons MediaDeck
// got - so a controller that "did nothing" can be followed afterwards. No game, app or file names. The last ~2000 lines.
const PAD_LOG = path.join(DATA, 'controller-log.txt');
let padLogTrimmed = false;
function padLog(text) {
  try {
    if (!padLogTrimmed) {
      padLogTrimmed = true;
      const old = fs.existsSync(PAD_LOG) ? fs.readFileSync(PAD_LOG, 'utf8').split('\n') : [];
      if (old.length > 2000) fs.writeFileSync(PAD_LOG, old.slice(-1500).join('\n'));
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    fs.appendFileSync(PAD_LOG, `${stamp}  ${String(text).slice(0, 200)}\n`);
  } catch {}
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

// After a game closes, for the PS menu: Windows won't let a program take the focus back by itself, so
// keys.exe (which can) puts our window in front, then the usual bringToFront - again and again for 2 s until
// MediaDeck really is in front (once in a while Windows still left it with the program, the controller then
// did nothing in the menu). Meanwhile a lost focus is taken back too - not from MediaDeck's own windows (the
// player, YouTube, Twitch), and not after the player went back to the game on purpose (letGoOfFocus).
let claimUntil = 0, claiming = false;
function focusSelf() {
  if (!win || win.isDestroyed()) return;
  claimUntil = Date.now() + 2000;
  padLog('taking the focus (2 s)');
  bringToFront();
  if (claiming) return;
  claiming = true;
  let lastFront = null;
  const step = async () => {
    if (!win || win.isDestroyed() || Date.now() > claimUntil) { claiming = false; return; }
    // Windows' own answer, not Chromium's: Chromium can think MediaDeck still has the focus while Windows gave it to
    // the program that came over it (the menu then showed with the program in front). keys.exe does nothing when
    // MediaDeck really is in front.
    const other = BrowserWindow.getFocusedWindow();
    if (!other || other === win) {
      const front = await keysExe(['focus', hwndOf(win)]);
      if (front !== lastFront) { lastFront = front; padLog(front ? 'Windows: MediaDeck in front' : 'Windows refused to put MediaDeck in front'); }
      if (front) tellActive(true);
      else if (win && !win.isDestroyed() && Date.now() <= claimUntil) bringToFront();
    }
    setTimeout(step, 250);
  };
  setTimeout(step, 100);
}
const letGoOfFocus = () => { claimUntil = 0; };

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
    waitForAppUpdate(known, target, tile.name).then(() =>
      startProgram(target, splitArgs(tile.args || ''), tile.cwd || path.dirname(target), tile.name, known ? { quitArgs: known.quitArgs } : {}).then(resolve));
  });
}

// An app that updates itself after it quit (PlexDeck "Later": its updater unpacks and copies the new version into
// its folder for ~5-20 s): started then, it ran on half-copied files. While it isn't running and its update folder
// still holds the download or the unpacked files, wait (up to 60 s, then start anyway: a stopped updater can leave
// the download behind, and the app itself deals with that).
async function waitForAppUpdate(known, exe, name) {
  if (!known || !known.updating) return;
  const dir = path.join(path.dirname(exe), known.updating);
  const busy = () => { try { return fs.readdirSync(dir).some((n) => /\.zip$/i.test(n) || n.toLowerCase() === 'unpacked'); } catch { return false; } };
  if (!busy() || (await mainProcessOf(exe))) return;
  if (win && !win.isDestroyed()) win.webContents.send('toast', `${name || known.name} is updating - it starts when it's done`);
  for (let i = 0; i < 60 && busy() && !(await mainProcessOf(exe)); i++) await wait(1000);
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
  if (twitchWasFull === false && win && !win.isDestroyed()) setFull(false);
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
  if (twitchWasFull === null) { twitchWasFull = full; if (!twitchWasFull) setFull(true); }
  focusSelf();
  if (req.video) {
    // a video: its playlist straight into the player, so seeking works
    execFile(STREAMLINK, ['--stream-url', ...pick.slice(0, -1), `https://www.twitch.tv/videos/${req.video}`, pick[pick.length - 1]], { windowsHide: true, timeout: 30000 }, async (err, out) => {
      if (twitchPlay !== me) return;
      const url = String(out || '').trim();
      if (err || !/^https:\/\//.test(url)) { back("Couldn't open this video"); return; }
      const i = await info;
      if (twitchPlay !== me) return;
      const r = await mpv.open([url], 0, { fromStart: true, ...i, stream: true, start: twitchTime(req.time) });
      if (!r.ok) back(r.error);
    });
    return;
  }
  // live: Streamlink serves the stream (ads left out) on a local address the player reads
  // (Streamlink that can't start - blocked, half updated - or never gives an address: back to Twitch with a note;
  // before, the Twitch window stayed hidden and the PS button did nothing)
  let proc;
  try {
    proc = me.proc = spawn(STREAMLINK, ['--player-external-http', '--player-external-http-interface', '127.0.0.1', '--player-external-http-port', '0',
      '--player-external-http-continuous', 'no', ...streamlinkFfmpeg(), ...pick.slice(0, -1), `https://www.twitch.tv/${req.channel}`, pick[pick.length - 1]], { windowsHide: true });
  } catch (e) { back(`Couldn't start Streamlink: ${e.message}`); return; }
  proc.on('error', (e) => { if (twitchPlay === me) back(`Couldn't start Streamlink: ${e.message}`); });
  setTimeout(() => { if (twitchPlay === me && !started) { try { proc.kill(); } catch {} back(`Couldn't open ${req.channel}`); } }, 45000);
  let out = '';
  let started = false;
  const onData = async (d) => {
    out += String(d);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
    if (started || !m || twitchPlay !== me) return;
    started = true;
    const i = await info;
    if (twitchPlay !== me) return;
    const r = await mpv.open([`http://127.0.0.1:${m[1]}/`], 0, { fromStart: true, ...i, stream: true, live: true });
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
  // FFmpeg just installed or updated: the media server uses it at once (it only looked at start)
  if (server && results.some((r) => r.ok)) await server.findTools().catch(() => {});
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
  // (one that can't start - blocked a moment - is tried again like one that stopped; before, the PS button
  // stayed dead for the whole session, and a throw here stopped the rest of the start)
  try { padwatch = spawn(exe, pads.padwatchArgs(config.controllers), { windowsHide: true }); } catch (e) { console.error('[padwatch]', e.message); padwatch = null; return; }
  padLog('PS watcher started');
  padwatch.on('error', (e) => {
    console.error('[padwatch]', e.message);
    padLog(`PS watcher error: ${e.message}`);
    if (padwatch !== me) return;
    padwatch = null;
    if (!quitting) setTimeout(() => { if (!quitting) startPadWatch(); }, 5000);
  });
  // (whole lines only: with the menu buttons there is more output, and a line can come in two parts)
  let rest = '';
  padwatch.stdout.on('data', (d) => {
    const lines = (rest + String(d)).split(/\r?\n/);
    rest = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (line === 'home') homePressed();
      else if (line === 'release') homeReleased();
      else if (/^[+-][a-z]+$/.test(line)) padNav(line.slice(1), line[0] === '+');
    }
  });
  const me = padwatch;
  padwatch.on('exit', () => {
    if (padwatch !== me) return;
    padLog('PS watcher stopped by itself (starting it again)');
    padNav(null);
    padwatch = null;
    if (!quitting) setTimeout(() => { if (!quitting) startPadWatch(); }, 1000);   // stopped by itself: again
  });
}

// The menu buttons as padwatch reads them (outside Chromium), for the page while MediaDeck is the active window - or
// the media player's controls while they have the focus: it uses them when Chromium's own controller list missed the
// controller (input.js). null: forget what was held.
function padNav(a, on) {
  if (!win || win.isDestroyed()) return;
  const player = mpv.osdWindow();
  if (a === null) { win.webContents.send('pad-nav', null); if (player) player.webContents.send('pad-nav', null); return; }
  if (player && player.isFocused()) { player.webContents.send('pad-nav', { a, on }); return; }
  if (toldActive !== true || win.isMinimized() || !win.isVisible()) return;
  win.webContents.send('pad-nav', { a, on });
}

// Emulators that crash when anything comes over them (MAME32) close after holding PS a while
let holdTimer = null;
function homeReleased() { clearTimeout(holdTimer); holdTimer = null; }

// PS / Guide / Back+Start (from padwatch, or from the test switch)
function homePressed() {
  if (!win || win.isDestroyed()) return;
  const alive = running && isAlive(running.pid);
  padLog(`PS pressed: ${alive ? 'a program runs' : 'nothing runs'}, MediaDeck ${win.isMinimized() ? 'minimized' : win.isVisible() ? 'shown' : 'hidden'}${win.isFocused() ? ', focused' : ''}${menuOnTop ? ', PS menu open' : ''}`);
  if (overlay.isOpen()) { overlay.refocus(); return; }
  if (youtube.isShown()) { youtubeHome(); return; }
  if (twitch.isShown()) { twitchHome(); return; }
  // The media player open: its controls show and get the focus. (PS brought MediaDeck's window to the front - under
  // the player, which then got no button or key.) Another program in front: MediaDeck comes back first.
  if (mpv.isOpen()) {
    const p = mpv.osdWindow();
    if (!win.isFocused() && !(p && p.isFocused())) bringToFront();
    mpv.focus(true);
    return;
  }
  // a Twitch stream in MediaDeck's player: B / Back there goes back to Twitch
  if (twitchPlay) return;
  if (alive && running.holdToClose) {
    // Nothing may come to the front while it runs: only a long hold closes it, then MediaDeck returns
    const held = running.pid;
    if (!holdTimer) holdTimer = setTimeout(async () => { holdTimer = null; await closeRunning(false); if (!otherRunning(held)) bringToFront(); }, running.holdToClose * 1000);
    return;
  }
  if (alive && config.settings.inGameOverlay) { freezeGame(); overlay.show(overlayInfo()); return; }
  // At home, MediaDeck in front: the Exit menu (pressed again: it closes)
  if (!alive && !mpv.isOpen() && win.isVisible() && !win.isMinimized() && win.isFocused()) {
    win.webContents.send('power-menu');
    return;
  }
  // nothing of ours running and MediaDeck in the background: another program has the controller - leave it
  if (!alive && !mpv.isOpen()) return;
  if (alive) { holdOnTop(true); freezeGame(); }
  // Over a program Windows often keeps the focus with it (the menu showed but the controller didn't reach it):
  // the sure way, until MediaDeck really is in front (focusSelf); over the media player (ours) the usual one
  if (alive) focusSelf(); else bringToFront();
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
// Newer Switch firmware in the BIOS folder than Eden has, that the installed Eden reads: MediaDeck asks once
// (a file the player said "don't ask again" about stays quiet; another, newer one asks again)
async function offerFirmware() {
  if (!win || win.isDestroyed() || installing || (running && isAlive(running.pid))) return;
  const skip = config.settings.firmwareSkip || [];
  const offer = (await emuInstaller.firmwareOffers(await emuModules.scan(emuDir()), P.BIOS)).find((o) => !skip.includes(`${o.moduleId}|${o.zip}`));
  if (offer) win.webContents.send('firmware-offer', offer);
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
      // the page told MediaDeck isn't the active window (as when Chromium missed the focus coming back)
      if (u.pathname === '/tell-inactive') { tellActive(false); return send({ ok: true }); }
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
      if (u.pathname === '/state') return send({ running: running && isAlive(running.pid) ? { pid: running.pid, name: running.name, emulator: running.emulator } : null, focused: !!(win && !win.isDestroyed() && win.isFocused()), minimized: !!(win && !win.isDestroyed() && win.isMinimized()), page: win && !win.isDestroyed() ? await win.webContents.executeJavaScript('document.visibilityState') : null });
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
      // the media player (tests): play a file, read mpv properties, change a sound setting like Y → Options does
      if (u.pathname === '/play') return send(await mpv.open([u.searchParams.get('file')], 0, {}));
      // which window has the focus with the player open; main: MediaDeck's window (under the player) is given it first,
      // like Alt+Tab does
      if (u.pathname === '/player-focus') {
        if (u.searchParams.has('main')) { win.focus(); await new Promise((r) => setTimeout(r, 500)); }
        const p = mpv.osdWindow();
        return send({ open: mpv.isOpen(), player: !!(p && p.isFocused()), main: win.isFocused() });
      }
      if (u.pathname === '/player-eval') { const p = mpv.osdWindow(); return send({ result: p ? await p.webContents.executeJavaScript(u.searchParams.get('js') || 'null') : null }); }
      if (u.pathname === '/player-props') {
        const out = {};
        for (const p of (u.searchParams.get('p') || '').split(',').filter(Boolean)) out[p] = await mpv.get(p);
        return send(out);
      }
      if (u.pathname === '/player-audio') return send({ ok: await mpv.setAudio(u.searchParams.get('key'), u.searchParams.get('value')) });
      // Screen size / Text size for this run only, not saved (tests: screenshots at both ends)
      if (u.pathname === '/scale') {
        const ui = Number(u.searchParams.get('ui')) || 1, text = Number(u.searchParams.get('text')) || 1;
        Object.assign(config.settings, { uiScale: ui, textScale: text });
        await win.webContents.executeJavaScript(`Object.assign(App.state.config.settings, { uiScale: ${ui}, textScale: ${text} }); App.applyScale()`);
        return send({ ok: true });
      }
      if (u.pathname === '/eval') return send({ result: await win.webContents.executeJavaScript(u.searchParams.get('js') || 'null') });
      // MediaDeck's own page as a PNG (to the given file) - works whatever the screen's DPI
      if (u.pathname === '/shot') { fs.writeFileSync(u.searchParams.get('file'), (await win.webContents.capturePage()).toPNG()); return send({ ok: true }); }
      // focuses the i-th element matching sel the way the controller does, and says whether it is in sight
      if (u.pathname === '/nav-check') {
        return send(await win.webContents.executeJavaScript(`(() => {
          const all = [...document.querySelectorAll(${JSON.stringify(u.searchParams.get('sel') || '')})].filter((x) => x.offsetParent);
          const el = all[${Number(u.searchParams.get('i')) || 0} < 0 ? all.length + ${Number(u.searchParams.get('i')) || 0} : ${Number(u.searchParams.get('i')) || 0}];
          if (!el) return { found: all.length };
          Nav.focus(el);
          const r = el.getBoundingClientRect();
          return { found: all.length, text: el.textContent.trim().slice(0, 40), top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, inSight: r.top >= 0 && r.bottom <= innerHeight };
        })()`));
      }
      if (u.pathname === '/clean-temp') return send({ removed: await cleanTempLeftovers() });
      if (u.pathname === '/player-set') return send({ ok: await mpv.set(u.searchParams.get('p'), u.searchParams.get('v')) });
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
          const list = (await consoleGames(c.id)).list.filter((g) => (!g.cover || g.coverIsIcon) && !server.hasCover(g.rom, g.console));
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
  let me;
  try { me = cursorHide = spawn(exe, [String(secs), String(process.pid)], { windowsHide: true, stdio: 'ignore' }); } catch (e) { console.error('[cursorhide]', e.message); cursorHide = null; return; }
  me.on('exit', () => { if (cursorHide === me) cursorHide = null; });
  me.on('error', () => { if (cursorHide === me) cursorHide = null; });
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
  if (padwatch) { const p = padwatch; padwatch = null; try { p.kill(); } catch {} padNav(null); }
}

// (EPERM: running, only with more rights than ours - a game started as admin or kept by its anti-cheat)
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// Another program runs now (a game started while the last one was still closing): MediaDeck must not come over it
// (MAME32 crashes when anything comes in front of it)
const otherRunning = (pid) => !!(running && running.pid !== pid && isAlive(running.pid));

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

// The first program a (now ended) process started, or null - a launcher's game
function childProcessOf(pid) {
  const ps = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(pid)}" | Where-Object { $_.Name -notmatch '^(conhost|WerFault)\.exe$' } | Sort-Object CreationDate | Select-Object -First 1).ProcessId`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
    const id = parseInt(String(out || '').trim(), 10);
    resolve(Number.isFinite(id) && isAlive(id) ? id : null);
  }));
}

function killTree(pid, force) {
  return new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true }, (err, out, errOut) => {
    // A polite close of the whole tree is refused when a child (e.g. a console host) can only be
    // ended by force: then nothing gets the message. Ask the program itself instead.
    // (its exit code too: the message is in Windows' own language)
    if (!force && (err || /could not be terminated/i.test(String(errOut || '') + String(out || '')))) {
      execFile('taskkill', ['/PID', String(pid)], { windowsHide: true }, () => resolve());
    } else resolve();
  }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Polite first; if it's still running without any window (nothing the player could answer,
// e.g. old full-screen emulators like ZSNES), close it for real. With a window it may be
// asking something (save?), so then the player decides.
// Programs MediaDeck asked to close that may still be on their way out (Dolphin takes ~15 s): the next game waits
// for them, as a closing program can come to the front over it (MAME32 crashes then)
const closing = new Map();   // pid -> name
async function closeRunning(force) {
  await thawGame();
  holdOnTop(false);
  if (!running || !isAlive(running.pid)) { running = null; stopPadWatch(); return { closed: true }; }
  const pid = running.pid;
  closing.set(pid, running.name);
  // Emulators that ignore Windows' close message in full screen (ares) quit with their own key
  const quitKey = running.hotkeys && running.hotkeys.quit;
  if (!force && quitKey && (await keysExe(['send', String(pid), quitKey]))) {
    for (let i = 0; i < 10 && isAlive(pid); i++) await wait(300);
  }
  if (!isAlive(pid)) {
    if (running && running.pid === pid) { running = null; stopPadWatch(); }
    if (!otherRunning(pid)) focusSelf();   // the quit key gave the emulator the focus; when it's gone Windows would pick another window
    return { closed: true, forced: false };
  }
  // An app that only hides to the tray when closed (PlexDeck, Audiobookshelf) quits for real with its own command
  // first - no close message: during a video it closed PlexDeck's player windows under it, and PlexDeck stopped
  // with an error box. Its quit stops the video and puts the screen / HDR back, which can take ~16 s: up to 20 s.
  if (!force && running && running.quitArgs && running.exe) {
    try { spawn(running.exe, running.quitArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
    for (let t = 0; t < 80 && isAlive(pid); t++) await wait(250);
  }
  // (then, or for any other program: Windows' close message)
  if (isAlive(pid)) await killTree(pid, force);
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
  if (!alive && !otherRunning(pid)) focusSelf();
  return { closed: !alive, forced };
}

// Back to the game: bring its window forward and step MediaDeck aside
// While MediaDeck's menu is over an emulator, the emulator stands still (keys.exe freeze: all its threads stop),
// so the controller presses in the menu don't play the game too - emulators built on Qt (simple64, RMG) read the
// pad even without the focus. Thawed on any way back: Back to game, a menu action, Close, Alt+Tab, MediaDeck quitting.
// Only emulators: PC games and apps may have anti-cheat that doesn't like it.
let frozen = null;
// freeze and thaw one after the other: PS then Back at once started both, and a thaw that finished first left the
// game frozen for good (Windows counts the freezes)
let freezeQueue = Promise.resolve();
const inOrder = (args) => (freezeQueue = freezeQueue.then(() => keysExe(args)));
async function freezeGame() {
  if (frozen || !running || !isAlive(running.pid) || !running.emulator || running.emulator === 'PC games') return;
  frozen = running.pid;
  await inOrder(['freeze', String(frozen)]);
}
async function thawGame() {
  if (!frozen) return;
  const pid = frozen;
  frozen = null;
  await inOrder(['thaw', String(pid)]);
}

function resumeRunning() {
  letGoOfFocus();
  thawGame();
  holdOnTop(false);
  if (running) closing.delete(running.pid);   // it didn't close and the player went back to it: no longer "closing"
  if (running && isAlive(running.pid)) {
    keysExe(['game', String(running.pid)]);
  }
  setTimeout(() => win && !win.isDestroyed() && win.minimize(), 300);
}

// ---------- In-game overlay ----------
const KEYS_EXE = P.tool('keys.exe');
const RA_COMMANDS = { saveState: 'SAVE_STATE', loadState: 'LOAD_STATE', pause: 'PAUSE_TOGGLE', screenshot: 'SCREENSHOT' };

const keysExe = (args) => new Promise((resolve) => execFile(KEYS_EXE, args, { windowsHide: true }, (err) => resolve(!err)));
const keysOut = (args) => new Promise((resolve) => execFile(KEYS_EXE, args, { windowsHide: true, timeout: 15000 }, (err, out) => resolve({ ok: !err, out: String(out || '').trim() })));
let displayTrial = null;      // a new screen mode waiting for "Keep" (Settings → Screen resolution): its go-back timer
let displayHwnd = '';         // … and MediaDeck's window then (its screen is the one to set back)

const hwndOf = (bw) => { const h = bw.getNativeWindowHandle(); return process.arch === 'x64' ? h.readBigUInt64LE(0).toString() : String(h.readUInt32LE(0)); };
// A borderless window that covers the screen (MediaDeck's full screen, the PS menu, YouTube, Twitch) still gets
// Windows 11's thin window border - a coloured line along the top of the screen. Off while it covers the screen,
// back as a normal window. (Asked again after every resize: changing the window's style can bring it back.)
function edgeless(bw) {
  if (process.platform !== 'win32') return;
  let timer = null;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (bw.isDestroyed()) return;
      const b = bw.getBounds(), d = screen.getDisplayMatching(b).bounds;
      const covers = b.x <= d.x && b.y <= d.y && b.x + b.width >= d.x + d.width && b.y + b.height >= d.y + d.height;
      keysExe(['border', hwndOf(bw), covers ? 'none' : 'default']);
    }, 150);
  };
  // (focus too, and twice more after it shows: once in a while the first call came too early and the line stayed)
  for (const ev of ['ready-to-show', 'show', 'resize', 'move', 'focus']) bw.on(ev, check);
  bw.once('show', () => { for (const ms of [1000, 4000]) setTimeout(() => { if (!bw.isDestroyed()) check(); }, ms); });
  check();
}
app.on('browser-window-created', (e, bw) => edgeless(bw));

function overlayInfo() {
  const r = running || {};
  const can = (a) => (r.control === 'retroarch' ? !!RA_COMMANDS[a] : !!(r.hotkeys && r.hotkeys[a]));
  return {
    name: r.name, emulator: r.emulator || '', theme: config.settings.theme,
    uiScale: config.settings.uiScale, textScale: config.settings.textScale,
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
  await thawGame();
  const r = running;
  if (!r || !isAlive(r.pid)) { overlay.hide(); bringToFront(); return { closed: true }; }
  if (action === 'resume') { overlay.hide(); await keysExe(['game', String(r.pid)]); return { ok: true }; }
  if (action === 'home') { overlay.hide(); bringToFront(); return { ok: true }; }
  if (action === 'close') {
    overlay.hide();
    const res = await closeRunning(false);
    if (!otherRunning(r.pid)) bringToFront();
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
async function startProgram(exe, args, cwd, name, meta = {}) {
  // a program still closing first (up to 30 s)
  for (const pid of [...closing.keys()]) if (!isAlive(pid)) closing.delete(pid);
  if (closing.size && win && !win.isDestroyed()) win.webContents.send('toast', `Waiting for ${[...closing.values()].join(', ')} to close…`);
  for (let t = 0; t < 120 && [...closing.keys()].some(isAlive); t++) await wait(250);
  closing.clear();
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      // Some programs (Ryujinx) crash when started without any console: they start attached
      // pads set up in Settings → Controllers: SDL-based emulators see them as Xbox controllers
      const sdl = pads.sdlConfig(config.controllers);
      // SDL programs read the controller only while their window is in front: with MediaDeck's PS menu over the
      // game, the presses stay in the menu (SDL lets this variable win over the program's own setting)
      const env = { ...process.env, SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS: '0', ...(sdl ? { SDL_GAMECONTROLLERCONFIG: sdl } : {}), ...((meta && meta.env) || {}) };
      child = spawn(exe, args, { cwd, detached: !(meta && meta.attached), stdio: 'ignore', env });
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    child.once('error', (e) => resolve({ ok: false, error: e.message }));
    child.once('spawn', () => {
      resolve({ ok: true });
      letGoOfFocus();
      holdOnTop(false);
      running = { pid: child.pid, name: name || path.basename(exe, '.exe'), exe, ...meta };
      padLog('a program started');
      startPadWatch();
      // Bring the game's window forward once it exists (Windows doesn't always let it come
      // to the front by itself); tried a few times during the first seconds only - not while the PS menu is up
      // (PS within 7 s of the start: the menu was pushed behind the program again)
      for (const ms of [1500, 3500, 7000]) setTimeout(() => { if (running && running.pid === child.pid && isAlive(child.pid) && !menuOnTop && Date.now() > claimUntil) keysExe(['game', String(child.pid)]); }, ms);
      // keys the game needs typed once it shows (MAME32's "type OK"), twice: its disclaimer, then a game's own note
      if (meta.startKeys && meta.startKeys.length) {
        for (const ms of [3000, 6000]) setTimeout(async () => {
          for (const k of meta.startKeys) { if (running && running.pid === child.pid && isAlive(child.pid)) await keysExe(['send', String(child.pid), k]); }
        }, ms);
      }
      padsToGame(true);
      if (config.settings.minimizeOnLaunch !== false) setTimeout(() => win && !win.isDestroyed() && win.minimize(), 400);
      if (meta.quitArgs) watchTrayHide(child.pid);
    });
    // Come back to the home screen when the program closes (ignore launchers that exit right away;
    // the controller combo keeps working for whatever they started)
    child.once('exit', () => {
      if (frozen === child.pid) frozen = null;
      if (Date.now() - started <= 5000) {
        // Gone at once: a program that runs only once (PlexDeck, Audiobookshelf) handed over to the copy
        // already running - follow that one, so the PS button and Close still reach it
        mainProcessOf(exe).then(async (pid) => {
          if (!running || running.pid !== child.pid) return;
          // no copy of it: a launcher that started the real program (follow that), else it really ended at once (a
          // bad game file, a missing DLL) - MediaDeck comes back; it used to stay minimized with the PS button dead
          if (!pid) pid = await childProcessOf(child.pid);
          if (!running || running.pid !== child.pid) return;
          if (!pid) { running = null; stopPadWatch(); focusSelf(); return; }
          followPid({ ...running, pid });
        });
        return;
      }
      // Only the program that is running now: an older one that exits late (after the next
      // game started) must not switch off the PS button for the new one - nor come over it (MAME32 crashes when
      // anything comes in front of it)
      const was = running && running.pid === child.pid ? running : null;
      if (was) { running = null; padLog('the program ended'); }
      if (running && isAlive(running.pid)) return;
      stopPadWatch();
      focusSelf();
      if (was) followRestart(was, child.pid);
    });
    child.unref();
  });
}

// An app that hides to the tray when its window is closed (PlexDeck, Audiobookshelf: their ✕ / Alt+F4) doesn't
// end, so MediaDeck never came back: once its window has been gone ~3 s the player has left it. Started from
// MediaDeck, ✕ means done: it quits for real with its own command (PlexDeck puts the screen / HDR back first),
// and MediaDeck comes back.
function watchTrayHide(pid) {
  let seen = false;
  let gone = 0;
  const since = Date.now();
  const t = setInterval(async () => {
    if (!running || running.pid !== pid || !isAlive(pid)) return clearInterval(t);
    if (closing.has(pid)) return;                   // Close from the PS menu takes care of it
    const shown = await keysExe(['visible', String(pid)]);
    if (!running || running.pid !== pid || closing.has(pid)) return;
    if (shown) { seen = true; gone = 0; return; }
    if (!seen) { if (Date.now() - since > 90000) clearInterval(t); return; }   // (its window never showed)
    if (++gone < 2) return;
    clearInterval(t);
    console.log(`[apps] ${running.name} went to the tray: quit, back to MediaDeck`);
    padLog('the program went to the tray: back to MediaDeck');
    if (running.exe && running.quitArgs) { try { spawn(running.exe, running.quitArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {} }
    running = null;
    stopPadWatch();
    focusSelf();
  }, 1500);
}

// An app that ended by itself, not by Close (PlexDeck's update: its updater starts the new version up to ~2 min
// later, windowed, without MediaDeck's --fullscreen --tv): a new copy in that time is followed again, so the PS
// button and Close reach it - before, it sat over MediaDeck and PS did nothing
// A program MediaDeck didn't start itself but follows (the copy it handed over to, one started again after an
// update): no 'exit' event for it, so it is looked at now and then; when it's gone MediaDeck comes back
function followPid(rec) {
  running = rec;
  const { pid } = rec;
  startPadWatch();
  const watch = setInterval(() => {
    if (!running || running.pid !== pid) return clearInterval(watch);
    if (isAlive(pid)) return;
    clearInterval(watch);
    const was = running;
    running = null;
    padLog('the program ended');
    stopPadWatch();
    focusSelf();
    followRestart(was, pid);
  }, 2000);
  if (rec.quitArgs) watchTrayHide(pid);
}

function followRestart(was, oldPid) {
  if (!was || !was.quitArgs || !was.exe || closing.has(oldPid)) return;
  const until = Date.now() + 150000;
  const t = setInterval(async () => {
    if (Date.now() > until || running) return clearInterval(t);
    const pid = await mainProcessOf(was.exe);
    if (!pid || pid === oldPid || running) return;
    clearInterval(t);
    console.log(`[apps] ${was.name} started again (an update): followed`);
    followPid({ ...was, pid });
  }, 3000);
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
// A console's icon: RetroArch's Systematic theme when RetroArch is there, else MediaDeck's own copy of it
// (renderer/img/consoles/<console>.png, CC BY 4.0) - a MediaDeck without RetroArch has its icons too
const consoleIcon = (system, raDir) => {
  if (!system) return null;
  const name = { 'Nintendo - Switch': 'Nintendo - Switch', 'Microsoft - DOS': 'DOS' }[system] || system;   // RetroArch's file names
  const ra = raDir && path.join(raDir, 'assets', 'xmb', 'systematic', 'png', name + '.png');
  if (ra && fs.existsSync(ra)) return ra;
  const own = path.join(__dirname, 'renderer', 'img', 'consoles', system + '.png');
  return fs.existsSync(own) ? own : null;
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
    noteCoverNames(mod, list);
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

// File name → the consoles that have it: a name on two or more consoles gets a cover for each (server.coverFile).
// Each scanned list once (the lists are cached).
const coverNames = new Map();
const notedLists = new WeakSet();
function noteCoverNames(mod, list) {
  if (!server || !mod || notedLists.has(list)) return;
  notedLists.add(list);
  for (const g of list) {
    const id = server.coverId(g.rom);
    if (!coverNames.has(id)) coverNames.set(id, new Set());
    coverNames.get(id).add(covers.consoleOf(mod, g.rom).console);
  }
  server.noteConsoles(coverNames);
}

// The games of one console, from the emulator chosen for it
async function consoleGames(consoleId, moduleId, fresh) {
  const c = (await consoleList(true)).find((x) => x.id === consoleId);
  if (!c) return { moduleId: null, list: [] };
  const mod = await moduleById(moduleId && c.emulators.some((e) => e.moduleId === moduleId) ? moduleId : c.emulator);
  if (!mod) return { moduleId: null, list: [] };
  const mine = (rom) => (c.system ? covers.systemFor(mod, rom) === c.system : true);
  const all = await gamesFor(mod, fresh);
  noteCoverNames(mod, all);
  const list = all.filter((g) => mine(g.rom)).map((g) => {
    const con = covers.consoleOf(mod, g.rom);
    return { ...g, ...con, storedCover: (!g.cover || g.coverIsIcon) && server.hasCover(g.rom, con.console) };
  });
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
      recent = [{ moduleId, ...game, t: Date.now() }, ...recent.filter((x) => x.rom !== rom)].slice(0, 100);
      writeGames(RECENT_FILE, recent);
    }
    return r;
  }
  // A PS3 PSN download (.pkg): RPCS3 installs it once - its licence (.rap / .rif / .edat next to it) into
  // dev_hdd0\home\00000001\exdata, the package with --installpkg (RPCS3 asks to confirm, then stays open);
  // after that the installed game's EBOOT.BIN starts like any PS3 game
  let startRom = rom;
  const psn = games.isRpcs3(mod) && games.psnPackage(rom);
  if (psn) {
    const rp = path.dirname(mod.exe);
    const inst = path.join(rp, 'dev_hdd0', 'game', psn.tid);
    const eboot = path.join(inst, 'USRDIR', 'EBOOT.BIN');
    if (fs.existsSync(eboot)) startRom = eboot;
    // a PSone Classic has no EBOOT.BIN (its PS1 disc is USRDIR\ISO.BIN.EDAT): RPCS3 boots its game folder
    else if (psn.ps1 && fs.existsSync(path.join(inst, 'PARAM.SFO'))) startRom = inst;
    else {
      const exdata = path.join(rp, 'dev_hdd0', 'home', '00000001', 'exdata');
      let licences = 0;
      try {
        fs.mkdirSync(exdata, { recursive: true });
        for (const f of fs.readdirSync(path.dirname(rom))) {
          if (!/\.(rap|rif|edat)$/i.test(f) || !(f.includes(psn.cid) || f.includes(psn.tid))) continue;
          licences++;
          const to = path.join(exdata, f);
          if (!fs.existsSync(to)) fs.copyFileSync(path.join(path.dirname(rom), f), to);
        }
      } catch (e) { return { ok: false, error: `The licence could not be copied into RPCS3:\n${e.message}` }; }
      const r = await startProgram(mod.exe, ['--installpkg', rom], rp, `${game.title} (installing)`, { emulator: mod.name, hotkeys: {} });
      if (r.ok) {
        // When RPCS3 says "Successfully installed" (a message box that keeps it from closing): its OK is pressed,
        // RPCS3 closes and the game starts - the installer staying open made a second RPCS3 crash
        const pid = running && running.pid;
        (async () => {
          let asked = false;
          for (let i = 0; i < 1200 && running && running.pid === pid && isAlive(pid); i++) {   // up to an hour
            // RPCS3 loads its game list at the same time and both wait for each other: that one is cancelled
            // (only the list), then its "Do you want to install this package?" answered - no mouse needed
            await keysExe(['click', String(pid), '^Loading games', 'Cancel']);
            if (!asked && await keysExe(['click', String(pid), '^PKG Installation', 'Install'])) asked = true;
            if (await keysExe(['ok', String(pid), 'success|installed', '0'])) {
              await wait(800);
              await closeRunning(false);
              for (let j = 0; j < 20 && isAlive(pid); j++) await wait(500);
              if (isAlive(pid)) return;                  // still open: the player closes it, then starts again
              const again = await launchGame(moduleId, rom);
              if (!again.ok && win && !win.isDestroyed()) win.webContents.send('toast', `${game.title}: ${again.error}`);
              return;
            }
            await wait(3000);
          }
        })();
      }
      return r.ok ? { ...r, notice: `${game.title} is installed into RPCS3 once (a few minutes) - MediaDeck answers RPCS3's questions and starts the game when it is installed.`
        + (licences ? '' : `\n\nNo licence (.rap) was found next to the package - the game may not start without it.`) } : r;
    }
  }
  let args;
  try { args = games.launchArgs(mod, startRom); } catch (e) { return { ok: false, error: e.message }; }
  ownSettings([path.dirname(mod.exe)]);
  edenOwnFolders(mod);
  await padsFollowPc(mod).catch(() => {});      // player 1 on the controller that is here (Eden, DuckStation …)
  // Mednafen keeps its settings in %HOME%\.mednafen when HOME is set (Git Bash, MSYS): always its own folder
  const env = emuInstaller.emuIdOf(mod) === 'mednafen' ? { MEDNAFEN_HOME: path.dirname(mod.exe) } : null;
  const r = await startProgram(mod.exe, args, mod.gameCwd === 'rom' ? path.dirname(rom) : path.dirname(mod.exe), game.title,
    { emulator: mod.name, env, control: mod.control, hotkeys: mod.hotkeys || {}, closeSteps: mod.closeSteps || 1, holdToClose: mod.holdToClose || 0, attached: !!mod.attached, startKeys: mod.startKeys || [] });
  if (r.ok) {
    loadRecent();
    recent = [{ moduleId, ...game, t: Date.now() }, ...recent.filter((x) => x.rom !== rom)].slice(0, 100);
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

// The videos a folder's watched mark counts: its own (trailers, samples and extras left out), or, when it has
// none (a show with season folders), the ones a folder down
const EXTRA_FILE = /(^|[-_. ])(trailer|sample)$|[-_.](featurette|behindthescenes|deleted|interview|scene|short|other)$/i;
const EXTRA_DIR = /^(extras?|featurettes|behind the scenes|deleted scenes|interviews|scenes|shorts|trailers|samples?|other)$/i;
async function folderVideos(dir) {
  const look = async (d) => {
    const files = [], dirs = [];
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (SKIP.has(e.name.toLowerCase()) || e.name.startsWith('$') || e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (!EXTRA_DIR.test(e.name)) dirs.push(path.join(d, e.name)); }
      else if (kindOf(e.name) === 'video' && !EXTRA_FILE.test(path.parse(e.name).name)) files.push(path.join(d, e.name));
    }
    return { files, dirs };
  };
  const top = await look(dir);
  if (top.files.length) return top.files;
  return (await Promise.all(top.dirs.slice(0, 300).map(async (s) => (await look(s)).files))).flat();
}

// ---------- Program icons ----------
// Pulls the largest icon out of an .exe (up to 256 px) and caches it as a PNG.
// Requests arriving close together share one PowerShell run.
const ICON_DIR = path.join(DATA, 'cache', 'icons');
const ICON_PS = `
[Console]::InputEncoding = [Text.Encoding]::UTF8   # the job list comes as UTF-8 (paths with é, å, ö)
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
// Emu_modules: MediaDeck's own, or the folder chosen in Settings (kept relative when it is inside MediaDeck's folder).
// One inside another MediaDeck folder (the one this copy came from, or an older MediaDeck on this PC) is the same
// folder in this one, and one that isn't there is our own - a copy must not use another install's emulators.
const emuDir = () => {
  const set = config.settings.emuModulesPath;
  if (!set) return P.EMU;
  const p = emuModules.ownCopy(P.resolve(set));
  return fs.existsSync(p) ? p : P.EMU;
};

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
  // nothing (offline at the first try): asked again next time instead of no Switch covers until a restart
  switchTdb.then((r) => { if (!r) switchTdb = null; });
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
  has: (rom, sys) => server.hasCover(rom, sys),
  save: (rom, img, sys) => server.saveCover(rom, img, sys),
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
  let stopped = false;
  for (const c of await consoleList(true)) {
    if (running && isAlive(running.pid)) { stopped = true; break; }   // never while a game runs
    const mod = await moduleById(c.emulator);
    if (!mod || mod.pcGames) continue;           // PC games: covers are the pictures next to them
    try {
      const r = await covers.downloadAll(mod, (await consoleGames(c.id)).list, coverOpts({
        skip: recent, missed: (rom) => { state.misses[rom] = Date.now(); },
      }));
      found += r.found;
    } catch (e) { console.error('[covers]', e.message); }
  }
  // done only when it went through: stopped for a game (often in the first minute), it tries again in half an hour
  // instead of skipping the next 20 hours
  if (!stopped) state.lastRun = Date.now();
  writeSecret(COVER_STATE(), state);
  if (stopped) setTimeout(() => autoCovers().catch((e) => console.error('[covers]', e.message)), 30 * 60e3);
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
  // the folder couldn't be read (its drive is offline): the cards stay as they are - before, every emulator
  // card's name, picture and place was wiped and saved
  try { mods = await emuModules.scan(emuDir()); } catch (e) { console.error('[emu]', e.message); return mods; }
  if (!mods.length && config.tiles.some((t) => t.section === 'emulators')) return mods;
  for (const m of mods) { try { emuModules.addKnownExtensions(m); } catch {} }
  const visible = mods.filter((m) => !m.hidden && m.ok);
  const claimed = new Set();
  const next = [];
  for (const t of config.tiles) {
    if (t.section !== 'emulators') { next.push(t); continue; }
    let m = t.moduleId && visible.find((x) => x.id === t.moduleId);
    // Cards from before modules existed take over the module with the same name
    if (!m && !t.moduleId) m = visible.find((x) => !claimed.has(x.id) && x.name.toLowerCase() === (t.name || '').toLowerCase());
    // its emulator is there but can't be found right now (its exe on a drive that is off): the card is kept
    if (!m && t.moduleId && mods.some((x) => x.id === t.moduleId && !x.hidden && !x.ok)) { next.push(t); claimed.add(t.moduleId); continue; }
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
  try { spawn(DS4_EXE, minimised ? ['-m'] : [], { cwd: path.dirname(DS4_EXE), detached: true, stdio: 'ignore' }).on('error', (e) => console.error('[ds4]', e.message)).unref(); } catch (e) { console.error('[ds4]', e.message); }
  return true;
}

// Settings → Controllers → Set up a controller: a pad that isn't Xbox / PlayStation, by its USB vendor:product
// (RetroArch gets a file for it too, Dolphin's GameCube port 1 listens to it; the SDL emulators get it when they start, see startProgram)
async function padsToEmulators() {
  try {
    const mods = (await emuModules.scan(emuDir())).filter((m) => m.ok);
    const done = [];
    const ra = mods.find((m) => games.isRetroArch(m));
    try { if (ra && pads.writeRetroArch(path.dirname(ra.exe), config.controllers)) done.push('RetroArch'); } catch (err) { console.log('[controllers] RetroArch:', err.message); }
    for (const d of mods.filter((m) => /^dolphin/i.test(path.basename(m.exe || '')))) {
      try { if (pads.writeDolphin(path.dirname(d.exe), config.controllers)) done.push('Dolphin'); } catch (err) { console.log('[controllers] Dolphin:', err.message); }
    }
    return [...new Set(done)].join(' and ');
  } catch (err) { console.log('[controllers]', err.message); return ''; }
}
// Player 1 on this PC (pad-pc.js): DuckStation / PCSX2 on the first controller, Eden on the controller that is here,
// xemu binding it by itself on a PC without DS4Windows, Mesen on every Xbox slot. At the start, and before a game of one of them starts (the
// controller may have been switched on since). only: that emulator's module.
const padPc = require('./pad-pc');
// Eden / the yuzu forks: their NAND, SD card … folders in their own user folder again when they point into another
// copy's (Eden writes full paths on every close - relocate.js). At the start and before each of their games.
function edenOwnFolders(m) {
  if (!/^(eden|suyu|sudachi|citron|yuzu)\.exe$/i.test(path.basename(m.exe || ''))) return;
  try {
    const fixed = require('./relocate').edenFolders(path.dirname(m.exe));
    if (fixed.length) console.log(`[${m.name}] its own folders again: ${fixed.join('; ')}`);
  } catch (e) { console.error(`[${m.name}]`, e.message); }
}
// Emulator settings pointing into ANOTHER MediaDeck folder (this one was copied from it: D:\MediaDeck from E:) point at
// this one, so it needs no other drive and never reads or saves in the other copy (relocate.otherCopies). At the start
// and before each game (that emulator's folder).
const isMediaDeckFolder = (r) => fs.existsSync(path.join(r, 'MediaDeck.exe')) || fs.existsSync(path.join(r, 'data', 'root.json'));
function ownSettings(dirs = [P.EMU, P.APPS]) {
  try {
    const fixed = require('./relocate').otherCopies(P.ROOT, dirs, P.EMU_BACKUPS, isMediaDeckFolder);
    if (fixed.length) console.log(`[copy] ${fixed.length} settings files pointed into another MediaDeck folder, now this one: ${fixed.slice(0, 8).map((f) => path.relative(P.ROOT, f)).join('; ')}`);
    return fixed;
  } catch (e) { console.error('[copy]', e.message); return []; }
}
const PADS_PC = path.join(DATA, 'pads-pc.json');      // what Eden / xemu had, per controller / per PC
const padStore = (k) => ({ get: () => (readJson(PADS_PC, {}) || {})[k], set: (v) => { const j = readJson(PADS_PC, {}) || {}; j[k] = v; writeJson(PADS_PC, j); } });
async function padsFollowPc(only) {
  const done = [];
  let here = null;
  for (const m of (await emuModules.scan(emuDir())).filter((x) => x.ok && !x.hidden && (!only || x.id === only.id))) {
    const id = emuInstaller.emuIdOf(m), dir = path.dirname(m.exe);
    try {
      if (id === 'duckstation' && padPc.sdlFirst(path.join(dir, 'settings.ini'))) done.push(m.name);
      if (id === 'pcsx2' && padPc.sdlFirst(path.join(dir, 'inis', 'PCSX2.ini'))) done.push(m.name);
      if (id === 'mesen' && padPc.mesenAnySlot(path.join(dir, 'settings.json'))) done.push(m.name);
      const exe = path.basename(m.exe);
      if (/^(eden|suyu|sudachi|citron|yuzu|ryujinx)\.exe$/i.test(exe) || id === 'mgba') {
        here = here || await padPc.connectedPads(KEYS_EXE);
        const kind = /^ryujinx\.exe$/i.test(exe) ? padPc.ryujinxFollow(dir, here)
          : id === 'mgba' ? padPc.mgbaFollow(dir, here, padStore(`mgba:${m.id}`))
            : padPc.edenFollow(dir, here, padStore(`eden:${m.id}`));
        if (kind) done.push(`${m.name} (${kind})`);
      }
      if (id === 'xemu' && padPc.xemuFollow(dir, fs.existsSync(DS4_EXE) && (await serviceState('ViGEmBus')) !== 'missing', padStore(`xemu:${m.id}`))) done.push(m.name);
    } catch (e) { console.error('[pads]', m.name, e.message); }
  }
  if (done.length) console.log(`[pads] player 1 for this PC: ${done.join(', ')}`);
  return done;
}

// Xbox / PlayStation setups forgotten at start (loadConfig): their maps leave RetroArch and Dolphin again
async function forgetXboxSetups() {
  if (!xboxSetupsForgotten.length) return;
  await padsToEmulators();
  console.log(`[controllers] forgot the setup of ${xboxSetupsForgotten.join(', ')} (an Xbox / PlayStation controller)`);
}

// ---------- This PC: what the emulators, apps and PC games need from Windows (pc-check.js) ----------
const pcCheckLib = require('./pc-check');
// Every program MediaDeck starts: the emulators, the apps on Home, its helper apps, the PC games
async function pcPrograms() {
  const out = [];
  for (const m of await emuModules.scan(emuDir())) {
    if (m.hidden || m.pcGames) continue;
    out.push({ name: m.name, exe: m.exe, kind: 'emulator', fix: emuInstaller.emuIdOf(m) ? { kind: 'emulator', id: m.id } : null });
  }
  const appExe = (a) => path.join(P.APPS, a.dir, a.up ? 'bin' : '', a.exe);
  const catalogOf = (exe) => Object.keys(appInstaller.CATALOG).find((id) => !appInstaller.CATALOG[id].setup && path.resolve(appExe(appInstaller.CATALOG[id])).toLowerCase() === path.resolve(exe).toLowerCase());
  for (const t of config.tiles) {
    if (t.builtin || !t.path || !/\.exe$/i.test(t.path)) continue;
    const exe = P.resolve(t.path), id = catalogOf(exe);
    out.push({ name: t.name, exe, kind: 'app', fix: id ? { kind: 'app', id } : null });
  }
  // (DS4Windows, mpv, FFmpeg, Streamlink: the ones whose folder is there; PlexDeck & co. are tiles above)
  for (const [id, a] of Object.entries(appInstaller.CATALOG)) {
    if (!a.setup && !a.tile && fs.existsSync(path.join(P.APPS, a.dir))) out.push({ name: a.name, exe: appExe(a), kind: 'app', fix: { kind: 'app', id } });
  }
  try {
    for (const f of fs.readdirSync(PC_GAMES_DIR).filter((x) => /\.game$/i.test(x))) {
      const g = readJson(path.join(PC_GAMES_DIR, f), null);
      if (g && g.exe && !/^[a-z][a-z0-9+.-]+:\/\//i.test(g.exe)) out.push({ name: f.replace(/\.game$/i, ''), exe: P.resolve(g.exe), kind: 'game' });
    }
  } catch {}
  return out;
}
// { fixes: [{ key, kind, name, for }], notes: [text] } - fixes are what MediaDeck can do (pcFix), notes what it can't
async function pcCheck() {
  const fixes = [];
  // an Emu_modules folder set in Settings that isn't the one in use (another MediaDeck's, or gone)
  const set = config.settings.emuModulesPath;
  if (set && path.resolve(P.resolve(set)).toLowerCase() !== path.resolve(emuDir()).toLowerCase()) {
    fixes.push({ key: 'setting:emuModulesPath', kind: 'setting', name: 'Use this MediaDeck\'s own Emu_modules folder (Settings pointed at another one)', for: [] });
  }
  const r = pcCheckLib.check(await pcPrograms());
  if (fs.existsSync(DS4_EXE) && (await serviceState('ViGEmBus')) === 'missing') {
    fixes.push({ key: 'driver:vigem', kind: 'driver', id: 'vigem', name: 'Install the ViGEmBus driver - DS4Windows needs it for the controller', for: ['DS4Windows'] });
  }
  // game folders that aren't there (another drive on the old PC …): one line with the emulators' names
  const noGames = [];
  for (const m of await emuModules.scan(emuDir())) {
    if (m.hidden || !m.ok) continue;
    if ((m.romFolders || []).some((f) => { const p = typeof f === 'string' ? f : f && f.path; return p && !fs.existsSync(p); })) noGames.push(m.name);
  }
  if (noGames.length) r.notes.push(`Game folders not found for ${noGames.slice(0, 5).join(', ')}${noGames.length > 5 ? ` +${noGames.length - 5}` : ''} (a console's page → Game folders)`);
  return { fixes: [...fixes, ...r.fixes], notes: r.notes };
}
// Runs an installer with Windows' "allow" question (it needs administrator rights) and waits for it: its exit code
// (1223: the question was answered No)
function runElevated(file, args = []) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `try { $p = Start-Process -FilePath ${q(file)}${args.length ? ` -ArgumentList ${args.map(q).join(',')}` : ''} -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err) => res(err ? (typeof err.code === 'number' ? err.code : -1) : 0)));
}
// A Windows runtime from Microsoft (pc-check.js): downloaded to Apps\Setup (kept for the next PC), then installed
async function installRuntime(f, progress) {
  const dir = path.join(P.APPS, 'Setup');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, f.file || decodeURIComponent(f.url.split('/').pop()));
  if (!fs.existsSync(file)) {
    await emuInstaller.download(f.url, file + '.part', net, (got, total) => progress(`${f.name}: downloading ${Math.round(got / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? got / total : 0));
    fs.renameSync(file + '.part', file);
  }
  progress(`${f.name}: installing - Windows asks to allow it`, 0.99);
  let code;
  if (f.unpack) {
    // DirectX: unpacked into a temporary folder, then its own setup (both in one "allow")
    const stamp = Date.now(), out = path.join(app.getPath('temp'), `mediadeck-runtime-${stamp}`), bat = `${out}.cmd`;
    fs.writeFileSync(bat, `@echo off\r\n"${file}" /Q /T:"${out}"\r\n"${out}\\DXSETUP.exe" /silent\r\nexit /b %errorlevel%\r\n`);
    try { code = await runElevated(bat); } finally { fs.rmSync(bat, { force: true }); fs.rmSync(out, { recursive: true, force: true }); }
  } else code = await runElevated(file, f.args);
  // 0: done; 3010 / 1641: done, the PC restarts later; 1638: a newer one is there already
  if ([0, 3010, 1641, 1638].includes(code)) { progress(`${f.name} installed`, 1); return { ok: true, restart: code === 3010 || code === 1641 }; }
  return { error: code === 1223 || code === 1602 ? 'Not installed: Windows\' question was answered No' : `The installer stopped (code ${code})` };
}
async function pcFix(key) {
  const progress = (text, pct) => { if (win && !win.isDestroyed()) win.webContents.send('emu-install-progress', { text, pct }); };
  const f = (await pcCheck()).fixes.find((x) => x.key === key);
  if (!f) return { ok: true };
  if (f.kind === 'runtime') return installRuntime(f, progress);
  if (f.kind === 'setting') {
    config.settings.emuModulesPath = '';
    writeJson(CONFIG_FILE, config);
    if (win && !win.isDestroyed()) win.webContents.send('settings-patch', { emuModulesPath: '' });
    await syncEmulators();
    return { ok: true };
  }
  if (f.kind === 'app') { const r = await installApps([f.id]); const x = (r.results || [])[0]; return x && x.ok ? { ok: true } : { error: (x && x.error) || r.error || 'Not installed' }; }
  if (f.kind === 'driver') {
    if (!appInstaller.exePath(SETUP_ID[f.id])) { const r = await installApps([SETUP_ID[f.id]]); const x = (r.results || [])[0]; if (!x || !x.ok) return { error: (x && x.error) || r.error || 'The installer could not be downloaded' }; }
    const err = await shell.openPath(appInstaller.exePath(SETUP_ID[f.id]));
    return err ? { error: err } : { ok: true, opened: true };
  }
  if (f.kind === 'emulator') {
    // its program again from its own page, into its folder (settings, saves and BIOS stay - emuInstaller.update)
    if (installing) return { error: 'An install or update is already running' };
    const m = (await emuModules.scan(emuDir())).find((x) => x.id === f.id);
    if (!m) return { error: 'Emulator not found' };
    installing = true;
    try {
      const r = await emuInstaller.update(m, { tempDir: app.getPath('temp'), sevenZip: P.tool('7za.exe'), net, emuDir: emuDir(), backupDir: P.EMU_BACKUPS, progress });
      emuModules.setInstaller(m, r);
    } catch (e) { return { error: e.message }; } finally { installing = false; }
    await syncEmulators();
    return { ok: true };
  }
  return { error: 'Nothing to do' };
}
// Another PC than last time (or the folder moved): the check runs by itself. data\pc.json keeps only a hash of
// Windows' machine id.
function machineHash() {
  return new Promise((res) => execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true }, (err, out) => {
    const id = (!err && (/MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out) || [])[1]) || require('os').hostname();
    res(crypto.createHash('sha256').update('mediadeck|' + id).digest('hex').slice(0, 16));
  }));
}
async function pcCheckAtStart() {
  const file = path.join(DATA, 'pc.json'), id = await machineHash();
  const known = readJson(file, null);
  if (!known || known.id !== id) writeJson(file, { id });
  // (the first start of this version on the PC it was on: only noted)
  if (config.settings.setupDone === false || (known ? known.id === id : !folderMoved)) return;
  const r = await pcCheck();
  console.log(`[pc] another PC or place: ${r.fixes.length} to set up, ${r.notes.length} notes`);
  if ((r.fixes.length || r.notes.length) && win && !win.isDestroyed()) win.webContents.send('pc-check', { auto: true, ...r });
}

// ---------- IPC ----------
// The games folder: where most emulators' game folders already are
async function gamesRoot(mods) {
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
}

// An emulator MediaDeck installed before its console's game folder was there got no game folders, and its console never
// showed (Eden: the Switch folder made after the install, the games copied in). That folder is linked once it holds the
// emulator's kind of game files. At the start and with Scan for new games; only emulators MediaDeck installed that have
// no folders at all (not RetroArch).
async function linkGameFolders() {
  const mods = await emuModules.scan(emuDir());
  const root = await gamesRoot(mods);
  if (!root) return [];
  const linked = [];
  for (const m of mods) {
    if (!m.ok || !m.installer || (m.romFolders || []).length) continue;
    const id = emuInstaller.emuIdOf(m);
    if (!id || id === 'retroarch') continue;
    const exts = new Set((m.romExtensions || []).map((x) => '.' + String(x).toLowerCase().replace(/^\./, '')));
    const hasGames = (dir, depth = 0) => {
      let es = [];
      try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
      return es.some((e) => (e.isFile() ? exts.has(path.extname(e.name).toLowerCase()) : e.isDirectory() && depth < 3 && hasGames(path.join(dir, e.name), depth + 1)));
    };
    const found = emuInstaller.consoleGameFolders(id, root).filter((d) => hasGames(d));
    if (!found.length) continue;
    emuModules.setFolders(m, found);
    linked.push(`${m.name}: ${found.map((f) => P.rel(f)).join(', ')}`);
  }
  if (linked.length) console.log(`[games] game folders linked: ${linked.join('; ')}`);
  return linked;
}

function registerIpc() {
  ipcMain.handle('pc-check', () => pcCheck());
  ipcMain.handle('pc-fix', (e, key) => pcFix(key));
  ipcMain.handle('get-state', () => ({ config, progress, server: server.status() }));
  ipcMain.handle('watch-drives', (e, on) => setDriveWatch(on));
  ipcMain.handle('emu-rescan', async () => { await relinkMovedFolders().catch(() => {}); const mods = await syncEmulators(); return { config, mods, dir: emuDir() }; });
  // New games added while MediaDeck runs: every emulator's game folders are read again (and new emulators found)
  ipcMain.handle('games-rescan', async () => {
    // (counted by game file: two emulators can share a folder)
    const known = new Set([...gameCache.values()].flatMap((v) => v.list.map((g) => g.rom.toLowerCase())));
    gameCache.clear();
    await relinkMovedFolders().catch(() => {});
    await linkGameFolders().catch((e) => console.error('[games]', e.message));
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
    if (!mod) return [];
    const all = await gamesFor(mod, fresh);
    noteCoverNames(mod, all);
    return all.map((g) => { const con = covers.consoleOf(mod, g.rom); return { ...g, ...con, storedCover: (!g.cover || g.coverIsIcon) && server.hasCover(g.rom, con.console) }; });
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
  ipcMain.handle('running-close', (e, force) => { padLog(`menu: close the program${force ? ' (force)' : ''}`); return closeRunning(!!force); });
  ipcMain.handle('running-resume', () => { padLog('menu: back to the program'); return resumeRunning(); });
  // The page has the focus but was told MediaDeck isn't the active window (see input.js): Windows decides
  let lastCheck = null;
  ipcMain.handle('check-active', async () => {
    if (!win || win.isDestroyed() || toldActive !== false || !win.isVisible() || win.isMinimized()) return false;
    const front = await keysExe(['front', hwndOf(win)]);
    if (front || lastCheck !== front) padLog(`the page has the focus, the controller was off: ${front ? 'MediaDeck is in front - controller on' : 'another window is in front - left off'}`);
    lastCheck = front;
    if (front && win && !win.isDestroyed()) tellActive(true);
    return front;
  });
  ipcMain.handle('pad-log', (e, text) => {
    const player = mpv.osdWindow();
    if (win && !win.isDestroyed() && e.sender === win.webContents) padLog(text);
    else if (player && e.sender === player.webContents) padLog(`player: ${text}`);
  });
  // Save / load state, pause, screenshot from the menu: back to the game, then tell the emulator
  ipcMain.handle('running-action', (e, action) => (['saveState', 'loadState', 'pause', 'screenshot', 'options'].includes(action) ? overlayAction(action) : null));
  ipcMain.handle('running-info', () => (running && isAlive(running.pid) ? { name: running.name } : null));
  // all: the whole history (100), for a console page's own row; else the last 5 for Home
  ipcMain.handle('recent-games', async (e, all) => {
    const mods = await emuModules.scan(emuDir());
    return loadRecent()
      .filter((g) => mods.some((m) => m.id === g.moduleId && !m.hidden))
      .slice(0, all ? 100 : 5)
      .map((g) => { const m = mods.find((x) => x.id === g.moduleId); return { ...g, console: covers.consoleOf(m, g.rom).console, emulator: m.name }; });
  });
  // Favourite games (encrypted like the history)
  ipcMain.handle('fav-games', async () => {
    const mods = await emuModules.scan(emuDir());
    return loadFavs().filter((g) => mods.some((m) => m.id === g.moduleId && !m.hidden))
      .map((g) => { const m = mods.find((x) => x.id === g.moduleId); return { ...g, console: covers.consoleOf(m, g.rom).console, emulator: m.name }; });
  });
  ipcMain.handle('fav-toggle', (e, game) => {
    loadFavs();
    const has = favGames.some((x) => x.rom === game.rom);
    favGames = has ? favGames.filter((x) => x.rom !== game.rom)
      : [...favGames, { moduleId: game.moduleId, rom: game.rom, title: game.title, region: game.region, type: game.type, cover: game.cover }];
    writeGames(FAV_FILE, favGames);
    return !has;
  });
  // Settings → Emulators → Clear recently played
  ipcMain.handle('recent-clear', () => {
    recent = [];
    writeGames(RECENT_FILE, recent);
    return true;
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
  ipcMain.handle('emu-install-catalog', async () => {
    const cat = emuInstaller.catalog(await emuModules.scan(emuDir()));
    // the consoles each installed one is on (one that is installed but on none: the install list says why)
    const where = new Map();
    for (const c of await consoleList(true)) for (const e of c.emulators) where.set(e.moduleId, [...(where.get(e.moduleId) || []), c.name]);
    for (const c of cat) for (const e of c.emulators) e.consoles = where.get(e.moduleId) || [];
    return cat;
  });
  ipcMain.handle('emu-hidden', async () => (await emuModules.scan(emuDir())).filter((m) => m.hidden).map((m) => ({ id: m.id, name: m.name, system: m.system })));
  // a hidden emulator ("hidden": true in its emu-module.json) shown again
  ipcMain.handle('emu-show', async (e, moduleId) => {
    const m = (await emuModules.scan(emuDir())).find((x) => x.id === moduleId);
    if (m) emuModules.setHidden(m, false);
    await syncEmulators();
    return { config };
  });
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
    // a newer version may read the newer firmware in the BIOS folder (after the results are shown)
    setTimeout(() => offerFirmware().catch(() => {}), 4000);
    return { results, config };
  });
  // The firmware offer's answers: put it in (the old firmware to Emulator backups), or don't ask about that file again
  ipcMain.handle('firmware-install', async (e, moduleId, zip) => {
    if (installing) return { error: 'An install or update is already running' };
    if (running && isAlive(running.pid)) return { error: 'Close the game first' };
    const m = (await emuModules.scan(emuDir())).find((x) => x.id === moduleId);
    if (!m) return { error: 'Emulator not found' };
    installing = true;
    try {
      const r = await emuInstaller.installFirmware(m, zip, { biosDir: P.BIOS, sevenZip: P.tool('7za.exe'), emuDir: emuDir(), backupDir: P.EMU_BACKUPS });
      emuModules.setFirmware(m, r.version);
      console.log(`[firmware] ${r.name}: ${r.was} -> ${r.version} (${r.zip})`);
      return { ok: true, ...r };
    } catch (err) { return { error: err.message }; } finally { installing = false; }
  });
  ipcMain.handle('firmware-skip', (e, moduleId, zip) => {
    const key = `${moduleId}|${zip}`;
    config.settings.firmwareSkip = [...new Set([...(config.settings.firmwareSkip || []), key])];
    writeJson(CONFIG_FILE, config);
    // (the page's copy follows, or its next save would drop it)
    if (win && !win.isDestroyed()) win.webContents.send('settings-patch', { firmwareSkip: config.settings.firmwareSkip });
    return true;
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
  ipcMain.handle('app-info', () => ({ dataDir: DATA, emuDir: emuDir(), appsDir: P.APPS, appDir: P.ROOT, gamesDir: P.GAMES, version: app.getVersion(), electron: process.versions.electron,
    thumbs: server ? server.cacheStats() : null, recentGames: loadRecent().length }));
  ipcMain.handle('pad-save', async (e, key, pad) => {
    config.controllers = { ...(config.controllers || {}), [String(key)]: { name: pad.name, type: pad.type || 'other', map: pad.map, saved: new Date().toISOString() } };
    writeJson(CONFIG_FILE, config);
    if (padwatch) { stopPadWatch(true); startPadWatch(); }      // its Start + Back
    return { controllers: config.controllers, emulators: await padsToEmulators() };
  });
  ipcMain.handle('pad-forget', async (e, key) => {
    const next = { ...(config.controllers || {}) };
    delete next[String(key)];
    config.controllers = next;
    writeJson(CONFIG_FILE, config);
    if (padwatch) { stopPadWatch(true); startPadWatch(); }
    await padsToEmulators();
    return { controllers: config.controllers };
  });
  // GameCube controller adapter (Nintendo's, or Mayflash's in Wii U mode: USB 057E:0337): Dolphin reads it itself
  // (all four ports, analog L / R, C-stick, rumble) once Windows has the WinUSB driver for it (Zadig, the user's
  // step). Status: plugged in? driver? does Dolphin use it (SIDevice0-3 = 12)?
  const dolphinDir = async () => {
    const d = (await emuModules.scan(emuDir())).find((m) => m.ok && /^dolphin/i.test(path.basename(m.exe || '')));
    return d && path.dirname(d.exe);
  };
  ipcMain.handle('gc-adapter', async (e, use) => {
    const ps = "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match '^USB.VID_057E&PID_0337' } | ForEach-Object { 'found:' + $_.Service }";
    // null = not plugged in, '' = no driver yet, 'WinUSB' = ready for Dolphin, 'HidUsb' = Windows' own driver
    const service = await new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000 },
      (err, out) => { const f = /found:(\S*)/.exec(String(out || '')); resolve(f ? f[1] : null); }));
    const dir = await dolphinDir();
    const { readIni, iniGet, iniSet, writeIni } = require('./pad-defaults');
    const file = dir && path.join(dir, 'User', 'Config', 'Dolphin.ini');
    if (file && typeof use === 'boolean') {
      const ini = readIni(file);
      for (let i = 0; i < 4; i++) iniSet(ini, 'Core', `SIDevice${i}`, use ? '12' : i === 0 ? '6' : '0');   // 12 = the adapter, 6 = a standard controller
      writeIni(file, ini);
    }
    const inDolphin = !!file && iniGet(readIni(file), 'Core', 'SIDevice0') === '12';
    return { plugged: service !== null, winusb: /winusb/i.test(service || ''), dolphin: !!dir, inDolphin };
  });
  ipcMain.handle('save-config', (e, next) => {
    // The window's size and full-screen state belong to this process; keep them.
    const { fullscreen, window } = config.settings;
    const hideBefore = config.settings.hideCursor, portableBefore = portableData(), ffmpegBefore = config.settings.ffmpegPath;
    // the games folder: relative when it is inside MediaDeck's folder (Games), so the folder can move
    config = { ...next, settings: { ...next.settings, fullscreen, window, gamesFolder: P.rel(next.settings.gamesFolder || ''), emuModulesPath: P.rel(next.settings.emuModulesPath || '') },
      tiles: (next.tiles || []).map((t) => ({ ...t, ...(t.path ? { path: P.rel(t.path) } : {}), ...(t.image ? { image: P.rel(t.image) } : {}) })) };
    writeJson(CONFIG_FILE, config);
    if (config.settings.hideCursor !== hideBefore) startCursorHide();
    if (portableData() !== portableBefore) relockAll();
    if (config.settings.ffmpegPath !== ffmpegBefore && server) server.findTools().catch(() => {});   // thumbnails at once, not after a restart
    return true;
  });
  // Screen resolution / refresh rate (Settings → General), for the screen MediaDeck is on, through keys.exe.
  // A new mode is tried first (not saved); "Keep" saves it like Windows' Display settings. Without an answer it goes
  // back by itself - here too, 20 s, in case the screen stays black and the window can't count down.
  ipcMain.handle('display-modes', async () => {
    const r = await keysOut(['display', 'list', hwndOf(win)]);
    try { return JSON.parse(r.out); } catch { return null; }
  });
  ipcMain.handle('display-set', async (e, w, h, hz, step) => {
    const mode = [String(w | 0), String(h | 0), String(hz | 0)];
    clearTimeout(displayTrial);
    displayTrial = null;
    if (step === 'revert') return { ok: (await keysOut(['display', 'reset', hwndOf(win)])).ok };
    if (step === 'keep') {
      const k = await keysOut(['display', 'set', hwndOf(win), ...mode, 'keep']);
      // Keep didn't take: back to the saved mode (the go-back timer was already stopped)
      if (!k.ok) await keysOut(['display', 'reset', hwndOf(win)]);
      return { ok: k.ok };
    }
    const test = await keysOut(['display', 'set', hwndOf(win), ...mode, 'test']);
    if (!test.ok) return { ok: false, error: 'This screen does not take that mode' };
    displayHwnd = hwndOf(win);
    const r = await keysOut(['display', 'set', displayHwnd, ...mode, 'try']);
    if (r.ok) displayTrial = setTimeout(() => { displayTrial = null; keysOut(['display', 'reset', displayHwnd]); }, 20000);
    return { ok: r.ok, error: r.ok ? '' : 'Windows could not switch to that mode' };
  });
  ipcMain.handle('launch', (e, tile) => launch(tile));
  ipcMain.handle('youtube-open', () => openYouTube());
  ipcMain.handle('youtube-action', (e, a) => youtubeAction(a));
  ipcMain.handle('twitch-open', () => openTwitch());
  ipcMain.handle('twitch-action', (e, a) => twitchAction(a));
  ipcMain.handle('list-dir', (e, dir) => listDir(dir));
  ipcMain.handle('folder-videos', (e, dirs) => Promise.all([].concat(dirs || []).map((d) => folderVideos(String(d)))));
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
  // Settings → Appearance → Background picture: at most 2560 wide, as a JPEG (a photo straight from a camera as a PNG
  // data URL was tens of MB)
  ipcMain.handle('bg-image', async (e, file) => {
    try {
      let img = nativeImage.createFromPath(P.resolve(file));
      if (img.isEmpty()) return null;
      if (img.getSize().width > 2560) img = img.resize({ width: 2560, quality: 'good' });
      return `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`;
    } catch { return null; }
  });
  ipcMain.handle('open-external-player', (e, file) => {
    const vlc = config.settings.vlcPath;
    if (vlc && fs.existsSync(vlc)) { try { spawn(vlc, ['--fullscreen', file], { detached: true, stdio: 'ignore' }).on('error', (e) => console.error('[vlc]', e.message)).unref(); return true; } catch { return false; } }
    shell.openPath(file);
    return true;
  });
  ipcMain.handle('open-data-folder', () => shell.openPath(DATA));
  // Settings → Media Player → Browsing → Clear play history
  ipcMain.handle('clear-progress', () => {
    progress = {};
    clearTimeout(progressTimer);
    writeProgress(progress);
    return true;
  });
  ipcMain.handle('clear-cache', async () => {
    server.clearCache();
    return server.cacheStats();
  });
  ipcMain.handle('toggle-fullscreen', () => { setFull(!full); return full; });
  // MediaDeck as a window: its title bar's buttons
  ipcMain.handle('win-control', (e, what) => {
    if (!win || win.isDestroyed()) return;
    if (what === 'minimize') win.minimize();
    else if (what === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    else if (what === 'full') setFull(true);
    else if (what === 'close') app.quit();
  });
  ipcMain.handle('quit', () => app.quit());
  // Restart MediaDeck (the Exit menu): a new copy starts as this one closes
  ipcMain.handle('restart-app', () => { app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--test') }); app.quit(); });
  ipcMain.handle('power', (e, action) => {
    // Sleep: Windows' own call for sleep (rundll32 powrprof SetSuspendState hibernated instead whenever hibernation
    // is on, Windows' default for Fast Startup - then a controller or the TV remote can't wake the PC)
    const sleep = "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)";
    const cmds = { sleep: ['powershell.exe', ['-NoProfile', '-Command', sleep]], restart: ['shutdown', ['/r', '/t', '0']], shutdown: ['shutdown', ['/s', '/t', '0']] };
    if (cmds[action]) { try { spawn(cmds[action][0], cmds[action][1], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch {} }
    return true;
  });
}

// ---------- Startup ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', bringToFront);
  app.whenReady().then(async () => {
    padLog(`MediaDeck ${app.getVersion()} started`);
    loadConfig();
    // The browser cache would keep thumbnail links, which contain file paths: empty it
    await session.defaultSession.clearCache().catch(() => {});
    await linkGameFolders().catch((e) => console.error('[games]', e.message));
    await syncEmulators();
    // BIOS files added to BIOS\<console> by hand go to the emulators that need them (only missing ones; in the background)
    setTimeout(async () => {
      try {
        const copied = await setupScan.biosSync(P.BIOS, await emuModules.scan(emuDir()));
        if (copied.length) console.log(`[bios] ${copied.length} BIOS files copied to the emulators: ${copied.slice(0, 8).join('; ')}${copied.length > 8 ? ' …' : ''}`);
        await offerFirmware();
      } catch (e) { console.error('[bios]', e.message); }
    }, 8000);
    // on another PC (or the folder moved): what this PC lacks for the emulators and apps (pcCheck)
    setTimeout(() => pcCheckAtStart().catch((e) => console.error('[pc]', e.message)), 15000);
    forgetXboxSetups().catch((e) => console.error('[controllers]', e.message));
    setTimeout(() => padsFollowPc().catch((e) => console.error('[pads]', e.message)), 10000);
    // settings pointing into another MediaDeck folder → this one; PCSX2 folders on a drive that is gone → its own sub
    // folders; Eden's in another copy → its own (relocate.js)
    ownSettings();
    try {
      for (const m of await emuModules.scan(emuDir())) {
        if (m.ok && emuInstaller.emuIdOf(m) === 'pcsx2') {
          const fixed = require('./relocate').pcsx2Folders(path.dirname(m.exe));
          if (fixed.length) console.log(`[pcsx2] folders fixed: ${fixed.join('; ')}`);
        }
        if (m.ok) edenOwnFolders(m);
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
      // a setting changed in the player (sound output, speakers, passthrough): saved, and the main window's copy too
      saveSettings: (patch) => {
        Object.assign(config.settings, patch);
        writeJson(CONFIG_FILE, config);
        if (win && !win.isDestroyed()) win.webContents.send('settings-patch', patch);
      },
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
    setTimeout(() => cleanTempLeftovers().catch(() => {}), 45000);
    // Bring the home screen back from anywhere
    globalShortcut.register('Control+Alt+Home', bringToFront);
  }).catch((e) => {
    // a start that fails (config.json held by antivirus, a read-only folder): say so and end - else MediaDeck kept
    // running without a window, and every new start only tried to show that window
    console.error('[start]', e);
    if (!win) { dialog.showErrorBox('MediaDeck could not start', String((e && e.message) || e)); app.exit(1); }
  });
  app.on('will-quit', () => {
    quitting = true;
    // never leave an emulator frozen behind (see freezeGame)
    if (frozen) { try { require('child_process').execFileSync(KEYS_EXE, ['thaw', String(frozen)], { windowsHide: true, timeout: 5000 }); } catch {} frozen = null; }
    // a screen mode still waiting for "Keep": back to the saved one
    if (displayTrial) { clearTimeout(displayTrial); try { require('child_process').execFileSync(KEYS_EXE, ['display', 'reset', displayHwnd || '0'], { windowsHide: true, timeout: 5000 }); } catch {} }
    globalShortcut.unregisterAll();
    mpv.stop(true);
    stopPadWatch(true);
    stopCursorHide();
    if (server) server.stop();
    clearTimeout(progressTimer);
    if (config.settings.keepPlayHistory === false) progress = {};   // forgotten when MediaDeck closes
    writeProgress(progress);
    if (config.settings.keepRecentGames === false) { recent = []; try { writeGames(RECENT_FILE, recent); } catch {} }   // the same for Recently played
    // Thumbnails and subtitles are only kept between sessions if the user wants that
    if (server && !config.settings.keepThumbnails) server.clearCache();
  });
  app.on('window-all-closed', () => app.quit());
}
