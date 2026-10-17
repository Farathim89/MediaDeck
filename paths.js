// Where MediaDeck keeps things. Portable: everything sits next to the program, never in AppData.
//  - run from the source folder (npm start): that folder
//  - built (MediaDeck.exe): the folder that holds MediaDeck.exe
// ROOT\data            settings, history, covers (encrypted where personal)
// ROOT\Apps            apps installed from MediaDeck (PlexDeck, ABS-DA, Streamlink, mpv, DS4Windows …)
// ROOT\Emu_modules     emulators;  ROOT\Emulator backups  files an emulator update replaced
// ROOT\BIOS            BIOS files you add yourself (never shipped or downloaded)
// ROOT\Games           a new MediaDeck's games folder: Games\<maker>\<console>, made at the first start
// TOOLS                MediaDeck's own helper programs (outside app.asar, so Windows can run them)
const { app } = require('electron');
const path = require('path');

// (from source, MEDIADECK_ROOT can point at an installed MediaDeck folder, to try new code on its data)
const ROOT = app.isPackaged ? path.dirname(process.execPath) : (process.env.MEDIADECK_ROOT || __dirname);
const TOOLS = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, 'tools');

module.exports = {
  ROOT,
  TOOLS,
  DATA: path.join(ROOT, 'data'),
  APPS: path.join(ROOT, 'Apps'),
  EMU: path.join(ROOT, 'Emu_modules'),
  EMU_BACKUPS: path.join(ROOT, 'Emulator backups'),
  BIOS: path.join(ROOT, 'BIOS'),
  GAMES: path.join(ROOT, 'Games'),
  tool: (name) => path.join(TOOLS, name),
  // Paths inside MediaDeck's folder are stored relative to it (Apps\PlexDeck\PlexDeck.exe), so the
  // folder can move (another drive, a USB stick); resolve() turns them back into full paths
  rel: (p) => { if (!p) return p; const r = path.relative(ROOT, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; },
  resolve: (p) => (p && !path.isAbsolute(p) && !/^[a-z][a-z0-9+.-]+:/i.test(p) ? path.join(ROOT, p) : p),
};
