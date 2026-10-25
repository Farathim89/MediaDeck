// Turns keyboard, remote and game controller input into actions:
// up / down / left / right / ok / back / menu / x / lb / rb / lt / rt / start / select / playpause / next / prev
const Input = (() => {
  let handler = () => {};
  let lastSource = 'keyboard';
  // a line in MediaDeck's controller log (data\controller-log.txt, see main.js padLog)
  const plog = (text) => { try { if (window.api && api.padLog) api.padLog(text); } catch {} };

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'ok', NumpadEnter: 'ok', ' ': 'ok',
    Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back',
    ContextMenu: 'menu', m: 'menu', M: 'menu', F1: 'menu',
    PageUp: 'lb', PageDown: 'rb', Home: 'home',
    MediaPlayPause: 'playpause', MediaTrackNext: 'next', MediaTrackPrevious: 'prev', MediaStop: 'back',
  };

  function emit(action, source) {
    if (source !== 'mouse') plog(`${action} (${source})`);
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
  let ignoreUntil = 0, ignoreHomeUntil = 0;

  // Pads set up in Settings → Controllers (not Xbox / PlayStation): their own buttons, read as the Xbox ones
  let maps = {};
  const keyOf = (p) => {
    const m = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(p.id) || /([0-9a-f]{4})-([0-9a-f]{4})/i.exec(p.id);
    return m ? `${m[1]}:${m[2]}`.toLowerCase() : p.id;
  };
  const HAT = ['up', 'upright', 'right', 'downright', 'down', 'downleft', 'left', 'upleft'];
  function isOn(pad, s) {
    if (!s) return false;
    if (s.t === 'b') { const b = pad.buttons[s.i]; return !!(b && (b.pressed || b.value > 0.6)); }
    const v = pad.axes[s.i];
    if (v === undefined) return false;
    if (s.t === 'h') { if (v < -1.01 || v > 1.01) return false; const d = HAT[Math.round((v + 1) * 3.5) % 8]; return d === s.d || d.includes(s.d); }
    return s.d > 0 ? v > 0.55 : v < -0.55;
  }
  const MAPPED = { a: 'ok', b: 'back', x: 'x', y: 'menu', lb: 'lb', rb: 'rb', lt: 'lt', rt: 'rt', back: 'select', start: 'start',
    dpup: 'up', dpdown: 'down', dpleft: 'left', dpright: 'right', lup: 'up', ldown: 'down', lleft: 'left', lright: 'right' };

  function pressedActions(pad) {
    const set = new Set();
    const own = pad.mapping !== 'standard' && maps[keyOf(pad)];
    if (own) {
      for (const [k, action] of Object.entries(MAPPED)) if (isOn(pad, own.map[k])) set.add(action);
      return set;
    }
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

  // Chromium said MediaDeck lost the focus and never that it came back, while MediaDeck was the window in front: keys
  // worked, the controller didn't (switching the TV / monitor brought it back). The page still has the focus then:
  // main asks Windows itself (see main.js 'check-active').
  let offSince = 0, lastCheck = 0, lastGate = '';
  function poll(now) {
    requestAnimationFrame(poll);
    const gate = `${winActive ? 'active' : 'not active'}, ${document.hasFocus() ? 'focus' : 'no focus'}${document.hidden ? ', hidden' : ''}`;
    if (gate !== lastGate) { lastGate = gate; plog(`page: ${gate}`); }
    if (!winActive && document.hasFocus() && !document.hidden && window.api && api.checkActive) {
      if (!offSince) offSince = now;
      else if (now - offSince > 600 && now - lastCheck > 2000) { lastCheck = now; api.checkActive(); }
    } else offSince = 0;
    if (!winActive || !document.hasFocus() || document.hidden) { held.clear(); return; }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const active = new Set();
    for (const pad of pads) if (pad && pad.connected) for (const a of pressedActions(pad)) active.add(a);

    for (const a of [...held.keys()]) if (!active.has(a)) held.delete(a);
    for (const a of active) {
      const h = held.get(a);
      if (h && h.ignored) continue;                 // still the press from before: wait for release
      if (!h && (now < ignoreUntil || (a === 'home' && now < ignoreHomeUntil))) {
        held.set(a, { since: now, last: now, ignored: true });
        plog(`${a} ignored (held from before)`);
        continue;
      }
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
    plog(`controller ${e.gamepad.index} connected: ${e.gamepad.id.slice(0, 60)}`);
    if (window.UI) UI.toast(`Controller connected`, { icon: 'check', duration: 2500 });
  });
  window.addEventListener('gamepaddisconnected', (e) => plog(`controller ${e.gamepad.index} disconnected`));

  // Buttons held right now are ignored until they are let go (e.g. the PS button that just
  // opened the overlay must not also press something in it). What shows up in the next moment counts as held too
  // (the page can see the pad a frame or two later) - PS / Guide, often held a while, for longer. A new press after
  // that counts: for 0.9 s every button was ignored, a quick Down after PS did nothing.
  function ignoreHeld() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const now = performance.now();
    for (const pad of pads) if (pad && pad.connected) for (const a of pressedActions(pad)) held.set(a, { since: now, last: now, ignored: true });
    ignoreUntil = now + 250;
    ignoreHomeUntil = now + 900;
  }

  return {
    ignoreHeld,
    setMaps(m) { maps = m || {}; },
    setHandler(fn) { handler = fn; },
    get source() { return lastSource; },
  };
})();
