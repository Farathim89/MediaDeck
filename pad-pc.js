// Player 1 on this PC: emulators that keep one particular controller (by its id) get the one that is here. The
// MediaDeck folder goes from PC to PC (a USB drive) with other controllers - a PS4 controller here, an Xbox one there.
//  - DuckStation / PCSX2: player 1 as "the first controller" (SDL-0), the same on every PC. A bind made while the PS4
//    controller came in twice (itself and DS4Windows' Xbox pad) was saved as a chord of both ("SDL-<its id>/A &
//    SDL-0/A": both at once) - on a PC without that controller nothing ever pressed it.
//  - Eden: player 1 by SDL's id of the controller that is here (from Windows' hardware ids), its own buttons for an
//    Xbox or a PlayStation pad; what it had is kept per controller and comes back with that controller
//  - Ryujinx / mGBA: the same by SDL's full id of the controller (they keep it with the CRC of its name); Ryujinx's
//    buttons are by name, mGBA's by number (its own for an Xbox / a PlayStation pad, what it had kept per pad)
//  - xemu: on a PC without DS4Windows it binds the controller that is there by itself (auto_bind); with DS4Windows
//    its own setting comes back (auto_bind there would bind the PS4 controller and its Xbox pad both)
//  - Mesen 2: player 1 on every Xbox slot (it knows the slots, not the controllers: an Xbox controller on the second
//    slot did nothing)
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
// SDL_crc16 (CRC-16/ARC): the name part of SDL's ids
function crc16(s) {
  let c = 0;
  for (const b of Buffer.from(s, 'utf8')) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
  return c.toString(16).padStart(4, '0');
}
// SDL's names of the PlayStation pads it reads itself (its HIDAPI drivers)
const PS_NAME = { '05c4': 'PS4 Controller', '09cc': 'PS4 Controller', '0ba0': 'PS4 Controller', '0ce6': 'DualSense Wireless Controller', '0df2': 'DualSense Edge Wireless Controller' };
// keys.exe pads: "xinput 045e 028e 0114 01 slot0" / "raw 045e 028e 0000 1 <manufacturer>\t<product>" (1 = an XInput pad)
// Each pad: guid = Eden's (SDL with its raw input off, no name CRC), sdl = SDL's own with its defaults and the name
// CRC (Ryujinx, mGBA): Xbox pads through raw input ('r', the CRC of the device's manufacturer + product text),
// PlayStation pads through HIDAPI ('h', the CRC of SDL's name for them)
function padsFrom(text) {
  const lines = String(text || '').split(/\r?\n/);
  const raw = lines.map((l) => /^raw ([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{4}) ([01]) ([^\t]*)\t(.*)$/i.exec(l.trim())).filter(Boolean)
    .map(([, vid, pid, ver, ig, mfr, prod]) => ({ vid: vid.toLowerCase(), pid: pid.toLowerCase(), ver: ver.toLowerCase(), ig: ig === '1', mfr: mfr.trim(), prod: prod.trim() }));
  const seen = new Map();
  for (const line of lines) {
    const m = /^xinput ([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{2})/i.exec(line.trim());
    if (!m) continue;
    const [, vid, pid, ver, sub] = m.map((x) => String(x).toLowerCase());
    const r = raw.find((x) => x.ig && x.vid === vid && x.pid === pid);
    const name = r ? (r.mfr && r.prod ? `${r.mfr} ${r.prod}` : r.prod) : '';
    const pad = { kind: 'xinput', vid, pid, guid: `03000000${le(vid)}0000${le(pid)}0000${le(ver)}78${sub}`,
      sdl: r ? `0300${le(crc16(name))}${le(vid)}0000${le(pid)}0000${le(r.ver)}7200` : '' };
    if (!seen.has(pad.guid)) seen.set(pad.guid, pad);
  }
  for (const r of raw) {
    if (r.ig || r.vid !== '054c' || !PS_PADS.has(r.pid)) continue;
    const pad = { kind: 'playstation', vid: r.vid, pid: r.pid, guid: `03000000${le(r.vid)}0000${le(r.pid)}000000006800`,
      sdl: `0300${le(crc16(PS_NAME[r.pid]))}${le(r.vid)}0000${le(r.pid)}000000006800` };
    if (!seen.has(pad.guid)) seen.set(pad.guid, pad);
  }
  return [...seen.values()].sort((a, b) => (a.kind === 'playstation' ? 0 : 1) - (b.kind === 'playstation' ? 0 : 1));
}
// The pad the emulator should play with: the first one (a PlayStation pad before an Xbox one) - unless the one it
// has is here and isn't just an Xbox pad next to a PlayStation one
function pick(pads, isBound) {
  const best = pads[0], here = pads.find(isBound);
  if (!best || here === best || (here && best.kind !== 'playstation')) return null;
  return best;
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

// ---------- Ryujinx ----------
// Its player 1 = "<n>-<SDL's GUID as a .NET Guid>" (the first three parts byte-swapped); the buttons are by name, so
// only the id changes. Returns the kind it now plays with, or ''.
const dotnetGuid = (h) => [h.slice(0, 8).match(/../g).reverse().join(''), h.slice(8, 12).match(/../g).reverse().join(''), h.slice(12, 16).match(/../g).reverse().join(''), h.slice(16, 20), h.slice(20, 32)].join('-');
function ryujinxFollow(dir, pads) {
  const file = [path.join(dir, 'portable', 'Config.json'), path.join(dir, 'Config.json')].find((f) => fs.existsSync(f));
  if (!file || !pads.length) return '';
  const text = fs.readFileSync(file, 'utf8');
  let j;
  try { j = JSON.parse(text); } catch { return ''; }
  const p1 = (j.input_config || []).find((c) => c && c.backend === 'GamepadSDL2' && c.player_index === 'Player1');
  if (!p1) return '';
  const id = (p) => `0-${dotnetGuid(p.sdl)}`;
  const pad = pick(pads.filter((p) => p.sdl), (p) => String(p1.id || '').toLowerCase() === id(p));
  if (!pad || !p1.id) return '';
  // only the id's text changes (the rest of the file stays as Ryujinx wrote it)
  const next = text.replace(`"id": "${p1.id}"`, `"id": "${id(pad)}"`);
  if (next === text) return '';
  if (!fs.existsSync(file + '.before-pads')) fs.copyFileSync(file, file + '.before-pads');
  fs.writeFileSync(file, next);
  return pad.kind === 'playstation' ? 'PlayStation controller' : 'Xbox controller';
}

// ---------- mGBA ----------
// [gba.input.SDLB]: the pad (device0 = SDL's GUID) and its buttons by SDL's numbers; GBA A = the right face button,
// B = the bottom one (by position, as before). What it had is kept per pad and comes back with it.
function mgbaBinds(p) {
  const stick = { axisLeftAxis: '-0', axisLeftValue: '-12288', axisRightAxis: '+0', axisRightValue: '12288', axisUpAxis: '-1', axisUpValue: '-12288', axisDownAxis: '+1', axisDownValue: '12288' };
  if (p.kind === 'playstation') return { keyA: '1', keyB: '0', keySelect: '4', keyStart: '6', keyL: '9', keyR: '10', keyUp: '11', keyDown: '12', keyLeft: '13', keyRight: '14', ...stick };
  // (Xbox pads through raw input: Back 6, Start 7, LB 4, RB 5; the D-pad is hat 0 - mGBA's keys 4-7 are Right, Left, Up, Down)
  return { keyA: '1', keyB: '0', keySelect: '6', keyStart: '7', keyL: '4', keyR: '5', keyUp: '-1', keyDown: '-1', keyLeft: '-1', keyRight: '-1',
    hat0Up: '6', hat0Down: '7', hat0Left: '5', hat0Right: '4', ...stick };
}
const MGBA_KEYS = [...new Set([...Object.keys(mgbaBinds({ kind: 'xinput' })), ...Object.keys(mgbaBinds({ kind: 'playstation' }))])];
function mgbaFollow(dir, pads, store) {
  const file = path.join(dir, 'config.ini');
  if (!pads.length || !fs.existsSync(file)) return '';
  const ini = readIni(file), sec = 'gba.input.SDLB';
  const device = String(iniGet(ini, sec, 'device0') || '').toLowerCase();
  if (!device) return '';                                       // no controller chosen in mGBA: it picks one itself
  const pad = pick(pads.filter((p) => p.sdl), (p) => p.sdl === device);
  if (!pad) return '';
  const saved = store.get() || {};
  saved[device] = Object.fromEntries(MGBA_KEYS.map((k) => [k, iniGet(ini, sec, k)]).filter(([, v]) => v !== undefined));
  const binds = saved[pad.sdl] || mgbaBinds(pad);
  iniSet(ini, sec, 'device0', pad.sdl, '=');
  for (const [k, v] of Object.entries(binds)) { iniSet(ini, sec, k, v, '='); iniSet(ini, `gba.input-profile.${pad.sdl}`, k, v, '='); }
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

// ---------- Mesen 2 ----------
// Its Xbox pads are the XInput slots themselves (Pad1 = the first slot, Pad2 the second …, code 0x1000 + slot * 0x100
// + button): player 1 on Pad1 did nothing with an Xbox controller that got the second slot (the PS4 controller through
// DS4Windows had the first). Player 1's Xbox layout also goes on the other slots, in its mappings 3 and 4 while they
// are empty (or this copy) - slots another player of that console uses left out. No controller ids.
const MESEN_PLAYER1 = { Nes: 'Port1', Snes: 'Port1', Sms: 'Port1', PcEngine: 'Port1', Cv: 'Port1', Gameboy: 'Controller', Gba: 'Controller', Ws: 'ControllerHorizontal' };
const mesenCodes = (m) => Object.keys(m || {}).filter((k) => typeof m[k] === 'number' && m[k]).map((k) => m[k]);
// the slot of a mapping that is one Xbox pad only; -1 none (empty), -2 something else (keys, DirectInput, mixed)
function mesenSlot(m) {
  const codes = mesenCodes(m);
  if (!codes.length) return -1;
  const slots = new Set(codes.map((c) => (c >= 0x1000 && c < 0x1400 ? (c - 0x1000) >> 8 : -2)));
  return slots.size === 1 ? [...slots][0] : -2;
}
const mesenOnSlot = (from, slot, m) => {
  const out = { ...m };
  for (const k of Object.keys(from)) if (typeof from[k] === 'number') out[k] = from[k] ? 0x1000 + slot * 0x100 + (from[k] & 0xff) : 0;
  return out;
};
const mesenSame = (a, b) => Object.keys(a).every((k) => typeof a[k] !== 'number' || (a[k] & 0xff) === (b[k] & 0xff));
function mesenAnySlot(file) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/(?<![\d.])\d{16,}/.test(text)) return false;               // a number JavaScript can't keep exactly: left alone
  let j;
  try { j = JSON.parse(text); } catch { return false; }
  let changed = false;
  for (const [con, p1] of Object.entries(MESEN_PLAYER1)) {
    const sec = j[con], me = sec && sec[p1];
    if (!me || !me.Mapping1) continue;
    const slot = mesenSlot(me.Mapping1);
    if (slot < 0) continue;                                         // player 1 isn't on one Xbox pad: the player's own
    const used = new Set([slot]);
    for (const [name, port] of Object.entries(sec)) {
      if (name === p1 || !port || typeof port !== 'object') continue;
      for (const k of ['Mapping1', 'Mapping2', 'Mapping3', 'Mapping4']) { const s = mesenSlot(port[k]); if (s >= 0) used.add(s); }
    }
    const free = [0, 1, 2, 3].filter((s) => !used.has(s));
    for (const k of ['Mapping3', 'Mapping4']) {
      const m = me[k];
      if (!m) continue;
      const s = mesenSlot(m);
      if (!(s === -1 || (s >= 0 && s !== slot && mesenSame(me.Mapping1, m)))) continue;   // the player's own
      // (no slot left for it: emptied - a copy on a slot another player took since)
      const to = free.shift();
      const next = to === undefined ? Object.fromEntries(Object.entries(m).map(([x, v]) => [x, typeof v === 'number' ? 0 : v])) : mesenOnSlot(me.Mapping1, to, m);
      if (JSON.stringify(next) !== JSON.stringify(m)) { me[k] = next; changed = true; }
    }
  }
  if (!changed) return false;
  if (!fs.existsSync(file + '.before-pads')) fs.copyFileSync(file, file + '.before-pads');
  fs.writeFileSync(file, '﻿' + JSON.stringify(j, null, 2).replace(/\n/g, '\r\n'));
  return true;
}

module.exports = { connectedPads, padsFrom, sdlFirst, edenBinds, edenFollow, ryujinxFollow, mgbaFollow, xemuFollow, mesenAnySlot, dotnetGuid };
