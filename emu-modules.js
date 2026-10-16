// Emulator modules: everything in the Emu_modules folder.
//
//  Emu_modules\<Emulator>\                 an emulator's own folder (portable copy)
//      emu-module.json                     how to run it (created automatically if missing)
//  Emu_modules\<Name>.emu.json             a module for an emulator installed elsewhere
//
// emu-module.json:
//  {
//    "name": "PCSX2", "system": "PlayStation 2",
//    "exe": "pcsx2-qt.exe",                relative to the module folder, or a full path
//    "args": "",                           when opening the emulator itself
//    "gameArgs": "-batch \"{rom}\"",       when starting a game ({rom} = the game file)
//    "romExtensions": ["iso", "chd"],      game files that belong to this emulator
//    "romFolders": [],                     where its games are (optional)
//    "hidden": false                       true = not shown in the app
//  }
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MODULE_FILE = 'emu-module.json';
const POINTER_SUFFIX = '.emu.json';
const NOT_THE_EMULATOR = /unins|update|crash|setup|install|vc_?redist|dxsetup|pkunzip|cwsdpmi|cheat|helper|elevate|7z|unrar/i;

// Known emulators: exe names (in order of preference) or a pattern, plus sensible defaults
const KNOWN = [
  { name: 'RetroArch', system: 'Multi-system', exes: ['retroarch.exe'], gameArgs: '-f -L "{core}" "{rom}"', romExtensions: ['zip', '7z', 'nes', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'md', 'gen', 'smd', 'sms', 'gg', 'n64', 'z64', 'v64', 'pce', 'cue', 'bin', 'chd', 'iso', 'pbp', 'm3u', 'gdi', 'cdi', 'nds', '3ds', 'rvz', 'a26', 'lnx'], hotkeys: { options: 'F1', saveState: 'F5', loadState: 'F8', pause: 'P' } },
  { name: 'PCSX2', system: 'PlayStation 2', pattern: /^pcsx2(-qt)?(-avx2)?\.exe$/i, gameArgs: '-fullscreen -batch -- "{rom}"', romExtensions: ['iso', 'chd', 'cso', 'gz', 'bin', 'mdf', 'elf'], hotkeys: { options: 'Alt+Return', saveState: 'F1', loadState: 'F3', pause: 'Space', screenshot: 'F8' } },
  { name: 'RPCS3', system: 'PlayStation 3', exes: ['rpcs3.exe'], gameArgs: '--no-gui "{rom}"', romExtensions: ['bin', 'iso', 'pkg'], hotkeys: { options: 'Shift+F10', saveState: 'Ctrl+S', pause: 'Ctrl+P', screenshot: 'F12' } },
  { name: 'Ryujinx', system: 'Nintendo Switch', exes: ['ryujinx.exe'], attached: true, gameArgs: '--fullscreen "{rom}"', romExtensions: ['nsp', 'xci', 'nsz', 'nca', 'nro'], hotkeys: { pause: 'F5', screenshot: 'F8' } },
  { name: 'Eden', system: 'Nintendo Switch', pattern: /^(eden|suyu|sudachi|citron|yuzu)\.exe$/i, gameArgs: '-f -g "{rom}"', romExtensions: ['nsp', 'xci', 'nca', 'nro'] },
  { name: 'ePSXe', system: 'PlayStation', exes: ['epsxe.exe'], gameArgs: '-nogui -loadbin "{rom}"', romExtensions: ['cue', 'bin', 'iso', 'img', 'mdf', 'pbp', 'ccd'] },
  { name: 'DuckStation', system: 'PlayStation', pattern: /^duckstation-qt.*\.exe$/i, gameArgs: '-batch -fullscreen "{rom}"', romExtensions: ['cue', 'bin', 'chd', 'iso', 'pbp', 'm3u', 'ecm', 'mds'], hotkeys: { options: 'Escape', saveState: 'F2', loadState: 'F1', pause: 'Space', screenshot: 'F10' } },
  { name: 'MAME', system: 'Arcade', exes: ['mame64.exe', 'mame32.exe', 'mame.exe'], gameArgs: '"{romname}"', romExtensions: ['zip', '7z', 'chd'] },
  { name: 'NeoRAGEx', system: 'Neo Geo', pattern: /^neoragex.*\.exe$/i, gameArgs: '"{romname}"', romExtensions: ['zip'] },
  { name: 'ZSNES', system: 'Super Nintendo', exes: ['zsnesw.exe', 'zsnes.exe'], gameArgs: '"{rom}"', romExtensions: ['sfc', 'smc', 'fig', 'swc', 'zip'] },
  { name: 'Snes9x', system: 'Super Nintendo', pattern: /^snes9x(-x64)?\.exe$/i, gameArgs: '-fullscreen "{rom}"', romExtensions: ['sfc', 'smc', 'zip'], hotkeys: { options: 'Alt+Return', saveState: 'Shift+F1', loadState: 'F1', pause: 'Pause', screenshot: 'F12' } },
  { name: 'Dolphin', system: 'GameCube / Wii', exes: ['dolphin.exe'], gameArgs: '-b -C Dolphin.Display.Fullscreen=True -e "{rom}"', romExtensions: ['iso', 'gcm', 'wbfs', 'rvz', 'ciso', 'gcz', 'wad', 'dol', 'elf'], hotkeys: { options: 'Alt+Return', saveState: 'Shift+F1', loadState: 'F1', pause: 'F10', screenshot: 'F9' } },
  { name: 'Cemu', system: 'Wii U', exes: ['cemu.exe'], gameArgs: '-f -g "{rom}"', romExtensions: ['wud', 'wux', 'rpx', 'wua', 'iso'] },
  { name: 'PPSSPP', system: 'PSP', pattern: /^ppssppwindows(64)?\.exe$/i, gameArgs: '--fullscreen "{rom}"', romExtensions: ['iso', 'cso', 'pbp', 'chd', 'elf'], hotkeys: { options: 'Escape', saveState: 'F2', loadState: 'F4', screenshot: 'F12' } },
  { name: 'Vita3K', system: 'PS Vita', exes: ['vita3k.exe'], gameArgs: '-F -r "{rom}"', romExtensions: ['vpk', 'zip'] },
  { name: 'shadPS4', system: 'PlayStation 4', exes: ['shadps4.exe'], gameArgs: '-g "{rom}"', romExtensions: ['bin'] },
  { name: 'xemu', system: 'Xbox', exes: ['xemu.exe'], gameArgs: '-full-screen -dvd_path "{rom}"', romExtensions: ['iso', 'xiso'], hotkeys: { options: 'F11' } },
  { name: 'Xenia', system: 'Xbox 360', pattern: /^xenia(_canary)?\.exe$/i, gameArgs: '--fullscreen "{rom}"', romExtensions: ['iso', 'xex', 'zar'] },
  { name: 'Azahar', system: 'Nintendo 3DS', pattern: /^(azahar|citra(-qt)?|lime3ds(-gui)?)\.exe$/i, gameArgs: '-f "{rom}"', romExtensions: ['3ds', 'cci', 'cxi', 'cia', '3dsx', 'app'] },
  { name: 'melonDS', system: 'Nintendo DS', exes: ['melonds.exe'], gameArgs: '-f "{rom}"', romExtensions: ['nds', 'zip', '7z'], hotkeys: { options: 'F11', saveState: 'Shift+F1', loadState: 'F1' } },
  { name: 'mGBA', system: 'Game Boy Advance', exes: ['mgba.exe'], gameArgs: '-f "{rom}"', romExtensions: ['gba', 'gb', 'gbc', 'zip', '7z'], hotkeys: { options: 'Ctrl+F', saveState: 'Shift+F1', loadState: 'F1', pause: 'Ctrl+P', screenshot: 'F12' } },
  { name: 'Project64', system: 'Nintendo 64', exes: ['project64.exe'], gameArgs: '"{rom}"', romExtensions: ['z64', 'n64', 'v64', 'zip'] },
  { name: 'Flycast', system: 'Dreamcast', exes: ['flycast.exe'], gameArgs: '"{rom}"', romExtensions: ['gdi', 'cdi', 'chd', 'cue'] },
  { name: 'Redream', system: 'Dreamcast', exes: ['redream.exe'], gameArgs: '"{rom}"', romExtensions: ['gdi', 'cdi', 'chd', 'cue'] },
  { name: 'Mesen', system: 'NES / SNES / Master System / PC Engine', exes: ['mesen.exe'], gameArgs: '"{rom}" --fullscreen', romExtensions: ['nes', 'unf', 'fds', 'sfc', 'smc', 'fig', 'swc', 'bs', 'sms', 'sg', 'gg', 'pce', 'sgx'], hotkeys: { options: 'F11', saveState: 'Shift+F1', loadState: 'F1', pause: 'Escape', screenshot: 'F12' } },
  { name: 'Stella', system: 'Atari 2600', exes: ['stella.exe'], gameArgs: '-baseinappdir -fullscreen 1 "{rom}"', romExtensions: ['a26', 'bin'], hotkeys: { options: 'Tab', saveState: 'F9', loadState: 'F11', pause: 'Pause', screenshot: 'F12' } },
  // ares: each game folder says which console ({ path, system: "Mega Drive" | "Mega 32X" | "Mega CD" | "Nintendo 64" })
  { name: 'ares', system: 'Multi-system', exes: ['ares.exe'], gameArgs: '--fullscreen --system "{system}" "{rom}"', romExtensions: ['md', 'bin', 'gen', 'smd', '32x', 'ngp', 'ngc'], hotkeys: { options: 'F11', saveState: 'F5', loadState: 'F7', pause: 'Pause', screenshot: 'F12', quit: 'F10' } },
  { name: 'RMG', system: 'Nintendo 64', exes: ['rmg.exe'], gameArgs: '-f -q "{rom}"', romExtensions: ['z64', 'n64', 'v64'], hotkeys: { options: 'Alt+Return', saveState: 'F5', loadState: 'F7', pause: 'F2', screenshot: 'F3' } },
  { name: 'Mednafen', system: 'Multi-system', exes: ['mednafen.exe'], gameArgs: '-video.fs 1 "{rom}"', romExtensions: ['cue', 'ccd', 'toc', 'm3u', 'pce', 'sgx', 'lnx', 'vb', 'ws', 'wsc', 'ngp', 'ngc', 'gg', 'sms', 'md', 'gen', 'nes', 'fds', 'gb', 'gbc', 'gba'], hotkeys: { saveState: 'F5', loadState: 'F7', pause: 'Pause', screenshot: 'F9', quit: 'F12' } },
  { name: 'jgenesis', system: 'Multi-system', exes: ['jgenesis.exe'], gameArgs: '--no-gui --config-override common.launch_in_fullscreen=true -f "{rom}"', romExtensions: ['md', 'gen', 'smd', 'bin', 'cue', 'chd', '32x', 'sms', 'gg', 'sg', 'nes', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'pce'], hotkeys: { saveState: 'F5', loadState: 'F6', pause: 'P' } },
  { name: 'puNES', system: 'NES', exes: ['punes64.exe', 'punes.exe'], gameArgs: '--portable -u yes "{rom}"', romExtensions: ['nes', 'fds', 'unf', 'unif', 'zip', '7z'], hotkeys: { options: 'Escape', saveState: 'F1', loadState: 'F4', pause: 'Pause', screenshot: 'Alt+X' } },
  { name: 'gopher64', system: 'Nintendo 64', exes: ['gopher64.exe'], gameArgs: '--fullscreen "{rom}"', romExtensions: ['z64', 'n64', 'v64', 'zip', '7z'], hotkeys: { saveState: 'F5', loadState: 'F7', pause: 'Alt+P' } },
  { name: 'VBA-M', system: 'Game Boy Advance', exes: ['visualboyadvance-m.exe'], gameArgs: '-f "{rom}"', romExtensions: ['gba', 'gb', 'gbc', 'sgb', 'zip', '7z'], hotkeys: { options: 'Alt+Return', saveState: 'Shift+F1', loadState: 'F1', pause: 'Pause' } },
  { name: 'BlastEm', system: 'Mega Drive', exes: ['blastem.exe'], gameArgs: '-f "{rom}"', romExtensions: ['md', 'gen', 'smd', 'bin', 'sms', 'gg', 'sg', 'cue', 'iso', 'chd'], hotkeys: { options: 'Escape', pause: 'F7', screenshot: 'P' } },
  { name: 'Ymir', system: 'Sega Saturn', exes: ['ymir-sdl3.exe'], gameArgs: '-f "{rom}"', romExtensions: ['chd', 'cue', 'ccd', 'iso', 'mds'], hotkeys: { options: 'F10', saveState: 'F2', loadState: 'F3', pause: 'Pause', screenshot: 'F12' } },
  { name: 'Supermodel', system: 'Sega Model 3', exes: ['supermodel.exe'], gameArgs: '"{rom}" -fullscreen', romExtensions: ['zip'], hotkeys: { saveState: 'F5', loadState: 'F7', pause: 'Alt+P' } },
  { name: 'Atari800', system: 'Atari 8-bit', exes: ['atari800.exe'], gameArgs: '-fullscreen "{rom}"', romExtensions: ['atr', 'xex', 'com', 'car', 'rom', 'a52', 'cas', 'xfd', 'atx'], hotkeys: { options: 'F1', saveState: 'Alt+S', loadState: 'Alt+L', screenshot: 'F10' } },
  { name: 'WinUAE', system: 'Amiga', exes: ['winuae64.exe', 'winuae.exe'], gameArgs: '-portable -s use_gui=no -s gfx_fullscreen_amiga=true -0 "{rom}"', romExtensions: ['adf', 'adz', 'dms', 'ipf', 'lha', 'hdf'], hotkeys: { options: 'F12', pause: 'Pause' } },
  { name: 'VICE', system: 'Commodore 64', exes: ['x64sc.exe'], gameArgs: '-VICIIfull -autostart "{rom}"', romExtensions: ['d64', 'd71', 'd81', 'g64', 't64', 'tap', 'prg', 'p00', 'crt'], hotkeys: { options: 'Alt+O', saveState: 'Alt+F11', loadState: 'Alt+F10', pause: 'Alt+P' } },
  { name: 'ZEsarUX', system: 'ZX Spectrum', exes: ['zesarux.exe'], gameArgs: '--configfile "{emudir}\\zesarux.cfg" --fullscreen --nowelcomemessage --quickexit "{rom}"', romExtensions: ['tap', 'tzx', 'pzx', 'z80', 'sna', 'szx', 'trd', 'scl', 'dsk'], hotkeys: { options: 'F5' } },
  { name: 'AppleWin', system: 'Apple II', exes: ['applewin.exe'], gameArgs: '-conf "{emudir}\\AppleWin.ini" -f -d1 "{rom}"', romExtensions: ['dsk', 'do', 'po', 'nib', 'woz', '2mg'], hotkeys: { options: 'F8', saveState: 'F11', loadState: 'F12', pause: 'Pause' } },
  { name: 'openMSX', system: 'MSX', exes: ['openmsx.exe'], gameArgs: '-cart "{rom}" -command "set fullscreen on"', romExtensions: ['rom', 'mx1', 'mx2', 'col'], hotkeys: { options: 'F10', saveState: 'Alt+F8', loadState: 'Alt+F7', pause: 'Pause' } },
  // DOS games: best as a folder with the game installed in _C and a <Game>.conf that mounts C:, the CD and
  // starts it (the CD images themselves are not listed: they only work through such a .conf)
  { name: 'DOSBox Staging', system: 'DOS', exes: ['dosbox.exe'], gameArgs: '--fullscreen "{rom}"', extArgs: { conf: '--fullscreen --conf "{rom}"' }, romExtensions: ['conf', 'exe', 'com', 'bat'], hotkeys: { pause: 'Alt+Pause', screenshot: 'Ctrl+F5' } },
  { name: 'x16emu', system: 'Commander X16', exes: ['x16emu.exe'], gameArgs: '-fullscreen -prg "{rom}" -run', romExtensions: ['prg'], hotkeys: { screenshot: 'Ctrl+P' } },
  { name: 'Ruffle', system: 'Flash', exes: ['ruffle.exe'], gameArgs: '--fullscreen "{rom}"', romExtensions: ['swf'], hotkeys: { pause: 'Ctrl+P' } },
  { name: 'BizHawk', system: 'Multi-system', exes: ['emuhawk.exe'], gameArgs: '"{rom}"', romExtensions: ['nes', 'sfc', 'gb', 'gba', 'n64', 'zip'] },
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^ï»¿/, '')); } catch { return null; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// All .exe files in a folder and one level below it (relative paths)
async function exesIn(dir) {
  const found = [];
  const walk = async (d, rel, depth) => {
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile() && /\.exe$/i.test(e.name)) found.push(path.join(rel, e.name));
      else if (e.isDirectory() && depth < 1) await walk(path.join(d, e.name), path.join(rel, e.name), depth + 1);
    }
  };
  await walk(dir, '', 0);
  return found;
}

function knownFor(exeName) {
  const n = exeName.toLowerCase();
  return KNOWN.find((k) => (k.exes && k.exes.includes(n)) || (k.pattern && k.pattern.test(n)));
}

// Works out a module for an emulator folder that doesn't have one yet
async function detect(dir, folderName) {
  const exes = (await exesIn(dir)).filter((e) => !NOT_THE_EMULATOR.test(path.basename(e)));
  if (!exes.length) return null;
  // A known emulator, preferring files in the folder itself and the preferred exe name
  let best = null;
  for (const k of KNOWN) {
    const hits = exes.filter((e) => knownFor(path.basename(e)) === k);
    if (!hits.length) continue;
    hits.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length ||
      (k.exes ? k.exes.indexOf(path.basename(a).toLowerCase()) - k.exes.indexOf(path.basename(b).toLowerCase()) : 0));
    best = { known: k, exe: hits[0] };
    break;
  }
  if (!best) {
    // Unknown emulator: the biggest program in the top folder
    let size = -1;
    for (const e of exes) {
      try { const s = fs.statSync(path.join(dir, e)).size; if (s > size) { size = s; best = { known: null, exe: e }; } } catch {}
    }
  }
  const k = best.known;
  return {
    name: k ? k.name : folderName,
    system: k ? k.system : '',
    exe: best.exe,
    args: '',
    gameArgs: k ? k.gameArgs : '"{rom}"',
    romExtensions: k ? k.romExtensions : [],
    romFolders: [],
    hidden: false,
    ...(k && k.hotkeys ? { hotkeys: k.hotkeys } : {}),
    ...(k && k.attached ? { attached: true } : {}),
    ...(k && k.extArgs ? { extArgs: k.extArgs } : {}),
  };
}

function normalise(mod, id, baseDir, moduleFile) {
  const exe = path.isAbsolute(mod.exe || '') ? mod.exe : path.join(baseDir, mod.exe || '');
  return {
    id,
    name: mod.name || id,
    system: mod.system || '',
    exe,
    args: mod.args || '',
    gameArgs: mod.gameArgs || '"{rom}"',
    // per file type, other start arguments: { conf: '--conf "{rom}"' }
    extArgs: mod.extArgs && typeof mod.extArgs === 'object' ? mod.extArgs : null,
    romExtensions: mod.romExtensions || [],
    romFolders: mod.romFolders || [],
    hidden: !!mod.hidden,
    hotkeys: mod.hotkeys || {},
    control: mod.control || '',
    closeSteps: mod.closeSteps || 1,      // MAME32: the 1st close ends the game, the 2nd closes the program
    holdToClose: mod.holdToClose || 0,    // seconds of holding PS that close it (no menu: MAME32 crashes under other windows)
    attached: !!mod.attached,             // start with the console of MediaDeck (Ryujinx crashes "detached")
    // Optional names file for games with short file names (MAME: "pacman=Pac Man (Midway)")
    gameNames: mod.gameNames ? path.resolve(baseDir, mod.gameNames) : '',
    gameNamesOnly: !!mod.gameNamesOnly,   // list only the games the names file knows (others don't run)
    // arcade: file name -> MAME short name, for box art (NeoRAGEx: "3countbout" -> "3countb")
    arcadeNames: mod.arcadeNames ? path.resolve(baseDir, mod.arcadeNames) : '',
    // ports / homebrew: box art from another console, { "file name": ["Sega - Saturn", "Sonic R (USA, Brazil)"] }
    coverFrom: mod.coverFrom && typeof mod.coverFrom === 'object' ? mod.coverFrom : null,
    // installed / updated from the install list: { version, stamp, date }
    installer: mod.installer && typeof mod.installer === 'object' ? mod.installer : null,
    moduleFile,
    dir: baseDir,
    ok: fs.existsSync(exe),
  };
}

// Folders that only sort emulators (by maker and console): "Nintendo", "Multi-system",
// "1994 - PlayStation", â€¦ They are looked into, never treated as an emulator themselves.
const GROUP_DIR = /^(\d{4} - .+|multi-system|nintendo|sony|sega|atari|snk|nec|arcade|microsoft|philips|bandai|commodore|sinclair|apple|msx|pc|commander|adobe|other)$/i;

// Reads every module (creating emu-module.json for new emulator folders). Emulators can sit
// directly in Emu_modules or in sorting folders (Sony\1994 - PlayStation\DuckStation).
// A module's id is its own folder name, so sorting it into other folders changes nothing.
async function scan(root, depth = 0) {
  if (!depth) fs.mkdirSync(root, { recursive: true });
  const out = [];
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const file = path.join(full, MODULE_FILE);
      let mod = readJson(file);
      if (!mod && GROUP_DIR.test(e.name)) {
        if (depth < 3) out.push(...(await scan(full, depth + 1)));
        continue;
      }
      if (!mod) {
        mod = await detect(full, e.name);
        if (!mod) continue;
        writeJson(file, mod);
      }
      out.push(normalise(mod, e.name, full, file));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(POINTER_SUFFIX)) {
      const mod = readJson(full);
      if (mod) out.push(normalise(mod, e.name.slice(0, -POINTER_SUFFIX.length), root, full));
    }
  }
  return out;
}

// Adds an emulator picked by its .exe: inside Emu_modules -> a module in its folder,
// anywhere else -> a <Name>.emu.json that points to it
async function add(root, exePath, name) {
  const rel = path.relative(root, exePath);
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel) && rel.includes(path.sep);
  const k = knownFor(path.basename(exePath));
  const mod = {
    name: name || (k ? k.name : path.basename(exePath, '.exe')),
    system: k ? k.system : '',
    exe: exePath,
    args: '',
    gameArgs: k ? k.gameArgs : '"{rom}"',
    romExtensions: k ? k.romExtensions : [],
    romFolders: [],
    hidden: false,
  };
  if (inside) {
    const folder = path.join(root, rel.split(path.sep)[0]);
    mod.exe = path.relative(folder, exePath);
    writeJson(path.join(folder, MODULE_FILE), mod);
    return path.basename(folder);
  }
  let id = mod.name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Emulator';
  let n = 2;
  while (fs.existsSync(path.join(root, id + POINTER_SUFFIX)) || fs.existsSync(path.join(root, id))) id = `${mod.name} ${n++}`;
  writeJson(path.join(root, id + POINTER_SUFFIX), mod);
  return id;
}

// Hides a module (nothing is deleted; set "hidden": false in its file to bring it back)
function setHidden(mod, hidden) {
  const data = readJson(mod.moduleFile) || {};
  data.hidden = hidden;
  writeJson(mod.moduleFile, data);
}

// Saves the folders where this emulator's games are
// Remembers which version the install list put in (for "Check for updates")
function setInstaller(mod, rec) {
  const data = readJson(mod.moduleFile) || {};
  data.installer = { version: rec.version || '', stamp: rec.stamp || '', date: new Date().toISOString().slice(0, 10) };
  writeJson(mod.moduleFile, data);
}

function setFolders(mod, folders) {
  const data = readJson(mod.moduleFile) || {};
  data.romFolders = folders;
  writeJson(mod.moduleFile, data);
}

// Games per ROM folder, counted with the real game scanner (multi-disc games and
// Switch updates count once)
async function countGames(mod) {
  const games = require('./games');
  const out = [];
  for (const f of mod.romFolders || []) {
    const p = games.folderPath(f);
    const exists = fs.existsSync(p);
    const list = exists ? await games.scanGames({ ...mod, romFolders: [f] }) : [];
    out.push({ folder: p, core: typeof f === 'object' ? f.core || '' : '', system: typeof f === 'object' ? f.system || '' : '', names: typeof f === 'object' ? f.names || '' : '', exists, games: list.length });
  }
  return out;
}

// Newer versions know more game file types: add them to existing modules
// (only adds, never removes what the user put there)
function addKnownExtensions(mod) {
  const k = knownFor(path.basename(mod.exe));
  if (!k) return;
  const data = readJson(mod.moduleFile);
  if (!data) return;
  const have = new Set((data.romExtensions || []).map((e) => e.toLowerCase()));
  const missing = k.romExtensions.filter((e) => !have.has(e));
  const addControls = (k.hotkeys && !data.hotkeys) || (k.control && !data.control);
  const addExtArgs = k.extArgs && Object.keys(k.extArgs).some((e) => !(data.extArgs && data.extArgs[e]));
  if (!missing.length && !addControls && !addExtArgs) return;
  if (addExtArgs) { data.extArgs = { ...k.extArgs, ...(data.extArgs || {}) }; mod.extArgs = data.extArgs; }
  data.romExtensions = [...(data.romExtensions || []), ...missing];
  // In-game overlay: hotkeys the emulator listens to (change them here if you change them there)
  if (k.hotkeys && !data.hotkeys) data.hotkeys = k.hotkeys;
  if (k.control && !data.control) data.control = k.control;
  mod.hotkeys = data.hotkeys || {};
  mod.control = data.control || '';
  writeJson(mod.moduleFile, data);
  mod.romExtensions = data.romExtensions;
}
module.exports = { scan, add, setHidden, setFolders, setInstaller, countGames, addKnownExtensions, MODULE_FILE, POINTER_SUFFIX };
