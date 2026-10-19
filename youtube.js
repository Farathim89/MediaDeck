// YouTube: YouTube's own TV interface (youtube.com/tv, the one smart TVs run) in a full-screen
// window, with TizenTube added (github.com/reisxd/TizenTube, GPL-3.0): no ads, SponsorBlock,
// DeArrow, speed control — the same idea as SmartTube on Android TV.
//
//  - the page sees a PS4 (YouTube's TV app only answers TV-like devices; this one reaches 1080p)
//  - sign-in is YouTube's TV sign-in (a code on yt.be/activate), kept in its own session
//  - TizenTube's script is kept in data\youtube\tizentube.js and refreshed weekly from npm
//  - the controller is read in the page (youtube-preload.js) and sent back here as real key presses
const { BrowserWindow, session, ipcMain, screen, net } = require('electron');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)';
const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js';
// TizenTube reads a YouTube setting that only exists after YouTube TV ran once: without it the
// whole script stops, so it is waited for (5 s) and else created empty
const READY = `new Promise((res) => { const k = 'yt.leanback.default::recurring_actions'; let n = 20;
  (function wait() { if (localStorage[k] || n-- <= 0) { if (!localStorage[k]) localStorage[k] = JSON.stringify({ data: { data: { whos_watching_fullscreen_zero_accounts: { lastFired: 0 } } } }); res(true); } else setTimeout(wait, 250); })(); })`;
// Look: YouTube's own colours even with a Windows contrast theme (which otherwise strips the white
// focus pill and leaves dark text on dark), and the sidebar's selected entry as white text with a
// red line under its name instead of a white pill. (The names sit in boxes that clip below the
// text line; "overflow: clip" with a margin keeps their "…" shortening and lets the line show.)
// The selected video: a thick red ring with a red glow instead of a thin white border; the grey
// border the mouse pointer leaves on another video is hidden, so only the selection shows.
const CSS = `
html { forced-color-adjust: none !important; }
ytlr-guide-entry-renderer.zylon-focus div { background-color: transparent !important; }
ytlr-guide-entry-renderer.zylon-focus yt-icon, ytlr-guide-entry-renderer.zylon-focus yt-formatted-string { color: #fff !important; }
ytlr-guide-entry-renderer.zylon-focus yt-formatted-string, ytlr-guide-entry-renderer.zylon-focus div:has(> yt-formatted-string) { overflow: clip !important; overflow-clip-margin: 0.9rem; }
ytlr-guide-entry-renderer.zylon-focus yt-formatted-string { text-decoration: underline solid #ff0033; text-decoration-thickness: 0.25rem; text-underline-offset: 0.4rem; text-decoration-skip-ink: none; }
ytlr-app ytlr-tile-renderer.zylon-focus.zylon-focus.zylon-focus.zylon-focus.zylon-focus[class][class] ytlr-tile-header-renderer[class][class][class][class]::after { border-color: #ff0033 !important; border-top-color: #ff0033 !important; border-right-color: #ff0033 !important; border-bottom-color: #ff0033 !important; border-left-color: #ff0033 !important; border-width: 0.5rem !important; box-shadow: 0 0 2rem 0.4rem rgba(255, 0, 51, 0.55) !important; }
ytlr-tile-renderer:not(.zylon-focus) ytlr-tile-header-renderer::after { border-color: transparent !important; box-shadow: none !important; }
`;
// key names Electron's sendInputEvent knows, per controller action
const KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Return', back: 'Escape', play: 'MediaPlayPause' };

let win = null;
let opts = {};

function init(o) {
  opts = o;   // { dataDir, onHome(), onClosed() }
  ipcMain.on('yt-key', (e, action) => { if (win && e.sender === win.webContents) key(action); });
  ipcMain.on('yt-home', (e) => { if (win && e.sender === win.webContents) opts.onHome && opts.onHome(); });
}

// One TV remote key into the page
function key(action) {
  if (!win || win.isDestroyed()) return;
  if (action === 'tizentube') {
    // TizenTube's own menu sits on the TV remote's green key (404), which a PC keyboard doesn't have
    win.webContents.executeJavaScript(`(() => { for (const type of ['keydown', 'keyup']) { const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => 404 }); Object.defineProperty(ev, 'which', { get: () => 404 }); document.dispatchEvent(ev); } })()`).catch(() => {});
    return;
  }
  const keyCode = KEYS[action];
  if (!keyCode) return;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}

// TizenTube's script: the local copy, refreshed when it is a week old (a failed refresh keeps the old one)
async function tizenTube() {
  const file = path.join(opts.dataDir, 'youtube', 'tizentube.js');
  let have = '';
  try { have = fs.readFileSync(file, 'utf8'); } catch {}
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(file).mtimeMs < 7 * 86400e3; } catch {}
  if (have && fresh) return have;
  try {
    const r = await net.fetch(SCRIPT_URL);
    const text = r.ok ? await r.text() : '';
    if (text.length > 100000 && /TizenTube|ytaf-configuration/.test(text)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return text;
    }
  } catch (e) { console.error('[youtube] TizenTube refresh:', e.message); }
  return have;
}

// Opens YouTube (or shows it again where it was), full screen on MediaDeck's screen
function open(parent) {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  const ses = session.fromPartition('persist:youtube');
  ses.setUserAgent(UA);
  const area = parent && !parent.isDestroyed() ? screen.getDisplayMatching(parent.getBounds()).bounds : screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    ...area, frame: false, fullscreenable: false,   // covers the screen without Chromium full screen (see main.js setFull)
    show: false, backgroundColor: '#000000', title: 'YouTube',
    webPreferences: { session: ses, preload: path.join(__dirname, 'youtube-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  win.webContents.setUserAgent(UA);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('dom-ready', async () => {
    win.webContents.insertCSS(CSS).catch(() => {});
    const script = await tizenTube();
    if (!script || !win || win.isDestroyed()) return;
    try {
      await win.webContents.executeJavaScript(READY);
      await win.webContents.executeJavaScript(script);
    } catch (e) { console.error('[youtube] TizenTube:', e.message); }
  });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { win = null; opts.onClosed && opts.onClosed(); });
  win.loadURL('https://www.youtube.com/tv');
}

// Out of the way (PS button): the video pauses, the window stays for "open again"
function hide() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); if (v && !v.paused) v.pause(); })()`).catch(() => {});
  win.hide();
}

// For tests: the elements YouTube marks as focused (tag, classes, size, border and shadow)
function focusInfo() {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  if (focusInfo.rules) return win.webContents.executeJavaScript(`(() => { const out = []; const walk = (rules) => { for (const r of rules) { if (r.cssRules) walk(r.cssRules); const t = r.cssText || ''; if (/after/.test(r.selectorText || '') && /border|outline/.test(t) && /ptYQ6c|I7WAid|yDUxac|DC68Tc|tile-header/.test(t)) out.push(t.slice(0, 400)); } };
    for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} } return out.slice(0, 20); })()`).catch((e) => e.message);
  return win.webContents.executeJavaScript(`[...document.querySelectorAll('ytlr-tile-renderer.zylon-focus *, ytlr-tile-renderer.zylon-focus')].filter((e) => [null, '::before', '::after'].some((p) => { const cs = getComputedStyle(e, p); return parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none' || cs.outlineStyle !== 'none'; })).slice(0, 12).map((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return e.tagName.toLowerCase() + '.' + [...e.classList].join('.') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
      + ' bs=' + cs.boxShadow.slice(0, 60) + ' bd=' + cs.borderTopWidth + ' ' + cs.borderTopColor
      + ' after=' + getComputedStyle(e, '::after').borderTopWidth + ' ' + getComputedStyle(e, '::after').borderTopColor + ' ' + getComputedStyle(e, '::after').borderTopStyle + '/' + getComputedStyle(e, '::after').boxShadow.slice(0, 50) + ' content=' + getComputedStyle(e, '::after').content
      + ' before=' + getComputedStyle(e, '::before').borderTopWidth + '/' + getComputedStyle(e, '::before').boxShadow.slice(0, 50) + ' kids=' + [...e.children].map((c) => c.tagName.toLowerCase() + '.' + [...c.classList].join('.')).join(',').slice(0, 200); })`).catch((e) => e.message);
}

const isShown = () => !!(win && !win.isDestroyed() && win.isVisible());
const isOpen = () => !!(win && !win.isDestroyed());
function close() { if (win && !win.isDestroyed()) win.close(); }

module.exports = { init, open, hide, close, isShown, isOpen, key, focusInfo };
