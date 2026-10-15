// Turns keyboard, remote and game controller input into actions:
// up / down / left / right / ok / back / menu / x / lb / rb / lt / rt / start / select / playpause / next / prev
const Input = (() => {
  let handler = () => {};
  let lastSource = 'keyboard';

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'ok', NumpadEnter: 'ok', ' ': 'ok',
    Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back',
    ContextMenu: 'menu', m: 'menu', M: 'menu', F1: 'menu',
    PageUp: 'lb', PageDown: 'rb', Home: 'home',
    MediaPlayPause: 'playpause', MediaTrackNext: 'next', MediaTrackPrevious: 'prev', MediaStop: 'back',
  };

  function emit(action, source) {
    lastSource = source;
    document.body.classList.toggle('hide-cursor', source !== 'mouse');
    handler(action);
  }

  function isTextField(el) {
    return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|number|)$/.test(el.type)));
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let action = KEYS[e.key];
    if (!action) return;
    // Let text fields keep their own keys (typing, cursor, delete)
    if (isTextField(document.activeElement) && !['up', 'down', 'back'].includes(action) && e.key !== 'Enter') return;
    if (isTextField(document.activeElement) && e.key === 'Backspace') return;
    e.preventDefault();
    emit(action, 'keyboard');
  });

  // ---- Mouse: show the cursor while it moves, hide it after a while ----
  // Chromium also sends "mousemove" when the page changes under a pointer that
  // isn't moving (e.g. the window opening under it). Only real movement counts.
  let cursorTimer = null;
  let lastPos = null;
  window.addEventListener('mousemove', (e) => {
    const pos = `${e.screenX},${e.screenY}`;
    const moved = lastPos !== null && pos !== lastPos;
    lastPos = pos;
    if (!moved) return;
    lastSource = 'mouse';
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
  }, true);
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) emit('back', 'mouse');
  });

  // ---- Game controllers (standard mapping: Xbox / PlayStation / most others) ----
  const BUTTONS = {
    0: 'ok', 1: 'back', 2: 'x', 3: 'menu', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt',
    8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home',
  };
  const REPEATS = new Set(['up', 'down', 'left', 'right', 'lt', 'rt', 'lb', 'rb']);
  const FIRST_DELAY = 380;
  const REPEAT_EVERY = 115;
  const held = new Map(); // action -> { since, last, ignored }
  let ignoreUntil = 0;

  function pressedActions(pad) {
    const set = new Set();
    pad.buttons.forEach((b, i) => {
      const action = BUTTONS[i];
      if (action && (b.pressed || b.value > 0.6)) set.add(action);
    });
    const [x = 0, y = 0] = pad.axes;
    if (x < -0.55) set.add('left');
    if (x > 0.55) set.add('right');
    if (y < -0.55) set.add('up');
    if (y > 0.55) set.add('down');
    return set;
  }

  // the window's real focus, from the main process (see main.js 'win-active')
  let winActive = true;
  if (window.api && api.onWinActive) api.onWinActive((on) => { winActive = on; if (on) ignoreHeld(); });

  function poll(now) {
    requestAnimationFrame(poll);
    if (!winActive || !document.hasFocus() || document.hidden) { held.clear(); return; }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const active = new Set();
    for (const pad of pads) if (pad && pad.connected) for (const a of pressedActions(pad)) active.add(a);

    for (const a of [...held.keys()]) if (!active.has(a)) held.delete(a);
    for (const a of active) {
      const h = held.get(a);
      if (h && h.ignored) continue;                 // still the press from before: wait for release
      if (!h && now < ignoreUntil) { held.set(a, { since: now, last: now, ignored: true }); continue; }
      if (!h) {
        held.set(a, { since: now, last: now });
        emit(a, 'gamepad');
      } else if (REPEATS.has(a) && now - h.since > FIRST_DELAY && now - h.last > REPEAT_EVERY) {
        h.last = now;
        emit(a, 'gamepad');
      }
    }
  }
  requestAnimationFrame(poll);

  window.addEventListener('gamepadconnected', (e) => {
    if (window.UI) UI.toast(`Controller connected`, { icon: 'check', duration: 2500 });
  });

  // Buttons held right now are ignored until they are let go (e.g. the PS button that just
  // opened the overlay must not also press something in it)
  function ignoreHeld() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const now = performance.now();
    for (const pad of pads) if (pad && pad.connected) for (const a of pressedActions(pad)) held.set(a, { since: now, last: now, ignored: true });
    ignoreUntil = now + 900;
  }

  return {
    ignoreHeld,
    setHandler(fn) { handler = fn; },
    get source() { return lastSource; },
  };
})();
