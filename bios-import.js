// BIOS import: the user points at a folder (or zip / 7z) of their own BIOS files. Each file is recognised by its
// checksum (bios-db.json, from libretro-database), gets its proper name and is copied into BIOS\<console>;
// files checksums can't tell (Xbox, Switch keys, PS3 firmware) go by their exact name. Nothing is moved, renamed
// or overwritten where it came from; a different file already in BIOS\<console> is kept. Nothing is downloaded.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DB = require('./bios-db.json').files;          // md5 → [folder, name, size]
const KNOWN_NAMES = new Set(Object.values(DB).map(([, n]) => n.toLowerCase()));
// By exact name (and size where it is fixed)
const BY_NAME = [
  { re: /^mcpx_1\.0\.bin$/i, size: 512, folder: 'Microsoft - Xbox', name: 'mcpx_1.0.bin' },
  { re: /^complex_4627\.bin$/i, size: 1048576, folder: 'Microsoft - Xbox', name: 'Complex_4627.bin' },
  { re: /^xbox_hdd\.qcow2$/i, folder: 'Microsoft - Xbox', name: 'xbox_hdd.qcow2' },
  { re: /^(prod|title)\.keys$/i, folder: 'Nintendo - Switch' },
  { re: /^ps3updat\.pup$/i, folder: 'Sony - PlayStation 3', name: 'PS3UPDAT.PUP' },
];
// A PS2 BIOS dump comes with files of the same name next to it (its NVM, MEC, ROM1 …): they go along
const PS2_SIDE = /\.(nvm|mec|rom0|rom1|rom2|erom)$/i;
const ARCHIVE = /\.(zip|7z|rar)$/i;
const MAX_HASH = 64 * 1024 * 1024;

const md5Of = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('md5');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

function walk(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

const unpack = (sevenZip, archive, dest) => new Promise((resolve) => {
  execFile(sevenZip, ['x', '-y', `-o${dest}`, archive], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err) => resolve(!err));
});

// sources: files and folders; opts: { sevenZip, tempDir, progress(text) }. Returns what happened.
async function importBios(sources, biosDir, opts = {}) {
  const say = opts.progress || (() => {});
  const result = { added: [], already: 0, kept: [], unknown: 0, badDumps: [], scanned: 0 };
  const temps = [];
  const queue = [];
  for (const s of sources || []) {
    try { if (fs.statSync(s).isDirectory()) queue.push(...walk(s)); else queue.push(s); } catch {}
  }
  const place = async (file, folder, name, md5) => {
    const dest = path.join(biosDir, folder, name);
    if (fs.existsSync(dest)) {
      if (md5 && (await md5Of(dest)) === md5) result.already++;
      else if (!md5 && fs.statSync(dest).size === fs.statSync(file).size) result.already++;
      else result.kept.push(`${folder}\\${name}`);
      return false;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    result.added.push({ folder, name, from: file });
    return true;
  };
  try {
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      const base = path.basename(file);
      let size = 0;
      try { size = fs.statSync(file).size; } catch { continue; }
      result.scanned++;
      if (result.scanned % 25 === 0) say(`Looking at ${result.scanned} files…`);
      const named = BY_NAME.find((x) => x.re.test(base) && (!x.size || x.size === size));
      if (named) { await place(file, named.folder, named.name || base, null); continue; }
      const md5 = size <= MAX_HASH ? await md5Of(file) : null;
      const hit = md5 && DB[md5];
      if (hit) {
        const [folder, name] = hit;
        await place(file, folder, name, md5);
        // a PS2 dump's own side files (same name, other endings) go along, named like it
        if (folder === 'Sony - PlayStation 2') {
          const stem = base.replace(/\.[^.]+$/, '').toLowerCase();
          const newStem = name.replace(/\.[^.]+$/, '');
          for (const side of fs.readdirSync(path.dirname(file))) {
            if (PS2_SIDE.test(side) && side.replace(/\.[^.]+$/, '').toLowerCase() === stem) {
              await place(path.join(path.dirname(file), side), folder, newStem + path.extname(side).toLowerCase(), null);
            }
          }
        }
        continue;
      }
      // an archive that isn't a BIOS itself (neogeo.zip is): look inside
      if (ARCHIVE.test(base) && opts.sevenZip && opts.tempDir && size < 1024 * 1024 * 1024) {
        const t = path.join(opts.tempDir, `bios-import-${Date.now()}-${i}`);
        temps.push(t);
        if (await unpack(opts.sevenZip, file, t)) queue.push(...walk(t));
        continue;
      }
      if (KNOWN_NAMES.has(base.toLowerCase()) && !PS2_SIDE.test(base)) result.badDumps.push(base);   // the name of a BIOS, not its checksum
      else result.unknown++;
    }
  } finally {
    for (const t of temps) fs.promises.rm(t, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}

module.exports = { importBios };
