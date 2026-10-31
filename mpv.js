// mpv playback. mpv draws into a borderless "host" window laid over the app;
// our own controls (renderer/player.html) sit on top in a see-through window.
// We talk to mpv over its JSON IPC pipe.
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const PlayerSettings = require('./renderer/js/player-settings');   // the player's defaults (shared with the windows)

let d = null;          // from main.js: win(), config(), dataDir, onShortcut, getProgress(), setProgress(), onClosed()
let host = null;
let osd = null;
let proc = null;
let pipe = null;
let buf = '';
let reqId = 0;
let session = null;    // { list, index, kind }
const pending = new Map();
let pipeReady = null;
let pipeReadyResolve = null;

function resetPipeReady() { pipeReady = new Promise((r) => { pipeReadyResolve = r; }); }
resetPipeReady();

function mpvPath() {
  const p = d.config().settings.mpvPath;
  // the one set in Settings, else the bundled one (Apps\mpv), else PlexDeck's
  const P = require('./paths');
  const candidates = [P.resolve(p), path.join(P.APPS, 'mpv', 'mpv.exe'), path.join(P.APPS, 'PlexDeck', 'resources', 'mpv', 'mpv.exe')];
  return candidates.find((c) => { try { return c && fs.statSync(c).isFile(); } catch { return false; } }) || null;
}

// ---------- Layers ----------
function place() {
  if (!host || host.isDestroyed()) return;
  const b = d.win().getContentBounds();
  host.setBounds(b);
  if (osd && !osd.isDestroyed()) osd.setBounds(b);
}
const onMin = () => { if (host) host.hide(); if (osd) osd.hide(); };
const onRestore = () => { if (host) { host.showInactive(); place(); } if (osd) { osd.show(); osd.focus(); } };
const LAYOUT_EVENTS = ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'];

function createLayers() {
  const win = d.win();
  // (thickFrame: false: no grey Windows frame bar along the bottom - see main.js)
  host = new BrowserWindow({
    parent: win, frame: false, thickFrame: false, show: false, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, focusable: false, backgroundColor: '#000000', hasShadow: false,
  });
  osd = new BrowserWindow({
    parent: host, frame: false, thickFrame: false, show: false, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-player.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  osd.setMenu(null);
  osd.webContents.on('before-input-event', d.onShortcut);
  osd.webContents.on('will-navigate', (e) => e.preventDefault());
  place();
  for (const ev of LAYOUT_EVENTS) win.on(ev, place);
  win.on('minimize', onMin);
  win.on('restore', onRestore);
}

// The player's controls take the focus: they read the controller and the keys. MediaDeck's own window lies under the
// player - whatever gave it the focus (PS, Alt+Tab, the taskbar) left the player deaf, its buttons and keys went to
// the hidden window. home: PS was pressed, the controls show.
function focus(home = false) {
  if (!osd || osd.isDestroyed() || !osd.isVisible()) return false;
  osd.focus();
  if (home) toOsd({ event: 'home' });
  return true;
}
const osdWindow = () => (osd && !osd.isDestroyed() ? osd : null);

function destroyLayers() {
  const win = d.win();
  // On quit the main window is already gone
  if (win && !win.isDestroyed()) {
    for (const ev of LAYOUT_EVENTS) win.removeListener(ev, place);
    win.removeListener('minimize', onMin);
    win.removeListener('restore', onRestore);
  }
  if (osd && !osd.isDestroyed()) osd.destroy();
  if (host && !host.isDestroyed()) host.destroy();
  osd = null; host = null;
}

// ---------- mpv and its pipe ----------
async function send(command) {
  if (!pipe) await Promise.race([pipeReady, new Promise((r) => setTimeout(r, 8000))]);
  return new Promise((resolve) => {
    if (!pipe) return resolve(null);
    const id = ++reqId;
    pending.set(id, resolve);
    pipe.write(JSON.stringify({ command, request_id: id }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 5000);
  });
}

function toOsd(msg) { if (osd && !osd.isDestroyed()) osd.webContents.send('mpv:event', msg); }

const OBSERVE = ['time-pos', 'pause', 'duration', 'track-list', 'paused-for-cache', 'eof-reached', 'path', 'volume', 'mute', 'metadata', 'idle-active',
  'video-params'];

function onLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.request_id && pending.has(m.request_id)) { pending.get(m.request_id)(m); pending.delete(m.request_id); return; }
  if (m.event === 'property-change' && m.name === 'video-params') { applyRtx(m.data).catch(() => {}); return; }   // a new video
  if (m.event === 'property-change') toOsd({ prop: m.name, value: m.data });
  else if (m.event === 'end-file') toOsd({ event: 'end-file', reason: m.reason, error: m.file_error });
  else if (m.event === 'file-loaded') toOsd({ event: 'file-loaded' });
}

function connectPipe(name, tries = 0) {
  const c = net.connect(name);
  c.on('connect', () => {
    pipe = c;
    pipeReadyResolve();
    OBSERVE.forEach((prop, i) => send(['observe_property', i + 1, prop]));
    for (const [key, cmd] of [['PLAY', 'set pause no'], ['PAUSE', 'set pause yes'], ['PLAYPAUSE', 'cycle pause']]) send(['keybind', key, cmd]);
  });
  c.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n);
      buf = buf.slice(n + 1);
      if (line.trim()) onLine(line);
    }
  });
  c.on('error', () => { if (!pipe && tries < 50 && proc) setTimeout(() => connectPipe(name, tries + 1), 150); });
  c.on('close', () => { if (pipe === c) pipe = null; });
}

// ---------- Sound: output, speakers, passthrough ----------
// Passthrough sends Dolby / DTS untouched to a receiver (mpv opens the output in exclusive mode for it). An optical /
// coaxial (S/PDIF) output only carries Dolby Digital and DTS; mpv 0.41 then falls back to decoding but never opens
// the output again - the film stands still. So S/PDIF outputs get only those two, and the guard below steps down.
const SPDIF_ALL = 'ac3,eac3,dts-hd,truehd';
const SPDIF_OPTICAL = 'ac3,dts';
const OPTICAL = /digital output|s\/?pdif|optical|toslink|coax/i;
let devices = null;        // [{ name, description }] from mpv (cached)

function audioDevices(fresh = false) {
  const exe = mpvPath();
  if (!exe) return Promise.resolve([]);
  if (devices && !fresh) return Promise.resolve(devices);
  return new Promise((resolve) => {
    require('child_process').execFile(exe, ['--no-config', '--audio-device=help'], { windowsHide: true, timeout: 10000 }, (err, out) => {
      const list = [];
      for (const m of String(out || '').matchAll(/^\s*'([^']+)'\s+\((.*)\)\s*$/gm)) {
        if (m[1].startsWith('wasapi/')) list.push({ name: m[1], description: m[2] });   // (not 'auto', not openal)
      }
      if (list.length) devices = list;
      resolve(list);
    });
  });
}

function deviceName(id) {
  return ((devices || []).find((x) => x.name === id) || {}).description || '';
}

function spdifFor(s, device = s.audioDevice) {
  const mode = s.audioPassthrough || 'on';
  if (mode === 'off') return '';
  if (mode === 'spdif' || OPTICAL.test(deviceName(device))) return SPDIF_OPTICAL;
  return SPDIF_ALL;
}

// Automatic follows Windows' speaker setup (shared mode); a chosen layout takes the output exclusively - in shared
// mode Windows mixes to its own layout (the DENON stayed 5.1 with "stereo"). 5.1 / 7.1 mean "up to": mpv picks the
// layout from the list that fits the film, so a stereo film stays stereo (a fixed 7.1 stretched it to 8 channels and
// the receiver no longer upmixed it)
const LAYOUTS = { stereo: 'stereo', '5.1': '5.1,stereo', '7.1': '7.1,5.1,stereo' };
function audioArgs(s) {
  const a = [];
  if (s.audioDevice && s.audioDevice !== 'auto') a.push(`--audio-device=${s.audioDevice}`);
  if (LAYOUTS[s.audioChannels]) a.push(`--audio-channels=${LAYOUTS[s.audioChannels]}`, '--audio-exclusive=yes');
  a.push(`--audio-spdif=${spdifFor(s)}`);
  return a;
}

// ---------- NVIDIA RTX Video: Super Resolution (AI upscaling) and RTX HDR (SDR made HDR) ----------
// mpv's d3d11vpp filter asks the driver for them (Direct3D 11 renderer; software-decoded video is uploaded to the
// card by itself). Per video: Super Resolution only when it is smaller than the player (scale = how many times it
// fits), RTX HDR only for SDR video - never for HDR films, pictures or album covers. Only on an NVIDIA RTX card:
// elsewhere nvidia-true-hdr would only relabel the picture as HDR (wrong colours). Super Resolution also needs
// "RTX Video Enhancement → Super resolution" switched on in NVIDIA's own settings - the driver ignores it otherwise.
let rtxCard = null;           // the NVIDIA RTX card's name, '' = none (asked once)
function rtxGpu() {
  if (rtxCard !== null) return Promise.resolve(rtxCard);
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name -join "|"'],
      { windowsHide: true, timeout: 15000 }, (err, out) => {
        rtxCard = String(out || '').split('|').map((x) => x.trim()).find((x) => /NVIDIA.*\bRTX\b/i.test(x)) || '';
        resolve(rtxCard);
      });
  });
}
let rtxFor = '';              // the video the filter was set for (w x h gamma), so a new video gets its own
async function applyRtx(vp, force = false) {
  if (!vp || !vp.w || !vp.h) return;
  const key = `${vp.w}x${vp.h} ${vp.gamma}`;
  if (key === rtxFor && !force) return;
  rtxFor = key;
  const s = d.config().settings;
  const parts = [];
  if (await rtxGpu() && (s.mpvGpuApi || 'd3d11') === 'd3d11' && !(await get('current-tracks/video/image'))) {
    if (s.rtxSuperRes !== 'off') {
      const win = (await get('osd-dimensions')) || {};
      const k = Math.min((win.w || 0) / vp.w, (win.h || 0) / vp.h);
      if (k > 1.1) parts.push(`scale=${Math.min(4, k).toFixed(3)}`, 'scaling-mode=nvidia');
    }
    // RTX HDR only when it is switched on (off by default; Super Resolution never brings it along)
    if (s.rtxHdr === 'on' && !['pq', 'hlg'].includes(vp.gamma)) parts.push('nvidia-true-hdr', 'format=p010');
  }
  await set('vf', parts.length ? `@rtx:d3d11vpp=${parts.join(':')}` : '');
}

// Changed in the player: applied at once, and kept in Settings
async function setAudio(key, value) {
  const s = d.config().settings;
  // the player's own defaults (Y → Options → Player settings): the same list as Settings → Media Player
  if (PlayerSettings.KEYS.includes(key)) {
    if (!PlayerSettings.valid(key, value)) return false;
    d.saveSettings({ [key]: value });
    return true;
  }
  if (key === 'rtxSuperRes' || key === 'rtxHdr') {
    if (!['on', 'off'].includes(value)) return false;
    d.saveSettings({ [key]: value });
    await applyRtx(await get('video-params'), true);
    return true;
  }
  if (!['audioDevice', 'audioChannels', 'audioPassthrough'].includes(key)) return false;
  if (key === 'audioDevice' && !(value === 'auto' || /^wasapi\/\{[0-9a-f.{}-]+\}$/i.test(value))) return false;
  if (key === 'audioChannels' && !['auto', ...Object.keys(LAYOUTS)].includes(value)) return false;
  if (key === 'audioPassthrough' && !['on', 'spdif', 'off'].includes(value)) return false;
  d.saveSettings({ [key]: value });
  if (key === 'audioDevice') {
    await send(['set_property', 'audio-device', value || 'auto']);
    await send(['set_property', 'audio-spdif', spdifFor(s)]);     // an optical output: Dolby Digital / DTS only
  }
  if (key === 'audioChannels') {
    await send(['set_property', 'audio-exclusive', !!LAYOUTS[value]]);
    await send(['set_property', 'audio-channels', LAYOUTS[value] || 'auto-safe']);
  }
  if (key === 'audioPassthrough') await send(['set_property', 'audio-spdif', spdifFor(s)]);
  watch.stalls = 0;
  return true;
}

// The guard: a file with sound that plays but whose sound output never opens (current-ao stays empty) = a
// passthrough format this output refused. One step down each time: all formats -> Dolby Digital / DTS -> off.
const watch = { timer: null, stalls: 0 };
function startWatch() {
  clearInterval(watch.timer);
  watch.stalls = 0;
  watch.timer = setInterval(async () => {
    if (!pipe) return;
    const get = async (p) => { const r = await send(['get_property', p]); return r && r.error === 'success' ? r.data : undefined; };
    const [codec, pause, idle, cache, ao, spdif] = await Promise.all(['current-tracks/audio/codec', 'pause', 'idle-active', 'paused-for-cache',
      'current-ao', 'audio-spdif'].map(get));
    // only Dolby / DTS sound goes through as it is (AAC, FLAC … are always decoded: not this guard's business)
    if (!/^(ac3|eac3|truehd|mlp|dts|dca)$/.test(codec || '') || pause || idle || cache || ao || !spdif) { watch.stalls = 0; return; }
    if (++watch.stalls < 2) return;
    watch.stalls = 0;
    const next = spdif.includes('truehd') || spdif.includes('eac3') ? SPDIF_OPTICAL : '';
    await send(['set_property', 'audio-spdif', next]);
    toOsd({ event: 'passthrough-fallback', to: next });
  }, 1500);
}

function settingsArgs(s) {
  const a = [];
  const size = { Small: 0.8, Normal: 1, Large: 1.25, Huge: 1.5 }[s.subSize] || 1;
  a.push(`--sub-scale=${size}`, '--sub-font=Segoe UI Semibold', '--sub-font-size=44', '--sub-border-size=2.6', '--sub-shadow-offset=1.2', '--sub-margin-y=48');
  if (s.subLang) a.push(`--slang=${s.subLang}`);
  if (s.audioLang) a.push(`--alang=${s.audioLang}`);
  if (s.subtitles === 'off') a.push('--sid=no');
  a.push(...audioArgs(s));
  return a;
}

// A player still open: it closes first, and the new one starts once it is gone - one that had the sound output to
// itself (passthrough, a fixed speaker layout) would otherwise keep the new one from opening it
const gone = (p, ms) => new Promise((resolve) => {
  if (!p || p.exitCode !== null) return resolve();
  p.once('exit', () => resolve());
  setTimeout(resolve, ms);
});

// One at a time: a second Play while a player is still starting or closing went through too (two mpv.exe, the
// controls on the wrong one, windows left over). It waits its turn; of several waiting only the newest plays.
let opening = Promise.resolve();
let openId = 0;
function open(list, index, opts = {}) {
  const id = ++openId;
  const run = opening.then(() => (id === openId ? openNow(list, index, opts) : { ok: true, replaced: true }));
  opening = run.catch(() => {});
  return run;
}

async function openNow(list, index, opts = {}) {
  const exe = mpvPath();
  if (!exe) return { ok: false, error: 'mpv was not found. Set its path in data\\config.json ("mpvPath").' };
  // (also its windows when mpv already ended by itself)
  if (proc || host) { const old = proc; stop(); await gone(old, 1500); }
  resetPipeReady();
  buf = '';
  rtxFor = '';
  const mpvDir = path.join(d.dataDir, 'mpv');
  fs.mkdirSync(path.join(mpvDir, 'cache'), { recursive: true });
  createLayers();
  const hwnd = host.getNativeWindowHandle();
  const wid = process.arch === 'x64' ? hwnd.readBigUInt64LE(0).toString() : String(hwnd.readUInt32LE(0));
  const pipeName = `\\\\.\\pipe\\mediacenter-mpv-${process.pid}-${Date.now()}`;
  const args = [
    `--wid=${wid}`, `--input-ipc-server=${pipeName}`, '--idle=yes', '--force-window=yes',
    '--no-osc', '--osd-level=0', '--no-input-default-bindings', '--input-vo-keyboard=no', '--no-input-cursor',
    '--cursor-autohide=always', '--hwdec=auto-safe', '--vo=gpu-next', '--target-colorspace-hint=yes',
    `--gpu-api=${d.config().settings.mpvGpuApi || 'd3d11'}`,
    '--keep-open=yes', '--cache=yes', '--demuxer-max-bytes=300MiB', '--media-controls=yes',
    '--audio-display=no', '--no-terminal', '--sub-auto=fuzzy', '--audio-file-auto=no', '--image-display-duration=inf',
    `--config-dir=${mpvDir}`, `--gpu-shader-cache-dir=${path.join(mpvDir, 'cache')}`, `--icc-cache-dir=${path.join(mpvDir, 'cache')}`,
    ...settingsArgs(d.config().settings),
  ];
  if (process.env.MC_MPV_LOG) args.push(`--log-file=${path.join(mpvDir, 'mpv.log')}`);
  session = { list, index, opts };
  const me = proc = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
  // (only this player's own end: an old one ending late must not close the new one)
  me.on('exit', () => { if (proc !== me) return; proc = null; pipe = null; clearInterval(watch.timer); toOsd({ event: 'mpv-exit' }); });
  startWatch();
  host.showInactive();
  osd.loadFile(path.join(__dirname, 'renderer', 'player.html'));
  osd.webContents.once('did-finish-load', () => { if (osd) { osd.show(); osd.focus(); } });
  setTimeout(() => connectPipe(pipeName), 200);
  return { ok: true };
}

// now: MediaDeck is closing - its timers won't run any more, so a player that doesn't quit by itself (hung on the
// sound device) is ended at once instead of staying behind with the sound output
function stop(now = false) {
  clearInterval(watch.timer);
  if (pipe) { try { pipe.write(JSON.stringify({ command: ['quit'] }) + '\n'); } catch {} }
  const p = proc;
  if (now && p && p.exitCode === null) { try { require('child_process').execFileSync('taskkill', ['/PID', String(p.pid), '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' }); } catch {} }
  setTimeout(() => { try { if (p && p.exitCode === null) p.kill(); } catch {} }, 800);
  proc = null; pipe = null;
  destroyLayers();
}

function init(deps) {
  d = deps;
  const fromOsd = (e) => osd && e.sender === osd.webContents;
  ipcMain.handle('play', (e, list, index, opts) => open(list, index, opts));
  ipcMain.handle('player:init', (e) => {
    if (!fromOsd(e)) return null;
    return { ...session, settings: d.config().settings, progress: d.getProgress(), server: d.serverStatus() };
  });
  const ALLOWED = new Set(['loadfile', 'set_property', 'get_property', 'seek', 'cycle', 'stop', 'add', 'frame-step', 'frame-back-step', 'sub-add', 'audio-add']);
  ipcMain.handle('player:cmd', async (e, command) => {
    if (!fromOsd(e) || !Array.isArray(command) || !ALLOWED.has(command[0])) return null;
    const r = await send(command);
    return r ? (r.error === 'success' ? (r.data ?? true) : null) : null;
  });
  ipcMain.handle('player:progress', (e, file, data) => { if (fromOsd(e)) d.setProgress(file, data); return true; });
  ipcMain.handle('player:audio', (e, key, value) => (fromOsd(e) ? setAudio(key, value) : false));
  ipcMain.handle('player:audio-devices', async (e) => (fromOsd(e) ? audioDevices() : []));
  ipcMain.handle('audio-devices', (e, fresh) => audioDevices(!!fresh));
  ipcMain.handle('rtx-card', () => rtxGpu());        // Settings → Video: the NVIDIA RTX card's name, '' = none
  setTimeout(() => rtxGpu(), 5000);
  setTimeout(() => audioDevices(), 4000);     // known before the first film (an optical output gets Dolby Digital / DTS only)
  ipcMain.on('player:close', (e) => {
    if (!fromOsd(e)) return;
    stop();
    d.onClosed();
  });
}

// (tests: the test switch reads properties and changes sound settings like the player's menu)
const get = async (prop) => { const r = await send(['get_property', prop]); return r && r.error === 'success' ? r.data : null; };
const set = async (prop, value) => { const r = await send(['set_property', prop, value]); return !!(r && r.error === 'success'); };

module.exports = { init, open, stop, focus, osdWindow, isOpen: () => !!host, available: () => !!(d && mpvPath()), audioDevices, setAudio, get, set };
