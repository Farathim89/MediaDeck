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
  { out: 'keys.exe', src: 'Keys.cs', refs: [path.join(WPF, 'UIAutomationClient.dll'), path.join(WPF, 'UIAutomationTypes.dll'), 'System.Core.dll'] },
  { out: 'padwatch.exe', src: 'PadWatch.cs', refs: ['System.Core.dll'] },
  { out: 'cursorhide.exe', src: 'CursorHide.cs', refs: [] },
];

if (!fs.existsSync(CSC)) throw new Error(`The C# compiler was not found: ${CSC}`);
fs.mkdirSync(OUT, { recursive: true });
for (const h of HELPERS) {
  const args = ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', `/out:${path.join(OUT, h.out)}`,
    ...h.refs.map((r) => `/reference:${r}`), path.join(ROOT, 'launcher', h.src)];
  execFileSync(CSC, args, { stdio: 'inherit' });
  console.log(`${h.out}  ${fs.statSync(path.join(OUT, h.out)).size} bytes`);
}
