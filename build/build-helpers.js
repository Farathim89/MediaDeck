// Compiles MediaDeck's small helper programs from launcher\*.cs with the C# compiler that comes with Windows
// (.NET Framework 4), into tools\ (or --out <folder>):
//   keys.exe        focus a window, press keys in a game, answer an emulator's "Are you sure?"  (UI Automation)
//   padwatch.exe    watches the controllers for the PS / Guide button and Back + Start
//   cursorhide.exe  hides the mouse pointer in full-screen games
// Used by the release workflow, so the signed programs are built from this source.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? path.resolve(process.argv[argOut + 1]) : path.join(ROOT, 'tools');
const NET = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const CSC = path.join(NET, 'csc.exe');
const WPF = path.join(NET, 'WPF');

const HELPERS = [
  { out: 'keys.exe', src: 'Keys.cs', title: 'MediaDeck keys helper', refs: [path.join(WPF, 'UIAutomationClient.dll'), path.join(WPF, 'UIAutomationTypes.dll'), 'System.Core.dll'] },
  { out: 'padwatch.exe', src: 'PadWatch.cs', title: 'MediaDeck controller watcher', refs: ['System.Core.dll'] },
  { out: 'cursorhide.exe', src: 'CursorHide.cs', title: 'MediaDeck mouse pointer helper', refs: [] },
];
// Each program says what it is: product MediaDeck, the release's version (code signing checks these)
const { version } = require('../package.json');
const v4 = `${version.split(/[^0-9.]/)[0].split('.').concat(['0', '0', '0']).slice(0, 3).join('.')}.0`;
const info = (title) => ['Product("MediaDeck")', `Title("${title}")`, `Description("${title}")`, 'Company("Farathim")', 'Copyright("Farathim, GPL-3.0-or-later")',
  `Version("${v4}")`, `FileVersion("${v4}")`, `InformationalVersion("${v4}")`].map((a) => `[assembly: System.Reflection.Assembly${a}]`).join('\n');

if (!fs.existsSync(CSC)) throw new Error(`The C# compiler was not found: ${CSC}`);
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mediadeck-helpers-'));
try {
  for (const h of HELPERS) {
    const infoFile = path.join(tmp, `${h.out}.info.cs`);
    fs.writeFileSync(infoFile, info(h.title));
    const args = ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', `/out:${path.join(OUT, h.out)}`,
      ...h.refs.map((r) => `/reference:${r}`), path.join(ROOT, 'launcher', h.src), infoFile];
    execFileSync(CSC, args, { stdio: 'inherit' });
    console.log(`${h.out}  ${fs.statSync(path.join(OUT, h.out)).size} bytes  ${h.title} ${version}`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
