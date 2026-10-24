// Twitch window (SmartTwitchTV):
//  - Twitch's embed player is replaced by a stand-in before the page runs: what SmartTwitchTV
//    would play there (a channel, or a video from a time) goes to main.js, which plays it in
//    MediaDeck's own player through Streamlink, without the ads
//  - the controller, read here (only while this window has the focus) and sent to twitch.js as
//    key presses: D-pad / left stick = arrows, A = OK, B / Back = back, X / Start = play-pause,
//    LB / RB = page up / down, Guide = MediaDeck (when the browser reports it; else the PS
//    button reaches MediaDeck through its own controller watcher)
//  - search gets an on-screen keyboard of MediaDeck's own (below)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const post = (req) => window.postMessage({ mcTwitch: req }, '*');
    let current = null;
    const player = {
      play() {}, pause() {}, seek() {}, setMuted() {}, getMuted: () => false, setVolume() {}, getVolume: () => 1,
      // more than one, or SmartTwitchTV keeps asking for them
      getQualities: () => [{ group: 'auto', name: 'Auto' }, { group: 'chunked', name: 'Source' }],
      setQuality() {}, getQuality: () => 'auto', isPaused: () => false, getCurrentTime: () => 0, getDuration: () => 0,
      addEventListener() {}, removeEventListener() {},
    };
    function Embed(id, o = {}) {
      this.listeners = {};
      current = this;
      if (o.channel) post({ channel: String(o.channel) });
      else if (o.video && String(o.video) !== '0') post({ video: String(o.video), time: String(o.time || '') });
    }
    Embed.VIDEO_READY = 'video.ready';
    Embed.VIDEO_PLAY = 'video.play';
    Embed.ENDED = 'ended';
    Embed.prototype.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
    Embed.prototype.removeEventListener = function () {};
    Embed.prototype.setChannel = function (c) { if (c) post({ channel: String(c) }); };
    Embed.prototype.setVideo = function (v, t) { if (v && String(v) !== '0') post({ video: String(v), time: String(t || '') }); };
    Embed.prototype.getPlayer = () => player;
    Object.defineProperty(window, 'Twitch', { value: Object.freeze({ Embed, Player: Embed }), writable: false, configurable: false });
    // called by twitch.js when MediaDeck's player has closed: SmartTwitchTV's own "exit player"
    // button (straight back to where you were; its "ended" event would say "has ended, exiting in 3 …")
    Object.defineProperty(window, '__mcTwitchEnded', {
      value: () => {
        const exit = document.getElementById('twitch-embed_exit');
        if (exit) { exit.click(); return; }
        const e = current;
        if (e) for (const fn of e.listeners[Embed.ENDED] || []) { try { fn(); } catch {} }
      },
    });
  },
});

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data.mcTwitch !== 'object') return;
  const r = e.data.mcTwitch;
  if (r.channel && /^[A-Za-z0-9_]{1,40}$/.test(r.channel)) ipcRenderer.send('tw-play', { channel: r.channel.toLowerCase() });
  else if (r.video && /^\d{1,15}$/.test(r.video)) ipcRenderer.send('tw-play', { video: r.video, time: /^[0-9hms]{0,12}$/.test(r.time) ? r.time : '' });
});

// Search: an on-screen keyboard of MediaDeck's own (SmartTwitchTV leaves typing to Android's keyboard, which a PC
// hasn't), open while the search box is being typed in. Laid out like the PC's keyboard, the same rows as
// youtube-preload.js: 1-0, then QWERTY / QWERTZ / AZERTY ... with that keyboard's own letters (Å Ä Ö on a Swedish
// one), and _ for Twitch names. With the controller: A types the key, X / Square deletes, Y / Triangle is a space,
// B / Back, Start or DONE go on to Channels / Games / Live / Videos (SmartTwitchTV's own Down, which ends typing).
// A real keyboard still types into the box itself; the mouse works on the keys.
const KB_ROWS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];
const KB_US = { Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Slash: '/' };
const KB_CSS = `
#mc-keyboard { position: fixed; left: 50%; transform: translateX(-50%); z-index: 2147483000; display: none; padding: 1.4vh 2.2vh 1.2vh; border-radius: 1.2vh;
  background: rgba(18, 18, 22, 0.97); box-shadow: 0 1vh 4vh rgba(0, 0, 0, 0.6); font-family: inherit; forced-color-adjust: none; user-select: none; }
#mc-keyboard.shown { display: block; }
.mc-kb-row { display: flex; justify-content: center; gap: 0.8vh; margin: 0.8vh 0; }
.mc-kb-key { min-width: 5.2vh; height: 5.2vh; line-height: 5.2vh; padding: 0 0.6vh; box-sizing: border-box; text-align: center; border-radius: 0.8vh; font-size: 2.6vh; color: #c8c8d0; cursor: pointer; }
.mc-kb-key.wide { min-width: 17vh; background: rgba(255, 255, 255, 0.08); font-size: 1.9vh; font-weight: 700; letter-spacing: 0.05em; }
.mc-kb-key.on { background: rgba(145, 70, 255, 0.30); color: #fff; box-shadow: inset 0 0 0 0.3vh #9146FF, 0 0 1.4vh 0.2vh rgba(145, 70, 255, 0.6); }
.mc-kb-hint { margin-top: 1vh; text-align: center; font-size: 1.6vh; color: #8a8a94; white-space: pre; }
`;
let kbChars = [];
let kbPanel = null;            // made when first needed (again after a layout change)
let kbAt = null;               // the selected key
const kbKeys = new WeakMap();  // key element -> { text, put } or { text, act }

function kbRead(map) {
  const charOf = (code) => (code.startsWith('Digit') ? code.slice(5) : (map && map.get(code)) || (code.startsWith('Key') ? code.slice(3).toLowerCase() : KB_US[code]));
  const fits = (c) => typeof c === 'string' && c.length === 1 && (/[\p{L}\p{N}]/u.test(c) || "-',.".includes(c));
  const seen = new Set();
  const chars = KB_ROWS.map((row) => row.map((code) => charOf(code)).filter((c) => fits(c) && !seen.has(c) && seen.add(c)));
  if (!seen.has('_')) chars[3].push('_');
  if (JSON.stringify(chars) === JSON.stringify(kbChars)) return;
  kbChars = chars;
  const wasOpen = kbOpen();
  if (kbPanel) kbPanel.remove();
  kbPanel = null;
  if (wasOpen) kbShow(true);
}
const kbReadLayout = () => { try { navigator.keyboard.getLayoutMap().then(kbRead, () => {}); } catch {} };

function kbBuild() {
  if (!document.getElementById('mc-keyboard-style')) {
    const s = document.createElement('style');
    s.id = 'mc-keyboard-style';
    s.textContent = KB_CSS;
    document.head.appendChild(s);
  }
  const panel = document.createElement('div');
  panel.id = 'mc-keyboard';
  const lines = kbChars.map((row) => row.map((c) => { const up = c.toUpperCase(); return { text: up.length === 1 ? up : c, put: c }; }));
  lines[0].push({ text: '⌫', act: 'delete' });
  lines.push([{ text: 'SPACE', put: ' ', wide: true }, { text: 'CLEAR', act: 'clear', wide: true }, { text: 'DONE', act: 'done', wide: true }]);
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'mc-kb-row';
    for (const k of line) {
      const b = document.createElement('div');
      b.className = 'mc-kb-key' + (k.wide ? ' wide' : '');
      b.textContent = k.text;
      kbKeys.set(b, k);
      // (mousedown, so the search box keeps the focus)
      b.addEventListener('mousedown', (e) => { e.preventDefault(); kbSelect(b); kbPress(k); });
      row.appendChild(b);
    }
    panel.appendChild(row);
  }
  const hint = document.createElement('div');
  hint.className = 'mc-kb-hint';
  hint.textContent = 'A  type     X  delete     Y  space     B  done';
  panel.appendChild(hint);
  return panel;
}

const kbOpen = () => !!(kbPanel && kbPanel.classList.contains('shown'));
function kbSelect(b) {
  if (kbAt) kbAt.classList.remove('on');
  kbAt = b;
  b.classList.add('on');
}
function kbShow(on) {
  if (on && !kbPanel) { kbPanel = kbBuild(); kbAt = kbPanel.children[1].children[0]; }
  if (!kbPanel) return;
  if (on) {
    if (!kbPanel.isConnected) document.body.appendChild(kbPanel);
    // below Channels / Games / Live / Videos, so they show what comes next
    const cats = document.getElementById('chanel_button');
    kbPanel.style.top = Math.round(cats ? cats.getBoundingClientRect().bottom + innerHeight * 0.04 : innerHeight * 0.46) + 'px';
    kbSelect(kbAt);
  }
  kbPanel.classList.toggle('shown', on);
}
document.addEventListener('focusin', (e) => {
  if (!e.target || e.target.id !== 'search_input') return;
  if (!e.target.value && kbPanel) kbSelect(kbPanel.children[1].children[0]);   // a new search starts on Q
  kbShow(true);
});
document.addEventListener('focusout', (e) => { if (e.target && e.target.id === 'search_input') kbShow(false); });

function kbPress(k) {
  const box = document.getElementById('search_input');
  if (!box) return;
  if (k.act === 'done') { ipcRenderer.send('tw-key', 'down'); return; }
  if (k.act === 'clear') box.value = '';
  else if (k.act === 'delete') box.value = [...box.value].slice(0, -1).join('');
  else box.value += k.put;
  box.setSelectionRange(box.value.length, box.value.length);
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
const kbMid = (e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; };
function kbMove(dir) {
  const rows = [...kbPanel.querySelectorAll('.mc-kb-row')].map((row) => [...row.children]);
  const r = rows.findIndex((row) => row.includes(kbAt));
  const c = rows[r].indexOf(kbAt);
  if (dir === 'left' || dir === 'right') { const to = rows[r][c + (dir === 'left' ? -1 : 1)]; if (to) kbSelect(to); return; }
  const line = rows[r + (dir === 'up' ? -1 : 1)];
  if (!line) return;
  // the key above / below that is closest (the rows are centred, so their keys don't line up)
  const x = kbMid(kbAt);
  kbSelect(line.reduce((a, b) => (Math.abs(kbMid(b) - x) < Math.abs(kbMid(a) - x) ? b : a)));
}
// A controller action while the keyboard is open: true when the keyboard used it
function kbHandle(action) {
  if (!kbOpen()) return false;
  if (['up', 'down', 'left', 'right'].includes(action)) kbMove(action);
  else if (action === 'ok') kbPress(kbKeys.get(kbAt));
  else if (action === 'play') kbPress({ act: 'delete' });
  else if (action === 'space') kbPress({ put: ' ' });
  else if (action === 'back' || action === 'start') kbPress({ act: 'done' });
  else if (action === 'home') return false;
  return true;
}
kbRead(null);   // US until the PC's own layout is known
kbReadLayout();
window.addEventListener('focus', kbReadLayout);   // (another keyboard layout chosen meanwhile)

const BUTTONS = { 0: 'ok', 1: 'back', 2: 'play', 3: 'space', 4: 'pageup', 5: 'pagedown', 8: 'back', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home' };
const REPEATS = new Set(['up', 'down', 'left', 'right']);
const FIRST = 420, EVERY = 110;
const held = new Map();

function pressed() {
  const set = new Set();
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!pad || !pad.connected) continue;
    pad.buttons.forEach((b, i) => { if (BUTTONS[i] && (b.pressed || b.value > 0.6)) set.add(BUTTONS[i]); });
    const [x = 0, y = 0] = pad.axes;
    if (x < -0.55) set.add('left');
    if (x > 0.55) set.add('right');
    if (y < -0.55) set.add('up');
    if (y > 0.55) set.add('down');
  }
  return set;
}

function send(action) {
  if (kbHandle(action)) return;
  if (action === 'home') ipcRenderer.send('tw-home');
  else if (action !== 'space') ipcRenderer.send('tw-key', action === 'start' ? 'play' : action);
}

let focused = false;
function poll(now) {
  requestAnimationFrame(poll);
  if (!document.hasFocus()) { held.clear(); focused = false; return; }
  const active = pressed();
  // buttons already down when the window got the focus (the A that opened Twitch) wait for release
  if (!focused) { focused = true; for (const a of active) held.set(a, { since: now, last: now, ignored: true }); }
  for (const a of [...held.keys()]) if (!active.has(a)) held.delete(a);
  for (const a of active) {
    const h = held.get(a);
    if (h && h.ignored) continue;
    if (!h) { held.set(a, { since: now, last: now }); send(a); }
    // (held X / Square keeps deleting while the keyboard is open)
    else if ((REPEATS.has(a) || (a === 'play' && kbOpen())) && now - h.since > FIRST && now - h.last > EVERY) { h.last = now; send(a); }
  }
}
window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
