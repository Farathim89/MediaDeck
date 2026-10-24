// YouTube window: the controller, read here (only while this window has the focus) and sent to
// youtube.js as TV remote keys. Standard gamepad layout (Xbox / DS4 via DS4Windows):
//   D-pad / left stick = arrows, A = OK, B / Back = back, X / Start = play-pause,
//   Y = TizenTube's menu, Guide = MediaDeck (when the browser reports it; else the PS button
//   reaches MediaDeck through its own controller watcher)
const { contextBridge, ipcRenderer } = require('electron');

// The search keyboard laid out like the PC's own keyboard instead of YouTube's A-Z rows of seven: 1-0 on top, then
// QWERTY (QWERTZ, AZERTY ...) with that keyboard's own letters (Å Ä Ö on a Swedish one), from Chromium's keyboard map.
// The key rows are swapped where YouTube's components get their props (their shared base class), so YouTube itself
// still moves, types and searches; delete, &123 and the language key keep a column of their own on the right (blank
// keys YouTube skips fill the gaps). Its other pages (&123, Cyrillic, ...) stay as they are.
contextBridge.executeInMainWorld({
  func: () => {
    const ROWS = [
      ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'],
      ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
      ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash'],
      ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
    ];
    const US = { Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Slash: '/' };
    const SPECIAL_ROW = { BACKSPACE: 0, NUMBER_LAYOUT: 1, SWITCH_LANGUAGE: 2 };
    let chars = [];
    let made = new WeakMap();   // YouTube's rows -> ours (the same array each time it draws them)
    // the digits stay 1-0 (on AZERTY they need Shift); letters, digits and - ' , . only (no dead keys like ´ ¨)
    const charOf = (map, code) => (code.startsWith('Digit') ? code.slice(5) : (map && map.get(code)) || (code.startsWith('Key') ? code.slice(3).toLowerCase() : US[code]));
    const fits = (c) => typeof c === 'string' && c.length === 1 && (/[\p{L}\p{N}]/u.test(c) || "-',.".includes(c));
    function read(map) {
      const seen = new Set();
      chars = ROWS.map((row) => row.map((code) => charOf(map, code)).filter((c) => fits(c) && !seen.has(c) && seen.add(c)));
      made = new WeakMap();
    }
    const readLayout = () => { try { navigator.keyboard.getLayoutMap().then(read, () => {}); } catch {} };
    read(null);   // US until the PC's own layout is known
    readLayout();
    window.addEventListener('focus', readLayout);   // (another keyboard layout chosen meanwhile)

    function ownLayout(rows) {
      const all = rows.flat().filter(Boolean);
      if (!all.filter((k) => k.action === 'TEXT').map((k) => k.label).join('').startsWith('ABCDEF')) return rows;
      let out = made.get(rows);
      if (out) return out;
      out = chars.map((row) => row.map((c) => { const up = c.toUpperCase(); return { label: up.length === 1 ? up : c, action: 'TEXT', ariaLabel: c }; }));
      // a letter of YouTube's keyboard language that this keyboard hasn't (Ñ on a Swedish one): at the end
      const have = new Set(chars.flat());
      for (const k of all) if (k.action === 'TEXT' && !have.has(String(k.label).toLowerCase())) out[3].push(k);
      const width = Math.max(...out.map((row) => row.length));
      for (const k of all) {
        if (k.action === 'TEXT') continue;
        const row = out[k.action in SPECIAL_ROW ? SPECIAL_ROW[k.action] : 3];
        while (row.length < width) row.push({ label: '', action: 'DISABLED' });
        row.push(k);
      }
      made.set(rows, out);
      return out;
    }

    const PROPS = Symbol.for('mediadeck.props');
    let tries = 0;
    const timer = setInterval(() => {
      const app = document.querySelector('ytlr-app');
      const inst = app && app.__instance;
      if (!inst) { if (++tries > 600) clearInterval(timer); return; }
      clearInterval(timer);
      let base = Object.getPrototypeOf(inst);
      while (Object.getPrototypeOf(base) && Object.getPrototypeOf(base) !== Object.prototype) base = Object.getPrototypeOf(base);
      if (Object.getOwnPropertyDescriptor(base, 'props')) return;
      Object.defineProperty(base, 'props', {
        configurable: true,
        get() { return this[PROPS]; },
        set(p) { if (p && Array.isArray(p.keys) && Array.isArray(p.keys[0])) p.keys = ownLayout(p.keys); this[PROPS] = p; },
      });
    }, 200);
  },
});

const BUTTONS = { 0: 'ok', 1: 'back', 2: 'play', 3: 'tizentube', 8: 'back', 9: 'play', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home' };
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
  if (action === 'home') ipcRenderer.send('yt-home');
  else ipcRenderer.send('yt-key', action);
}

let focused = false;
function poll(now) {
  requestAnimationFrame(poll);
  if (!document.hasFocus()) { held.clear(); focused = false; return; }
  const active = pressed();
  // buttons already down when the window got the focus (the A that opened YouTube) wait for release
  if (!focused) { focused = true; for (const a of active) held.set(a, { since: now, last: now, ignored: true }); }
  for (const a of [...held.keys()]) if (!active.has(a)) held.delete(a);
  for (const a of active) {
    const h = held.get(a);
    if (h && h.ignored) continue;
    if (!h) { held.set(a, { since: now, last: now }); send(a); }
    else if (REPEATS.has(a) && now - h.since > FIRST && now - h.last > EVERY) { h.last = now; send(a); }
  }
}
window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
