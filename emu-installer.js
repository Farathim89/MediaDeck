// Emulator installer: a catalog of the best emulators per console, downloaded from their
// official pages (latest version), unpacked into Emu_modules\<Maker>\<Year - Console>\<Name>,
// made portable, given their BIOS from the BIOS folder and pointed at the console's games.
//
// Sources:  { gh: 'owner/repo', asset: /regex/ }      latest GitHub release asset
//           { page: url, link: /regex/, base: url }    first link on an official download page
//           { json: url, pick: (j) => url }            an official update feed (Dolphin)
// Electron's own fs treats .asar files as folders (an app's resources\app.asar would be copied
// as a folder and fail); original-fs sees them as the plain files they are
const fs = process.versions.electron ? require('original-fs') : require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

// Consoles: where their emulators go, their games folder (under the games root) and BIOS folder
const CONSOLES = [
  { id: 'nes', name: 'NES', maker: 'Nintendo', folder: 'Nintendo\\1983 - NES', games: ['Nintendo 8-Bit'], emus: ['mesen', 'punes', 'jgenesis', 'retroarch'] },
  { id: 'snes', name: 'Super Nintendo', maker: 'Nintendo', folder: 'Nintendo\\1990 - Super Nintendo', games: ['Nintendo Snes'], emus: ['mesen', 'snes9x', 'bsnes', 'jgenesis', 'retroarch'] },
  { id: 'n64', name: 'Nintendo 64', maker: 'Nintendo', folder: 'Nintendo\\1996 - Nintendo 64', games: ['Nintendo 64'], emus: ['rmg', 'simple64', 'gopher64', 'ares', 'retroarch'] },
  { id: 'gb', name: 'Game Boy / Color / Advance', maker: 'Nintendo', folder: 'Nintendo\\2001 - Game Boy Advance', games: ['GameBoy', 'GameBoy Color', 'GameBoy Advance'], bios: 'Nintendo - Game Boy Advance', emus: ['mgba', 'vbam', 'jgenesis', 'retroarch'] },
  { id: 'gcwii', name: 'GameCube & Wii', maker: 'Nintendo', folder: 'Nintendo\\2001 - GameCube & Wii', games: ['Nintendo GameCube', 'Nintendo WII'], emus: ['dolphin'] },
  { id: 'nds', name: 'Nintendo DS', maker: 'Nintendo', folder: 'Nintendo\\2004 - Nintendo DS', games: ['Nintendo Ds'], emus: ['melonds', 'retroarch'] },
  { id: '3ds', name: 'Nintendo 3DS', maker: 'Nintendo', folder: 'Nintendo\\2011 - Nintendo 3DS', games: ['Nintendo 3Ds'], emus: ['azahar'] },
  { id: 'ps1', name: 'PlayStation', maker: 'Sony', folder: 'Sony\\1994 - PlayStation', games: ['PlayStation'], bios: 'Sony - PlayStation', emus: ['duckstation', 'retroarch'] },
  { id: 'ps2', name: 'PlayStation 2', maker: 'Sony', folder: 'Sony\\2000 - PlayStation 2', games: ['PlayStation 2'], bios: 'Sony - PlayStation 2', emus: ['pcsx2'] },
  { id: 'psp', name: 'PSP', maker: 'Sony', folder: 'Sony\\2004 - PSP', games: ['PlayStation Portable'], emus: ['ppsspp'] },
  { id: 'ps3', name: 'PlayStation 3', maker: 'Sony', folder: 'Sony\\2006 - PlayStation 3', games: ['PlayStation 3'], emus: ['rpcs3'] },
  { id: 'vita', name: 'PS Vita', maker: 'Sony', folder: 'Sony\\2011 - PS Vita', games: ['PlayStation Vita', 'PS Vita'], emus: ['vita3k'] },
  { id: 'ps4', name: 'PlayStation 4', maker: 'Sony', folder: 'Sony\\2013 - PlayStation 4', games: ['PlayStation 4'], emus: ['shadps4'] },
  { id: 'wiiu', name: 'Wii U', maker: 'Nintendo', folder: 'Nintendo\\2012 - Wii U', games: ['Nintendo Wii U', 'Nintendo WiiU', 'Wii U'], emus: ['cemu'] },
  { id: 'sms', name: 'Master System / SG-1000', maker: 'Sega', folder: 'Sega\\1985 - Master System', games: ['Sega Master System', 'Sega SG-1000'], emus: ['mesen', 'jgenesis', 'retroarch'] },
  { id: 'md', name: 'Mega Drive / 32X / Sega CD', maker: 'Sega', folder: 'Sega\\1988 - Mega Drive', games: ['Sega Mega Drive (Sega Genesis)', 'Sega 32X', 'SEGA CD'], bios: 'Sega - Mega CD - Sega CD', emus: ['ares', 'blastem', 'jgenesis', 'retroarch'] },
  { id: 'saturn', name: 'Saturn', maker: 'Sega', folder: 'Sega\\1994 - Saturn', games: ['Sega Saturn'], bios: 'Sega - Saturn', emus: ['mednafen', 'ymir'] },
  { id: 'dc', name: 'Dreamcast', maker: 'Sega', folder: 'Sega\\1999 - Dreamcast', games: ['Sega Dreamcast'], bios: 'Sega - Dreamcast', emus: ['flycast', 'retroarch'] },
  { id: 'pce', name: 'PC Engine / TurboGrafx-16', maker: 'NEC', folder: 'NEC\\1987 - PC Engine', games: ['TurboGrafx-16 (PC Engine)'], emus: ['mesen', 'mednafen', 'jgenesis', 'retroarch'] },
  { id: 'ngp', name: 'Neo Geo Pocket', maker: 'SNK', folder: 'SNK\\1998 - Neo Geo Pocket', games: ['SNK Neo Geo Pocket', 'SNK Neo Geo Pocket Color'], bios: 'SNK - Neo Geo Pocket', emus: ['ares', 'mednafen'] },
  { id: 'a2600', name: 'Atari 2600', maker: 'Atari', folder: 'Atari\\1977 - Atari 2600', games: ['Atari 2600'], emus: ['stella'] },
  { id: 'xbox', name: 'Xbox', maker: 'Microsoft', folder: 'Microsoft\\2001 - Xbox', games: ['Xbox'], bios: 'Microsoft - Xbox', emus: ['xemu'] },
  { id: 'x360', name: 'Xbox 360', maker: 'Microsoft', folder: 'Microsoft\\2005 - Xbox 360', games: ['Xbox 360'], emus: ['xenia'] },
  { id: 'gg', name: 'Game Gear', maker: 'Sega', folder: 'Sega\\1990 - Game Gear', games: ['Sega Game Gear'], bios: 'Sega - Game Gear', emus: ['mesen', 'mednafen', 'retroarch'] },
  { id: 'lynx', name: 'Atari Lynx', maker: 'Atari', folder: 'Atari\\1989 - Lynx', games: ['Atari Lynx'], bios: 'Atari - Lynx', emus: ['mednafen'] },
  { id: 'a800', name: 'Atari 8-bit / 5200', maker: 'Atari', folder: 'Atari\\1979 - Atari 8-bit', games: ['Atari 800', 'Atari 8-bit', 'Atari 5200'], emus: ['atari800'] },
  { id: 'vb', name: 'Virtual Boy', maker: 'Nintendo', folder: 'Nintendo\\1995 - Virtual Boy', games: ['Nintendo Virtual Boy'], emus: ['mednafen'] },
  { id: 'wswan', name: 'WonderSwan / Color', maker: 'Bandai', folder: 'Bandai\\1999 - WonderSwan', games: ['Bandai WonderSwan', 'Bandai WonderSwan Color'], emus: ['mednafen'] },
  { id: 'pcfx', name: 'PC-FX', maker: 'NEC', folder: 'NEC\\1994 - PC-FX', games: ['NEC PC-FX'], bios: 'NEC - PC-FX', emus: ['mednafen'] },
  { id: 'model3', name: 'Sega Model 3', maker: 'Arcade', folder: 'Arcade\\1996 - Sega Model 3', games: ['Sega Model 3'], emus: ['supermodel'] },
  { id: 'amiga', name: 'Amiga', maker: 'Commodore', folder: 'Commodore\\1985 - Amiga', games: ['Commodore Amiga', 'Amiga'], bios: 'Commodore - Amiga', emus: ['winuae'] },
  // CD32: its own WinUAE copy that starts a disc in CD32 mode (needs the CD32 Kickstart + extended ROM in BIOS)
  { id: 'cd32', name: 'Amiga CD32', maker: 'Commodore', folder: 'Commodore\\1993 - Amiga CD32', games: ['Amiga CD32', 'Commodore Amiga CD32', 'CD32'], bios: 'Commodore - Amiga CD32', emus: ['winuae-cd32'] },
  { id: 'c64', name: 'Commodore 64', maker: 'Commodore', folder: 'Commodore\\1982 - Commodore 64', games: ['Commodore 64', 'C64'], emus: ['vice'] },
  { id: 'zx', name: 'ZX Spectrum', maker: 'Sinclair', folder: 'Sinclair\\1982 - ZX Spectrum', games: ['Sinclair ZX Spectrum', 'ZX Spectrum'], emus: ['zesarux'] },
  { id: 'apple2', name: 'Apple II', maker: 'Apple', folder: 'Apple\\1977 - Apple II', games: ['Apple II'], emus: ['applewin'] },
  { id: 'msx', name: 'MSX / ColecoVision', maker: 'MSX', folder: 'MSX\\1983 - MSX', games: ['MSX', 'MSX2', 'ColecoVision'], emus: ['openmsx'] },
  { id: 'dos', name: 'DOS', maker: 'PC', folder: 'PC\\1981 - DOS', games: ['DOS', 'MS-DOS'], emus: ['dosbox'] },
  { id: 'x16', name: 'Commander X16', maker: 'Commander', folder: 'Commander\\2023 - Commander X16', games: ['Commander X16'], emus: ['x16emu'] },
  { id: 'flash', name: 'Flash games', maker: 'Adobe', folder: 'Adobe\\1996 - Flash', games: ['Flash'], emus: ['ruffle'] },
  { id: 'arcade', name: 'Arcade', maker: 'Arcade', folder: 'Arcade\\MAME', games: ['Arcade', 'MAME'], emus: ['mame'] },
];

// Emulators. exe: the program to look for after unpacking. multi: shared by several consoles
// (goes to Multi-system). portable: files that make it keep its settings in its own folder.
const EMULATORS = {
  // a second WinUAE that starts CD32 discs; module: the emu-module.json it gets (not the Amiga one)
  'winuae-cd32': { name: 'WinUAE', desc: 'Amiga CD32 (needs the CD32 Kickstart 40.060 and its extended ROM)', exe: /^winuae64\.exe$/i,
    src: { page: 'https://www.winuae.net/download/', link: /https:\/\/download\.abime\.net\/winuae\/releases\/WinUAE\d+_x64\.zip/, ver: (l) => (/WinUAE(\d)(\d)(\d)/.exec(l) || []).slice(1).join('.') }, portable: ['winuae.ini'], biosTo: 'Roms', biosFiles: /\.(rom|bin|cd32|ext)$/i,
    module: { system: 'Amiga CD32', exe: 'winuae64.exe', gameArgs: '-portable -s use_gui=no -s gfx_fullscreen_amiga=true -s quickstart=cd32,0 -s "cdimage0={rom},image"', romExtensions: ['cue', 'iso', 'chd', 'ccd'], hotkeys: { options: 'F12', pause: 'Pause' } } },
  mesen: { name: 'Mesen', desc: 'Accurate NES, SNES, Master System and PC Engine', exe: /^mesen\.exe$/i, multi: true,
    src: { gh: 'SourMesen/Mesen2', asset: /_Windows\.zip$/i } },
  snes9x: { name: 'Snes9x', desc: 'Fast, well-known Super Nintendo emulator', exe: /^snes9x-x64\.exe$/i,
    src: { gh: 'snes9xgit/snes9x', asset: /win32-x64\.zip$/i } },
  bsnes: { name: 'bsnes', desc: 'Very accurate Super Nintendo', exe: /^bsnes\.exe$/i,
    src: { gh: 'bsnes-emu/bsnes', asset: /windows\.zip$/i } },
  rmg: { name: 'RMG', desc: "Rosalie's Mupen GUI: the best N64 emulator", exe: /^rmg\.exe$/i,
    src: { gh: 'Rosalie241/RMG', asset: /Portable-Windows64.*\.zip$/i }, portable: ['portable.txt'] },
  simple64: { name: 'simple64', desc: 'Accurate N64 (needs a strong PC)', exe: /^simple64-gui\.exe$/i,
    src: { gh: 'simple64/simple64', asset: /win64.*\.zip$/i } },
  ares: { name: 'ares', desc: 'Accurate multi-system: Mega Drive, 32X, Sega CD, N64, Neo Geo Pocket', exe: /^ares\.exe$/i, multi: true,
    src: { gh: 'ares-emulator/ares', asset: /^ares-windows-x64\.zip$/i } },
  mgba: { name: 'mGBA', desc: 'The best Game Boy / Color / Advance emulator', exe: /^mgba\.exe$/i,
    src: { gh: 'mgba-emu/mgba', asset: /win64\.7z$/i }, portable: ['portable.ini'] },
  dolphin: { name: 'Dolphin', desc: 'GameCube and Wii', exe: /^dolphin\.exe$/i,
    src: { json: 'https://dolphin-emu.org/update/latest/beta', pick: (j) => (j.artifacts.find((a) => /windows x64/i.test(a.system)) || {}).url }, portable: ['portable.txt'] },
  melonds: { name: 'melonDS', desc: 'Nintendo DS', exe: /^melonds\.exe$/i,
    src: { gh: 'melonDS-emu/melonDS', asset: /windows-x86_64\.zip$/i } },
  azahar: { name: 'Azahar', desc: 'Nintendo 3DS (Citra / Lime3DS continued)', exe: /^azahar\.exe$/i,
    src: { gh: 'azahar-emu/azahar', asset: /^azahar-windows-msvc-[\d.]+\.zip$/i }, portable: ['user/'] },
  duckstation: { name: 'DuckStation', desc: 'The best PlayStation emulator', exe: /^duckstation-qt.*\.exe$/i,
    src: { gh: 'stenzek/duckstation', asset: /windows-x64-release\.zip$/i }, portable: ['portable.txt'], biosTo: 'bios', biosFiles: /^scph.*\.bin$/i },
  pcsx2: { name: 'PCSX2', desc: 'PlayStation 2', exe: /^pcsx2-qt\.exe$/i,
    src: { gh: 'PCSX2/pcsx2', asset: /windows-x64-Qt\.7z$/i }, portable: ['portable.ini'], biosTo: 'bios', biosFiles: /\.(bin|rom0|rom1|nvm|mec)$/i },
  ppsspp: { name: 'PPSSPP', desc: 'PSP', exe: /^ppssppwindows64\.exe$/i,
    src: { page: 'https://www.ppsspp.org/download/', link: /files\/[0-9_]+\/ppsspp_win\.zip/, base: 'https://www.ppsspp.org/' } },
  rpcs3: { name: 'RPCS3', desc: 'PlayStation 3 (install the PS3 firmware from its menu)', exe: /^rpcs3\.exe$/i,
    src: { gh: 'RPCS3/rpcs3-binaries-win', asset: /win64.*\.7z$/i } },
  flycast: { name: 'Flycast', desc: 'The best Dreamcast emulator', exe: /^flycast\.exe$/i,
    src: { gh: 'flyinghead/flycast', asset: /win64.*\.zip$/i }, portable: ['emu.cfg'], biosTo: 'data', biosFiles: /^dc_(boot|flash)\.bin$/i },
  mednafen: { name: 'Mednafen', desc: 'Accurate Saturn, PC Engine, Neo Geo Pocket', exe: /^mednafen\.exe$/i, multi: true,
    src: { page: 'https://mednafen.github.io/releases/', link: /files\/mednafen-[\d.]+-win64\.zip/, base: 'https://mednafen.github.io/releases/' },
    biosTo: 'firmware', biosFiles: /^(sega_101\.bin|mpr-17933\.bin|lynxboot\.img|pcfx\.rom|syscard3\.pce|scph550[012]\.bin|disksys\.rom)$/i },
  jgenesis: { name: 'jgenesis', desc: 'Accurate multi-system: Mega Drive, Sega CD, 32X, NES, SNES, Game Boy, PC Engine', exe: /^jgenesis\.exe$/i, multi: true,
    src: { gh: 'jsgroth/jgenesis', asset: /^jgenesis-[\d.]+-windows-x86_64\.zip$/i }, portable: ['portable.txt'] },
  punes: { name: 'puNES', desc: 'Very accurate NES / Famicom / FDS', exe: /^punes64\.exe$/i,
    src: { gh: 'punesemu/puNES', asset: /^punes-[\d.]+-x86_64-win-opengl\.zip$/i }, portable: ['puNES.cfg'] },
  gopher64: { name: 'gopher64', desc: 'Accurate, simple N64 emulator', exe: /^gopher64\.exe$/i, bare: 'gopher64.exe',
    src: { gh: 'gopher64/gopher64', asset: /^gopher64-windows-x86_64\.exe$/i }, portable: ['portable.txt'] },
  vbam: { name: 'VBA-M', desc: 'VisualBoyAdvance-M: Game Boy / Color / Advance', exe: /^visualboyadvance-m\.exe$/i,
    src: { gh: 'visualboyadvance-m/visualboyadvance-m', asset: /^visualboyadvance-m-Win-x86_64\.zip$/i }, portable: ['vbam.ini'] },
  blastem: { name: 'BlastEm', desc: 'Very accurate Mega Drive (also Master System, Sega CD)', exe: /^blastem\.exe$/i,
    src: { page: 'https://www.retrodev.com/blastem/downloads.html', link: /blastem-win64-[\d.]+\.zip/, base: 'https://www.retrodev.com/blastem/' } },
  ymir: { name: 'Ymir', desc: 'New, accurate Saturn emulator (needs an AVX2 processor)', exe: /^ymir-sdl3\.exe$/i,
    src: { gh: 'ymir-emu/Ymir', asset: /^ymir-windows-x86_64-AVX2-v[\d.]+\.zip$/i }, portable: ['Ymir.toml'], biosTo: 'roms/ipl', biosFiles: /^(sega_101|mpr-17933)\.bin$/i },
  supermodel: { name: 'Supermodel', desc: 'Sega Model 3 arcade (Daytona USA 2, Virtua Fighter 3)', exe: /^supermodel\.exe$/i,
    src: { gh: 'trzy/Supermodel', asset: /-windows\.zip$/i } },
  atari800: { name: 'Atari800', desc: 'Atari 400/800/XL/XE and 5200', exe: /^atari800\.exe$/i,
    src: { gh: 'atari800/atari800', asset: /^atari800-[\d.]+-win64\.zip$/i } },
  winuae: { name: 'WinUAE', desc: 'Amiga (a free Kickstart replacement is built in)', exe: /^winuae64\.exe$/i,
    src: { page: 'https://www.winuae.net/download/', link: /https:\/\/download\.abime\.net\/winuae\/releases\/WinUAE\d+_x64\.zip/, ver: (l) => (/WinUAE(\d)(\d)(\d)/.exec(l) || []).slice(1).join('.') }, portable: ['winuae.ini'], biosTo: 'Roms', biosFiles: /\.(rom|bin)$/i },
  vice: { name: 'VICE', desc: 'Commodore 64 (also C128, VIC-20, PET, Plus/4)', exe: /^x64sc\.exe$/i, up: 1,
    src: { gh: 'VICE-Team/svn-mirror', asset: /^GTK3VICE-[\d.]+-win64\.zip$/i }, portable: ['bin/vice.ini'] },
  zesarux: { name: 'ZEsarUX', desc: 'ZX Spectrum (all models), ZX81, SAM Coupe', exe: /^zesarux\.exe$/i,
    src: { gh: 'chernandezba/zesarux', asset: /^ZEsarUX_windows-[\d.]+\.zip$/i }, portable: ['zesarux.cfg'] },
  applewin: { name: 'AppleWin', desc: 'Apple II / IIe', exe: /^applewin\.exe$/i,
    src: { gh: 'AppleWin/AppleWin', asset: /^AppleWin[\d.]+\.zip$/i }, portable: ['AppleWin.ini'] },
  openmsx: { name: 'openMSX', desc: 'MSX (free C-BIOS built in: cartridges run without a BIOS)', exe: /^openmsx\.exe$/i,
    src: { gh: 'openMSX/openMSX', asset: /^openmsx-[\d.]+-windows-vc-x64-bin\.zip$/i } },
  dosbox: { name: 'DOSBox Staging', desc: 'DOS games', exe: /^dosbox\.exe$/i,
    src: { gh: 'dosbox-staging/dosbox-staging', asset: /^dosbox-staging-windows-x64-v[\d.]+\.zip$/i }, portable: ['dosbox-staging.conf'] },
  x16emu: { name: 'x16emu', desc: 'Commander X16 (official emulator)', exe: /^x16emu\.exe$/i,
    src: { gh: 'X16Community/x16-emulator', asset: /^x16emu_win64-r\d+\.zip$/i } },
  ruffle: { name: 'Ruffle', desc: 'Flash games (.swf)', exe: /^ruffle\.exe$/i,
    src: { gh: 'ruffle-rs/ruffle', asset: /^ruffle-[\d.]+-windows-x86_64\.zip$/i } },
  stella: { name: 'Stella', desc: 'Atari 2600', exe: /^stella\.exe$/i,
    src: { gh: 'stella-emu/stella', asset: /windows\.zip$/i } },
  xemu: { name: 'xemu', desc: 'Original Xbox (needs the Xbox BIOS / HDD image)', exe: /^xemu\.exe$/i,
    src: { gh: 'xemu-project/xemu', asset: /^xemu-[\d.]+-windows-x86_64\.zip$/i },
    biosTo: 'bios', biosFiles: /^(mcpx_1\.0\.bin|Complex_4627\.bin|xbox_hdd\.qcow2|xbox_eeprom\.bin)$/i },
  cemu: { name: 'Cemu', desc: 'Wii U', exe: /^cemu\.exe$/i,
    src: { gh: 'cemu-project/Cemu', asset: /windows-x64\.zip$/i }, portable: ['portable/'] },
  vita3k: { name: 'Vita3K', desc: 'PS Vita (install the PS Vita firmware from its menu)', exe: /^vita3k\.exe$/i,
    src: { gh: 'Vita3K/Vita3K', asset: /^windows-latest\.zip$/i } },
  shadps4: { name: 'shadPS4', desc: 'PlayStation 4 (early: few games run)', exe: /^shadps4\.exe$/i,
    src: { gh: 'shadps4-emu/shadPS4', asset: /win64.*\.zip$/i } },
  xenia: { name: 'Xenia', desc: 'Xbox 360 (Canary build)', exe: /^xenia_canary\.exe$/i,
    src: { gh: 'xenia-canary/xenia-canary-releases', asset: /windows.*\.zip$/i }, portable: ['portable.txt'] },
  mame: { name: 'MAME', desc: 'Arcade (current MAME; needs matching ROM sets)', exe: /^mame\.exe$/i,
    src: { gh: 'mamedev/mame', asset: /b_x64\.exe$/i } },
  retroarch: { name: 'RetroArch', desc: 'All-in-one (cores); used where no standalone exists', exe: /^retroarch\.exe$/i, multi: true,
    src: { page: 'https://www.retroarch.com/?page=platforms', link: /https:\/\/buildbot\.libretro\.com\/stable\/[\d.]+\/windows\/x86_64\/RetroArch\.7z/ } },
};

// ---- where things are ---------------------------------------------------------------------
function targetDir(emuDir, emuId, consoleId) {
  const e = EMULATORS[emuId];
  if (e.multi) return path.join(emuDir, 'Multi-system', e.name);
  const c = CONSOLES.find((x) => x.id === consoleId);
  return path.join(emuDir, c.folder, e.name);
}

// What the catalog looks like right now: per console, its emulators and whether each is installed
function catalog(installedModules) {
  const have = new Set(installedModules.map((m) => String(m.name || '').toLowerCase()));
  return CONSOLES.map((c) => ({
    id: c.id, name: c.name, maker: c.maker,
    emulators: c.emus.map((id) => ({ id, name: EMULATORS[id].name, desc: EMULATORS[id].desc, installed: have.has(EMULATORS[id].name.toLowerCase()) })),
  }));
}

// ---- downloading ---------------------------------------------------------------------------
// The latest release on GitHub. The API allows 60 questions an hour per PC; when it says no,
// the normal release pages (no such limit) give the same tag and file names, without dates.
async function githubLatest(gh, net) {
  const r = await net.fetch(`https://api.github.com/repos/${gh}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.ok) { const j = await r.json(); return { tag: j.tag_name, body: j.body || '', assets: (j.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, date: a.updated_at || '', digest: a.digest || '' })) }; }
  if (r.status !== 403 && r.status !== 429) throw new Error(`GitHub: ${r.status}`);
  const page = await net.fetch(`https://github.com/${gh}/releases/latest`);
  const tag = decodeURIComponent((/\/releases\/tag\/([^/?#]+)/.exec(page.url || '') || [])[1] || '');
  if (!tag) throw new Error('GitHub: no release found');
  const html = await (await net.fetch(`https://github.com/${gh}/releases/expanded_assets/${encodeURIComponent(tag)}`)).text();
  const assets = [];
  const re = /href="(\/[^"]+\/releases\/download\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) assets.push({ name: decodeURIComponent(m[1].split('/').pop()), url: 'https://github.com' + m[1], size: 0, date: '' });
  return { tag, assets };
}

// Two stamps of the same download (tag|file|date): the date only counts when both have one
function sameStamp(a, b) {
  const x = String(a || '').split('|'), y = String(b || '').split('|');
  if (x.length < 2 || y.length < 2) return a === b;
  return x[0] === y[0] && x[1] === y[1] && (!x[2] || !y[2] || x[2] === y[2]);
}

async function resolveUrl(src, net) {
  if (src.gh) {
    const j = await githubLatest(src.gh, net);
    const a = j.assets.find((x) => src.asset.test(x.name));
    if (!a) throw new Error('No Windows download in the latest release');
    // stamp: changes with every new build, also for "latest" / "continuous" tags
    const version = /^(latest|continuous|nightly)$/i.test(j.tag) ? (a.date || '').slice(0, 10) || j.tag
      : /^build-/i.test(j.tag) ? ((/v[\d.]+-\d+/.exec(a.name) || [])[0] || j.tag.slice(0, 14)) : j.tag;
    return { url: a.url, version, size: a.size, stamp: `${j.tag}|${a.name}|${a.date}` };
  }
  if (src.json) {
    const j = await (await net.fetch(src.json)).json();
    const url = src.pick(j);
    if (!url) throw new Error('No Windows download found');
    return { url, version: j.shortrev || '', stamp: url };
  }
  const html = await (await net.fetch(src.page)).text();
  const m = src.link.exec(html);
  if (!m) throw new Error('No download link on the page');
  const url = /^https?:/.test(m[0]) ? m[0] : new URL(m[0], src.base || src.page).href;
  const version = src.ver ? src.ver(m[0]) : (/[\d]+[._][\d._]*\d/.exec(m[0]) || [''])[0].replace(/_/g, '.');
  return { url, version, stamp: url };
}

async function download(url, file, net, onBytes) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  const reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
    onBytes(got, total);
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
}

function unpack(sevenZip, archive, dest) {
  return new Promise((resolve, reject) => {
    execFile(sevenZip, ['x', '-y', `-o${dest}`, archive], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) reject(new Error(`Unpacking failed: ${String(errOut || err.message).trim().split('\n').pop()}`)); else resolve();
    });
  });
}

// The folder that holds the emulator's exe (archives often have a top folder of their own)
async function findExeDir(dir, re, depth = 0) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && re.test(e.name))) return dir;
  if (depth >= 3) return null;
  for (const e of entries) if (e.isDirectory()) { const f = await findExeDir(path.join(dir, e.name), re, depth + 1); if (f) return f; }
  return null;
}

// Unpacks a download and returns the folder to install: the one with the program, or its parent
// for programs in a bin folder (up: 1). A download that is the program itself is just named.
async function unpackTo(e, sevenZip, archive, out) {
  if (e.bare) { await fsp.mkdir(out, { recursive: true }); await fsp.copyFile(archive, path.join(out, e.bare)); return out; }
  await unpack(sevenZip, archive, out);
  let dir = await findExeDir(out, e.exe);
  if (!dir) throw new Error(`${e.name}: the program wasn't found in the download`);
  for (let i = 0; i < (e.up || 0); i++) dir = path.dirname(dir);
  return dir;
}

async function moveAll(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const name of await fsp.readdir(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    try { await fsp.rename(a, b); } catch { await fsp.cp(a, b, { recursive: true, force: false, errorOnExist: false }); }
  }
}

// A console's games folder under the games root: directly, or inside a maker folder
function gameFolders(root, name) {
  if (!root) return [];
  const out = [];
  if (fs.existsSync(path.join(root, name))) out.push(path.join(root, name));
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(root, d.name, name))) out.push(path.join(root, d.name, name));
    }
  } catch {}
  return out;
}

// ---- install ---------------------------------------------------------------------------------
// opts: { emuDir, gamesRoot, biosDir, tempDir, sevenZip, net, progress(text, pct) }
async function install(emuId, consoleId, opts) {
  const e = EMULATORS[emuId];
  if (!e) throw new Error('Unknown emulator');
  const dest = targetDir(opts.emuDir, emuId, consoleId);
  if (fs.existsSync(dest) && (await fsp.readdir(dest)).length) throw new Error(`${e.name} is already in ${path.relative(opts.emuDir, dest)}`);
  const say = opts.progress || (() => {});
  say(`${e.name}: finding the latest version…`, 0);
  const { url, version, stamp } = await resolveUrl(e.src, opts.net);
  const work = path.join(opts.tempDir, `emu-install-${emuId}-${Date.now()}`);
  await fsp.mkdir(work, { recursive: true });
  try {
    const archive = path.join(work, decodeURIComponent(url.split('/').pop().split('?')[0]) || 'download');
    await download(url, archive, opts.net, (got, total) => say(`${e.name} ${version}: downloading ${Math.round(got / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? got / total : 0));
    say(`${e.name}: unpacking…`, 1);
    const out = path.join(work, 'out');
    const exeDir = await unpackTo(e, opts.sevenZip, archive, out);
    await moveAll(exeDir, dest);
    // keep its settings in its own folder
    for (const p of e.portable || []) {
      const f = path.join(dest, p);
      if (p.endsWith('/')) await fsp.mkdir(f, { recursive: true });
      else if (!fs.existsSync(f)) { await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, ''); }
    }
    // an emulator with its own module settings (WinUAE for CD32): written now, so the Amiga defaults aren't used
    if (e.module && !fs.existsSync(path.join(dest, 'emu-module.json'))) {
      await fsp.writeFile(path.join(dest, 'emu-module.json'), JSON.stringify({ name: e.name + (e.module.system ? ` (${e.module.system})` : ''), args: '', romFolders: [], ...e.module }, null, 2));
    }
    // BIOS from the central BIOS folder (copies; nothing moved)
    const c = CONSOLES.find((x) => x.id === consoleId);
    let biosCopied = 0;
    if (e.biosTo && c && c.bios && opts.biosDir) {
      const from = path.join(opts.biosDir, c.bios);
      if (fs.existsSync(from)) {
        const to = path.join(dest, e.biosTo);
        await fsp.mkdir(to, { recursive: true });
        for (const f of await fsp.readdir(from)) {
          if (e.biosFiles.test(f) && !fs.existsSync(path.join(to, f))) { await fsp.copyFile(path.join(from, f), path.join(to, f)); biosCopied++; }
        }
      }
    }
    // the console's game folders (those that exist)
    const romFolders = [];
    for (const cc of e.multi ? CONSOLES.filter((x) => x.emus.includes(emuId)) : [c]) {
      for (const g of cc.games || []) romFolders.push(...gameFolders(opts.gamesRoot, g));
    }
    say(`${e.name} ${version} installed`, 1);
    return { name: e.name, version, stamp, emuId, dir: dest, biosCopied, romFolders: [...new Set(romFolders)] };
  } finally {
    fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- updates -------------------------------------------------------------------------------
// Which catalog emulator an installed module is (by name)
// …and only when its program is the one the download has (MAME32's mame32.exe is not modern MAME)
const emuIdOf = (mod) => Object.keys(EMULATORS).find((id) => EMULATORS[id].name.toLowerCase() === String(mod.name || '').toLowerCase()
  && EMULATORS[id].exe.test(path.basename(String(mod.exe || '')))) || null;

// For each installed emulator we know: its recorded version and the latest one
async function checkUpdates(mods, net) {
  const out = [];
  await Promise.all(mods.filter((m) => !m.hidden && emuIdOf(m)).map(async (m) => {
    const id = emuIdOf(m);
    const rec = m.installer || {};
    try {
      const latest = await resolveUrl(EMULATORS[id].src, net);
      out.push({ moduleId: m.id, emuId: id, name: EMULATORS[id].name, installed: rec.version || '', latest: latest.version,
        update: !rec.stamp || !sameStamp(rec.stamp, latest.stamp), known: !!rec.stamp });
    } catch (err) { out.push({ moduleId: m.id, emuId: id, name: EMULATORS[id].name, installed: rec.version || '', error: err.message, update: false }); }
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Settings, saves, BIOS and anything you made stay: the files the download has are replaced
// (the old ones go to "Emulator backups"), new files are added, nothing else is touched.
// Settings files next to the program (portable configs) are kept; resources in sub folders
// (shaders, game databases) must match the new program, so they are replaced.
const SETTINGS_FILE = /\.(ini|cfg|conf|json|xml|txt)$/i;
async function overlay(from, to, backup, counts, top = true) {
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) { await fsp.mkdir(b, { recursive: true }); await overlay(a, b, path.join(backup, entry.name), counts, false); continue; }
    if (!fs.existsSync(b)) { await fsp.copyFile(a, b); counts.added++; continue; }
    if (top && SETTINGS_FILE.test(entry.name)) { counts.kept++; continue; }
    await fsp.mkdir(backup, { recursive: true });
    await fsp.copyFile(b, path.join(backup, entry.name));
    await fsp.copyFile(a, b);
    counts.replaced++;
  }
}
// mod: the installed module (dir = its folder, exe = its program)
async function update(mod, opts) {
  const id = emuIdOf(mod);
  if (!id) throw new Error(`${mod.name} isn't in the install list`);
  const e = EMULATORS[id];
  const say = opts.progress || (() => {});
  say(`${e.name}: finding the latest version…`, 0);
  const { url, version, stamp } = await resolveUrl(e.src, opts.net);
  const progDir = path.dirname(path.isAbsolute(mod.exe) ? mod.exe : path.join(mod.dir, mod.exe));
  const work = path.join(opts.tempDir, `emu-update-${id}-${Date.now()}`);
  await fsp.mkdir(work, { recursive: true });
  try {
    const archive = path.join(work, decodeURIComponent(url.split('/').pop().split('?')[0]) || 'download');
    await download(url, archive, opts.net, (got, total) => say(`${e.name} ${version}: downloading ${Math.round(got / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? got / total : 0));
    say(`${e.name}: updating…`, 1);
    const out = path.join(work, 'out');
    const exeDir = await unpackTo(e, opts.sevenZip, archive, out);
    // each update keeps the files it replaced in <backupDir>\<its folder in Emu_modules>\<old version> (nothing deleted)
    const old = String((mod.installer && mod.installer.version) || 'unknown version').replace(/[<>:"/\\|?*]/g, '_');
    let backup = opts.backupDir && opts.emuDir ? path.join(opts.backupDir, path.relative(opts.emuDir, progDir), old) : path.join(progDir, '_previous version', old);
    if (fs.existsSync(backup)) backup += ` (${new Date().toISOString().slice(0, 19).replace(/:/g, '-')})`;
    const counts = { replaced: 0, added: 0, kept: 0 };
    await overlay(exeDir, progDir, backup, counts);
    say(`${e.name} updated to ${version}`, 1);
    return { name: e.name, version, stamp, emuId: id, ...counts };
  } finally {
    fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { CONSOLES, EMULATORS, catalog, install, targetDir, resolveUrl, checkUpdates, update, emuIdOf, githubLatest, download, unpack, findExeDir };
