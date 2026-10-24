// The MediaDeck folder moved (another drive letter, a USB stick, another folder): emulators keep full paths in their
// own settings (xemu's BIOS files, PCSX2's folders, Dolphin's game folders …). Those that point into the old MediaDeck
// folder are pointed at the new one, so everything keeps working. Files are changed only where such a path is, and
// each changed file's old copy is kept in <backupDir>\<date> (moved from …)\<its path>.
const fs = require('fs');
const path = require('path');

const SETTINGS = /\.(ini|toml|cfg|conf|ya?ml|json|xml|txt|bml|uae)$/i;
const SKIP_DIR = /^(cache|shaders?|textures|covers|screenshots|videos|logs|autoconfig|assets|cores|overlays?|filters|database|thumbnails|dumps?|load|sys|languages|translations|qtplugins|plugins|resources)$/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ways a path is written in settings files: C:\x\y, C:\\x\\y (escaped, TOML / JSON), C:/x/y
function styles(oldRoot, newRoot) {
  const o = path.resolve(oldRoot).replace(/[\\/]+$/, ''), n = path.resolve(newRoot).replace(/[\\/]+$/, '');
  return [
    [o.replace(/\\/g, '\\\\'), n.replace(/\\/g, '\\\\')],
    [o, n],
    [o.replace(/\\/g, '/'), n.replace(/\\/g, '/')],
  ].map(([from, to]) => ({ re: new RegExp(esc(from) + '(?=[\\\\/"\'\\s,;\\]}<]|$)', 'gi'), to }));
}

function files(dir, depth = 0, out = []) {
  if (depth > 7) return out;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) files(p, depth + 1, out); continue; }
    if (SETTINGS.test(e.name) && !/\.(before-|bak)|\.other-pc/i.test(e.name)) out.push(p);
  }
  return out;
}

// dirs: the folders to look in (Emu_modules, Apps); returns the files changed
function relocate(oldRoot, newRoot, dirs, backupDir) {
  if (!oldRoot || path.resolve(oldRoot).toLowerCase() === path.resolve(newRoot).toLowerCase()) return [];
  const rules = styles(oldRoot, newRoot);
  const stamp = `${new Date().toISOString().slice(0, 10)} (moved from ${path.resolve(oldRoot).replace(/[\\/:]+/g, ' ').trim()})`;
  const changed = [];
  for (const dir of dirs) {
    for (const f of files(dir)) {
      let text;
      try { if (fs.statSync(f).size > 4e6) continue; text = fs.readFileSync(f, 'latin1'); } catch { continue; }
      let next = text;
      for (const r of rules) next = next.replace(r.re, r.to);
      if (next === text) continue;
      try {
        if (backupDir) {
          const b = path.join(backupDir, stamp, path.relative(path.resolve(newRoot), f));
          fs.mkdirSync(path.dirname(b), { recursive: true });
          if (!fs.existsSync(b)) fs.copyFileSync(f, b);
        }
        fs.writeFileSync(f, next, 'latin1');
        changed.push(f);
      } catch {}
    }
  }
  return changed;
}

// PCSX2 keeps its folders (BIOS, memory cards, save states …) as full paths. One that isn't there any more (an old
// drive), while PCSX2's own sub folder of that name is, is pointed at the sub folder - written relative, so it
// moves with MediaDeck. Without its BIOS folder PCSX2 quits at once when a game starts. Returns the keys changed.
const PCSX2_FOLDERS = { Bios: 'bios', Snapshots: 'snaps', SaveStates: 'sstates', MemoryCards: 'memcards', Cheats: 'cheats',
  Cache: 'cache', Covers: 'covers', Patches: 'patches', Textures: 'textures', Videos: 'videos', InputProfiles: 'inputprofiles' };
function pcsx2Folders(dir) {
  const pads = require('./pad-defaults');
  const file = path.join(dir, 'inis', 'PCSX2.ini');
  if (!fs.existsSync(file)) return [];
  const ini = pads.readIni(file);
  const changed = [];
  for (const [key, sub] of Object.entries(PCSX2_FOLDERS)) {
    const v = (pads.iniGet(ini, 'Folders', key) || '').trim();
    if (!v || !path.isAbsolute(v) || fs.existsSync(v) || !fs.existsSync(path.join(dir, sub))) continue;
    pads.iniSet(ini, 'Folders', key, sub);
    changed.push(`${key}: ${v} -> ${sub}`);
  }
  if (changed.length) pads.writeIni(file, ini);
  return changed;
}

// Eden (and the other yuzu forks) keeps its folders (the NAND: saves, firmware, installed updates; the SD card …) as full
// paths, and uses them as long as they are there: a copy of it on another drive kept using the first one's NAND. It
// writes them again on every close, so before each start: a folder in another copy's user folder, or one that is gone,
// goes back to its own user folder (portable). A folder chosen elsewhere stays. Returns the keys changed.
const EDEN_FOLDERS = [['Data%20Storage', 'nand_directory', 'nand'], ['Data%20Storage', 'sdmc_directory', 'sdmc'],
  ['Data%20Storage', 'load_directory', 'load'], ['Data%20Storage', 'dump_directory', 'dump'], ['Data%20Storage', 'tas_directory', 'tas'],
  ['UI', 'Screenshots\\screenshot_path', 'screenshots']];
function edenFolders(dir) {
  const pads = require('./pad-defaults');
  const file = path.join(dir, 'user', 'config', 'qt-config.ini');
  if (!fs.existsSync(file)) return [];
  const ini = pads.readIni(file);
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const changed = [];
  for (const [sec, key, sub] of EDEN_FOLDERS) {
    const raw = (pads.iniGet(ini, sec, key) || '').trim();
    const v = raw.replace(/^"(.*)"$/, '$1');
    if (!v || !path.isAbsolute(v)) continue;
    const m = /^(.*)[\\/]user[\\/]([^\\/]+)[\\/]?$/.exec(v);
    const otherCopy = m && m[2].toLowerCase() === sub && !same(m[1], dir);
    if (!otherCopy && (fs.existsSync(v) || !fs.existsSync(path.join(dir, 'user', sub)))) continue;
    const to = path.join(dir, 'user', sub).replace(/\\/g, '/');
    pads.iniSet(ini, sec, key, raw.startsWith('"') || /[\s,;=#"]/.test(to) ? `"${to}"` : to, '=');
    changed.push(`${key}: ${v} -> ${to}`);
  }
  if (changed.length) pads.writeIni(file, ini);
  return changed;
}

module.exports = { relocate, pcsx2Folders, edenFolders, styles, files };
