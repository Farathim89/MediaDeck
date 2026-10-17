// The first-start setup and the BIOS check: which consoles a games folder holds (by the console folders' names,
// also inside maker folders like Nintendo\SNES), how many games, the emulator MediaDeck installs for each, and
// which BIOS / firmware files a console needs, which are there and where they go. Reads only; nothing is
// downloaded (MediaDeck never downloads BIOS).
const fs = require('fs');
const path = require('path');
const covers = require('./covers');
const emuInstaller = require('./emu-installer');

// A console found by its folder name → the emulator installer's console (its list of emulators to choose from)
const INSTALLER = {
  'Nintendo - Nintendo Entertainment System': 'nes', 'Nintendo - Super Nintendo Entertainment System': 'snes',
  'Nintendo - Nintendo 64': 'n64', 'Nintendo - Game Boy': 'gb', 'Nintendo - Game Boy Color': 'gb',
  'Nintendo - Game Boy Advance': 'gb', 'Nintendo - GameCube': 'gcwii', 'Nintendo - Wii': 'gcwii',
  'Nintendo - Nintendo DS': 'nds', 'Nintendo - Nintendo 3DS': '3ds', 'Nintendo - Wii U': 'wiiu',
  'Nintendo - Virtual Boy': 'vb', 'Sony - PlayStation': 'ps1', 'Sony - PlayStation 2': 'ps2',
  'Sony - PlayStation Portable': 'psp', 'Sony - PlayStation 3': 'ps3', 'Sony - PlayStation Vita': 'vita',
  'Sony - PlayStation 4': 'ps4', 'Sega - Master System - Mark III': 'sms', 'Sega - SG-1000': 'sms',
  'Sega - Mega Drive - Genesis': 'md', 'Sega - 32X': 'md', 'Sega - Mega-CD - Sega CD': 'md', 'Sega - Saturn': 'saturn',
  'Sega - Dreamcast': 'dc', 'Sega - Game Gear': 'gg', 'NEC - PC Engine - TurboGrafx 16': 'pce', 'NEC - PC-FX': 'pcfx',
  'SNK - Neo Geo Pocket': 'ngp', 'SNK - Neo Geo Pocket Color': 'ngp', 'Atari - 2600': 'a2600', 'Atari - Lynx': 'lynx',
  'Atari - 5200': 'a800', 'Atari - 8-bit': 'a800', 'Microsoft - Xbox': 'xbox', 'Microsoft - Xbox 360': 'x360',
  'Bandai - WonderSwan': 'wswan', 'Bandai - WonderSwan Color': 'wswan', 'Arcade - Sega Model 3': 'model3',
  'Commodore - Amiga': 'amiga', 'Commodore - CD32': 'cd32', 'Commodore - 64': 'c64', 'Sinclair - ZX Spectrum': 'zx',
  'Apple - II': 'apple2', 'Microsoft - MSX': 'msx', 'Microsoft - MSX2': 'msx', 'Coleco - ColecoVision': 'msx',
  'Microsoft - DOS': 'dos', 'Commander - X16': 'x16', 'Adobe - Flash': 'flash', MAME: 'arcade', 'SNK - Neo Geo': 'arcade',
};

// BIOS / firmware per console: need = required | cd (only for its CD games) | optional | none; files = what to put in
// BIOS\<folder> (any one of them unless all: true); emu = where the emulator itself may keep it (its folder + sub)
const BIOS = [
  { system: 'Sony - PlayStation', folder: 'Sony - PlayStation', need: 'required', match: /^scph.*\.bin$/i,
    files: 'scph5501.bin (USA), scph5502.bin (Europe) or scph5500.bin (Japan) - one is enough', emu: ['duckstation', 'bios'] },
  { system: 'Sony - PlayStation 2', folder: 'Sony - PlayStation 2', need: 'required', match: /\.bin$/i,
    files: 'a PS2 BIOS dump (.bin), e.g. SCPH-70004 (Europe) or SCPH-39001 (USA)', emu: ['pcsx2', 'bios'] },
  { system: 'Sony - PlayStation 3', folder: 'Sony - PlayStation 3', need: 'firmware',
    files: 'PS3UPDAT.PUP - the official firmware from playstation.com, installed from RPCS3\'s File menu' },
  { system: 'Nintendo - Switch', folder: 'Nintendo - Switch', need: 'required', all: [/^prod\.keys$/i],
    files: 'prod.keys (+ title.keys) and a firmware .zip, from your own Switch - installed in Ryujinx' },
  { system: 'Sega - Saturn', folder: 'Sega - Saturn', need: 'required', match: /^(sega_101|mpr-17933)\.bin$/i,
    files: 'mpr-17933.bin (USA / Europe) or sega_101.bin (Japan)', emu: ['mednafen', 'firmware'] },
  { system: 'Sega - Mega-CD - Sega CD', folder: 'Sega - Mega CD - Sega CD', need: 'cd', match: /^bios_cd_[uej]\.bin$/i,
    files: 'bios_CD_U.bin (USA), bios_CD_E.bin (Europe) or bios_CD_J.bin (Japan) - only for Sega CD games' },
  { system: 'Sega - Dreamcast', folder: 'Sega - Dreamcast', need: 'optional', match: /^dc_boot\.bin$/i,
    files: 'dc_boot.bin and dc_flash.bin (recommended; Flycast has a built-in replacement)', emu: ['flycast', 'data'] },
  { system: 'NEC - PC Engine - TurboGrafx 16', folder: 'NEC - PC Engine CD', need: 'cd', match: /^syscard3\.pce$/i,
    files: 'syscard3.pce - only for PC Engine CD games' },
  { system: 'NEC - PC-FX', folder: 'NEC - PC-FX', need: 'required', match: /^pcfx\.rom$/i, files: 'pcfx.rom', emu: ['mednafen', 'firmware'] },
  { system: 'Atari - Lynx', folder: 'Atari - Lynx', need: 'required', match: /^lynxboot\.img$/i, files: 'lynxboot.img', emu: ['mednafen', 'firmware'] },
  { system: 'SNK - Neo Geo', folder: 'SNK - Neo Geo', need: 'required', match: /^neogeo\.zip$/i, files: 'neogeo.zip' },
  { system: 'Philips - CD-i', folder: 'Philips - CD-i', need: 'required', match: /^cdimono1\.zip$/i, files: 'cdimono1.zip' },
  { system: 'Microsoft - Xbox', folder: 'Microsoft - Xbox', need: 'required', all: [/^mcpx_1\.0\.bin$/i, /^complex_4627\.bin$/i],
    files: 'mcpx_1.0.bin and Complex_4627.bin (+ an xbox_hdd.qcow2 hard disk image)', emu: ['xemu', 'bios'] },
  { system: 'Commodore - CD32', folder: 'Commodore - Amiga CD32', need: 'required', match: /cd32|40060/i,
    files: 'the CD32 Kickstart 3.1 (40.060) and its extended ROM (from Amiga Forever or your own CD32)' },
  { system: 'Commodore - Amiga', folder: 'Commodore - Amiga', need: 'required', match: /kick|\.rom$/i,
    files: 'an Amiga Kickstart ROM (from Amiga Forever or your own Amiga)' },
  { system: 'Nintendo - Game Boy Advance', folder: 'Nintendo - Game Boy Advance', need: 'optional', match: /^gba_bios\.bin$/i,
    files: 'gba_bios.bin (optional - mGBA has a built-in replacement)' },
  { system: 'Nintendo - Nintendo DS', folder: 'Nintendo - DS', need: 'optional', match: /^(bios7|nds_bios7)\.bin$/i,
    files: 'bios7.bin, bios9.bin, firmware.bin (optional - melonDS has a built-in replacement)' },
  { system: 'Nintendo - GameCube', folder: 'Nintendo - GameCube', need: 'optional', match: /\.bin$/i,
    files: 'IPL.bin (optional - only for the boot animation)' },
];

// Recommended files per BIOS folder: the file names the emulators look for (and the BIOS import gives them),
// what each one is, and its MD5 from bios-db.json - so a file can be checked. Names only; MediaDeck has no BIOS files.
const RECOMMENDED = {
  'Sony - PlayStation': [['scph5501.bin', 'USA'], ['scph5502.bin', 'Europe'], ['scph5500.bin', 'Japan']],
  'Sony - PlayStation 2': [['ps2-0200a-20040614.bin', 'USA, v2.00'], ['ps2-0200e-20040614.bin', 'Europe, v2.00'], ['ps2-0200j-20040614.bin', 'Japan, v2.00']],
  'Sony - PlayStation 3': [['PS3UPDAT.PUP', "the official PS3 firmware, free from playstation.com - install it from RPCS3's File menu"]],
  'Nintendo - Switch': [['prod.keys', 'from your own Switch'], ['title.keys', 'from your own Switch']],
  'Sega - Saturn': [['mpr-17933.bin', 'USA / Europe'], ['sega_101.bin', 'Japan']],
  'Sega - Mega CD - Sega CD': [['bios_CD_U.bin', 'USA (Sega CD)'], ['bios_CD_E.bin', 'Europe (Mega CD)'], ['bios_CD_J.bin', 'Japan (Mega CD)']],
  'Sega - Dreamcast': [['dc_boot.bin', 'boot ROM'], ['dc_flash.bin', 'flash memory (settings, region)']],
  'NEC - PC Engine CD': [['syscard3.pce', 'Super CD-ROM System Card 3.0 (Japan)'], ['syscard3u.pce', 'Super System Card 3.0 (USA)']],
  'NEC - PC-FX': [['pcfx.rom', 'PC-FX BIOS']],
  'Atari - Lynx': [['lynxboot.img', 'Lynx boot ROM']],
  'SNK - Neo Geo': [['neogeo.zip', 'the Neo Geo BIOS set (MAME / FBNeo)']],
  'Philips - CD-i': [['cdimono1.zip', 'the CD-i (Mono-I) BIOS set (MAME)']],
  'Microsoft - Xbox': [['mcpx_1.0.bin', 'MCPX boot ROM (512 bytes)'], ['Complex_4627.bin', 'flash BIOS (1 MB)'], ['xbox_hdd.qcow2', "the hard disk image (see xemu's setup guide)"]],
  'Commodore - Amiga CD32': [['kick40060.CD32', 'CD32 Kickstart 3.1'], ['kick40060.CD32.ext', 'CD32 extended ROM']],
  'Commodore - Amiga': [['kick34005.A500', 'Kickstart 1.3 (A500)'], ['kick40068.A1200', 'Kickstart 3.1 (A1200)']],
  'Nintendo - Game Boy Advance': [['gba_bios.bin', 'GBA BIOS']],
  'Nintendo - DS': [['bios7.bin', 'ARM7 BIOS'], ['bios9.bin', 'ARM9 BIOS'], ['firmware.bin', 'DS firmware']],
  'Nintendo - GameCube': [['gc-ntsc-12.bin', 'USA IPL (boot animation only)'], ['gc-pal-12.bin', 'Europe IPL (boot animation only)']],
};
// consoles that need every recommended file (the others: any one, for your region)
const ALL_PARTS = new Set(['Microsoft - Xbox', 'Sega - Dreamcast', 'Nintendo - DS', 'Commodore - Amiga CD32', 'Nintendo - Switch']);
const MD5_OF = (() => {
  const m = new Map();
  try { for (const [md5, [folder, name]] of Object.entries(require('./bios-db.json').files)) if (!m.has(`${folder}|${name}`.toLowerCase())) m.set(`${folder}|${name}`.toLowerCase(), md5); } catch {}
  return m;
})();
const recommended = (folder) => (RECOMMENDED[folder] || []).map(([name, what]) => ({ name, what, md5: MD5_OF.get(`${folder}|${name}`.toLowerCase()) || '' }));

const GAME_EXT = new Set(('nes fds unf sfc smc swc fig n64 z64 v64 gb gbc gba nds 3ds cci cia iso bin cue chd img ccd mds pbp cso '
  + 'gdi cdi rvz wbfs gcz wia nsp xci nsz xex sms gg sg md gen smd 32x pce sgx ngp ngc a26 a52 a78 lnk lyx vb ws wsc '
  + 'adf hdf ipf d64 t64 prg tap tzx z80 dsk rom mx1 mx2 col exe conf swf zip 7z rar m3u elf pkg').split(' '));

function countGames(dir, depth = 0, out = { n: 0 }) {
  if (depth > 4 || out.n >= 5000) return out.n;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out.n; }
  for (const d of list) {
    if (d.name.startsWith('_') || d.name.startsWith('.')) continue;
    if (d.isDirectory()) {
      // a PS3 game folder (PS3_GAME\USRDIR) is one game; a disc's own folder is counted by its files
      if (/^ps3_game$/i.test(d.name)) { out.n++; continue; }
      countGames(path.join(dir, d.name), depth + 1, out);
    } else if (GAME_EXT.has(path.extname(d.name).slice(1).toLowerCase()) && !/\(track \d+\)\.bin$/i.test(d.name)) out.n++;
  }
  return out.n;
}

const systemOf = (name) => covers.systemFor({}, path.join(name, 'x'));

// The console folders under a games folder: <root>\<console> or <root>\<maker>\<console>
function consoleFolders(root) {
  const out = [];
  let top = [];
  try { top = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')); } catch { return out; }
  for (const d of top) {
    const p = path.join(root, d.name);
    const sys = systemOf(d.name);
    const subs = [];
    try {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('_')) continue;
        const s2 = systemOf(e.name);
        if (s2) subs.push({ system: s2, folder: path.join(p, e.name) });
      }
    } catch {}
    // a maker folder whose own name is a console too (MSX\MSX2, Arcade\Sega Model 3): its console folders count
    if (sys && !subs.some((x) => x.system !== sys)) out.push({ system: sys, folder: p });
    else out.push(...subs);
  }
  return out;
}

// Games folders on this PC: drive roots and their folders (two levels) that hold two or more console folders
// a MediaDeck folder (this one or another copy): its BIOS / Emu_modules folders have console names, but no games
const isMediaDeck = (p) => fs.existsSync(path.join(p, 'MediaDeck.exe')) || fs.existsSync(path.join(p, 'Emu_modules'));

function findGamesFolders(skip = []) {
  const found = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const drive = `${letter}:\\`;
    if (!fs.existsSync(drive)) continue;
    const look = [drive];
    try {
      for (const d of fs.readdirSync(drive, { withFileTypes: true })) {
        if (!d.isDirectory() || /^(windows|program files|programdata|\$|system volume|recovery|users|msocache|perflogs)/i.test(d.name)) continue;
        const p = path.join(drive, d.name);
        look.push(p);
        try { for (const e of fs.readdirSync(p, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('$')) look.push(path.join(p, e.name)); } catch {}
      }
    } catch {}
    for (const p of look) {
      if (skip.some((x) => (p + path.sep).toLowerCase().startsWith((x + path.sep).toLowerCase())) || isMediaDeck(p)) continue;
      const cf = consoleFolders(p);
      const n = new Set(cf.map((c) => c.system)).size;
      if (n >= 2) found.push({ path: p, consoles: n, cf });
    }
  }
  // the best first (more consoles, then the shorter path); only folders that really hold games (an emulators
  // folder has console names too)
  return found.sort((a, b) => b.consoles - a.consoles || a.path.length - b.path.length).slice(0, 8)
    .map(({ path: p, consoles, cf }) => ({ path: p, consoles, games: cf.reduce((t, c) => t + Math.min(countGames(c.folder), 5000), 0) }))
    .filter((c) => c.games > 0).slice(0, 4);
}

// What the setup shows for a games folder: one row per console found (its folders merged), sorted by games
function scanGames(root, installedModules) {
  const catalog = emuInstaller.catalog(installedModules || []);
  const by = new Map();
  for (const { system, folder } of consoleFolders(root)) {
    const r = by.get(system) || { system, name: covers.consoleOf({}, path.join(folder, 'x')).console, folders: [], games: 0 };
    r.folders.push(folder);
    r.games += countGames(folder);
    by.set(system, r);
  }
  return [...by.values()].map((r) => {
    const c = catalog.find((x) => x.id === INSTALLER[r.system]);
    const installed = c ? c.emulators.filter((e) => e.installed) : [];
    return { ...r, consoleId: c ? c.id : null, consoleName: c ? c.name : r.name,
      emulator: c ? c.emulators[0] : null, installed: installed.map((e) => e.name) };
  }).filter((r) => r.games > 0).sort((a, b) => b.games - a.games);
}

// The BIOS check: per console that needs one, what's there (BIOS\<folder>, or the emulator's own folder)
function biosStatus(biosDir, installedModules, systems) {
  const emuDirs = {};
  for (const m of installedModules || []) {
    const id = emuInstaller.emuIdOf ? emuInstaller.emuIdOf(m) : null;
    if (id && m.dir) emuDirs[id] = m.dir;
  }
  const list = (dir) => { try { return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()); } catch { return []; } };
  return BIOS.filter((b) => !systems || systems.includes(b.system)).map((b) => {
    const here = list(path.join(biosDir, b.folder));
    const inEmu = b.emu && emuDirs[b.emu[0]] ? list(path.join(emuDirs[b.emu[0]], b.emu[1])) : [];
    const files = [...new Set([...here, ...inEmu])];
    let ok;
    if (b.need === 'firmware') ok = null;                                  // installed inside the emulator: can't tell
    else if (b.all) ok = b.all.every((re) => files.some((f) => re.test(f)));
    else ok = files.some((f) => b.match.test(f));
    const rec = recommended(b.folder).map((r) => ({ ...r, have: files.some((f) => f.toLowerCase() === r.name.toLowerCase()) }));
    return { system: b.system, name: covers.consoleOf({}, path.join(b.system, 'x')).console, need: b.need, files: b.files, rec, allParts: ALL_PARTS.has(b.folder),
      folder: path.join(biosDir, b.folder), ok, found: files.filter((f) => (b.all ? b.all.some((re) => re.test(f)) : b.match && b.match.test(f))).slice(0, 4) };
  });
}

// BIOS added after an emulator was installed: copied from BIOS\<console> into the emulator's own BIOS folder, as
// the installer does (only files that aren't there yet; never overwrites, nothing is moved). Returns the copies.
function biosSync(biosDir, installedModules) {
  const copied = [];
  for (const m of installedModules || []) {
    const id = emuInstaller.emuIdOf(m);
    const e = id && emuInstaller.EMULATORS[id];
    if (!e || !e.biosTo || !e.biosFiles || !m.dir) continue;
    for (const c of emuInstaller.CONSOLES.filter((x) => x.bios && x.emus.includes(id))) {
      const from = path.join(biosDir, c.bios);
      let files = [];
      try { files = fs.readdirSync(from).filter((f) => e.biosFiles.test(f) && fs.statSync(path.join(from, f)).isFile()); } catch { continue; }
      const to = path.join(m.dir, e.biosTo);
      for (const f of files) {
        if (fs.existsSync(path.join(to, f))) continue;
        try { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(path.join(from, f), path.join(to, f)); copied.push(`${e.name}: ${f}`); } catch {}
      }
    }
  }
  return copied;
}

// BIOS\<console> for every console that needs one, each with a note of the files that go in it and the recommended
// ones with their checksums (made at the first start and when the BIOS check opens; the note is MediaDeck's own and
// kept up to date, nothing else in the folders is touched). Returns how many folders were made.
const NOTE_HEAD = ' - BIOS / firmware';
function makeBiosFolders(biosDir) {
  let made = 0;
  for (const b of BIOS) {
    const dir = path.join(biosDir, b.folder);
    try {
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); made++; }
      const note = path.join(dir, 'What goes here.txt');
      const need = b.need === 'required' ? 'Needed' : b.need === 'cd' ? 'Needed for CD games only' : b.need === 'firmware' ? 'Installed from the emulator' : 'Optional';
      const rec = recommended(b.folder);
      const text = [`${covers.consoleOf({}, path.join(b.system, 'x')).console}${NOTE_HEAD}`, '', `${need}: ${b.files}`, '',
        ...(rec.length ? [ALL_PARTS.has(b.folder) ? 'Recommended - all of these:' : rec.length > 1 ? 'Recommended - any one of these (for your region):' : 'Recommended:',
          ...rec.map((r) => `  ${r.name.padEnd(24)} ${r.what}${r.md5 ? `   MD5 ${r.md5}` : ''}`), ''] : []),
        'Dump them from your own console. MediaDeck never downloads BIOS files.',
        'Have them in a folder or zip already? Settings > Emulators > BIOS check > Import BIOS files...',
        'recognises each one by its checksum, names it and puts it here.',
        'Added files by hand? BIOS check > Copy BIOS files to the emulators.', ''].join('\r\n');
      let old = null;
      try { old = fs.readFileSync(note, 'utf8'); } catch {}
      // a note that isn't MediaDeck's (someone wrote their own) stays
      if (old !== text && (old === null || old.split(/\r?\n/)[0].endsWith(NOTE_HEAD))) fs.writeFileSync(note, text);
    } catch {}
  }
  return made;
}

module.exports = { makeBiosFolders, recommended, RECOMMENDED, ALL_PARTS, findGamesFolders, scanGames, biosStatus, biosSync, consoleFolders, BIOS, INSTALLER };
