// Games for an emulator: finds them in its ROM folders, cleans up their names,
// finds cover art, and builds the command line that starts a game directly.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const COVER_DIRS = ['covers', 'cover', 'boxart', 'boxarts', 'named_boxarts', 'images', 'media'];
const MAX_ENTRIES = 60000;
const MAX_DEPTH = 5;

// RetroArch: which core plays what. Folder names are checked first, then the file type.
const RA_FOLDERS = [
  [/playstation ?2|\bps2\b/, ['pcsx2']],
  [/playstation portable|\bpsp\b/, ['ppsspp']],
  [/playstation|\bpsx\b|\bps1\b/, ['swanstation', 'pcsx_rearmed', 'mednafen_psx_hw', 'mednafen_psx']],
  [/saturn/, ['mednafen_saturn', 'yabasanshiro', 'kronos']],
  [/dreamcast/, ['flycast']],
  [/sega ?cd|mega ?cd/, ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive']],
  [/master system|game ?gear/, ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive']],
  [/mega ?drive|genesis/, ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive']],
  [/philips|\bcd-?i\b/, ['same_cdi', 'cdi2015']],
  [/3ds/, ['citra', 'azahar']],
  [/nintendo ?ds|\bnds\b/, ['melonds', 'melondsds', 'desmume']],
  [/gamecube|\bwii\b|nintendo wii/, ['dolphin']],
  [/nintendo ?64|\bn64\b/, ['mupen64plus_next', 'parallel_n64']],
  [/snes|super nintendo/, ['snes9x', 'snes9x2010', 'bsnes']],
  [/game ?boy advance|gba/, ['gpsp', 'mgba', 'vba_next']],
  [/game ?boy|\bgbc?\b/, ['gearboy', 'gambatte', 'sameboy', 'mgba']],
  [/\bnes\b|8-bit|famicom/, ['quicknes', 'nestopia', 'fceumm', 'mesen']],
  [/sg-?1000/, ['genesis_plus_gx', 'genesis_plus_gx_wide']],
  [/atari ?2600/, ['stella', 'stella2014']],
  [/turbo ?grafx|pc ?engine/, ['mednafen_pce_fast', 'mednafen_pce']],
  [/zx ?spectrum/, ['fuse']],
];
const RA_EXT = {
  smc: ['snes9x', 'snes9x2010', 'bsnes'], sfc: ['snes9x', 'snes9x2010', 'bsnes'],
  z64: ['mupen64plus_next', 'parallel_n64'], n64: ['mupen64plus_next', 'parallel_n64'], v64: ['mupen64plus_next', 'parallel_n64'],
  gba: ['gpsp', 'mgba', 'vba_next'], gb: ['gearboy', 'gambatte', 'sameboy'], gbc: ['gearboy', 'gambatte', 'sameboy'],
  nes: ['quicknes', 'nestopia', 'fceumm', 'mesen'],
  md: ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive'], gen: ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive'],
  smd: ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive'], sms: ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive'],
  gg: ['genesis_plus_gx', 'genesis_plus_gx_wide', 'picodrive'], sg: ['genesis_plus_gx', 'genesis_plus_gx_wide'],
  a26: ['stella', 'stella2014'], pce: ['mednafen_pce_fast', 'mednafen_pce'], sgx: ['mednafen_pce_fast', 'mednafen_pce'],
  tzx: ['fuse'], tap: ['fuse'], z80: ['fuse'], sna: ['fuse'],
  nds: ['melonds', 'melondsds', 'desmume'], '3ds': ['citra', 'azahar'], cci: ['citra'], cia: ['citra'],
  gdi: ['flycast'], cdi: ['flycast'], pbp: ['swanstation', 'pcsx_rearmed'], rvz: ['dolphin'], wbfs: ['dolphin'], gcm: ['dolphin'],
};

const isRetroArch = (mod) => /retroarch\.exe$/i.test(mod.exe);
const isRpcs3 = (mod) => /rpcs3\.exe$/i.test(mod.exe);
const isSwitch = (mod) => (mod.romExtensions || []).some((e) => ['nsp', 'xci'].includes(e.toLowerCase()));

// A ROM folder is a path, or { path, core } when a RetroArch core was chosen by hand
const folderPath = (f) => (typeof f === 'string' ? f : f.path);

function availableCores(mod) {
  try {
    return fs.readdirSync(path.join(path.dirname(mod.exe), 'cores'))
      .filter((n) => /_libretro\.dll$/i.test(n)).map((n) => n.replace(/_libretro\.dll$/i, '').toLowerCase());
  } catch { return []; }
}

// The RetroArch core for a game: chosen for its folder, else guessed from folder names / file type
function pickCore(mod, rom, folder) {
  const have = availableCores(mod);
  if (folder && typeof folder === 'object' && folder.core && have.includes(folder.core)) return folder.core;
  const where = path.relative(path.dirname(folderPath(folder || rom)), rom).toLowerCase().replace(/[\\/_]+/g, ' ');
  for (const [re, cores] of RA_FOLDERS) if (re.test(where)) { const c = cores.find((x) => have.includes(x)); if (c) return c; }
  const ext = path.extname(rom).slice(1).toLowerCase();
  const c = (RA_EXT[ext] || []).find((x) => have.includes(x));
  return c || null;
}

// "Crash Bandicoot - Warped (USA) (Disc 1).bin" -> { title: 'Crash Bandicoot - Warped (Disc 1)', region: 'USA' }
function cleanName(file) {
  let n = path.basename(file).replace(/\.[^.]{1,5}$/, '');
  const disc = (/\((dis[ck]|cd)\s*\d+[^)]*\)/i.exec(n) || [])[0] || '';
  const region = (/\((usa|europe|japan|world|sweden|germany|france|spain|italy|uk|australia|korea|asia|scandinavia)[^)]*\)/i.exec(n) || [])[1] || '';
  // Versions stay apart in the list: (Rev 1), (V1.1), (Beta), (Proto), (Sample), (Demo)
  const vm = /\((rev\s?[0-9a-z]+|v\s?\d+\.\d+|beta[^)]*|proto[^)]*|sample|demo|kiosk[^)]*)\)/i.exec(n);
  const version = vm ? vm[1].replace(/^rev\s?/i, 'Rev ').replace(/^v\s?/i, 'v') : '';
  n = n.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  n = n.replace(/^(.*), (The|A|An)$/i, '$2 $1');
  return { title: (disc ? `${n} ${disc}` : n) || path.basename(file), region, version };
}

// TITLE and TITLE_ID of a PS3 PARAM.SFO (a small key/value table)
function sfoInfo(file) {
  const out = {};
  try {
    const b = fs.readFileSync(file);
    if (b.readUInt32BE(0) !== 0x00505346) return out;   // "\0PSF"
    const keys = b.readUInt32LE(8), data = b.readUInt32LE(12), count = b.readUInt32LE(16);
    for (let i = 0; i < count; i++) {
      const e = 20 + i * 16;
      const k = keys + b.readUInt16LE(e);
      const key = b.toString('utf8', k, b.indexOf(0, k));
      if (key !== 'TITLE' && key !== 'TITLE_ID') continue;
      const off = data + b.readUInt32LE(e + 12), len = b.readUInt32LE(e + 4);
      out[key] = b.toString('utf8', off, off + len).replace(/\0+$/, '').replace(/[\r\n]+/g, ' ').replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
    }
  } catch {}
  return out;
}
async function walk(root, onDir) {
  let seen = 0;
  const go = async (dir, depth) => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    seen += entries.length;
    if (seen > MAX_ENTRIES) return;
    await onDir(dir, entries, depth);
    for (const e of entries) {
      // Skips system folders and "_" folders such as _Duplicates
      if (e.isDirectory() && depth < MAX_DEPTH && !/^[$._]/.test(e.name)) await go(path.join(dir, e.name), depth + 1);
    }
  };
  await go(root, 0);
}

// Cover art: same name as the game, a picture in a one-game folder, or a covers/boxart folder
function findCover(gameFile, dirImages, coverIndex, oneGameInDir) {
  const base = path.basename(gameFile).replace(/\.[^.]{1,5}$/, '').toLowerCase();
  const imgs = dirImages.get(path.dirname(gameFile)) || [];
  const same = imgs.find((i) => path.basename(i).replace(/\.[^.]+$/, '').toLowerCase() === base);
  if (same) return same;
  if (coverIndex.has(base)) return coverIndex.get(base);
  const clean = cleanName(gameFile).title.toLowerCase();
  if (coverIndex.has(clean)) return coverIndex.get(clean);
  if (oneGameInDir && imgs.length) {
    const pref = imgs.find((i) => /cover|box|front|folder|poster|icon/i.test(path.basename(i)));
    return pref || imgs[0];
  }
  return null;
}

// Names file of a module: "short=Full Name" lines (MAME's roms.txt) or a JSON object
const nameFiles = new Map(); // file -> { mtime, map }
function gameNames(file) {
  if (!file) return null;
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = nameFiles.get(file);
    if (hit && hit.mtime === mtime) return hit.map;
    const text = fs.readFileSync(file, 'latin1');
    const map = new Map();
    if (/^\s*\{/.test(text)) for (const [k, v] of Object.entries(JSON.parse(text))) map.set(k.toLowerCase(), String(v));
    else for (const line of text.split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) map.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()); }
    nameFiles.set(file, { mtime, map });
    return map;
  } catch { return null; }
}

async function scanGames(mod) {
  const exts = new Set((mod.romExtensions || []).map((e) => '.' + e.toLowerCase().replace(/^\./, '')));
  const names = gameNames(mod.gameNames);
  const games = [];
  const seenRoms = new Set();

  for (const folder of mod.romFolders || []) {
    const root = folderPath(folder);
    if (!fs.existsSync(root)) continue;
    // A folder can bring its own names file ({ path, names }), e.g. RetroArch's arcade folder
    const fnames = (folder && typeof folder === 'object' && folder.names) ? gameNames(folder.names) : names;
    const dirImages = new Map();
    const coverIndex = new Map();
    const found = [];

    await walk(root, async (dir, entries) => {
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      const imgs = files.filter((n) => IMAGE_EXT.includes(path.extname(n).toLowerCase())).map((n) => path.join(dir, n));
      if (imgs.length) dirImages.set(dir, imgs);
      if (COVER_DIRS.includes(path.basename(dir).toLowerCase())) {
        for (const i of imgs) coverIndex.set(path.basename(i).replace(/\.[^.]+$/, '').toLowerCase(), i);
      }

      // PS3: a game is a folder with PS3_GAME\USRDIR\EBOOT.BIN
      if (isRpcs3(mod)) {
        if (/^usrdir$/i.test(path.basename(dir)) && /^ps3_game$/i.test(path.basename(path.dirname(dir)))) {
          const eboot = files.find((n) => n.toLowerCase() === 'eboot.bin');
          if (eboot) {
            const gameDir = path.dirname(path.dirname(dir));
            const icon = ['ICON0.PNG', 'icon0.png'].map((n) => path.join(gameDir, 'PS3_GAME', n)).find((p) => fs.existsSync(p));
            const sfo = sfoInfo(path.join(gameDir, 'PS3_GAME', 'PARAM.SFO'));
            // the icon is a wide banner: only a stand-in until real box art is downloaded (coverIsIcon)
            found.push({ rom: path.join(dir, eboot), ...cleanName((sfo.TITLE || path.basename(gameDir)) + '.x'), cover: icon || null, coverIsIcon: !!icon,
              serial: sfo.TITLE_ID || (/^[A-Z]{4}\d{5}$/.test(path.basename(gameDir)) ? path.basename(gameDir) : ''), folder });
          }
        }
        for (const n of files) if (path.extname(n).toLowerCase() === '.iso') found.push({ rom: path.join(dir, n), folder });
        return;
      }

      let candidates = files.filter((n) => exts.has(path.extname(n).toLowerCase()));
      const lower = (n) => n.toLowerCase();

      // Multi-file games show once: .m3u hides its discs, .cue/.gdi hide their tracks
      const hidden = new Set();
      for (const n of candidates) {
        const ext = path.extname(n).toLowerCase();
        if (!['.m3u', '.cue', '.gdi'].includes(ext)) continue;
        try {
          const text = fs.readFileSync(path.join(dir, n), 'utf8');
          for (const line of text.split(/\r?\n/)) {
            const ref = ext === '.m3u' ? line.trim()
              : ext === '.cue' ? ((/FILE\s+"([^"]+)"/i.exec(line) || /FILE\s+(\S+)/i.exec(line) || [])[1])
              : (line.trim().split(/\s+/)[4] || '').replace(/"/g, '');
            if (ref && !ref.startsWith('#')) hidden.add(lower(path.basename(ref)));
          }
        } catch {}
      }
      candidates = candidates.filter((n) => !hidden.has(lower(n)));

      // Switch: only the base game, not its updates and DLC ([…800][v65536] etc.)
      if (isSwitch(mod)) {
        candidates = candidates.filter((n) => {
          const id = (/\[([0-9a-f]{16})\]/i.exec(n) || [])[1];
          const ver = (/\[v(\d+)\]/i.exec(n) || [])[1];
          if (id && !/000$/i.test(id)) return false;
          if (ver && ver !== '0') return false;
          return !/\b(update|dlc)\b/i.test(n);
        });
      }

      // The same game in several formats (e.g. .smc and .zip): keep the best one
      const rank = (n) => {
        const e = path.extname(n).toLowerCase();
        return ['.m3u', '.cue', '.gdi', '.chd'].includes(e) ? 0 : ['.zip', '.7z'].includes(e) ? 2 : 1;
      };
      const best = new Map();
      for (const n of candidates) {
        const base = lower(n).replace(/\.[^.]{1,5}$/, '');
        const cur = best.get(base);
        if (!cur || rank(n) < rank(cur)) best.set(base, n);
      }
      candidates = [...best.values()];

      for (const n of candidates) {
        // A full name from the names file (kept whole, so "Pac Man (Midway)" and "(Namco)" stay apart)
        const full = fnames && fnames.get(n.replace(/\.[^.]{1,5}$/, '').toLowerCase());
        if (fnames && mod.gameNamesOnly && !full) continue;
        found.push({ rom: path.join(dir, n), folder, dirCount: candidates.length, ...(full ? { title: full, region: '' } : {}) });
      }
    });

    // Same title twice in one ROM folder (e.g. a copy in an "unsorted" folder): keep one,
    // unless they are different region versions (USA and Europe both stay)
    const byTitle = new Map();
    const archive = (r) => /\.(zip|7z)$/i.test(r) ? 1 : 0;
    for (const g of found) {
      const n = g.title ? g : { ...g, ...cleanName(g.rom) };
      const key = `${n.title.toLowerCase()}|${(n.version || '').toLowerCase()}`;
      const list = byTitle.get(key) || [];
      const same = list.find((o) => !o.region || !n.region || o.region.toLowerCase() === n.region.toLowerCase());
      if (!same) { list.push(n); byTitle.set(key, list); continue; }
      // Prefer a plain file over an archive, then one with a region in its name
      if (archive(n.rom) < archive(same.rom) || (archive(n.rom) === archive(same.rom) && n.region && !same.region)) list[list.indexOf(same)] = n;
    }
    found.length = 0;
    for (const list of byTitle.values()) found.push(...list);

    for (const g of found) {
      if (seenRoms.has(g.rom.toLowerCase())) continue;
      seenRoms.add(g.rom.toLowerCase());
      const names = g.title ? { title: g.title, region: g.region } : cleanName(g.rom);
      // A game in its own folder (e.g. "Animal Well [NSP]\…") takes the folder's name
      if (g.dirCount === 1 && path.dirname(g.rom) !== folderPath(g.folder) && /\[(nsp|xci)\]|\(/i.test(path.basename(path.dirname(g.rom)))) {
        names.title = cleanName(path.basename(path.dirname(g.rom)) + '.x').title;
      }
      games.push({
        rom: g.rom,
        title: names.title,
        region: names.region,
        version: names.version || cleanName(g.rom).version,
        // PS3 game folders: their serial says more than EBOOT.BIN's extension
        type: g.serial || path.extname(g.rom).slice(1).toUpperCase(),
        cover: g.cover !== undefined ? g.cover : findCover(g.rom, dirImages, coverIndex, g.dirCount === 1),
        ...(g.coverIsIcon ? { coverIsIcon: true } : {}),
        ...(g.serial ? { serial: g.serial } : {}),
      });
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return games.sort((a, b) => collator.compare(a.title, b.title));
}

// Command line for starting a game: the module's gameArgs with {rom}, {romname}, {romdir}, {core},
// {system} (set per game folder, e.g. ares: "Mega Drive"), {emudir} (the emulator's own folder)
function launchArgs(mod, rom) {
  const folder = (mod.romFolders || []).find((f) => rom.toLowerCase().startsWith(folderPath(f).toLowerCase()));
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(mod.gameArgs || '"{rom}"'))) tokens.push(m[1] !== undefined ? m[1] : m[2]);
  let core = null;
  if (tokens.some((t) => t.includes('{core}'))) {
    const name = pickCore(mod, rom, folder);
    if (!name) {
      const ext = path.extname(rom).slice(1).toLowerCase();
      throw new Error(`RetroArch has no core for this game (.${ext}).\nChoose a core for its folder under Game folders, or install one in RetroArch.`);
    }
    core = path.join(path.dirname(mod.exe), 'cores', `${name}_libretro.dll`);
  }
  return tokens.map((t) => t
    .replace('{rom}', rom)
    .replace('{romname}', path.basename(rom).replace(/\.[^.]{1,5}$/, ''))
    .replace('{romdir}', path.dirname(rom))
    .replace('{emudir}', path.dirname(mod.exe))
    .replace('{core}', core || '')
    .replace('{system}', (folder && typeof folder === 'object' && folder.system) || ''));
}

module.exports = { scanGames, launchArgs, pickCore, availableCores, folderPath, isRetroArch };
