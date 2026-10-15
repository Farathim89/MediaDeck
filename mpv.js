// mpv playback. mpv draws into a borderless "host" window laid over the app;
// our own controls (renderer/player.html) sit on top in a see-through window.
// We talk to mpv over its JSON IPC pipe.
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

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
  host = new BrowserWindow({
    parent: win, frame: false, show: false, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, focusable: false, backgroundColor: '#000000', hasShadow: false,
  });
  osd = new BrowserWindow({
    parent: host, frame: false, show: false, skipTaskbar: true, resizable: false, movable: false,
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

const OBSERVE = ['time-pos', 'pause', 'duration', 'track-list', 'paused-for-cache', 'eof-reached', 'path', 'volume', 'mute', 'metadata', 'idle-active'];

function onLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.request_id && pending.has(m.request_id)) { pending.get(m.request_id)(m); pending.delete(m.request_id); return; }
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

function settingsArgs(s) {
  const a = [];
  const size = { Small: 0.8, Normal: 1, Large: 1.25, Huge: 1.5 }[s.subSize] || 1;
  a.push(`--sub-scale=${size}`, '--sub-font=Segoe UI Semibold', '--sub-font-size=44', '--sub-border-size=2.6', '--sub-shadow-offset=1.2', '--sub-margin-y=48');
  if (s.subLang) a.push(`--slang=${s.subLang}`);
  if (s.audioLang) a.push(`--alang=${s.audioLang}`);
  if (s.subtitles === 'off') a.push('--sid=no');
  return a;
}

function open(list, index, opts = {}) {
  const exe = mpvPath();
  if (!exe) return { ok: false, error: 'mpv was not found. Set its path in data\\config.json ("mpvPath").' };
  if (proc) stop();
  resetPipeReady();
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
  proc = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
  proc.on('exit', () => { proc = null; pipe = null; toOsd({ event: 'mpv-exit' }); });
  host.showInactive();
  osd.loadFile(path.join(__dirname, 'renderer', 'player.html'));
  osd.webContents.once('did-finish-load', () => { if (osd) { osd.show(); osd.focus(); } });
  setTimeout(() => connectPipe(pipeName), 200);
  return { ok: true };
}

function stop() {
  if (pipe) { try { pipe.write(JSON.stringify({ command: ['quit'] }) + '\n'); } catch {} }
  const p = proc;
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
  ipcMain.on('player:close', (e) => {
    if (!fromOsd(e)) return;
    stop();
    d.onClosed();
  });
}

module.exports = { init, open, stop, isOpen: () => !!host, available: () => !!(d && mpvPath()) };
