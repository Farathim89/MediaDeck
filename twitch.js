// Twitch: SmartTwitchTV's TV interface (github.com/fgl27/SmartTwitchTV, GPL-3.0; the web build of
// the Android TV app) in a full-screen window, without ads:
//
//  - browsing (channels, games, follows, clips) is SmartTwitchTV's own D-pad interface
//  - its web build plays streams in Twitch's embed player, which shows ads. That player is
//    replaced (twitch-preload.js) by a stand-in that hands the channel or video to main.js,
//    which plays it in MediaDeck's own player through Streamlink (it leaves the ads out)
//  - the controller is read in the page (twitch-preload.js) and sent back here as key presses
const { BrowserWindow, session, ipcMain, screen } = require('electron');
const path = require('path');

const URL = 'https://fgl27.github.io/SmartTwitchTV/release/index.html';
// key names Electron's sendInputEvent knows, per controller action (SmartTwitchTV: Escape = back)
const KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Return', back: 'Escape', play: 'MediaPlayPause', pageup: 'PageUp', pagedown: 'PageDown' };
// never loaded: Twitch's embed player (replaced) and the page's analytics
const BLOCK = ['*://embed.twitch.tv/*', '*://player.twitch.tv/*', '*://www.googletagmanager.com/*', '*://www.gstatic.com/firebasejs/*', '*://*.google-analytics.com/*'];

// What's selected, clearer than SmartTwitchTV's own (a changed background only): a Twitch-purple
// ring with a glow on the selected card, the same purple on menus, settings and dialog buttons.
// Also keeps the page's colours under a Windows contrast theme.
const PURPLE = '#9146FF';
const CSS = `
html { forced-color-adjust: none !important; }
.stream_thumbnail_focused, .stream_thumbnail_focused_no_ani, .feed_thumbnail_focused, .feed_thumbnail_focused_no_ani {
  background-color: rgba(145, 70, 255, 0.30) !important; border-color: ${PURPLE} !important;
  box-shadow: inset 0 0 0 0.3em ${PURPLE}, 0 0 1.6em 0.35em rgba(145, 70, 255, 0.6) !important;
  position: relative; z-index: 5;
}
.side_panel_div_focused, .settings_div_focus, .settings_value_focus, .stream_switch_focused, .playsideinfofocus {
  background: rgba(145, 70, 255, 0.32) !important; border-image: none !important; box-shadow: inset 0.3em 0 0 ${PURPLE} !important;
}
.button_dialog_focused, .dialog_end_icons_focus, .button_search_focused, .feed_end_name_focus {
  background-color: rgba(145, 70, 255, 0.38) !important; border-image: none !important; border-color: ${PURPLE} !important;
  box-shadow: 0 0 0 0.2em ${PURPLE}, 0 0 1.2em rgba(145, 70, 255, 0.55) !important;
}
.side_panel_feed_img_focus, .progress_bar_holder_focus { box-shadow: 0 0 0 0.25em ${PURPLE}, 0 0 1em rgba(145, 70, 255, 0.6) !important; }
`;

let win = null;
let opts = {};

function init(o) {
  opts = o;   // { onHome(), onClosed(), onPlay({ channel } | { video, time }) }
  const mine = (e) => win && e.sender === win.webContents;
  ipcMain.on('tw-key', (e, action) => { if (mine(e)) key(action); });
  ipcMain.on('tw-home', (e) => { if (mine(e)) opts.onHome && opts.onHome(); });
  ipcMain.on('tw-play', (e, req) => { if (mine(e)) opts.onPlay && opts.onPlay(req); });
}

function key(action) {
  if (!win || win.isDestroyed()) return;
  const keyCode = KEYS[action];
  if (!keyCode) return;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}

// Opens Twitch (or shows it again where it was), full screen on MediaDeck's screen
function open(parent) {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  const ses = session.fromPartition('persist:twitch');
  ses.webRequest.onBeforeRequest({ urls: BLOCK }, (d, cb) => cb({ cancel: true }));
  const area = parent && !parent.isDestroyed() ? screen.getDisplayMatching(parent.getBounds()).bounds : screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    ...area, frame: false, fullscreenable: false,   // covers the screen without Chromium full screen (see main.js setFull)
    show: false, backgroundColor: '#000000', title: 'Twitch',
    webPreferences: { session: ses, preload: path.join(__dirname, 'twitch-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('dom-ready', () => { win.webContents.insertCSS(CSS).catch(() => {}); });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { win = null; opts.onClosed && opts.onClosed(); });
  win.loadURL(URL);
}

// Out of the way (PS button, or a stream playing in MediaDeck's player)
function hide() { if (win && !win.isDestroyed()) win.hide(); }

// The stream in MediaDeck's player ended: SmartTwitchTV leaves its player screen
function ended() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript('window.__mcTwitchEnded && window.__mcTwitchEnded()').catch(() => {});
}

// A short message over Twitch ("… is offline")
function notice(text) {
  if (!win || win.isDestroyed() || !text) return;
  win.webContents.executeJavaScript(`(() => {
    const d = document.createElement('div');
    d.textContent = ${JSON.stringify(String(text))};
    d.style.cssText = 'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);z-index:2147483647;padding:.7em 1.4em;border-radius:.5em;background:rgba(20,20,24,.94);color:#fff;font:600 1.6em Segoe UI,sans-serif;border-left:.25em solid #9146FF;pointer-events:none;forced-color-adjust:none';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4000);
  })()`).catch(() => {});
}

const isShown = () => !!(win && !win.isDestroyed() && win.isVisible());
const isOpen = () => !!(win && !win.isDestroyed());
function close() { if (win && !win.isDestroyed()) win.close(); }

module.exports = { init, open, hide, ended, notice, close, isShown, isOpen, key };
