// Builds the MediaDeck release:  npm run dist
//  1. electron-builder → dist\win-unpacked (MediaDeck.exe, resources\app.asar, resources\tools)
//  2. dist\MediaDeck: that, plus the bundled media tools from this folder's Apps (mpv, FFmpeg,
//     Streamlink — each with its .mediadeck-version.json, so MediaDeck can update them), the
//     licence and the third-party notices
//  3. dist\MediaDeck-<version>-portable.zip (top folder "MediaDeck") and SHA256SUMS.txt
// Nothing personal goes in: no data, no other apps, no emulators, no BIOS.
// For signing in between (the release workflow): --no-zip stops after step 2; --zip-only <folder> does step 3 for a
// release folder (the signed one).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const { version } = require('../package.json');
const STAGE = path.join(DIST, 'MediaDeck');
const ZIP = path.join(DIST, `MediaDeck-${version}-portable.zip`);
// where the bundled tools come from: --apps <folder> (e.g. an installed MediaDeck's Apps), else this folder's Apps
//   npm run dist -- --apps "D:\MediaDeck\Apps"
const argApps = process.argv.indexOf('--apps');
const APPS_SRC = argApps > 0 ? path.resolve(process.argv[argApps + 1]) : path.join(ROOT, 'Apps');
const argZipOnly = process.argv.indexOf('--zip-only');
const NO_ZIP = process.argv.includes('--no-zip');

// What of each bundled tool ships (paths relative to Apps\<tool>)
const BUNDLE = {
  mpv: (rel) => !/^(installer|doc)([\\/]|$)|^(updater|mpv-register|mpv-unregister)\.bat$/i.test(rel),
  ffmpeg: (rel) => !/^(include|lib|doc)([\\/]|$)|^bin[\\/]ffplay\.exe$/i.test(rel),
  Streamlink: (rel) => !/^ffmpeg([\\/]|$)/i.test(rel),   // it uses MediaDeck's FFmpeg instead
};

function copyTree(from, to, keep, rel = '') {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (!keep(r)) continue;
    if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(to, e.name), keep, r);
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

function buildFolder() {
  console.log(`MediaDeck ${version}: electron-builder…`);
  execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--x64', '--dir', '--publish', 'never'], { cwd: ROOT, stdio: 'inherit' });

  console.log('Putting the release folder together…');
  fs.rmSync(STAGE, { recursive: true, force: true });
  copyTree(path.join(DIST, 'win-unpacked'), STAGE, () => true);
  for (const [tool, keep] of Object.entries(BUNDLE)) {
    const src = path.join(APPS_SRC, tool);
    if (!fs.existsSync(path.join(src, '.mediadeck-version.json'))) throw new Error(`${src} is missing (install it from Settings → Apps first, or pass --apps <folder>)`);
    copyTree(src, path.join(STAGE, 'Apps', tool), keep);
  }
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(STAGE, 'LICENSE.txt'));
  fs.copyFileSync(path.join(__dirname, 'THIRD-PARTY-NOTICES.txt'), path.join(STAGE, 'THIRD-PARTY-NOTICES.txt'));
}

// The zip's top folder is "MediaDeck" (it unpacks to MediaDeck\MediaDeck.exe), whatever the folder is called
function zipFolder(folder) {
  console.log('Zipping…');
  const src = path.resolve(folder);
  const top = src === STAGE ? STAGE : path.join(DIST, '_zip', 'MediaDeck');
  if (top !== STAGE) { fs.rmSync(path.dirname(top), { recursive: true, force: true }); copyTree(src, top, () => true); }
  fs.rmSync(ZIP, { force: true });
  execFileSync(path.join(ROOT, 'tools', '7za.exe'), ['a', '-tzip', '-mx=7', ZIP, top], { stdio: 'ignore' });
  if (top !== STAGE) fs.rmSync(path.dirname(top), { recursive: true, force: true });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(ZIP)).digest('hex');
  fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), `${sha}  ${path.basename(ZIP)}\n`);
  console.log(`${path.basename(ZIP)}  ${(fs.statSync(ZIP).size / 1048576).toFixed(1)} MB\nSHA-256 ${sha}`);
}

if (argZipOnly > 0) zipFolder(process.argv[argZipOnly + 1]);
else {
  buildFolder();
  if (!NO_ZIP) zipFolder(STAGE);
}
