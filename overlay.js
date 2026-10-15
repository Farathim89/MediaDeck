// In-game overlay: a see-through window that floats over the running game (like the Steam
// overlay). The game keeps its own window; the overlay only shows a menu on top of it.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let ov = null;
let ready = null;
let info = null;     // what the overlay shows: { name, emulator, actions }
let d = null;        // from main.js: focusWindow(hwnd), onAction(action)

function create() {
  ov = new BrowserWindow({
    frame: false, backgroundColor: '#000000', hasShadow: false,   // solid: see-through windows turn black over other programs here
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  ov.setAlwaysOnTop(true, 'screen-saver');   // above full-screen (borderless) games
  ov.setMenu(null);
  ready = new Promise((r) => ov.webContents.once('did-finish-load', r));
  ov.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  ov.on('closed', () => { ov = null; });
}

async function show(data) {
  info = data;
  if (!ov || ov.isDestroyed()) create();
  await ready;
  // The screen the player is looking at
  // A side panel on the left of the screen the player is looking at; the game stays visible next to it
  const b = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  ov.setBounds({ x: b.x, y: b.y, width: Math.round(b.width * 0.26), height: b.height });
  ov.webContents.send('overlay:open', info);
  ov.showInactive();
  // Take the keyboard/controller from the game (Windows only allows this with a little trick)
  const h = ov.getNativeWindowHandle();
  d.focusWindow(process.arch === 'x64' ? h.readBigUInt64LE(0).toString() : String(h.readUInt32LE(0)));
  setTimeout(() => { if (ov && !ov.isDestroyed()) ov.focus(); }, 120);
}

function hide() {
  if (ov && !ov.isDestroyed() && ov.isVisible()) ov.hide();
}

const isOpen = () => !!(ov && !ov.isDestroyed() && ov.isVisible());

function init(deps) {
  d = deps;
  const fromOverlay = (e) => ov && e.sender === ov.webContents;
  ipcMain.handle('overlay:info', (e) => (fromOverlay(e) ? info : null));
  ipcMain.handle('overlay:action', async (e, action) => {
    if (!fromOverlay(e)) return null;
    return d.onAction(action);
  });
}

module.exports = { init, show, hide, isOpen };
