// Apps MediaDeck can install and update (Settings → Apps), each from its own GitHub releases:
// the latest portable build, unpacked into Apps\<folder> next to MediaDeck.
//  - an update replaces the program's files and keeps everything else (sign-ins, settings and
//    data folders the apps keep next to themselves are not in the downloads)
//  - the version is kept in Apps\<folder>\.mediadeck-version.json, so it travels with the folder
//  - the download is checked against GitHub's SHA-256 when the release lists one
//  - driver installers (ViGEmBus, HidHide) are only downloaded to Apps\Setup; Windows runs them
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const emu = require('./emu-installer');
const P = require('./paths');

const CATALOG = {
  plexdeck: { name: 'PlexDeck', desc: 'Plex for movies & TV, with a TV mode for the controller', gh: 'Farathim89/plexdeck', asset: /^PlexDeck-Portable-.*\.zip$/i,
    dir: 'PlexDeck', exe: 'PlexDeck.exe', tile: { name: 'Plex', args: '--fullscreen --tv', subtitle: 'Movies & TV' } },
  absda: { name: 'ABS-DA', desc: 'Audiobookshelf: audiobooks, podcasts and e-books', gh: 'Farathim89/abs-da', asset: /^ABS-DA-Folder-.*\.zip$/i,
    dir: 'Audiobookshelf', exe: 'ABS Desktop App.exe', tile: { name: 'Audiobookshelf', subtitle: 'Audiobooks & podcasts' } },
  mpv: { name: 'mpv', desc: 'The video player behind the Media Player and Twitch', gh: 'zhongfly/mpv-winbuild', asset: /^mpv-x86_64-\d.*\.7z$/i,
    dir: 'mpv', exe: 'mpv.exe' },
  ffmpeg: { name: 'FFmpeg', desc: 'Thumbnails, and converting videos mpv can\'t play directly', gh: 'BtbN/FFmpeg-Builds', asset: /^ffmpeg-master-latest-win64-gpl-shared\.zip$/i,
    // the programs only: no ffplay and no developer files (include, lib, doc)
    dir: 'ffmpeg', exe: 'ffmpeg.exe', up: 1, skip: (rel) => /^(include|lib|doc)([\\/]|$)|^bin[\\/]ffplay\.exe$/i.test(rel) },
  streamlink: { name: 'Streamlink', desc: 'Plays Twitch streams without the ads', gh: 'streamlink/windows-builds', asset: /-x86_64\.zip$/i,
    dir: 'Streamlink', exe: 'streamlink.exe', up: 1, auto: true,
    // its own copy of ffmpeg (145 MB) is left out when MediaDeck has one
    skip: (rel) => /^ffmpeg([\\/]|$)/i.test(rel) && fs.existsSync(path.join(P.APPS, 'ffmpeg', 'bin', 'ffmpeg.exe')) },
  ds4windows: { name: 'DS4Windows', desc: 'PlayStation controllers as Xbox controllers (needs the .NET 8 Desktop Runtime)', gh: 'schmaldeo/DS4Windows', asset: /_x64\.zip$/i,
    dir: 'DS4Windows', exe: 'DS4Windows.exe', keepTop: /\.xml$/i },
  vigembus: { name: 'ViGEmBus driver', desc: 'Needed by DS4Windows (installer; Windows asks to allow it)', gh: 'nefarius/ViGEmBus', asset: /\.exe$/i, setup: true },
  hidhide: { name: 'HidHide driver', desc: 'Hides the real controller from games (installer; Windows asks to allow it)', gh: 'nefarius/HidHide', asset: /x64\.exe$/i, setup: true },
};

const SETUP_DIR = path.join(P.APPS, 'Setup');
const appDir = (a) => path.join(P.APPS, a.dir);
const verFile = (a) => (a.setup ? path.join(SETUP_DIR, `.${a.gh.split('/')[1]}-version.json`) : path.join(appDir(a), '.mediadeck-version.json'));
const readVer = (a) => { try { return JSON.parse(fs.readFileSync(verFile(a), 'utf8')); } catch { return null; } };

// the program's path (for apps), or the newest downloaded installer (for drivers)
function exePath(id) {
  const a = CATALOG[id];
  if (!a) return null;
  if (a.setup) {
    try {
      const f = fs.readdirSync(SETUP_DIR).filter((x) => a.asset.test(x) && x.toLowerCase().startsWith(a.gh.split('/')[1].toLowerCase())).sort().pop();
      return f ? path.join(SETUP_DIR, f) : null;
    } catch { return null; }
  }
  const p = path.join(appDir(a), a.up ? 'bin' : '', a.exe);
  return fs.existsSync(p) ? p : null;
}

// An app installed before MediaDeck kept its version: asked from the app itself
//  (Electron apps: their package; Streamlink: --version; installers: their file name)
async function detectVersion(id, exe) {
  const a = CATALOG[id];
  try {
    if (a.setup) return (/_(\d+(?:\.\d+)+)/.exec(path.basename(exe)) || [])[1] || '';
    if (id === 'streamlink') {
      return await new Promise((res) => execFile(exe, ['--version'], { windowsHide: true, timeout: 20000 }, (e, out) => res(String(out || '').trim().split(' ').pop())));
    }
    const pkg = path.join(appDir(a), 'resources', 'app.asar', 'package.json');   // Electron reads inside .asar
    if (fs.existsSync(path.join(appDir(a), 'resources', 'app.asar'))) return JSON.parse(fs.readFileSync(pkg, 'utf8')).version || '';
  } catch {}
  return '';
}
// "v1.5.230.0" / "8.6.2-1" / "1.5.230" → comparable
const plain = (v) => String(v || '').replace(/^v/i, '').replace(/-\d+$/, '').replace(/(\.0)+$/, '');

// What is installed, and (asked from GitHub when check = true) the latest version
async function status(net, check = false) {
  const out = [];
  await Promise.all(Object.entries(CATALOG).map(async ([id, a]) => {
    const exe = exePath(id);
    let rec = readVer(a);
    if (exe && !rec && check) {
      const v = await detectVersion(id, exe);
      if (v) {
        try {
          const latest = await emu.resolveUrl({ gh: a.gh, asset: a.asset }, net);
          rec = { version: v, stamp: plain(v) === plain(latest.version) ? latest.stamp : '', detected: true };
          if (rec.stamp) await fsp.writeFile(verFile(a), JSON.stringify({ ...rec, installed: new Date().toISOString() }, null, 2));
        } catch { rec = { version: v, stamp: '' }; }
      }
    }
    const row = { id, name: a.name, desc: a.desc, setup: !!a.setup, installed: !!exe, version: rec ? rec.version : '', exe };
    if (check) {
      try {
        const latest = await emu.resolveUrl({ gh: a.gh, asset: a.asset }, net);
        row.latest = latest.version;
        row.update = !!exe && (!rec || !sameStamp(rec.stamp, latest.stamp));
      } catch (e) { row.error = e.message; }
    }
    out.push(row);
  }));
  const order = Object.keys(CATALOG);
  return out.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
}
const sameStamp = (a, b) => { const x = String(a || '').split('|'), y = String(b || '').split('|'); return x[0] === y[0] && x[1] === y[1]; };

const running = (exeName) => new Promise((res) => execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], { windowsHide: true },
  (e, out) => res(!e && String(out).toLowerCase().includes(exeName.toLowerCase()))));

// Copies the new files over the old ones; keeps what the download doesn't have
async function overlay(from, to, a, rel = '') {
  await fsp.mkdir(to, { recursive: true });
  for (const e of await fsp.readdir(from, { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (a.skip && a.skip(r)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) { await overlay(src, dst, a, r); continue; }
    if (!rel && a.keepTop && a.keepTop.test(e.name) && fs.existsSync(dst)) continue;   // its own settings
    await fsp.copyFile(src, dst);
  }
}

// Installs or updates one app. opts: { net, tempDir, progress(text, pct) }
async function install(id, opts) {
  const a = CATALOG[id];
  if (!a) throw new Error('Unknown app');
  const say = opts.progress || (() => {});
  if (!a.setup && exePath(id) && await running(path.basename(a.exe))) throw new Error(`Close ${a.name} first, then update it`);
  say(`${a.name}: finding the latest version…`, 0);
  const rel = await emu.githubLatest(a.gh, opts.net);
  const asset = rel.assets.find((x) => a.asset.test(x.name));
  if (!asset) throw new Error(`${a.name}: no Windows download in the latest release`);
  const version = /^latest$/i.test(rel.tag) ? (asset.date || '').slice(0, 10) || rel.tag : rel.tag.replace(/^v/i, '');
  const work = path.join(opts.tempDir, `mediadeck-app-${id}-${Date.now()}`);
  await fsp.mkdir(work, { recursive: true });
  try {
    const file = path.join(work, asset.name);
    await emu.download(asset.url, file, opts.net, (got, total) => say(`${a.name} ${version}: downloading ${Math.round(got / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? got / total : 0));
    const sha = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '');
    if (sha && crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex') !== sha[1]) throw new Error(`${a.name}: the download does not match its checksum`);
    const stamp = `${rel.tag}|${asset.name}|${asset.date || ''}`;
    if (a.setup) {
      await fsp.mkdir(SETUP_DIR, { recursive: true });
      await fsp.copyFile(file, path.join(SETUP_DIR, asset.name));
    } else {
      say(`${a.name}: unpacking…`, 1);
      const out = path.join(work, 'out');
      await emu.unpack(P.tool('7za.exe'), file, out);
      const exeRe = new RegExp('^' + a.exe.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '$', 'i');
      let dir = await emu.findExeDir(out, exeRe);
      if (!dir) throw new Error(`${a.name}: ${a.exe} was not found in the download`);
      for (let i = 0; i < (a.up || 0); i++) dir = path.dirname(dir);
      await overlay(dir, appDir(a), a);
    }
    await fsp.writeFile(verFile(a), JSON.stringify({ version, stamp, installed: new Date().toISOString() }, null, 2));
    say(`${a.name} ${version} installed`, 1);
    return { id, name: a.name, version, tile: a.tile ? { ...a.tile, path: exePath(id) } : null };
  } finally {
    fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { CATALOG, status, install, exePath };
