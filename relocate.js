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

module.exports = { relocate, styles, files };
