// Controllers set up in Settings → Controllers (pads that aren't Xbox / PlayStation, see renderer/js/padsetup.js).
// A saved pad = { name, map: { a: { t: 'b', i: 5 }, lup: { t: 'a', i: 1, d: -1 }, dpup: { t: 'h', i: 9, d: 'up' } … } }
// (button / axis direction / hat, as the Gamepad API numbers them - the same order DirectInput and SDL use).
// sdlLine() turns it into an SDL game controller mapping: emulators built on SDL (DuckStation, PCSX2, RMG, Flycast,
// DOSBox, Ryujinx, RPCS3 …) then see the pad as an Xbox controller - MediaDeck hands the lines to every program it
// starts in SDL_GAMECONTROLLERCONFIG (SDL 2 and 3 both read it).

// SDL's id of a USB DirectInput pad: bus 0003, vendor and product (little endian), no CRC / version
function sdlGuid(key) {
  const [vid, pid] = String(key).split(':');
  if (!/^[0-9a-f]{4}$/i.test(vid || '') || !/^[0-9a-f]{4}$/i.test(pid || '')) return null;
  const le = (h) => h.slice(2, 4) + h.slice(0, 2);
  return `03000000${le(vid)}0000${le(pid)}000000000000`.toLowerCase();
}

const HAT_BIT = { up: 1, right: 2, down: 4, left: 8 };
// a source as SDL writes it: b5, +a1 / -a1 (half axis), h0.1
function src(s, half = true) {
  if (!s) return null;
  if (s.t === 'b') return `b${s.i}`;
  if (s.t === 'h') return HAT_BIT[s.d] ? `h0.${HAT_BIT[s.d]}` : null;
  if (s.t === 'a') return half ? `${s.d > 0 ? '+' : '-'}a${s.i}` : `a${s.i}`;
  return null;
}

// one stick axis (leftx from lleft / lright): one full axis when both ends are the same axis, else two halves
function stick(out, name, neg, pos) {
  if (neg && pos && neg.t === 'a' && pos.t === 'a' && neg.i === pos.i && neg.d !== pos.d) {
    out.push(`${name}:a${neg.i}${neg.d > 0 ? '~' : ''}`);   // ~ = the pad's axis runs the other way
    return;
  }
  if (neg && src(neg)) out.push(`-${name}:${src(neg)}`);
  if (pos && src(pos)) out.push(`+${name}:${src(pos)}`);
}

// The map the emulators get: a right stick made of buttons that are also face / shoulder buttons is left out (a cheap
// GameCube pad's C-stick sends Y / X / A / B - in a game every A would move the camera too)
const RSTICK = ['rup', 'rdown', 'rleft', 'rright'];
const OTHER = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'start', 'back'];
// Pads set up as a kind (padsetup.js TYPES) whose emulator layout differs from MediaDeck's menus: an N64 pad's B is
// MediaDeck's Back (Xbox B) and Z its LT, but N64 emulators on an Xbox pad (RMG) want B on X and Z on RT
const EMU_ALSO = { n64: { x: 'b', rt: 'lt' } };
const STICK_FIRST = new Set(['n64', 'gamecube']);
function forEmulators(map, type) {
  const out = { ...(map || {}) };
  for (const [to, from] of Object.entries(EMU_ALSO[type] || {})) if (!out[to] && out[from]) out[to] = out[from];
  // N64 / GameCube games steer with the stick: a cheap pad whose D-pad sends the stick's signal gives it to the stick
  if (STICK_FIRST.has(type)) {
    const same = (x, y) => x && y && x.t === y.t && x.i === y.i && (x.d || 0) === (y.d || 0);
    for (const [d, l] of [['dpup', 'lup'], ['dpdown', 'ldown'], ['dpleft', 'lleft'], ['dpright', 'lright']]) if (same(out[d], out[l])) delete out[d];
  }
  for (const k of RSTICK) {
    const s = out[k];
    if (s && s.t === 'b' && OTHER.some((o) => map[o] && map[o].t === 'b' && map[o].i === s.i)) delete out[k];
  }
  return out;
}

function sdlLine(key, pad) {
  const guid = sdlGuid(key);
  if (!guid || !pad || !pad.map) return null;
  const m = forEmulators(pad.map, pad.type), out = [];
  const one = { a: 'a', b: 'b', x: 'x', y: 'y', back: 'back', start: 'start', lb: 'leftshoulder', rb: 'rightshoulder',
    l3: 'leftstick', r3: 'rightstick', dpup: 'dpup', dpdown: 'dpdown', dpleft: 'dpleft', dpright: 'dpright' };
  // a Back borrowed from another button (pads without Select) is only for MediaDeck's Start + Back: emulators
  // would see Start + Select (RetroArch's menu, emulator hotkeys) every time the player pressed Start + Z
  const real = (k) => m[k] && !(k === 'back' && m[k].also);
  for (const [k, n] of Object.entries(one)) if (real(k) && src(m[k])) out.push(`${n}:${src(m[k])}`);
  for (const [k, n] of [['lt', 'lefttrigger'], ['rt', 'righttrigger']]) if (m[k] && src(m[k])) out.push(`${n}:${src(m[k])}`);
  stick(out, 'leftx', m.lleft, m.lright);
  stick(out, 'lefty', m.lup, m.ldown);
  stick(out, 'rightx', m.rleft, m.rright);
  stick(out, 'righty', m.rup, m.rdown);
  const name = String(pad.name || 'Controller').replace(/,/g, ' ');
  return `${guid},${name},${out.join(',')},platform:Windows,`;
}

// An Xbox / PlayStation controller (XInput, Microsoft or Sony): every emulator knows it already - a setup saved for
// one (Settings → Controllers took any pad) gave the emulators a second, wrong map of it
const xboxLike = (key, pad) => /^(045e|054c):/i.test(String(key)) || /xinput/i.test(`${key} ${(pad && pad.name) || ''}`);
// the set-up pads the emulators get (and padwatch): not those
const setUp = (controllers) => Object.fromEntries(Object.entries(controllers || {}).filter(([k, p]) => !xboxLike(k, p)));

// every set-up pad's SDL mapping, one per line (for SDL_GAMECONTROLLERCONFIG)
function sdlConfig(controllers) {
  return Object.entries(setUp(controllers)).map(([k, p]) => sdlLine(k, p)).filter(Boolean).join('\n');
}

// padwatch: the buttons of Start and Back (Start + Back held 1 s = MediaDeck's menu in a game), per pad
// "0810:e501=9+4" (button numbers as Windows' joystick API counts them: from 0, like the Gamepad API)
function padwatchArgs(controllers) {
  const out = [];
  for (const [k, p] of Object.entries(setUp(controllers))) {
    const s = p.map && p.map.start, b = p.map && p.map.back;
    if (s && b && s.t === 'b' && b.t === 'b') out.push('--pad', `${k}=${s.i}+${b.i}`);
  }
  return out;
}

// RetroArch: its "xinput" controller driver reads other pads through DirectInput and looks for a file in
// autoconfig\dinput with the pad's vendor / product (in decimal). RetroPad is SNES-shaped: its A is the right
// face button (Xbox B), its B the bottom one (Xbox A), X the top one (Xbox Y), Y the left one (Xbox X).
// "00 MediaDeck - …" sorts first, so it wins over RetroArch's own file for the same vendor / product.
const RA = { b: 'a', a: 'b', y: 'x', x: 'y', select: 'back', start: 'start', l: 'lb', r: 'rb', l2: 'lt', r2: 'rt', l3: 'l3', r3: 'r3',
  up: 'dpup', down: 'dpdown', left: 'dpleft', right: 'dpright',
  l_x_minus: 'lleft', l_x_plus: 'lright', l_y_minus: 'lup', l_y_plus: 'ldown',
  r_x_minus: 'rleft', r_x_plus: 'rright', r_y_minus: 'rup', r_y_plus: 'rdown' };
function retroarchFile(key, pad) {
  const [vid, pid] = String(key).split(':');
  if (!/^[0-9a-f]{4}$/i.test(vid || '') || !/^[0-9a-f]{4}$/i.test(pid || '') || !pad || !pad.map) return null;
  const q = (v) => `"${String(v).replace(/"/g, '')}"`;
  const lines = ['# Made by MediaDeck (Settings → Controllers). Set the pad up again there to change it.',
    'input_driver = "dinput"', `input_device = ${q(pad.name || 'Controller')}`, `input_device_display_name = ${q(pad.name || 'Controller')}`,
    `input_vendor_id = "${parseInt(vid, 16)}"`, `input_product_id = "${parseInt(pid, 16)}"`];
  const map = forEmulators(pad.map, pad.type);
  for (const [ra, x] of Object.entries(RA)) {
    const s = map[x];
    if (!s || (x === 'back' && s.also)) continue;              // a borrowed Back: see sdlLine
    if (s.t === 'b') lines.push(`input_${ra}_btn = "${s.i}"`);
    else if (s.t === 'a') lines.push(`input_${ra}_axis = "${s.d > 0 ? '+' : '-'}${s.i}"`);
    else if (s.t === 'h' && ['up', 'down', 'left', 'right'].includes(s.d)) lines.push(`input_${ra}_btn = "h0${s.d}"`);
  }
  return { name: `00 MediaDeck - ${vid.toLowerCase()}_${pid.toLowerCase()}.cfg`, text: lines.join('\n') + '\n' };
}

// RetroArch's autoconfig\dinput: a file for every set-up pad, and none left for pads that were forgotten
function writeRetroArch(raDir, controllers) {
  const fs = require('fs'), path = require('path');
  const dir = path.join(raDir, 'autoconfig', 'dinput');
  if (!fs.existsSync(path.join(raDir, 'autoconfig'))) return 0;
  fs.mkdirSync(dir, { recursive: true });
  const want = new Map();
  for (const [k, p] of Object.entries(setUp(controllers))) { const f = retroarchFile(k, p); if (f) want.set(f.name, f.text); }
  for (const f of fs.readdirSync(dir)) if (/^00 MediaDeck - /.test(f) && !want.has(f)) fs.unlinkSync(path.join(dir, f));
  for (const [n, t] of want) fs.writeFileSync(path.join(dir, n), t);
  return want.size;
}

// Dolphin (portable): GameCube port 1 also listens to every set-up pad, added with | next to what is there - the
// Xbox controller keeps working. Dolphin reads the pad itself through DirectInput, by its name
// (`DInput/0/USB Joystick:Button 2`). DirectInput numbers buttons and axes the way the Gamepad API does (axes X Y Z,
// then Xr Yr Zr; the hat = Hat 0). Dolphin's SDL must leave these pads alone (SDL_JOYSTICK_DIRECTINPUT = 0): both
// grab the pad for themselves and the one that comes second gets nothing (Xbox / PlayStation pads are XInput).
const DI_AXIS = ['X', 'Y', 'Z', 'Xr', 'Yr', 'Zr'];
const DI_HAT = { up: 'N', down: 'S', left: 'W', right: 'E' };
function diInput(s) {
  if (!s) return null;
  if (s.t === 'b') return `Button ${s.i}`;
  if (s.t === 'a') return DI_AXIS[s.i] ? `Axis ${DI_AXIS[s.i]}${s.d > 0 ? '+' : '-'}` : null;
  if (s.t === 'h') return DI_HAT[s.d] ? `Hat 0 ${DI_HAT[s.d]}` : null;
  return null;
}
const diName = (p) => String(p.name || 'Controller').trim();
// GameCube control ← the Xbox control it was saved as. A GameCube pad's buttons by name; other pads by position,
// like MediaDeck's Xbox default (GameCube B = Xbox X, X = Xbox B)
function dolphinBinds(pad) {
  const gc = pad.type === 'gamecube';
  const from = {
    'Buttons/A': 'a', 'Buttons/B': gc ? 'b' : 'x', 'Buttons/X': gc ? 'x' : 'b', 'Buttons/Y': 'y', 'Buttons/Z': 'rb', 'Buttons/Start': 'start',
    'Main Stick/Up': 'lup', 'Main Stick/Down': 'ldown', 'Main Stick/Left': 'lleft', 'Main Stick/Right': 'lright',
    'C-Stick/Up': 'rup', 'C-Stick/Down': 'rdown', 'C-Stick/Left': 'rleft', 'C-Stick/Right': 'rright',
    'Triggers/L': 'lt', 'Triggers/R': 'rt', 'Triggers/L-Analog': 'lt', 'Triggers/R-Analog': 'rt',
    'D-Pad/Up': 'dpup', 'D-Pad/Down': 'dpdown', 'D-Pad/Left': 'dpleft', 'D-Pad/Right': 'dpright',
  };
  const out = {};
  // cheap pads send the D-pad as the stick: in Dolphin the stick would press the D-pad too, so it stays the stick
  const stickOf = { dpup: 'lup', dpdown: 'ldown', dpleft: 'lleft', dpright: 'lright' };
  const map = forEmulators(pad.map, pad.type);
  for (const [k, x] of Object.entries(from)) {
    const v = diInput(map[x]);
    if (v && !(stickOf[x] && diInput(map[stickOf[x]]) === v)) out[k] = v;
  }
  return out;
}
const DOLPHIN_KEYS = ['Buttons/A', 'Buttons/B', 'Buttons/X', 'Buttons/Y', 'Buttons/Z', 'Buttons/Start',
  'Main Stick/Up', 'Main Stick/Down', 'Main Stick/Left', 'Main Stick/Right', 'C-Stick/Up', 'C-Stick/Down', 'C-Stick/Left', 'C-Stick/Right',
  'Triggers/L', 'Triggers/R', 'Triggers/L-Analog', 'Triggers/R-Analog', 'D-Pad/Up', 'D-Pad/Down', 'D-Pad/Left', 'D-Pad/Right'];

function writeDolphin(dir, controllers) {
  const fs = require('fs'), path = require('path');
  const { readIni, iniGet, iniSet, writeIni } = require('./pad-defaults');
  if (!fs.existsSync(path.join(dir, 'portable.txt'))) return 0;
  const file = path.join(dir, 'User', 'Config', 'GCPadNew.ini');
  const ini = readIni(file);
  const pads = Object.values(setUp(controllers)).filter((p) => p && p.map && p.name);
  // a pad set up before (or since forgotten): its old `SDL/n/Name:…` (`DInput/n/Name:…` at first) parts go first
  const ours = /^`(DInput|SDL)\/\d+\/(?!Keyboard Mouse)[^:`]+:[^`]*`$/;
  let changed = false;
  for (const k of DOLPHIN_KEYS) {
    const before = iniGet(ini, 'GCPad1', k);
    const parts = String(before || '').split('|').map((x) => x.trim()).filter((x) => x && !ours.test(x));
    for (const p of pads) {
      const v = dolphinBinds(p)[k];
      if (v) parts.push(`\`DInput/0/${diName(p)}:${v}\``);
    }
    const value = parts.join(' | ');
    if (value !== (before || '').trim()) { iniSet(ini, 'GCPad1', k, value); changed = true; }
  }
  if (!iniGet(ini, 'GCPad1', 'Device') && pads.length) { iniSet(ini, 'GCPad1', 'Device', `DInput/0/${diName(pads[0])}`); changed = true; }
  // Port 1's own device is the Xbox controller: when it is off, Dolphin tells the game "no controller in port 1"
  // and the set-up pads in it do nothing - unless the port counts as always connected
  if (pads.length && iniGet(ini, 'GCPad1', 'Options/Always Connected') !== 'True') { iniSet(ini, 'GCPad1', 'Options/Always Connected', 'True'); changed = true; }
  if (changed) writeIni(file, ini);
  if (pads.length) {
    const main = path.join(dir, 'User', 'Config', 'Dolphin.ini');
    const dini = readIni(main);
    if (iniGet(dini, 'SDL_Hints', 'SDL_JOYSTICK_DIRECTINPUT') !== '0') { iniSet(dini, 'SDL_Hints', 'SDL_JOYSTICK_DIRECTINPUT', '0'); writeIni(main, dini); }
  }
  return pads.length;
}

module.exports = { sdlGuid, sdlLine, sdlConfig, padwatchArgs, retroarchFile, writeRetroArch, dolphinBinds, writeDolphin, xboxLike };
