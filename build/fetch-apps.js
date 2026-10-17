// Downloads the media tools MediaDeck ships with (mpv, FFmpeg, Streamlink) into <folder>\<tool>, the way Settings →
// Apps installs them (latest release of each, checked against GitHub's SHA-256, .mediadeck-version.json written),
// for a build without an installed MediaDeck - the release workflow:   node build/fetch-apps.js <folder>
// Then:  node build/build.js --apps <folder>
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const emu = require('../emu-installer');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'Apps'));
const SEVEN_ZIP = path.join(ROOT, 'tools', '7za.exe');
// the same downloads as app-installer.js CATALOG (mpv, ffmpeg, streamlink)
const TOOLS = [
  { id: 'mpv', gh: 'zhongfly/mpv-winbuild', asset: /^mpv-x86_64-\d.*\.7z$/i, dir: 'mpv', exe: 'mpv.exe', up: 0 },
  { id: 'ffmpeg', gh: 'BtbN/FFmpeg-Builds', asset: /^ffmpeg-master-latest-win64-gpl-shared\.zip$/i, dir: 'ffmpeg', exe: 'ffmpeg.exe', up: 1 },
  { id: 'streamlink', gh: 'streamlink/windows-builds', asset: /-x86_64\.zip$/i, dir: 'Streamlink', exe: 'streamlink.exe', up: 1 },
];
// GitHub's API allows more questions with the workflow's token
const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
const net = { fetch: (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(/api\.github\.com/.test(url) ? headers : {}) } }) };

(async () => {
  for (const t of TOOLS) {
    const rel = await emu.githubLatest(t.gh, net);
    const asset = rel.assets.find((x) => t.asset.test(x.name));
    if (!asset) throw new Error(`${t.id}: no Windows download in ${t.gh} ${rel.tag}`);
    const version = /^latest$/i.test(rel.tag) ? (asset.date || '').slice(0, 10) || rel.tag : rel.tag.replace(/^v/i, '');
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), `mediadeck-${t.id}-`));
    try {
      const file = path.join(work, asset.name);
      await emu.download(asset.url, file, net, () => {});
      const sha = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '');
      if (sha && crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex') !== sha[1]) throw new Error(`${t.id}: the download does not match its checksum`);
      await emu.unpack(SEVEN_ZIP, file, path.join(work, 'out'));
      const exeRe = new RegExp(`^${t.exe.replace('.', '\\.')}$`, 'i');
      let dir = await emu.findExeDir(path.join(work, 'out'), exeRe);
      if (!dir) throw new Error(`${t.id}: ${t.exe} was not found in the download`);
      for (let i = 0; i < t.up; i++) dir = path.dirname(dir);
      const dest = path.join(OUT, t.dir);
      await fsp.rm(dest, { recursive: true, force: true });
      await fsp.cp(dir, dest, { recursive: true });
      await fsp.writeFile(path.join(dest, '.mediadeck-version.json'), JSON.stringify({ version, stamp: `${rel.tag}|${asset.name}|${asset.date || ''}`, installed: new Date().toISOString() }, null, 2));
      console.log(`${t.id} ${version}  (${asset.name})`);
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
