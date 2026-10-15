// YouTube window: the controller, read here (only while this window has the focus) and sent to
// youtube.js as TV remote keys. Standard gamepad layout (Xbox / DS4 via DS4Windows):
//   D-pad / left stick = arrows, A = OK, B / Back = back, X / Start = play-pause,
//   Y = TizenTube's menu, Guide = MediaDeck (when the browser reports it; else the PS button
//   reaches MediaDeck through its own controller watcher)
const { ipcRenderer } = require('electron');

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
