// MediaDeck updates itself from its GitHub releases (the portable folder zip):
//  1. check: the latest release's version against this one (at every start, or from Settings → About)
//  2. install: download the zip, check its SHA-256 (from the release), unpack it to a temp folder,
//     then a small PowerShell script waits for MediaDeck to close, copies the new program files over
//     the old ones and starts MediaDeck again. data, Apps, Emu_modules, Emulator backups and BIOS are
//     never touched (the zip's own Apps are skipped: those update from Settings → Apps).
// Only for the built app; run from source, the update is a git pull.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const emu = require('./emu-installer');
const P = require('./paths');

const REPO = 'Farathim89/MediaDeck';
const ASSET = /^MediaDeck-.*-portable\.zip$/i;

const parts = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
function newer(a, b) {   // a > b
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

async function check(net) {
  const rel = await emu.githubLatest(REPO, net);
  const asset = rel.assets.find((a) => ASSET.test(a.name));
  const latest = rel.tag.replace(/^v/i, '');
  // what's new: the release notes' bold headings ("- **Game cards: big covers, small covers or a list.** …")
  const notes = [...String(rel.body || '').matchAll(/^\s*-\s+\*\*(.+?)\*\*/gm)].map((m) => m[1].replace(/[.:]\s*$/, '')).slice(0, 4);
  return { current: app.getVersion(), latest, update: !!asset && newer(latest, app.getVersion()), asset, canInstall: app.isPackaged, notes };
}

// Downloads and unpacks the new version, then hands over to the script and quits
async function install(net, progress = () => {}) {
  if (!app.isPackaged) throw new Error('Run from source: update it with git pull');
  const info = await check(net);
  if (!info.update) throw new Error('MediaDeck is up to date');
  const work = path.join(app.getPath('temp'), `mediadeck-update-${Date.now()}`);
  await fsp.mkdir(work, { recursive: true });
  const zip = path.join(work, info.asset.name);
  await emu.download(info.asset.url, zip, net, (got, total) => progress(`MediaDeck ${info.latest}: downloading ${Math.round(got / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? got / total : 0));
  // MediaDeck itself is only replaced by a download that matches the checksum GitHub gives for it (none when GitHub
  // only answered with its web page, e.g. too many questions in an hour: then later)
  if (!(await emu.checkDigest(zip, info.asset.digest, 'The download'))) throw new Error('GitHub gave no checksum for the download, so it can\'t be checked - try again later');
  progress('MediaDeck: unpacking…', 1);
  const out = path.join(work, 'new');
  await emu.unpack(P.tool('7za.exe'), zip, out);
  // the folder that holds MediaDeck.exe (the zip has a top folder)
  const dir = await emu.findExeDir(out, /^MediaDeck\.exe$/i);
  if (!dir) throw new Error('MediaDeck.exe was not found in the download');
  const exe = path.join(P.ROOT, 'MediaDeck.exe');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const script = path.join(work, 'update.ps1');
  await fsp.writeFile(script, [
    '$ErrorActionPreference = "SilentlyContinue"',
    `Wait-Process -Id ${process.pid} -Timeout 60`,
    'Start-Sleep -Milliseconds 800',
    // /E: with sub folders; /XD: never the user's folders (the zip has no data; its Apps are skipped)
    `robocopy ${q(dir)} ${q(P.ROOT)} /E /R:5 /W:1 /NFL /NDL /NJH /NJS /XD ${q(path.join(dir, 'Apps'))} ${q(path.join(dir, 'data'))} | Out-Null`,
    `Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(P.ROOT)}`,
    `Remove-Item -LiteralPath ${q(work)} -Recurse -Force`,
  ].join('\r\n'));
  // PowerShell started straight from here (detached, so it outlives MediaDeck) gets no console and
  // quits at once; a tiny VBScript starts it hidden instead (cmd's "start" if Windows Script Host is off)
  const vbs = path.join(work, 'update.vbs');
  await fsp.writeFile(vbs, `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${script}""", 0, False\r\n`);
  const run = spawn('wscript.exe', ['//B', '//Nologo', vbs], { detached: true, stdio: 'ignore', windowsHide: true });
  run.on('error', () => spawn('cmd.exe', ['/d', '/c', 'start', '""', '/min', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref());
  run.unref();
  setTimeout(() => app.quit(), 300);
  return { version: info.latest };
}

module.exports = { check, install, newer };
