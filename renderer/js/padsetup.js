// Controller setup for pads that aren't Xbox / PlayStation (USB N64, SNES, GameCube … pads): MediaDeck asks for each
// Xbox control in turn and records what the pad sends (a button, an axis direction, or the hat). Saved per pad model
// (USB vendor:product) - MediaDeck's menus then read the pad like an Xbox controller, Start + Back held opens
// MediaDeck's menu in games, and the emulators get it as an SDL mapping (see main.js controllers).
const PadSetup = (() => {
  const el = document.getElementById('padsetup');
  // Start first: once it is known, pressing Start again skips a control the pad hasn't got
  const XBOX = [
    ['start', 'Start'], ['a', 'A (bottom face button - OK)'], ['b', 'B (right face button - Back)'], ['x', 'X (left face button)'],
    ['y', 'Y (top face button)'], ['back', 'Back / Select'], ['lb', 'LB (left shoulder)'], ['rb', 'RB (right shoulder)'],
    ['lt', 'LT (left trigger)'], ['rt', 'RT (right trigger)'],
    ['dpup', 'D-pad up'], ['dpdown', 'D-pad down'], ['dpleft', 'D-pad left'], ['dpright', 'D-pad right'],
    ['lup', 'Left stick up'], ['ldown', 'Left stick down'], ['lleft', 'Left stick left'], ['lright', 'Left stick right'],
    ['rup', 'Right stick up'], ['rdown', 'Right stick down'], ['rleft', 'Right stick left'], ['rright', 'Right stick right'],
    ['l3', 'Left stick click (L3)'], ['r3', 'Right stick click (R3)'],
  ];
  const XNAME = Object.fromEntries(XBOX.map(([k, n]) => [k, n.replace(/ \(.*$/, '')]));
  const DPAD = [['dpup', 'D-pad up'], ['dpdown', 'D-pad down'], ['dpleft', 'D-pad left'], ['dpright', 'D-pad right']];
  const STICK = [['lup', 'Stick up'], ['ldown', 'Stick down'], ['lleft', 'Stick left'], ['lright', 'Stick right']];
  // The kinds of pads (chosen in Settings first): their own buttons, each on the Xbox control it plays as
  // (by position, as Dolphin / RMG / RetroArch lay these pads out). back = the button that also acts as Back for
  // Start + Back when the pad has no Select.
  const TYPES = [
    { id: 'n64', name: 'Nintendo 64', back: 'lt', controls: [['start', 'Start'], ['a', 'A'], ['b', 'B'], ['lt', 'Z (under the pad)'], ['lb', 'L'], ['rb', 'R'],
      ...DPAD, ...STICK, ['rup', 'C-up'], ['rdown', 'C-down'], ['rleft', 'C-left'], ['rright', 'C-right']] },
    { id: 'gamecube', name: 'GameCube', back: 'rb', controls: [['start', 'Start'], ['a', 'A (big green)'], ['b', 'B (red)'], ['x', 'X (right of A)'], ['y', 'Y (above A)'],
      ['rb', 'Z'], ['lt', 'L (press all the way)'], ['rt', 'R (press all the way)'],
      ...DPAD, ...STICK, ['rup', 'C-stick up'], ['rdown', 'C-stick down'], ['rleft', 'C-stick left'], ['rright', 'C-stick right']] },
    { id: 'snes', name: 'Super Nintendo (SNES)', controls: [['start', 'Start'], ['back', 'Select'], ['a', 'B (bottom)'], ['b', 'A (right)'], ['x', 'Y (left)'], ['y', 'X (top)'],
      ['lb', 'L'], ['rb', 'R'], ...DPAD] },
    { id: 'nes', name: 'NES', controls: [['start', 'Start'], ['back', 'Select'], ['a', 'B'], ['b', 'A'], ...DPAD] },
    { id: 'genesis', name: 'Sega Genesis / Mega Drive', controls: [['start', 'Start'], ['a', 'B'], ['b', 'C'], ['x', 'A'], ['y', 'Y (6-button pads)'], ['lb', 'X (6-button pads)'],
      ['rb', 'Z (6-button pads)'], ['back', 'Mode (6-button pads)'], ...DPAD] },
    { id: 'other', name: 'Other pad (asks for every Xbox control)', controls: null },
  ];
  let type = TYPES[TYPES.length - 1], CONTROLS = XBOX;
  // where Xbox's controls are on pads without them (Xbox layout as Dolphin / RMG use it)
  const HINT = {
    back: 'N64 / GameCube have none: press Start - MediaDeck asks for one at the end.',
    lb: 'N64: L · GameCube: none (press Start)', rb: 'N64: R · GameCube: Z',
    lt: 'N64: Z · GameCube: L (all the way)', rt: 'N64: none (press Start) · GameCube: R (all the way)',
    rup: 'N64: C-up · GameCube: C-stick', rdown: 'N64: C-down · GameCube: C-stick', rleft: 'N64: C-left · GameCube: C-stick', rright: 'N64: C-right · GameCube: C-stick',
  };
  // one control per button (the sticks may share: a GameCube pad's C-stick sends the face buttons)
  const BUTTONS = new Set(['start', 'a', 'b', 'x', 'y', 'back', 'lb', 'rb', 'lt', 'rt', 'dpup', 'dpdown', 'dpleft', 'dpright', 'l3', 'r3']);
  const HAT = ['up', 'upright', 'right', 'downright', 'down', 'downleft', 'left', 'upleft'];
  let pad = null;          // { index, key, name }
  let step = 0, map = {}, rest = null, waitRelease = false, timer = null, note = '';

  const keyOf = (p) => {
    const m = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(p.id) || /([0-9a-f]{4})-([0-9a-f]{4})/i.exec(p.id);
    return m ? `${m[1]}:${m[2]}`.toLowerCase() : p.id;
  };
  const nameOf = (p) => (p.id.replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*$/i, '').trim() || 'Controller');
  const hatDir = (v) => (v >= -1.01 && v <= 1.01 ? HAT[Math.round((v + 1) * 3.5) % 8] : null);   // Chromium's hat axis (idle ~3.29)
  const snap = (p) => ({ b: p.buttons.map((x) => x.pressed || x.value > 0.6), a: p.axes.slice() });

  // what changed from the pad at rest: a button, an axis pushed past half way, or the hat
  function source(p) {
    const s = snap(p);
    for (let i = 0; i < s.b.length; i++) if (s.b[i] && !rest.b[i]) return { t: 'b', i };
    for (let i = 0; i < s.a.length; i++) {
      const v = s.a[i], r = rest.a[i];
      if (Math.abs(r) > 1.01) { const d = hatDir(v); if (d) return { t: 'h', i, d }; continue; }   // a hat at rest
      if (Math.abs(v - r) > 0.6 && Math.abs(v) > 0.6) return { t: 'a', i, d: v > 0 ? 1 : -1 };
    }
    return null;
  }
  const same = (x, y) => x && y && x.t === y.t && x.i === y.i && (x.d || 0) === (y.d || 0);
  const label = (s) => (!s ? '-' : s.t === 'b' ? `button ${s.i + 1}` : s.t === 'h' ? `D-pad (hat) ${s.d}` : `axis ${s.i + 1} ${s.d > 0 ? '+' : '−'}`);

  function frame(title, desc, body) {
    el.innerHTML = `<section class="setup-page"><div class="hero-kicker">Controller setup${pad ? ` · ${UI.esc(pad.name)}` : ''}</div>
      <h1 class="setup-title">${title}</h1><div class="setup-desc">${desc}</div><div class="settings-list setup-body">${body || ''}</div></section>`;
  }
  function draw() {
    if (!pad) {
      frame('Press a button', `Press any button on the ${UI.esc(type.id === 'other' ? 'controller' : type.name + ' pad')} you want to set up.`);
      return;
    }
    if (step >= CONTROLS.length) return finish();
    const done = CONTROLS.slice(0, step).map(([k, n]) => `<div class="setting type-info"><div class="setting-text"><div class="setting-label">${UI.esc(n)}</div></div>
      <div class="setting-value"><span class="setting-value-text">${UI.esc(label(map[k]))}</span></div></div>`).slice(-6).join('');
    const plays = CONTROLS !== XBOX && XNAME[CONTROLS[step][0]] ? `<div class="padsetup-hint">Plays as Xbox ${UI.esc(XNAME[CONTROLS[step][0]])}</div>` : '';
    frame(`Press: ${UI.esc(CONTROLS[step][1])}`,
      `${step + 1} of ${CONTROLS.length}. ${step ? 'Your pad hasn\'t got it? Press <b>Start</b> to skip it.' : 'Start comes first: after it, Start skips a control your pad hasn\'t got.'}`
      + plays + (CONTROLS === XBOX && HINT[CONTROLS[step][0]] ? `<div class="padsetup-hint">${HINT[CONTROLS[step][0]]}</div>` : '')
      + (note ? `<div class="padsetup-note">${UI.esc(note)}</div>` : '')
      + ' Keyboard: Space skips, Esc cancels.', done);
  }

  function poll() {
    const pads = [...navigator.getGamepads()].filter(Boolean);
    if (!pad) {
      for (const p of pads) {
        const s = snap(p);
        if (s.b.some(Boolean)) { pad = { index: p.index, key: keyOf(p), name: nameOf(p) }; waitRelease = true; rest = null; draw(); return; }
      }
      return;
    }
    const p = pads.find((x) => x.index === pad.index);
    if (!p) return;
    if (!rest) { if (!snap(p).b.some(Boolean)) { rest = snap(p); waitRelease = false; draw(); } return; }
    const src = source(p);
    if (waitRelease) { if (!src) waitRelease = false; return; }
    if (!src) return;
    waitRelease = true;
    const [k] = CONTROLS[step];
    const used = BUTTONS.has(k) && src.t === 'b' && CONTROLS.find(([c]) => c !== k && BUTTONS.has(c) && same(map[c], src));
    if (k !== 'start' && same(src, map.start)) { note = ''; skip(); }
    else if (used) { note = `That button is already ${used[1]} - press another one, or Start to skip.`; draw(); }
    else { note = ''; map[k] = src; step++; draw(); }
  }
  function skip() { if (pad && rest && step < CONTROLS.length) { delete map[CONTROLS[step][0]]; step++; draw(); } }

  async function finish() {
    clearInterval(timer); timer = null;
    if (!map.a || !map.start) { UI.toast('A and Start are needed - nothing saved', { icon: 'alert' }); return App.back(); }
    if (!map.back && type.back && map[type.back] && map[type.back].t === 'b') map.back = { ...map[type.back], also: type.back };
    if (!map.back) {
      // no Back / Select: Start + Back opens MediaDeck's menu in games - offer a button that is there
      const opts = ['lb', 'rb', 'lt', 'rt', 'x', 'y'].filter((k) => map[k] && map[k].t === 'b');
      const pick = opts.length ? await UI.menu({ title: 'No Back / Select button', message: 'In a game, Start + Back held for a second opens MediaDeck\'s menu. Which button should be Back?',
        items: [...opts.map((k) => ({ label: (CONTROLS.find((c) => c[0] === k) || [k, XNAME[k]])[1], value: k })), { label: 'None', value: '' }] }) : '';
      if (pick) map.back = { ...map[pick], also: pick };
    }
    const r = await api.padSave(pad.key, { name: pad.name, type: type.id, map });
    App.state.config.controllers = r.controllers;
    Input.setMaps(r.controllers);
    UI.toast(`${pad.name} set up${r.emulators ? ` - also for ${r.emulators}` : ''}`, { icon: 'check', duration: 5000 });
    App.back();
  }

  function handle(action) {
    if (action === 'back' && !pad) { App.back(); return true; }
    return true;                       // everything else is the pad being recorded
  }
  function onKey(e) {
    if (!el.classList.contains('active')) return;
    if (e.code === 'Space') { e.preventDefault(); skip(); }
    if (e.code === 'Escape') { e.preventDefault(); clearInterval(timer); timer = null; App.back(); }
  }
  addEventListener('keydown', onKey, true);

  function init() {}
  function enter(params = {}) {
    type = TYPES.find((t) => t.id === params.type) || TYPES[TYPES.length - 1];
    CONTROLS = type.controls || XBOX;
    pad = null; step = 0; map = {}; rest = null; waitRelease = false; note = '';
    Nav.setRoot(el);
    draw();
    clearInterval(timer);
    timer = setInterval(poll, 16);
  }
  function resume() { Nav.setRoot(el); draw(); }
  function leave() { clearInterval(timer); timer = null; }
  return { el, init, enter, resume, leave, handle, TYPES };
})();
