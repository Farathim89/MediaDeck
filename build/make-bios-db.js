// Makes bios-db.json (the BIOS import's checksum table) from libretro-database's System.dat (CC BY-SA 4.0):
//   node build/make-bios-db.js <System.dat>
// Only the consoles that have a folder in MediaDeck's BIOS folder (setup-scan.js BIOS). Names and checksums only.
const fs = require('fs');
const path = require('path');

// System.dat's console → MediaDeck's BIOS\<folder>
const FOLDERS = {
  'Sony - PlayStation': 'Sony - PlayStation', 'Sony - PlayStation 2': 'Sony - PlayStation 2',
  'Sega - Saturn': 'Sega - Saturn', 'Sega - Mega CD - Sega CD': 'Sega - Mega CD - Sega CD', 'Sega - Dreamcast': 'Sega - Dreamcast',
  'NEC - PC Engine - TurboGrafx 16 - SuperGrafx': 'NEC - PC Engine CD', 'NEC - PC-FX': 'NEC - PC-FX', 'Atari - Lynx': 'Atari - Lynx',
  'Nintendo - Game Boy Advance': 'Nintendo - Game Boy Advance', 'Nintendo - Nintendo DS': 'Nintendo - DS', 'Nintendo - GameCube': 'Nintendo - GameCube',
  'Philips - CD-i': 'Philips - CD-i', 'Commodore - Amiga': 'Commodore - Amiga', Arcade: 'SNK - Neo Geo',
};
const ONLY = { Arcade: /^neogeo\.zip$/i };            // from "Arcade" only the Neo Geo BIOS
const CD32 = /cd32/i;                                   // Amiga CD32 Kickstart / extended ROM → its own folder
const NOT_BIOS = /\.(ya?ml|txt|dat|xml|json|ini)$/i;     // emulator data files the list has too (PCSX2's GameIndex.yaml)
// names the emulators MediaDeck installs look for
const RENAME = { 'Sega - Dreamcast': { 'flash.bin': 'dc_flash.bin' } };

const text = fs.readFileSync(process.argv[2], 'utf8');
const db = {};
let system = '';
for (const line of text.split(/\r?\n/)) {
  const c = /^\s*comment "(.+)"\s*$/.exec(line);
  if (c) { system = c[1]; continue; }
  const r = /^\s*rom \( name ("[^"]+"|\S+) size (\d+) crc \S+ md5 ([0-9a-f]{32})/i.exec(line);
  if (!r || !FOLDERS[system]) continue;
  let name = path.basename(r[1].replace(/"/g, '')).replace(/^.*[\\/]/, '');
  if (NOT_BIOS.test(name)) continue;
  name = (RENAME[system] || {})[name.toLowerCase()] || name;
  if (ONLY[system] && !ONLY[system].test(name)) continue;
  const folder = system === 'Commodore - Amiga' && CD32.test(name) ? 'Commodore - Amiga CD32' : FOLDERS[system];
  const md5 = r[3].toLowerCase();
  if (!db[md5]) db[md5] = [folder, name, Number(r[2])];   // the first name for a dump (scph5501 before scph7003)
}
const out = path.join(__dirname, '..', 'bios-db.json');
fs.writeFileSync(out, JSON.stringify({ source: 'libretro-database dat/System.dat (CC BY-SA 4.0)', files: db }) + '\n');
console.log(`${Object.keys(db).length} BIOS files → ${out}`);
