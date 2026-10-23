// Player 1 on this PC: emulators that keep one particular controller (by its id) get the one that is here. The
// MediaDeck folder goes from PC to PC (a USB drive) with other controllers - a PS4 controller here, an Xbox one there.
//  - DuckStation / PCSX2: player 1 as "the first controller" (SDL-0), the same on every PC. A bind made while the PS4
//    controller came in twice (itself and DS4Windows' Xbox pad) was saved as a chord of both ("SDL-<its id>/A &
//    SDL-0/A": both at once) - on a PC without that controller nothing ever pressed it.
//  - Eden: player 1 by SDL's id of the controller that is here (from Windows' hardware ids), its own buttons for an
//    Xbox or a PlayStation pad; what it had is kept per controller and comes back with that controller
//  - xemu: on a PC without DS4Windows it binds the controller that is there by itself (auto_bind); with DS4Windows
//    its own setting comes back (auto_bind there would bind the PS4 controller and its Xbox pad both)
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { readIni, iniGet, iniSet, writeIni } = require('./pad-defaults');

// ---------- The controllers Windows has now ----------
// [{ kind: 'xinput' | 'playstation', vid, pid, guid }], a PlayStation pad first (through DS4Windows it is an Xbox pad
// too; the real one has the motion sensors). guid as Eden keeps it (SDL's GUID without its name CRC): XInput
// 03000000 <vid> 0000 <pid> 0000 <version> 78 <subtype> (the ids XInput gives, as SDL takes them), PlayStation (SDL's
// HIDAPI) 03000000 <vid> 0000 <pid> 0000 0000 6800
const PS_PADS = new Set(['05c4', '09cc', '0ba0', '0ce6', '0df2']);   // DS4 v1 / v2 / USB adapter, DualSense, DualSense Edge
const le = (h) => h.slice(2, 4) + h.slice(0, 2);
// keys.exe pads: "xinput 045e 028e 0114 01 slot0" / "hid 054c 09cc 0100 00 \\?\HID#…"
function padsFrom(text) {
  const seen = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(xinput|hid) ([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{2})/i.exec(line.trim());
    if (!m) continue;
    const [, type, vid, pid, ver, sub] = m.map((x) => String(x).toLowerCase());
    let pad = null;
    if (type === 'xinput') pad = { kind: 'xinput', vid, pid, guid: `03000000${le(vid)}0000${le(pid)}0000${le(ver)}78${sub}` };
    else if (vid === '054c' && PS_PADS.has(pid)) pad = { kind: 'playstation', vid, pid, guid: `03000000${le(vid)}0000${le(pid)}000000006800` };
    if (pad && !seen.has(pad.guid)) seen.set(pad.guid, pad);
  }
  return [...seen.values()].sort((a, b) => (a.kind === 'playstation' ? 0 : 1) - (b.kind === 'playstation' ? 0 : 1));
}
function connectedPads(keysExe) {
  return new Promise((resolve) => execFile(keysExe, ['pads'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(padsFrom(out))));
}

// ---------- DuckStation / PCSX2 ----------
// player 1's binds on one particular SDL controller (or a chord of the same control on several) → the first one
function sdlFirst(file, sections = ['Pad1']) {
  if (!fs.existsSync(file)) return false;
  const ini = readIni(file);
  let changed = false;
  for (const sec of sections) {
    const lines = ini.sections.get(sec) || [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*[^=;#[]+?\s*=\s*)(\S.*?)\s*$/.exec(lines[i]);
      if (!m) continue;
      const parts = m[2].split('&').map((x) => x.trim());
      const sdl = parts.map((x) => /^SDL-[^/]+\/(.+)$/.exec(x));
      if (!sdl.every(Boolean)) continue;                         // with a key in it: the player's own chord
      const controls = new Set(sdl.map((x) => x[1]));
      if (controls.size !== 1) continue;
      if (parts.length === 1 && /^SDL-\d+\//.test(parts[0])) continue;   // already "the n-th controller"
      lines[i] = `${m[1]}SDL-0/${[...controls][0]}`;
      changed = true;
    }
  }
  if (changed) writeIni(file, ini);
  return changed;
}

// ---------- Eden ----------
const dev = (p) => `engine:sdl,port:0,guid:${p.guid}`;
// Eden's own choice of buttons (its SDL driver: Switch A = the right face button …), by SDL's button numbers of each kind
function edenBinds(p) {
  const d = dev(p), b = (n) => `"${d},button:${n}"`, axis = (n) => `"${d},axis:${n},threshold:0.5,invert:+"`;
  const stick = (x, y) => `"${d},axis_x:${x},axis_y:${y},offset_x:-0.000000,offset_y:0.000000,invert_x:+,invert_y:+"`;
  if (p.kind === 'playstation') {
    return { button_a: b(1), button_b: b(0), button_x: b(3), button_y: b(2), button_lstick: b(7), button_rstick: b(8), button_l: b(9), button_r: b(10),
      button_zl: axis(4), button_zr: axis(5), button_plus: b(6), button_minus: b(4),
      button_dup: b(11), button_ddown: b(12), button_dleft: b(13), button_dright: b(14),
      button_slleft: b(9), button_srleft: b(10), button_slright: b(9), button_srright: b(10),
      lstick: stick(0, 1), rstick: stick(2, 3), motionleft: `"engine:sdl,motion:0,port:0,guid:${p.guid}"`, motionright: `"engine:sdl,motion:0,port:0,guid:${p.guid}"` };
  }
  const hat = (dir) => `"${d},hat:0,direction:${dir}"`;
  return { button_a: b(1), button_b: b(0), button_x: b(3), button_y: b(2), button_lstick: b(8), button_rstick: b(9), button_l: b(4), button_r: b(5),
    button_zl: axis(2), button_zr: axis(5), button_plus: b(7), button_minus: b(6),
    button_dup: hat('up'), button_ddown: hat('down'), button_dleft: hat('left'), button_dright: hat('right'),
    button_slleft: b(4), button_srleft: b(5), button_slright: b(4), button_srright: b(5),
    lstick: stick(0, 1), rstick: stick(3, 4), motionleft: '"engine:keyboard,code:55,toggle:0"', motionright: '"engine:keyboard,code:56,toggle:0"' };
}
const EDEN_KEYS = Object.keys(edenBinds({ kind: 'playstation', guid: '0'.repeat(32) }));
// store: { get(), set(v) } - Eden's player 1 per controller. Returns the kind it now plays with, or ''.
function edenFollow(dir, pads, store) {
  const file = path.join(dir, 'user', 'config', 'qt-config.ini');
  if (!pads.length || !fs.existsSync(file)) return '';
  const ini = readIni(file);
  const bound = new Set();
  for (const l of ini.sections.get('Controls') || []) {
    const m = /^player_0_[a-z_]+="?engine:sdl,[^"]*?guid:([0-9a-f]{32})/i.exec(l);
    if (m) bound.add(m[1].toLowerCase());
  }
  const saved = store.get() || {};
  const pad = pads[0];
  // its controller is here - unless that is the Xbox pad of DS4Windows and the PS4 controller it played with before
  // is here too (back on that PC)
  const here = pads.find((p) => bound.has(p.guid));
  if (here && (here === pad || !saved[pad.guid])) return '';
  const from = [...bound][0];
  if (from) saved[from] = Object.fromEntries(EDEN_KEYS.map((k) => [k, iniGet(ini, 'Controls', `player_0_${k}`)]).filter(([, v]) => v !== undefined));
  for (const [k, v] of Object.entries(saved[pad.guid] || edenBinds(pad))) {
    iniSet(ini, 'Controls', `player_0_${k}\\default`, 'false', '=');
    iniSet(ini, 'Controls', `player_0_${k}`, v, '=');
  }
  writeIni(file, ini);
  store.set(saved);
  return pad.kind === 'playstation' ? 'PlayStation controller' : 'Xbox controller';
}

// ---------- xemu ----------
// ds4windows: this PC uses DS4Windows (its driver is installed). store: { get(), set(v) }. Returns whether it changed.
function xemuFollow(dir, ds4windows, store) {
  const file = path.join(dir, 'xemu.toml');
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const auto = /^(\s*auto_bind\s*=\s*)(true|false)\s*$/m.exec(text);
  const port = /^(\s*port1\s*=\s*)('[^']*'|"[^"]*")\s*$/m.exec(text);
  if (!auto) return false;
  const saved = store.get();
  let next = text;
  if (!ds4windows && auto[2] === 'false') {
    store.set({ auto_bind: auto[2], port1: port ? port[2] : null });
    next = next.replace(auto[0], `${auto[1]}true`);
    if (port) next = next.replace(port[0], `${port[1]}''`);
  } else if (ds4windows && saved && auto[2] === 'true' && (!port || /^(''|"")$/.test(port[2]))) {
    next = next.replace(auto[0], `${auto[1]}${saved.auto_bind}`);
    if (port && saved.port1) next = next.replace(port[0], `${port[1]}${saved.port1}`);
    store.set(null);
  }
  if (next === text) return false;
  if (!fs.existsSync(file + '.before-pads')) fs.copyFileSync(file, file + '.before-pads');
  fs.writeFileSync(file, next);
  return true;
}

module.exports = { connectedPads, padsFrom, sdlFirst, edenBinds, edenFollow, xemuFollow };
