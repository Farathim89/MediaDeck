// Controller set-up for the emulators MediaDeck installs: player 1 is the first Xbox-style controller (XInput / SDL;
// a PlayStation controller through DS4Windows counts too), buttons by position (the console's bottom button = A).
// Written right after an install, and by Settings → Controllers → "Set up the controller in the emulators".
// Never overwrites: a player 1 that already has a controller bound is left as it is; only missing settings are added.
// Guide is never bound: it is MediaDeck's menu button.
const fs = require('fs');
const path = require('path');

// ---------- ini files ----------
function readIni(file) {
  // the file is written back as it was (line ends, BOM, last line ending) - only changed / new lines differ
  const out = { order: [], sections: new Map(), eol: '\r\n', bom: '', endsWithEol: true };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  if (text.startsWith('﻿')) { out.bom = '﻿'; text = text.slice(1); }
  out.eol = /\r\n/.test(text) ? '\r\n' : /\n/.test(text) ? '\n' : out.eol;
  out.endsWithEol = /\n$/.test(text) || !text;
  if (out.endsWithEol) text = text.replace(/\r?\n$/, '');
  let cur = null;
  for (const line of text ? text.split(/\r?\n/) : []) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (h) { cur = h[1]; if (!out.sections.has(cur)) { out.sections.set(cur, []); out.order.push(cur); } continue; }
    if (cur === null) { cur = ''; out.sections.set('', []); out.order.push(''); }
    out.sections.get(cur).push(line);
  }
  return out;
}
const iniGet = (ini, sec, key) => {
  for (const l of ini.sections.get(sec) || []) { const m = /^\s*([^=;#]+?)\s*=\s*(.*)$/.exec(l); if (m && m[1] === key) return m[2]; }
  return undefined;
};
const iniGetAll = (ini, sec, key) => (ini.sections.get(sec) || []).map((l) => /^\s*([^=;#]+?)\s*=\s*(.*)$/.exec(l)).filter((m) => m && m[1] === key).map((m) => m[2]);
// one more line for the key (DuckStation / PCSX2 read every "key = …" line as another bind of it)
function iniAdd(ini, sec, key, value, sep = ' = ') {
  const lines = ini.sections.get(sec);
  const at = lines.map((l) => (/^\s*([^=;#]+?)\s*=/.exec(l) || [])[1]).lastIndexOf(key);
  lines.splice(at + 1, 0, `${key}${sep}${value}`);
}
function iniSet(ini, sec, key, value, sep = ' = ') {
  if (!ini.sections.has(sec)) { ini.sections.set(sec, []); ini.order.push(sec); }
  const lines = ini.sections.get(sec);
  const i = lines.findIndex((l) => { const m = /^\s*([^=;#]+?)\s*=/.exec(l); return m && m[1] === key; });
  const line = `${key}${sep}${value}`;
  if (i >= 0) lines[i] = line;
  else { let at = lines.length; while (at > 0 && !lines[at - 1].trim()) at--; lines.splice(at, 0, line); }
}
// The first change to an emulator's own file keeps its old copy as <file>.before-pads
function backup(file) {
  try { if (fs.existsSync(file) && !fs.existsSync(file + '.before-pads')) fs.copyFileSync(file, file + '.before-pads'); } catch {}
}
function writeIni(file, ini) {
  backup(file);
  const parts = [];
  for (const sec of ini.order) {
    // a section that follows lines of the one before gets a blank line in between (only matters for new sections)
    if (sec !== '' && parts.length && parts[parts.length - 1].trim()) parts.push('');
    if (sec !== '') parts.push(`[${sec}]`);
    parts.push(...ini.sections.get(sec));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ini.bom + parts.join(ini.eol) + (ini.endsWithEol && parts.length ? ini.eol : ''));
}
// Binds a section's keys when none of them is bound to a controller yet (keyboard-only or empty). extra: other
// settings, only where missing. fresh: the same, only in a file that isn't there yet (an emulator writes its own
// defaults into a new file only, so a new file needs the hotkeys MediaDeck's menu presses). keep: set along with
// the binds. join: emulators that take several bindings per button in one value keep the keys already there. multi: the
// same with a line of its own (DuckStation / PCSX2: "Keyboard/X & SDL-0/A" there is a chord - both at once).
function iniPad(file, { section, binds, isPad, extra = {}, fresh = {}, keep = {}, join = '', multi = false, single = [], sep = ' = ' }) {
  const isNew = !fs.existsSync(file);
  const ini = readIni(file);
  let changed = false;
  const add = (groups) => {
    for (const [sec, kv] of Object.entries(groups)) for (const [k, v] of Object.entries(kv)) {
      if (iniGet(ini, sec, k) === undefined) { iniSet(ini, sec, k, v, sep); changed = true; }
    }
  };
  if (isNew) add(fresh);
  add(extra);
  const has = Object.keys(binds).some((k) => (multi ? iniGetAll(ini, section, k) : [iniGet(ini, section, k) || '']).some((v) => isPad(v || '')));
  if (!has) {
    for (const [k, v] of Object.entries(binds)) {
      const old = iniGet(ini, section, k);
      const keepOld = old && old.trim() && !single.includes(k);
      if (multi && keepOld) iniAdd(ini, section, k, v, sep);
      else iniSet(ini, section, k, join && keepOld ? `${old.trim()}${join}${v}` : v, sep);
    }
    for (const [sec, kv] of Object.entries(keep)) for (const [k, v] of Object.entries(kv)) iniSet(ini, sec, k, v, sep);
    changed = true;
  }
  if (changed) writeIni(file, ini);
  return changed;
}
// A whole file, only when it isn't there yet
function newFile(file, text) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}
const exists = (dir, ...p) => fs.existsSync(path.join(dir, ...p));

// ---------- DuckStation, PCSX2: "SDL-0/Button" ----------
const sdl = (x) => `SDL-0/${x}`;
const isSdl = (v) => /SDL-|XInput-|DInput-/i.test(v);
const psPad = (south, east, west, north) => ({
  Up: sdl('DPadUp'), Down: sdl('DPadDown'), Left: sdl('DPadLeft'), Right: sdl('DPadRight'),
  Cross: sdl(south), Circle: sdl(east), Square: sdl(west), Triangle: sdl(north),
  Select: sdl('Back'), Start: sdl('Start'), L1: sdl('LeftShoulder'), R1: sdl('RightShoulder'),
  L2: sdl('+LeftTrigger'), R2: sdl('+RightTrigger'), L3: sdl('LeftStick'), R3: sdl('RightStick'),
  LUp: sdl('-LeftY'), LDown: sdl('+LeftY'), LLeft: sdl('-LeftX'), LRight: sdl('+LeftX'),
  RUp: sdl('-RightY'), RDown: sdl('+RightY'), RLeft: sdl('-RightX'), RRight: sdl('+RightX'),
  SmallMotor: sdl('SmallMotor'), LargeMotor: sdl('LargeMotor'),
});

// ---------- Dolphin: expressions in backticks, one device per controller ----------
const q = (x) => `\`${x}\``;
const isDevice = (v) => /XInput|SDL|WGInput|DInput\/\d+\/(?!Keyboard)/i.test(v);
const GC_PAD = {
  Device: 'XInput/0/Gamepad',
  'Buttons/A': q('Button A'), 'Buttons/B': q('Button X'), 'Buttons/X': q('Button B'), 'Buttons/Y': q('Button Y'),
  'Buttons/Z': q('Shoulder R'), 'Buttons/Start': q('Start'),
  'Main Stick/Up': q('Left Y+'), 'Main Stick/Down': q('Left Y-'), 'Main Stick/Left': q('Left X-'), 'Main Stick/Right': q('Left X+'),
  'C-Stick/Up': q('Right Y+'), 'C-Stick/Down': q('Right Y-'), 'C-Stick/Left': q('Right X-'), 'C-Stick/Right': q('Right X+'),
  'Triggers/L': q('Trigger L'), 'Triggers/R': q('Trigger R'), 'Triggers/L-Analog': q('Trigger L'), 'Triggers/R-Analog': q('Trigger R'),
  'D-Pad/Up': q('Pad N'), 'D-Pad/Down': q('Pad S'), 'D-Pad/Left': q('Pad W'), 'D-Pad/Right': q('Pad E'),
  'Rumble/Motor': `${q('Motor L')}|${q('Motor R')}`,
};
// Wii: an emulated Wii Remote with a Nunchuk (left stick, C = LB, Z = LT), the pointer on the right stick
const WII_PAD = {
  Source: '1', Device: 'XInput/0/Gamepad',
  'Buttons/A': q('Button A'), 'Buttons/B': q('Trigger R'), 'Buttons/1': q('Button X'), 'Buttons/2': q('Button Y'),
  'Buttons/-': q('Back'), 'Buttons/+': q('Start'), 'Buttons/Home': q('Thumb R'),
  'D-Pad/Up': q('Pad N'), 'D-Pad/Down': q('Pad S'), 'D-Pad/Left': q('Pad W'), 'D-Pad/Right': q('Pad E'),
  'IR/Up': q('Right Y+'), 'IR/Down': q('Right Y-'), 'IR/Left': q('Right X-'), 'IR/Right': q('Right X+'),
  'Shake/X': q('Button B'), 'Shake/Y': q('Button B'), 'Shake/Z': q('Button B'),
  Extension: 'Nunchuk',
  'Nunchuk/Buttons/C': q('Shoulder L'), 'Nunchuk/Buttons/Z': q('Trigger L'),
  'Nunchuk/Stick/Up': q('Left Y+'), 'Nunchuk/Stick/Down': q('Left Y-'), 'Nunchuk/Stick/Left': q('Left X-'), 'Nunchuk/Stick/Right': q('Left X+'),
  'Nunchuk/Shake/X': q('Shoulder R'), 'Nunchuk/Shake/Y': q('Shoulder R'), 'Nunchuk/Shake/Z': q('Shoulder R'),
  'Rumble/Motor': `${q('Motor L')}|${q('Motor R')}`,
};

// ---------- Azahar: SDL game controller numbers; maptype:all = any connected controller (no device id) ----------
const az = (x) => `"engine:sdl,api:controller,maptype:all,${x}"`;
const AZ_KEYS = {
  button_a: az('button:1'), button_b: az('button:0'), button_x: az('button:3'), button_y: az('button:2'),
  button_up: az('button:11'), button_down: az('button:12'), button_left: az('button:13'), button_right: az('button:14'),
  button_l: az('button:9'), button_r: az('button:10'), button_start: az('button:6'), button_select: az('button:4'),
  button_zl: az('axis:4,direction:+,threshold:0.5'), button_zr: az('axis:5,direction:+,threshold:0.5'),
  circle_pad: az('axis_x:0,axis_y:1,deadzone:0.1'), c_stick: az('axis_x:2,axis_y:3,deadzone:0.1'),
};
const AZ_PAD = Object.fromEntries(Object.entries(AZ_KEYS).map(([k, v]) => [`profiles\\1\\${k}`, v]));
const AZ_NOT_DEFAULT = Object.fromEntries(Object.keys(AZ_KEYS).map((k) => [`profiles\\1\\${k}\\default`, 'false']));

// ---------- RMG: N64 A = A, B = X, Z = LT, C buttons on the right stick; "Automatic" = the first controller ----------
const rmgBind = (name, type, sdlName, data, extra) => ({
  [`${name}_InputType`]: `"${type}"`, [`${name}_Name`]: `"${sdlName}"`, [`${name}_Data`]: `"${data}"`, [`${name}_ExtraData`]: `"${extra}"`,
});
const RMG_PAD = {
  PluggedIn: 'True', DeviceName: '"Automatic"', DeviceType: '2', DevicePath: '""', DeviceSerial: '""', DeviceGuid: '""',
  Deadzone: '9', Sensitivity: '100', Pak: '0', GameboyRom: '""', GameboySave: '""',
  RemoveDuplicateMappings: 'True', FilterEventsForButtons: 'True', FilterEventsForAxis: 'True',
  ...rmgBind('A', 0, 'a', 0, 0), ...rmgBind('B', 0, 'x', 2, 0), ...rmgBind('Start', 0, 'start', 6, 0),
  ...rmgBind('DpadUp', 0, 'dpup', 11, 0), ...rmgBind('DpadDown', 0, 'dpdown', 12, 0), ...rmgBind('DpadLeft', 0, 'dpleft', 13, 0), ...rmgBind('DpadRight', 0, 'dpright', 14, 0),
  ...rmgBind('CButtonUp', 1, 'righty-', 3, 0), ...rmgBind('CButtonDown', 1, 'righty+', 3, 1), ...rmgBind('CButtonLeft', 1, 'rightx-', 2, 0), ...rmgBind('CButtonRight', 1, 'rightx+', 2, 1),
  ...rmgBind('LeftTrigger', 0, 'leftshoulder', 9, 0), ...rmgBind('RightTrigger', 0, 'rightshoulder', 10, 0), ...rmgBind('ZTrigger', 1, 'lefttrigger+', 4, 1),
  ...rmgBind('AnalogStickUp', 1, 'lefty-', 1, 0), ...rmgBind('AnalogStickDown', 1, 'lefty+', 1, 1), ...rmgBind('AnalogStickLeft', 1, 'leftx-', 0, 0), ...rmgBind('AnalogStickRight', 1, 'leftx+', 0, 1),
};

// ---------- Cemu: Wii U GamePad on XInput controller 1 (numbers from Cemu's own XInput defaults) ----------
const CEMU_MAP = [[1, 13], [2, 12], [3, 15], [4, 14], [5, 8], [6, 9], [7, 42], [8, 43], [9, 4], [10, 5], [11, 0], [12, 1], [13, 2], [14, 3],
  [15, 6], [16, 7], [17, 39], [18, 45], [19, 44], [20, 38], [21, 41], [22, 47], [23, 46], [24, 40]];
const CEMU_XML = ['<?xml version="1.0" encoding="UTF-8"?>', '<emulated_controller>', '\t<type>Wii U GamePad</type>', '\t<controller>',
  '\t\t<api>XInput</api>', '\t\t<uuid>0</uuid>', '\t\t<display_name>Controller 1</display_name>', '\t\t<mappings>',
  ...CEMU_MAP.map(([m, b]) => `\t\t\t<entry>\n\t\t\t\t<mapping>${m}</mapping>\n\t\t\t\t<button>${b}</button>\n\t\t\t</entry>`),
  '\t\t</mappings>', '\t</controller>', '</emulated_controller>', ''].join('\n');

// ---------- RPCS3: player 1 = XInput pad 1 (values from RPCS3's own XInput defaults) ----------
const RPCS3_CONFIG = [['Left Stick Left', 'LS X-'], ['Left Stick Down', 'LS Y-'], ['Left Stick Right', 'LS X+'], ['Left Stick Up', 'LS Y+'],
  ['Right Stick Left', 'RS X-'], ['Right Stick Down', 'RS Y-'], ['Right Stick Right', 'RS X+'], ['Right Stick Up', 'RS Y+'],
  ['Start', 'Start'], ['Select', 'Back'], ['PS Button', 'Guide'], ['Square', 'X'], ['Cross', 'A'], ['Circle', 'B'], ['Triangle', 'Y'],
  ['Left', 'Left'], ['Down', 'Down'], ['Right', 'Right'], ['Up', 'Up'], ['R1', 'RB'], ['R2', 'RT'], ['R3', 'RS'], ['L1', 'LB'], ['L2', 'LT'], ['L3', 'LS'],
  ['Left Stick Deadzone', 7849], ['Right Stick Deadzone', 8689], ['Left Stick Anti-Deadzone', 4259], ['Right Stick Anti-Deadzone', 4259],
  ['Left Trigger Threshold', 30], ['Right Trigger Threshold', 30]];
const RPCS3_YML = ['Player 1 Input:', '  Handler: XInput', '  Device: XInput Pad #1', '  Config:',
  ...RPCS3_CONFIG.map(([k, v]) => `    ${k}: ${v}`), '  Buddy Device: ""', ''].join('\n');

// ---------- Snes9x: WinMM joystick 0 (A=0 B=1 X=2 Y=3 LB=4 RB=5 Back=6 Start=7, d-pad = POV) ----------
const SNES9X_PAD = {
  'Joypad1:Enabled': 'TRUE', 'Joypad1:Up': '(J0)POV Up', 'Joypad1:Down': '(J0)POV Down', 'Joypad1:Left': '(J0)POV Left', 'Joypad1:Right': '(J0)POV Right',
  'Joypad1:B': '(J0)Button 0', 'Joypad1:A': '(J0)Button 1', 'Joypad1:Y': '(J0)Button 2', 'Joypad1:X': '(J0)Button 3',
  'Joypad1:L': '(J0)Button 4', 'Joypad1:R': '(J0)Button 5', 'Joypad1:Select': '(J0)Button 6', 'Joypad1:Start': '(J0)Button 7',
};

// ---------- mGBA: by position (its own default puts GBA A on the bottom button) - SDL game controller numbers ----------
const MGBA_PAD = {
  keyA: '1', keyB: '0', keySelect: '4', keyStart: '6', keyUp: '11', keyDown: '12', keyLeft: '13', keyRight: '14', keyL: '9', keyR: '10',
  axisRightAxis: '+0', axisRightValue: '16384', axisLeftAxis: '-0', axisLeftValue: '-16384',
  axisDownAxis: '+1', axisDownValue: '16384', axisUpAxis: '-1', axisUpValue: '-16384',
};

// ---------- Mednafen: "<setting> keyboard 0x0 89 || joystick <id> button_14" lines in mednafen.cfg ----------
// XInput numbers as Mednafen reads them: d-pad 0-3, Start 4, Back 5, LS 6, RS 7, LB 8, RB 9, A 12, B 13, X 14, Y 15;
// abs_2 / abs_3 = right stick (up = +), abs_4 / abs_5 = triggers. The pad's id: the one already in the file (Mednafen
// writes it when a pad is set up in it), else a standard XInput gamepad's.
const MEDNAFEN_XINPUT = '0x000000000000000000010004f3ff0000';
const dpad = (pre, [u, d, l, r] = ['up', 'down', 'left', 'right']) => ({ [`${pre}.${u}`]: 'button_0', [`${pre}.${d}`]: 'button_1', [`${pre}.${l}`]: 'button_2', [`${pre}.${r}`]: 'button_3' });
const rstick = (pre, [u, d, l, r]) => ({ [`${pre}.${u}`]: 'abs_3+', [`${pre}.${d}`]: 'abs_3-', [`${pre}.${l}`]: 'abs_2-', [`${pre}.${r}`]: 'abs_2+' });
const MEDNAFEN_PADS = {
  // Saturn: A B C on the bottom row = X A B, X Y Z on top = LB Y RB, L R = triggers
  ...dpad('ss.input.port1.gamepad'), 'ss.input.port1.gamepad.a': 'button_14', 'ss.input.port1.gamepad.b': 'button_12', 'ss.input.port1.gamepad.c': 'button_13',
  'ss.input.port1.gamepad.x': 'button_8', 'ss.input.port1.gamepad.y': 'button_15', 'ss.input.port1.gamepad.z': 'button_9',
  'ss.input.port1.gamepad.ls': 'abs_4+', 'ss.input.port1.gamepad.rs': 'abs_5+', 'ss.input.port1.gamepad.start': 'button_4',
  // Lynx: A (right) = B, B = A, Option 1 / 2 = LB / RB, Pause = Start
  ...dpad('lynx.input.builtin.gamepad'), 'lynx.input.builtin.gamepad.a': 'button_13', 'lynx.input.builtin.gamepad.b': 'button_12',
  'lynx.input.builtin.gamepad.option_1': 'button_8', 'lynx.input.builtin.gamepad.option_2': 'button_9', 'lynx.input.builtin.gamepad.pause': 'button_4',
  // Virtual Boy: left d-pad = d-pad, right d-pad = right stick
  ...dpad('vb.input.builtin.gamepad', ['up-l', 'down-l', 'left-l', 'right-l']), ...rstick('vb.input.builtin.gamepad', ['up-r', 'down-r', 'left-r', 'right-r']),
  'vb.input.builtin.gamepad.a': 'button_13', 'vb.input.builtin.gamepad.b': 'button_12', 'vb.input.builtin.gamepad.lt': 'button_8', 'vb.input.builtin.gamepad.rt': 'button_9',
  'vb.input.builtin.gamepad.select': 'button_5', 'vb.input.builtin.gamepad.start': 'button_4',
  // WonderSwan: X pad = d-pad, Y pad = right stick
  ...dpad('wswan.input.builtin.gamepad', ['up-x', 'down-x', 'left-x', 'right-x']), ...rstick('wswan.input.builtin.gamepad', ['up-y', 'down-y', 'left-y', 'right-y']),
  'wswan.input.builtin.gamepad.a': 'button_13', 'wswan.input.builtin.gamepad.b': 'button_12', 'wswan.input.builtin.gamepad.start': 'button_4',
  // PC Engine / PC-FX: I (right) = B, II = A, III-VI = X Y LB RB, Select / Run = Back / Start
  ...dpad('pce.input.port1.gamepad'), 'pce.input.port1.gamepad.i': 'button_13', 'pce.input.port1.gamepad.ii': 'button_12', 'pce.input.port1.gamepad.iii': 'button_14',
  'pce.input.port1.gamepad.iv': 'button_15', 'pce.input.port1.gamepad.v': 'button_8', 'pce.input.port1.gamepad.vi': 'button_9',
  'pce.input.port1.gamepad.select': 'button_5', 'pce.input.port1.gamepad.run': 'button_4',
  ...dpad('pcfx.input.port1.gamepad'), 'pcfx.input.port1.gamepad.i': 'button_13', 'pcfx.input.port1.gamepad.ii': 'button_12', 'pcfx.input.port1.gamepad.iii': 'button_14',
  'pcfx.input.port1.gamepad.iv': 'button_15', 'pcfx.input.port1.gamepad.v': 'button_8', 'pcfx.input.port1.gamepad.vi': 'button_9',
  'pcfx.input.port1.gamepad.select': 'button_5', 'pcfx.input.port1.gamepad.run': 'button_4',
  // Game Gear: 1 / 2 = A / B; Neo Geo Pocket: A / B = A / B, Option = Start
  ...dpad('gg.input.builtin.gamepad'), 'gg.input.builtin.gamepad.button1': 'button_12', 'gg.input.builtin.gamepad.button2': 'button_13', 'gg.input.builtin.gamepad.start': 'button_4',
  ...dpad('ngp.input.builtin.gamepad'), 'ngp.input.builtin.gamepad.a': 'button_12', 'ngp.input.builtin.gamepad.b': 'button_13', 'ngp.input.builtin.gamepad.option': 'button_4',
};
// Adds the controller to every control above that is in the file and has no joystick yet (keyboard keys stay)
function mednafenPads(file) {
  let text;
  try { text = fs.readFileSync(file, 'latin1'); } catch { return false; }
  const id = (/joystick (0x[0-9a-f]{32})/i.exec(text) || [])[1] || MEDNAFEN_XINPUT;
  let changed = 0;
  const out = text.split(/(\r?\n)/).map((line) => {
    const m = /^(\S+) (.*)$/.exec(line);
    if (!m || !MEDNAFEN_PADS[m[1]] || /joystick/i.test(m[2])) return line;
    changed++;
    const bind = `joystick ${id} ${MEDNAFEN_PADS[m[1]]}`;
    return `${m[1]} ${m[2].trim() ? `${m[2].trim()} || ${bind}` : bind}`;
  });
  if (!changed) return false;
  backup(file);
  fs.writeFileSync(file, out.join(''), 'latin1');
  return true;
}

// Per emulator (the installer's ids): (its program folder, { installed: just installed by MediaDeck }) → true when it
// set something up. Each one only when the emulator really reads its settings from its own folder (portable) - one
// that uses Documents / AppData is left alone (its settings are there).
const SETUP = {
  duckstation: (dir) => exists(dir, 'portable.txt') && iniPad(path.join(dir, 'settings.ini'), {
    section: 'Pad1', isPad: isSdl, binds: { Type: 'AnalogController', ...psPad('A', 'B', 'X', 'Y') }, multi: true, single: ['Type'],
    extra: { InputSources: { SDL: 'true' } },
    fresh: { Main: { SetupWizardIncomplete: 'false' }, Hotkeys: { OpenPauseMenu: 'Keyboard/Escape', SaveSelectedSaveState: 'Keyboard/F2',
      LoadSelectedSaveState: 'Keyboard/F1', SelectPreviousSaveStateSlot: 'Keyboard/F3', SelectNextSaveStateSlot: 'Keyboard/F4',
      TogglePause: 'Keyboard/Space', Screenshot: 'Keyboard/F10', ToggleFullscreen: 'Keyboard/F11', FastForward: 'Keyboard/Tab' } },
  }),
  pcsx2: (dir) => {
    if (!exists(dir, 'portable.ini') && !exists(dir, 'portable.txt')) return false;
    // PCSX2's first-start window is skipped only when a BIOS is there (that window is where it asks for one)
    let bios = '';
    try { bios = fs.readdirSync(path.join(dir, 'bios')).find((f) => /\.bin$/i.test(f)) || ''; } catch {}
    return iniPad(path.join(dir, 'inis', 'PCSX2.ini'), {
      section: 'Pad1', isPad: isSdl, binds: { Type: 'DualShock2', ...psPad('FaceSouth', 'FaceEast', 'FaceWest', 'FaceNorth') }, multi: true, single: ['Type'],
      extra: { InputSources: { SDL: 'true' } },
      fresh: { UI: { SettingsVersion: '1', ...(bios ? { SetupWizardIncomplete: 'false' } : {}) }, ...(bios ? { Filenames: { BIOS: bios } } : {}),
        Hotkeys: { ToggleFullscreen: 'Keyboard/Alt & Keyboard/Return', SaveStateToSlot: 'Keyboard/F1', NextSaveStateSlot: 'Keyboard/F2',
          LoadStateFromSlot: 'Keyboard/F3', ToggleFrameLimit: 'Keyboard/F4', Screenshot: 'Keyboard/F8', OpenPauseMenu: 'Keyboard/Escape',
          TogglePause: 'Keyboard/Space', ToggleTurbo: 'Keyboard/Tab' } },
    });
  },
  dolphin: (dir) => {
    if (!exists(dir, 'portable.txt')) return false;
    const a = iniPad(path.join(dir, 'User', 'Config', 'GCPadNew.ini'), { section: 'GCPad1', isPad: isDevice, binds: GC_PAD });
    const b = iniPad(path.join(dir, 'User', 'Config', 'WiimoteNew.ini'), { section: 'Wiimote1', isPad: isDevice, binds: WII_PAD });
    return a || b;
  },
  // melonDS (portable by itself): SDL joystick numbers (A=0 B=1 X=2 Y=3 LB=4 RB=5 Back=6 Start=7, hat 0, LT = axis 2,
  // RT = axis 5); a value can hold a button / hat and an axis at once. DS by position: DS B = A, DS A = B, DS Y = X, DS X = Y.
  melonds: (dir) => iniPad(path.join(dir, 'melonDS.toml'), {
    section: 'Instance0.Joystick', isPad: (v) => v !== '' && v.trim() !== '-1',
    extra: { Instance0: { JoystickID: '0' } },
    binds: { A: '1', B: '0', X: '3', Y: '2', L: String(0x02210004), R: String(0x05210005), Select: '6', Start: '7',
      Up: String(0x01110101), Down: String(0x01010104), Left: String(0x00110108), Right: String(0x00010102) },
  }),
  azahar: (dir) => exists(dir, 'user') && iniPad(path.join(dir, 'user', 'config', 'qt-config.ini'), {
    section: 'Controls', isPad: (v) => /engine:sdl/i.test(v), binds: AZ_PAD, sep: '=',
    extra: { Controls: { profile: '0', 'profiles\\size': '1', 'profiles\\1\\name': 'Default' } },
    keep: { Controls: AZ_NOT_DEFAULT },
  }),
  // RMG: a player 1 that is there at all (set up in RMG) keeps its buttons; one tied to one particular controller
  // (by its device path - another PC or controller wouldn't be found) is switched to "Automatic" = the first one
  rmg: (dir) => {
    if (!exists(dir, 'portable.txt') && !exists(dir, 'Config', 'mupen64plus.cfg')) return false;
    const file = path.join(dir, 'Config', 'mupen64plus.cfg'), sec = "Rosalie's Mupen GUI - Input Plugin Profile 0";
    const made = iniPad(file, { section: sec, isPad: (v) => v !== '', binds: RMG_PAD });
    const ini = readIni(file);
    const lines = ini.sections.get(sec) || [];
    const types = lines.map((l) => /^\s*(?!Hotkey_)\w+_InputType\s*=\s*"(\d*)"/.exec(l)).filter((m) => m && m[1] !== '').map((m) => m[1]);
    const pad = types.length && types.every((t) => t === '0' || t === '1');      // controller buttons / sticks only
    if (made || !pad || iniGet(ini, sec, 'DeviceType') === '2' || iniGet(ini, sec, 'PluggedIn') !== 'True') return made;
    for (const [k, v] of Object.entries({ DeviceName: '"Automatic"', DeviceType: '2', DevicePath: '""', DeviceSerial: '""', DeviceGuid: '""' })) iniSet(ini, sec, k, v);
    writeIni(file, ini);
    return true;
  },
  // (xemu binds the first controller by itself. auto_bind = false is left alone: with DS4Windows it binds both the real
  // PlayStation controller and the virtual Xbox one, so every button comes twice - switched off for that on purpose.)
  // Mednafen writes mednafen.cfg at its first start; without it there is nothing to add to yet
  mednafen: (dir) => mednafenPads(path.join(dir, 'mednafen.cfg')),
  cemu: (dir) => exists(dir, 'portable') && newFile(path.join(dir, 'portable', 'controllerProfiles', 'controller0.xml'), CEMU_XML),
  rpcs3: (dir) => newFile(path.join(dir, 'config', 'input_configs', 'global', 'Default.yml'), RPCS3_YML),
  // Supermodel: XInput instead of DirectInput, Start / Coin on Start / Back (its other controls are joystick ones already)
  supermodel: (dir) => exists(dir, 'Config', 'Supermodel.ini') && iniPad(path.join(dir, 'Config', 'Supermodel.ini'), {
    section: ' Global ', isPad: (v) => /xinput/i.test(v),
    binds: { InputSystem: '"xinput"', InputStart1: '"KEY_1,JOY1_BUTTON8"', InputCoin1: '"KEY_3,JOY1_BUTTON7"' },
  }),
  // Ymir binds the first controller by itself; its empty portable marker gets the version, or it asks at the start
  ymir: (dir) => {
    const f = path.join(dir, 'Ymir.toml');
    try { if (fs.statSync(f).size > 0) return false; } catch { return false; }
    fs.writeFileSync(f, 'ConfigVersion = 6\n');
    return true;
  },
  // Mesen 2: settings.json next to it makes it portable and fills in Xbox controller defaults at its first start.
  // Only for a fresh install - one already set up keeps its settings where they are (maybe Documents).
  mesen: (dir, o) => !!(o && o.installed) && newFile(path.join(dir, 'settings.json'), '{"ConfigUpgrade":1,"Preferences":{"AutomaticallyCheckForUpdates":false}}\n'),
  snes9x: (dir) => iniPad(path.join(dir, 'snes9x.conf'), {
    section: 'Controls\\Win', isPad: (v) => /\(J\d+\)/.test(v) || (parseInt(v, 16) & 0x8000) > 0, binds: SNES9X_PAD,
  }),
  // mGBA plays with a controller by itself (by label); a fresh install gets it by position like the others
  mgba: (dir, o) => !!(o && o.installed) && exists(dir, 'portable.ini') && iniPad(path.join(dir, 'config.ini'), {
    // a section that is there at all is mGBA's own (set up in mGBA)
    section: 'gba.input.SDLC', isPad: (v) => v !== '', binds: MGBA_PAD, sep: '=',
  }),
};

// emuId → did it set anything up (null: nothing to do - this emulator finds the controller by itself:
// Flycast, PPSSPP, xemu, Xenia, Vita3K, shadPS4, Stella, MAME, RetroArch)
function apply(emuId, dir, opts = {}) {
  const f = SETUP[emuId];
  if (!f) return null;
  try { return !!f(dir, opts); } catch (e) { console.error(`[pads] ${emuId}:`, e.message); return false; }
}

// Emulators where player 1 plays with the controller right after MediaDeck installs them (set up here, or by itself)
const READY = new Set([...Object.keys(SETUP), 'ppsspp', 'flycast', 'xemu', 'xenia', 'vita3k', 'shadps4', 'stella', 'mame', 'retroarch', 'ymir', 'blastem']);

module.exports = { apply, SETUP, READY, readIni, iniGet, iniSet, writeIni, iniPad };
