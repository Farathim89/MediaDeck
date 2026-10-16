// Downloads box art for games: the libretro thumbnail library (the one RetroArch uses) by No-Intro
// name, GameTDB for PS3 (serial) and Switch (title), the Arcade Database for arcade flyers (MAME short
// name), extra GitHub collections where libretro has gaps (PSP). Covers are stored encrypted by the
// media server. Only the game name / serial / short name and console go over the network.
const fs = require('fs');
const path = require('path');

const BASES = [
  'https://thumbnails.libretro.com/{system}/Named_Boxarts/{name}.png',
  'https://raw.githubusercontent.com/libretro-thumbnails/{repo}/master/Named_Boxarts/{name}.png',
];

// Console of a game, from its folder names and the emulator's system
const SYSTEMS = [
  [/playstation ?vita|\bps ?vita\b/, 'Sony - PlayStation Vita'],
  [/playstation ?5|\bps5\b/, 'Sony - PlayStation 5'],
  [/playstation ?4|\bps4\b/, 'Sony - PlayStation 4'],
  [/pocketstation/, 'Sony - PocketStation'],
  [/playstation ?3|\bps3\b/, 'Sony - PlayStation 3'],
  [/playstation ?2|\bps2\b/, 'Sony - PlayStation 2'],
  [/playstation portable|\bpsp\b/, 'Sony - PlayStation Portable'],
  [/playstation|\bpsx\b|\bps1\b/, 'Sony - PlayStation'],
  [/saturn/, 'Sega - Saturn'],
  [/model ?3/, 'Arcade - Sega Model 3'],
  [/dreamcast/, 'Sega - Dreamcast'],
  [/sega ?cd|mega ?cd/, 'Sega - Mega-CD - Sega CD'],
  [/sg-?1000/, 'Sega - SG-1000'],
  [/master system/, 'Sega - Master System - Mark III'],
  [/game ?gear/, 'Sega - Game Gear'],
  [/32x/, 'Sega - 32X'],
  [/mega ?drive|genesis/, 'Sega - Mega Drive - Genesis'],
  [/philips|\bcd-?i\b/, 'Philips - CD-i'],
  [/switch/, 'Nintendo - Switch'],
  [/3ds/, 'Nintendo - Nintendo 3DS'],
  [/nintendo ?ds|\bnds\b/, 'Nintendo - Nintendo DS'],
  [/gamecube/, 'Nintendo - GameCube'],
  [/\bwii ?u\b/, 'Nintendo - Wii U'],
  [/\bwii\b/, 'Nintendo - Wii'],
  [/virtual ?boy/, 'Nintendo - Virtual Boy'],
  [/nintendo ?64|\bn64\b/, 'Nintendo - Nintendo 64'],
  [/snes|super nintendo/, 'Nintendo - Super Nintendo Entertainment System'],
  [/game ?boy advance|gba/, 'Nintendo - Game Boy Advance'],
  [/game ?boy color|\bgbc\b/, 'Nintendo - Game Boy Color'],
  [/game ?boy|\bgb\b/, 'Nintendo - Game Boy'],
  [/\bnes\b|8-bit|famicom/, 'Nintendo - Nintendo Entertainment System'],
  [/atari ?2600/, 'Atari - 2600'],
  [/atari ?5200/, 'Atari - 5200'],
  [/atari ?7800/, 'Atari - 7800'],
  [/atari ?(400|800|xl|xe)|atari ?8-?bit/, 'Atari - 8-bit'],
  [/lynx/, 'Atari - Lynx'],
  [/jaguar/, 'Atari - Jaguar'],
  [/wonderswan ?colou?r/, 'Bandai - WonderSwan Color'],
  [/wonderswan/, 'Bandai - WonderSwan'],
  [/pc-?fx/, 'NEC - PC-FX'],
  [/xbox ?360/, 'Microsoft - Xbox 360'],
  [/xbox/, 'Microsoft - Xbox'],
  [/msx ?2/, 'Microsoft - MSX2'],
  [/\bmsx\b/, 'Microsoft - MSX'],
  [/colecovision/, 'Coleco - ColecoVision'],
  [/\bms-?dos\b|\bdos\b/, 'Microsoft - DOS'],
  [/\bcd32\b/, 'Commodore - CD32'],
  [/\bcdtv\b/, 'Commodore - CDTV'],
  [/amiga/, 'Commodore - Amiga'],
  [/commodore ?64|\bc64\b/, 'Commodore - 64'],
  [/apple ?(ii|2)\b/, 'Apple - II'],
  [/commander ?x16/, 'Commander - X16'],
  [/\bflash\b/, 'Adobe - Flash'],
  [/turbo ?grafx|pc ?engine/, 'NEC - PC Engine - TurboGrafx 16'],
  [/zx ?spectrum/, 'Sinclair - ZX Spectrum'],
  [/neo ?geo pocket color/, 'SNK - Neo Geo Pocket Color'],
  [/neo ?geo pocket/, 'SNK - Neo Geo Pocket'],
  [/neo ?geo/, 'SNK - Neo Geo'],
  [/arcade|mame/, 'MAME'],
];

// The game's folders decide first (Dolphin plays GameCube and Wii), then the emulator's console
function systemFor(mod, rom) {
  const norm = (s) => s.toLowerCase().replace(/[\\/_]+/g, ' ');
  for (const hay of [norm(path.dirname(rom)), norm(`${mod.system || ''} ${mod.name || ''}`)]) {
    for (const [re, name] of SYSTEMS) if (re.test(hay)) return name;
  }
  return null;
}

// Characters the thumbnail library replaces with "_"
const safe = (n) => n.replace(/[&*/:`<>?\\|"]/g, '_');

// Names to try: the file's own name (correct for No-Intro names), then tidied versions
function candidates(game) {
  const base = path.basename(game.rom).replace(/\.[^.]{1,5}$/, '');
  const out = [base];
  // Old GoodTools codes to No-Intro regions, without dump tags
  const good = base.replace(/\((U|UE)\)/g, '(USA)').replace(/\(E\)/g, '(Europe)').replace(/\(J\)/g, '(Japan)').replace(/\(W\)/g, '(World)')
    .replace(/\s*\[[^\]]*\]/g, '').trim();
  out.push(good);
  // Without version / language extras: "Name (USA)"
  const region = (/\((USA|Europe|Japan|World)[^)]*\)/i.exec(good) || [])[0];
  const title = good.replace(/\s*\([^)]*\)/g, '').trim();
  if (region) out.push(`${title} ${region.replace(/,.*\)/, ')')}`);
  out.push(`${title} (USA)`, `${title} (Europe)`, `${title} (World)`);
  // Old 32X names carry the console in the title: "After Burner 32X (A) [!]"
  const no32x = title.replace(/\s+32X$/i, '');
  if (no32x !== title) out.push(`${no32x} (USA)`, `${no32x} (Europe)`, `${no32x} (World)`, `${no32x} (Japan, USA)`, `${no32x} (USA, Europe)`);
  // Switch / folder names like "Animal Well [NSP]"
  if (game.title && game.title !== title) out.push(game.title);
  return [...new Set(out.map(safe))];
}

async function fetchImage(url, net) {
  try {
    const r = await net.fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const png = buf[0] === 0x89 && buf[1] === 0x50, jpg = buf[0] === 0xff && buf[1] === 0xd8;
    return buf.length > 1000 && (png || jpg) ? buf : null; // a real picture
  } catch { return null; }
}

// PS3: libretro has very few PS3 boxes, GameTDB has them by serial (BLUS30727). Only the serial is sent.
const GAMETDB_REGION = [[/^(BL|BC|NP)U|^NPUB|^NPUA/, ['US', 'EN']], [/^(BL|BC|NP)E/, ['EN', 'US', 'DE', 'FR']], [/^(BL|BC|NP)J|^BCJS|^BLJM/, ['JA', 'US']], [/^(BL|BC|NP)[AHK]/, ['ZH', 'KO', 'US', 'EN']]];
async function gametdbCover(serial, net) {
  if (!/^[A-Z]{4}\d{5}$/.test(serial || '')) return null;
  const regions = (GAMETDB_REGION.find(([re]) => re.test(serial)) || [null, ['US', 'EN', 'JA']])[1];
  for (const r of regions) {
    for (const kind of ['coverM', 'cover']) {
      const img = await fetchImage(`https://art.gametdb.com/ps3/${kind}/${r}/${serial}.jpg`, net);
      if (img) return img;
    }
  }
  return null;
}

// Switch: GameTDB has covers by its own product code (ANIMAL WELL = BCCHA). Its database (switchtdb.xml)
// gives code + title; games are matched by title, as file names carry no product code.
// Titles compared without accents, apostrophes and punctuation; "+" = plus, II = 2; release tags dropped
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const normTitle = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['\u2019`]/g, '').replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[\u2122\u00ae\u00a9]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((w) => w && !/^(romslab|nsw2u|v\d{3,})$/.test(w)).map((w) => ROMAN[w] || w)
  .join(' ').replace(/^the /, '');
function parseSwitchTdb(xml) {
  const out = [];
  const re = /<game name="([^"]*)">([\s\S]*?)<\/game>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = (/<id>([^<]+)<\/id>/.exec(m[2]) || [])[1];
    const region = (/<region>([^<]*)<\/region>/.exec(m[2]) || [])[1] || '';
    const titles = [...m[2].matchAll(/<title>([^<]*)<\/title>/g)].map((t) => t[1]);
    const name = m[1].replace(/\s*\([^)]*\)\s*$/, '');
    if (id) out.push({ id, region, titles: [...new Set([name, ...titles].map(normTitle).filter(Boolean))] });
  }
  return out;
}
// The best entry for a game title: same title first (US / worldwide entries preferred), else the one
// whose title starts with ours ("DRAGON QUEST TREASURES" ~ "DRAGON QUEST TREASURES Deluxe")
function switchMatch(index, title) {
  const t = normTitle(title);
  if (!t || !index) return [];
  const rank = (e) => ({ USA: 0, ALL: 1, EUR: 2, JPN: 3 }[e.region] ?? 4);
  const exact = index.filter((e) => e.titles.includes(t)).sort((a, b) => rank(a) - rank(b));
  if (exact.length) return exact;
  // (only titles of two words or more: a one-word title like "V" would match anything)
  const words = (x) => x.split(' ').length >= 2;
  return index.filter((e) => e.titles.some((x) => (words(t) && x.startsWith(t + ' ')) || (words(x) && t.startsWith(x + ' '))))
    .sort((a, b) => Math.min(...a.titles.map((x) => Math.abs(x.length - t.length))) - Math.min(...b.titles.map((x) => Math.abs(x.length - t.length))) || rank(a) - rank(b))
    .slice(0, 3);
}
async function gametdbSwitchCover(index, title, net) {
  for (const e of switchMatch(index, title)) {
    for (const r of ['US', 'EN', 'JA']) {
      for (const kind of ['coverM', 'cover']) {
        const img = await fetchImage(`https://art.gametdb.com/switch/${kind}/${r}/${e.id}.jpg`, net);
        if (img) return img;
      }
    }
  }
  return null;
}

// When no exact name fits: the console's list of box art names (libretro), matched by title without
// punctuation ("Dissidia Final Fantasy" = "Dissidia - Final Fantasy"), the game's own region first,
// then USA, Europe, World, Japan (a box of another region beats no box)
const REGION_ORDER = ['USA', 'Europe', 'World', 'Japan'];

// More box art collections (GitHub) for consoles where libretro has gaps, tried after libretro;
// their file names follow the same No-Intro style, so they are matched the same way
const EXTRA_SOURCES = {
  'Sony - PlayStation Portable': { repo: 'dipubadatya/psp-covers-hd', branch: 'main', dir: 'covers' },
};
// How well a box name fits a game title (lower = better, null = not at all):
//  0 same title, one of its alternative titles ("A _ B", "A ~ B"), the same without spaces, or
//    without "the" ("Sporting News, The - Baseball" = "Sporting News Baseball, The")
//  1 the main title before " - " ("Coryoon - Child of Dragon"), the part after it ("Busou Keiji -
//    Cyber Cross"), or the same words in another order ("Super Noah's Ark 3D" = "Super 3D Noah's Ark")
//  2 a longer title starting with ours ("After Burner" ~ "After Burner Complete"), or ours without its
//    subtitle ("Digital Champ - Battle Boxing" ~ "Digital Champ"); two words or more
function titleFit(boxTitle, key, ownMain) {
  const compact = (s) => s.replace(/ /g, '');
  const noThe = (s) => s.split(' ').filter((w) => w !== 'the').join(' ');
  const words = (s) => noThe(s).split(' ').sort().join(' ');
  const long = (s) => s.split(' ').length >= 2;
  let best = null;
  const better = (lvl) => { if (best === null || lvl < best) best = lvl; };
  for (const alt of boxTitle.split(/\s+[_~]\s+/)) {
    const t = normTitle(alt);
    if (!t) continue;
    if (t === key || compact(t) === compact(key) || noThe(t) === noThe(key)) better(0);
    const parts = alt.split(/\s+-\s+/);
    if (parts.length > 1 && (normTitle(parts[0]) === key || (long(key) && normTitle(parts[parts.length - 1]) === key))) better(1);
    if (key.split(' ').length >= 3 && words(t) === words(key)) better(1);
    if (long(key) && t.startsWith(key + ' ')) better(2);
    if (ownMain && long(ownMain) && (t === ownMain || normTitle(parts[0]) === ownMain)) better(2);
  }
  return best;
}
function libretroMatch(names, game) {
  let key = normTitle(game.title || path.basename(game.rom).replace(/\.[^.]{1,5}$/, '').replace(/\s*[([].*$/, ''));
  key = key.replace(/ 32x$/, '');   // old 32X names carry the console: "Knuckles Chaotix 32X"
  if (!key || !names) return [];
  // our title without its subtitle ("Digital Champ - Battle Boxing" -> "digital champ")
  const rawTitle = String(game.title || '');
  const ownMain = / - /.test(rawTitle) ? normTitle(rawTitle.split(/\s+-\s+/)[0]).replace(/ 32x$/, '') : '';
  const own = String(game.region || (/\((USA|Europe|Japan|World)/i.exec(path.basename(game.rom)) || [])[1] || '');
  const order = [own, ...REGION_ORDER].filter(Boolean);
  // the region list is the first (...) of the name: "(Japan, USA)" counts as USA too
  const region = (n) => { const regs = (/\(([^)]*)\)/.exec(n) || [])[1] || ''; const i = order.findIndex((r) => new RegExp(`\\b${r}\\b`, 'i').test(regs)); return i < 0 ? 9 : i; };
  const odd = (n) => (/\((Beta|Demo|Proto|Sample|Alt)[^)]*\)/i.test(n) ? 1 : 0);   // a release box before a beta's
  return names.filter((n) => !/SymbolicLink/i.test(n))
    .map((n) => ({ n, fit: titleFit(n.replace(/\s*[([].*$/, ''), key, ownMain) }))
    .filter((x) => x.fit !== null)
    .sort((a, b) => a.fit - b.fit || odd(a.n) - odd(b.n) || region(a.n) - region(b.n) || a.n.length - b.n.length)
    .slice(0, 4).map((x) => x.n);
}

// Arcade: the Arcade Database (adb.arcadeitalia.net) has the original flyers by MAME short name.
// MAME32's file names are short names; NeoRAGEx's are mapped in its arcade-names.json (module field
// "arcadeNames"). Missing art comes back as a MAME logo placeholder: recognised by comparing with the
// answer for a game that doesn't exist. Clones without a flyer use their parent's.
let adbPlaceholder = null;
const adbFlyer = (short, net) => fetchImage(`https://adb.arcadeitalia.net/?mame=${encodeURIComponent(short)}&type=flyer&resize=500`, net);
async function arcadeCover(short, net) {
  if (!adbPlaceholder) adbPlaceholder = adbFlyer('zzzz-no-such-game', net);
  const none = await adbPlaceholder;
  const real = (img) => (img && !(none && img.equals(none)) ? img : null);
  let img = real(await adbFlyer(short, net));
  if (img) return img;
  try {
    const r = await net.fetch(`https://adb.arcadeitalia.net/service_scraper.php?ajax=query_mame&game_name=${encodeURIComponent(short)}`);
    const j = await r.json();
    const parent = j && j.result && j.result[0] && j.result[0].cloneof;
    if (parent) img = real(await adbFlyer(parent, net));
  } catch {}
  return img;
}
const arcadeNameFiles = new Map();
function arcadeShortName(mod, system, rom) {
  const base = path.basename(rom).replace(/\.[^.]{1,5}$/, '').toLowerCase();
  if (mod.arcadeNames) {
    if (!arcadeNameFiles.has(mod.arcadeNames)) { let m = {}; try { m = JSON.parse(fs.readFileSync(mod.arcadeNames, 'utf8')); } catch {} arcadeNameFiles.set(mod.arcadeNames, m); }
    const m = arcadeNameFiles.get(mod.arcadeNames);
    if (m[base]) return m[base];
  }
  return system === 'MAME' ? base : null;
}

// libretro's folder names that differ from the console's name ("DOS", not "Microsoft - DOS")
const LIBRETRO_DIR = { 'Microsoft - DOS': 'DOS' };

async function findCover(mod, game, net, opts = {}) {
  const own = systemFor(mod, game.rom);
  if (!own) return null;
  const system = LIBRETRO_DIR[own] || own;
  if (system === 'Sony - PlayStation 3' && game.serial) {
    const img = await gametdbCover(game.serial, net);
    if (img) return img;
  }
  if (system === 'Nintendo - Switch' && opts.switchIndex) {
    const img = await gametdbSwitchCover(await opts.switchIndex(), game.title, net);
    if (img) return img;
  }
  // ports / homebrew: the module can name another console's box to use ("coverFrom": { file: [system, name] })
  const from = mod.coverFrom && mod.coverFrom[path.basename(game.rom).replace(/\.[^.]{1,5}$/, '').toLowerCase()];
  if (Array.isArray(from) && from.length === 2) {
    for (const base of BASES) {
      const url = base.replace('{system}', encodeURIComponent(from[0])).replace('{repo}', encodeURIComponent(from[0].replace(/ /g, '_')))
        .replace('{name}', encodeURIComponent(safe(from[1])));
      const img = await fetchImage(url, net);
      if (img) return img;
    }
  }
  const tryNames = async (names) => {
    for (const name of names) {
      for (const base of BASES) {
        const url = base.replace('{system}', encodeURIComponent(system)).replace('{repo}', encodeURIComponent(system.replace(/ /g, '_')))
          .replace('{name}', encodeURIComponent(name));
        const img = await fetchImage(url, net);
        if (img) return img;
      }
    }
    return null;
  };
  const direct = await tryNames(candidates(game));
  if (direct) return direct;
  if (opts.libretroIndex) {
    const img = await tryNames(libretroMatch(await opts.libretroIndex(system), game));
    if (img) return img;
  }
  if (system === 'MAME' || system === 'SNK - Neo Geo') {
    const short = arcadeShortName(mod, system, game.rom);
    const img = short && await arcadeCover(short, net);
    if (img) return img;
  }
  const extra = EXTRA_SOURCES[system];
  if (extra && opts.extraIndex) {
    const files = (await opts.extraIndex(extra)) || [];
    const byName = new Map(files.map((f) => [f.replace(/\.(png|jpe?g)$/i, ''), f]));
    for (const name of libretroMatch([...byName.keys()], game)) {
      const url = `https://raw.githubusercontent.com/${extra.repo}/${extra.branch}/${extra.dir}/${encodeURIComponent(byName.get(name))}`;
      const img = await fetchImage(url, net);
      if (img) return img;
    }
  }
  // Last: the game's title screen, else an in-game screenshot (libretro's Named_Titles / Named_Snaps,
  // more complete than the boxes): the card shows a 4:3 picture whole, over a blurred copy of itself
  for (const kind of opts.libretroIndex ? ['Named_Titles', 'Named_Snaps'] : []) {
    for (const name of libretroMatch(await opts.libretroIndex(system, kind), game)) {
      for (const base of BASES) {
        const url = base.replace('Named_Boxarts', kind).replace('{system}', encodeURIComponent(system))
          .replace('{repo}', encodeURIComponent(system.replace(/ /g, '_'))).replace('{name}', encodeURIComponent(name));
        const img = await fetchImage(url, net);
        if (img) return img;
      }
    }
  }
  return null;
}

// Downloads covers for the games that don't have one yet, a few at a time
// opts: { net, has(rom), save(rom, img), progress(p), switchIndex(), skip(rom), missed(rom) }
async function downloadAll(mod, games, opts) {
  const { net, has, save, progress = () => {}, skip = () => false, missed = () => {} } = opts;
  const todo = games.filter((g) => (!g.cover || g.coverIsIcon) && !has(g.rom) && !skip(g.rom));
  let done = 0, found = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift();
      const img = await findCover(mod, g, net, opts);
      if (img) { await save(g.rom, img); found++; } else missed(g.rom);
      done++;
      progress({ done, total: todo.length, found });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { total: todo.length, found, already: games.length - todo.length };
}

// Short console names for the game lists, and the shape of their boxes (width / height)
const SHORT = {
  'Nintendo - Super Nintendo Entertainment System': ['SNES', 1.38], 'Nintendo - Nintendo 64': ['N64', 1.38],
  'Nintendo - Game Boy': ['Game Boy', 1], 'Nintendo - Game Boy Color': ['Game Boy Color', 1], 'Nintendo - Game Boy Advance': ['GBA', 1],
  'Nintendo - Nintendo DS': ['DS', 1.08], 'Nintendo - Nintendo 3DS': ['3DS', 0.88], 'Nintendo - Nintendo Entertainment System': ['NES', 0.73],
  'Nintendo - GameCube': ['GameCube', 0.71], 'Nintendo - Wii': ['Wii', 0.71],
  'Sony - PlayStation': ['PS1', 1], 'Sony - PlayStation 2': ['PS2', 0.71], 'Sony - PlayStation 3': ['PS3', 0.86], 'Sony - PlayStation Portable': ['PSP', 0.58],
  'Sega - Master System - Mark III': ['Master System', 0.71], 'Sega - Mega Drive - Genesis': ['Mega Drive', 0.71], 'Sega - Game Gear': ['Game Gear', 0.71], 'Sega - 32X': ['32X', 0.71], 'Nintendo - Switch': ['Switch', 0.62],
  'Sega - Mega-CD - Sega CD': ['Sega CD', 1], 'Sega - Saturn': ['Saturn', 1], 'Sega - Dreamcast': ['Dreamcast', 1],
  'Philips - CD-i': ['CD-i', 1], 'SNK - Neo Geo Pocket': ['Neo Geo Pocket', 1], 'SNK - Neo Geo Pocket Color': ['Neo Geo Pocket Color', 1], 'Sega - SG-1000': ['SG-1000', 0.71], 'Atari - 2600': ['Atari 2600', 0.73],
  'NEC - PC Engine - TurboGrafx 16': ['TurboGrafx-16', 0.88], 'NEC - PC-FX': ['PC-FX', 1],
  'Nintendo - Wii U': ['Wii U', 0.71], 'Nintendo - Virtual Boy': ['Virtual Boy', 0.73],
  'Sony - PlayStation 4': ['PS4', 0.81], 'Sony - PlayStation 5': ['PS5', 0.81], 'Sony - PlayStation Vita': ['PS Vita', 0.58], 'Sony - PocketStation': ['PocketStation', 1],
  'Microsoft - Xbox': ['Xbox', 0.71], 'Microsoft - Xbox 360': ['Xbox 360', 0.71], 'Microsoft - MSX': ['MSX', 0.71], 'Microsoft - MSX2': ['MSX2', 0.71], 'Microsoft - DOS': ['DOS', 0.8],
  'Atari - 5200': ['Atari 5200', 0.73], 'Atari - 7800': ['Atari 7800', 0.73], 'Atari - 8-bit': ['Atari 8-bit', 0.73], 'Atari - Lynx': ['Lynx', 0.73], 'Atari - Jaguar': ['Jaguar', 0.73],
  'Bandai - WonderSwan': ['WonderSwan', 1], 'Bandai - WonderSwan Color': ['WonderSwan Color', 1], 'Coleco - ColecoVision': ['ColecoVision', 0.73],
  'Commodore - Amiga': ['Amiga', 0.8], 'Commodore - CD32': ['Amiga CD32', 0.88], 'Commodore - CDTV': ['CDTV', 0.88], 'Commodore - 64': ['C64', 0.8], 'Apple - II': ['Apple II', 0.8], 'Commander - X16': ['Commander X16', 1], 'Adobe - Flash': ['Flash', 1.33],
  'Arcade - Sega Model 3': ['Model 3', 0.75], 'Sinclair - ZX Spectrum': ['ZX Spectrum', 0.66], 'SNK - Neo Geo': ['Neo Geo', 0.71], MAME: ['Arcade', 0.75],
};
function consoleOf(mod, rom) {
  const s = systemFor(mod, rom);
  const [name, ratio] = SHORT[s] || [mod.system || 'Games', /switch/i.test(mod.system || '') ? 0.62 : 0.75];
  return { console: name, ratio };
}

module.exports = { downloadAll, systemFor, consoleOf, parseSwitchTdb, switchMatch, libretroMatch };
