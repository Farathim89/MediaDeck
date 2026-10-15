// Settings screen: sections on the left, settings on the right.
// Row types: toggle, choice, text, file, folder, action, info.
const Settings = (() => {
  const el = document.getElementById('settings');
  const navEl = el.querySelector('.tabs');
  const listEl = el.querySelector('.settings-list');
  const titleEl = el.querySelector('.settings-title');
  const descEl = el.querySelector('.settings-desc');
  let active = 'general';
  let info = null;

  const s = () => App.state.config.settings;
  const save = () => api.saveConfig(App.state.config);
  const choiceName = (opts, v) => (opts.find((o) => o.value === v) || {}).label || v || '';
  const secs = (list) => list.map((v) => ({ value: v, label: v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}` }));

  const SECTIONS = [
    {
      id: 'general', title: 'General', icon: 'settings', desc: 'How MediaDeck starts and behaves',
      items: [
        { label: 'Full screen', desc: 'F11 does the same. MediaDeck remembers it for next time.', type: 'action', value: () => (s().fullscreen ? 'On' : 'Off'),
          run: async () => { s().fullscreen = await api.toggleFullscreen(); } },
        { label: '24-hour clock', type: 'toggle', key: 'clock24h' },
        { label: 'Minimise when an app starts', desc: 'MediaDeck comes back when the app closes', type: 'toggle', key: 'minimizeOnLaunch' },
        { label: 'Hide the mouse pointer', desc: 'In full-screen apps and games, when the mouse has not moved for a while', type: 'choice', key: 'hideCursor', options: () => [
          { value: 0, label: 'Never' }, { value: 5, label: 'After 5 seconds' }, { value: 10, label: 'After 10 seconds' }, { value: 30, label: 'After 30 seconds' }] },
      ],
    },
    {
      id: 'appearance', title: 'Appearance', icon: 'palette', desc: 'Theme and colours',
      items: [
        { label: 'Theme', type: 'choice', key: 'theme', options: () => App.THEMES.map((t) => ({ value: t.id, label: t.name })),
          after: (v) => App.applyTheme(v) },
      ],
    },
    {
      id: 'media', title: 'Media Player', icon: 'media', desc: 'Browsing your drives and folders',
      items: [
        { label: 'Show all files', desc: 'Off: only folders, videos, music and pictures', type: 'toggle', key: 'showAllFiles' },
        { label: 'Show only USB drives', desc: 'Hides the PC\'s own drives in the Media Player; USB sticks and drives still show up', type: 'toggle', key: 'usbOnly' },
        { label: 'Hidden drives', desc: 'Hide a drive with Y on it in the Media Player', type: 'action',
          value: () => { const n = (s().hiddenDrives || []).length; return n ? `${n} hidden` : 'None'; }, run: () => manageHiddenDrives() },
        { label: 'Sort folders by', type: 'choice', key: 'sortBy', options: () => [
          { value: 'name', label: 'Name' }, { value: 'date', label: 'Newest first' }, { value: 'size', label: 'Size' }] },
        { label: 'Thumbnails', desc: 'Pictures of videos, music and photos. Turn off for very slow drives.', type: 'toggle', key: 'thumbnails' },
        { label: 'Folder pictures', desc: 'poster.jpg / folder.jpg, or a frame from the film inside', type: 'toggle', key: 'folderArt' },
        { label: 'Keep thumbnails after closing', desc: 'Off: thumbnails are deleted when MediaDeck closes. They are always stored encrypted.', type: 'toggle', key: 'keepThumbnails' },
      ],
    },
    {
      id: 'playback', title: 'Playback', icon: 'play', desc: 'Skipping, resuming and the player controls',
      items: [
        { label: 'Skip back (left arrow)', type: 'choice', key: 'skipBack', options: () => secs([5, 10, 15, 30]) },
        { label: 'Skip forward (right arrow)', type: 'choice', key: 'skipForward', options: () => secs([10, 15, 30, 60]) },
        { label: 'Big skip (LT / RT)', desc: 'The triggers on the controller', type: 'choice', key: 'skipBig', options: () => secs([30, 60, 120, 300, 600]) },
        { label: 'When a video was started before', type: 'choice', key: 'resumeMode', options: () => [
          { value: 'ask', label: 'Ask' }, { value: 'resume', label: 'Always resume' }, { value: 'start', label: 'Always start over' }] },
        { label: 'Play the next file automatically', type: 'toggle', key: 'autoplayNext' },
        { label: 'Count as watched at', desc: 'How far into a video it is marked as watched', type: 'choice', key: 'watchedAt', options: () =>
          [85, 90, 92, 95, 98].map((v) => ({ value: v, label: `${v}%` })) },
        { label: 'Hide the controls after', type: 'choice', key: 'osdHide', options: () => [
          ...[3, 4, 6, 10].map((v) => ({ value: v, label: `${v} seconds` })), { value: 'never', label: 'Never' }] },
        { label: 'Start volume', type: 'choice', key: 'volume', options: () => [100, 90, 80, 70, 60, 50].map((v) => ({ value: v, label: `${v}%` })) },
        { label: 'Start speed', type: 'choice', key: 'defaultSpeed', options: () =>
          [0.75, 1, 1.25, 1.5].map((v) => ({ value: v, label: v === 1 ? 'Normal' : `${v}×` })) },
        { label: 'Clock in the player', type: 'toggle', key: 'playerClock' },
      ],
    },
    {
      id: 'subs', title: 'Subtitles & audio', icon: 'subs', desc: 'Which languages and how subtitles look',
      items: [
        { label: 'Audio language', desc: 'Language codes in order, e.g. jpn,eng (empty = the file\'s default)', type: 'text', key: 'audioLang' },
        { label: 'Subtitle language', desc: 'Language codes in order, e.g. eng,swe', type: 'text', key: 'subLang' },
        { label: 'Subtitles', type: 'choice', key: 'subtitles', options: () => [
          { value: 'auto', label: 'Automatic' }, { value: 'off', label: 'Off' }] },
        { label: 'Subtitle size', type: 'choice', key: 'subSize', options: () => ['Small', 'Normal', 'Large', 'Huge'].map((v) => ({ value: v, label: v })) },
        { label: 'Remember my subtitle choice', desc: 'Keeps the language you pick for the next files', type: 'toggle', key: 'rememberSubs' },
      ],
    },
    {
      id: 'video', title: 'Video', icon: 'film', desc: 'How videos are drawn and converted',
      items: [
        { label: 'Video renderer', desc: 'How mpv draws the picture. Direct3D 11 is the safe choice.', type: 'choice', key: 'mpvGpuApi', options: () => [
          { value: 'd3d11', label: 'Direct3D 11' }, { value: 'vulkan', label: 'Vulkan' }, { value: 'opengl', label: 'OpenGL' }] },
        { label: 'Hardware video converting', desc: 'Uses the graphics card when a video has to be converted', type: 'toggle', key: 'hardwareEncode' },
      ],
    },
    {
      id: 'twitch', title: 'Twitch', icon: 'twitch', desc: 'Live streams and videos (played through Streamlink, without ads)',
      items: [
        { label: 'Stream quality', desc: 'The best quality a stream has up to this one', type: 'choice', key: 'twitchQuality', options: () => [
          { value: 'best', label: 'Best (source)' }, { value: '1080p60', label: '1080p' }, { value: '720p60', label: '720p' },
          { value: '480p30', label: '480p' }, { value: '360p30', label: '360p' }, { value: 'audio_only', label: 'Audio only' }] },
      ],
    },
    {
      id: 'apps', title: 'Apps', icon: 'plus', desc: 'Apps MediaDeck installs and keeps up to date (into its Apps folder)',
      items: () => [
        ...(apps || []).map((a) => ({
          label: a.name, desc: a.desc, type: 'action',
          value: () => (!a.installed ? (a.setup ? 'Not downloaded' : 'Not installed - install')
            : a.update ? `${a.version || 'version unknown'}  →  update to ${a.latest}` : (a.version || 'Installed')),
          run: () => installApp(a),
        })),
        { label: 'Check for updates', desc: 'Asks each app\'s GitHub releases for a newer version', type: 'action', run: () => refreshApps(true, true) },
        { label: 'Check for updates at start', desc: 'Once a day. Streamlink updates by itself; for the others MediaDeck tells you.', type: 'toggle', key: 'checkAppUpdates' },
        { label: 'Open the Apps folder', type: 'action', run: () => api.openPath(info && info.appsDir) },
      ],
    },
    {
      id: 'emulators', title: 'Emulators', icon: 'gamepad', desc: 'Emulators come from the Emu_modules folder',
      // Fixed rows, then one "game folders" row per emulator
      items: () => [
        { label: 'Install emulators', desc: 'Pick a console, tick the emulators you want, and they are downloaded and set up', type: 'action', icon: 'plus',
          run: () => installEmulators() },
        { label: 'Check for updates', desc: 'Newer versions of your emulators. Settings, saves and BIOS stay.', type: 'action', icon: 'refresh',
          value: () => (updateInfo == null ? '' : updateInfo ? `${updateInfo} available` : 'All up to date'), run: () => updateEmulators() },
        { label: 'Games folder', desc: 'Where your games are, one folder per console (or per maker, then console). New emulators get their console\'s folder from here.', type: 'folder', key: 'gamesFolder' },
        { label: 'Emu_modules folder', desc: 'Put an emulator\'s folder here and it shows up in the app', type: 'folder', key: 'emuModulesPath',
          value: () => s().emuModulesPath || (info && info.emuDir) || '', after: () => rescan(true) },
        { label: 'Recently played', desc: 'Where the last 5 games show on the Consoles tab', type: 'choice', key: 'recentPosition', options: () => [
          { value: 'below', label: 'Below the consoles' }, { value: 'above', label: 'Above the consoles' }] },
        { label: 'Check for updates at start', desc: 'Once a day, a while after MediaDeck opens. Only asks the emulators\' download pages.', type: 'toggle', key: 'checkEmuUpdates' },
        { label: 'Show consoles without games', desc: 'Off: a console only gets a card once its emulator has games for it', type: 'toggle', key: 'showEmptyConsoles' },
        { label: 'Open the Emu_modules folder', type: 'action', run: () => api.openPath(s().emuModulesPath || (info && info.emuDir)) },
        { label: 'Download covers automatically', desc: 'Once a day, a while after start: box art for games that have none (new games too). Game names / PS3 serials go to libretro and GameTDB.', type: 'toggle', key: 'autoCovers' },
        { label: 'Download covers for all emulators', desc: 'Box art from the libretro library (game names are sent to it), PS3 and Switch from GameTDB. Stored encrypted.', type: 'action',
          run: () => downloadAllCovers() },
        { label: 'Look for new emulators', type: 'action', value: () => (info && info.emuCount != null ? `${info.emuCount} found` : ''), run: () => rescan(true) },
        ...gameFolderRows(),
      ],
    },
    {
      id: 'controllers', title: 'Controllers', icon: 'gamepad', desc: 'PlayStation controllers work everywhere through DS4Windows',
      items: () => [
        { label: 'ViGEmBus driver', desc: 'Required: lets DS4Windows make a virtual Xbox controller', type: 'action',
          value: () => ctlLabel(ctl && ctl.vigem), run: () => installPart('vigem', 'ViGEmBus') },
        { label: 'HidHide driver', desc: 'Hides the real PS4 controller from games, so they don\'t see it twice', type: 'action',
          value: () => ctlLabel(ctl && ctl.hidhide), run: () => installPart('hidhide', 'HidHide') },
        { label: 'DS4Windows', desc: 'Turns the PS4 controller into an Xbox controller (PS button = Guide)', type: 'action',
          value: () => (!ctl ? '…' : ctl.ds4 === 'running' ? 'Running' : ctl.ds4 === 'installed' ? 'Ready - open it' : 'Not installed - install'),
          run: async () => {
            if (ctl && ctl.ds4 === 'missing') {
              if (!apps) apps = await api.appsStatus(false);
              await installApp(apps.find((a) => a.id === 'ds4windows'));
              return refreshCtl();
            }
            if (await api.openDs4()) UI.toast('DS4Windows is starting', { icon: 'gamepad' });
            setTimeout(refreshCtl, 4000);
          } },
        { label: 'Xbox button opens Game Bar', desc: 'Windows opens its Xbox Game Bar on the Guide / PS button. Turn it off so only MediaDeck\'s menu appears.', type: 'action',
          value: () => (!ctl ? '…' : ctl.gameBar ? 'On - turn off' : 'Off'), run: () => toggleGameBar() },
        { label: 'In-game overlay (experimental)', desc: 'Off: the PS / Guide button brings MediaDeck to the front with its menu. On: a menu over the game instead.', type: 'toggle', key: 'inGameOverlay' },
        { label: 'Start DS4Windows with MediaDeck', desc: 'Starts it minimised when MediaDeck opens', type: 'toggle', key: 'startDs4' },
        { label: '.NET 8 Desktop Runtime', desc: 'DS4Windows needs it', type: 'info', value: () => (!ctl ? '…' : ctl.dotnet8 ? 'Installed' : 'Missing') },
        { label: 'How to set it up', type: 'action', run: () => setupHelp() },
        { label: 'Check again', type: 'action', run: () => refreshCtl(true) },
      ],
    },
    {
      id: 'folders', title: 'Folders & programs', icon: 'folder', desc: 'Where MediaDeck finds its helper programs',
      items: [
        { label: 'mpv (video player)', type: 'file', key: 'mpvPath', filter: 'exe' },
        { label: 'VLC (for "Open with VLC")', type: 'file', key: 'vlcPath', filter: 'exe' },
        { label: 'ffmpeg (thumbnails)', desc: 'Empty = find it automatically. Takes effect after a restart.', type: 'file', key: 'ffmpegPath', filter: 'exe' },
        { label: 'Settings and data folder', type: 'action', value: () => (info ? info.dataDir : ''), run: () => api.openDataFolder() },
        { label: 'Clear thumbnail cache', desc: 'Deletes the stored (encrypted) thumbnails and subtitles now', type: 'action',
          run: async () => { await api.clearCache(); UI.toast('Thumbnail cache cleared'); } },
      ],
    },
    {
      id: 'about', title: 'About', icon: 'info', desc: 'MediaDeck',
      items: [
        { label: 'Version', type: 'info', value: () => (info ? `${info.version}  ·  Electron ${info.electron}` : '') },
        { label: 'Check for MediaDeck updates', desc: 'From MediaDeck\'s GitHub releases. Your settings, apps and emulators stay.', type: 'action',
          value: () => (selfLatest ? `${selfLatest} available - install` : ''), run: () => selfUpdateNow() },
        { label: 'App folder', type: 'info', value: () => (info ? info.appDir : '') },
        { label: 'Exit MediaDeck', type: 'action', run: () => api.quit() },
      ],
    },
  ];

  const section = () => SECTIONS.find((x) => x.id === active);

  // ---------- Drawing ----------
  function renderNav() {
    navEl.innerHTML = '';
    for (const sec of SECTIONS) {
      const b = document.createElement('button');
      b.className = 'tab focusable' + (sec.id === active ? ' active' : '');
      b.dataset.group = 'settings-nav';
      b.dataset.section = sec.id;
      b.innerHTML = `<span class="tab-icon">${Icons[sec.icon] || ''}</span><span class="tab-label">${UI.esc(sec.title)}</span>`;
      b.addEventListener('click', () => openSection(sec.id));
      navEl.appendChild(b);
    }
  }

  function renderList() {
    const sec = section();
    titleEl.textContent = sec.title;
    descEl.textContent = sec.desc || '';
    listEl.innerHTML = '';
    const items = typeof sec.items === 'function' ? sec.items() : sec.items;
    items.forEach((item, i) => {
      if (item.heading) {
        listEl.insertAdjacentHTML('beforeend', `<h3 class="settings-heading">${UI.esc(item.heading)}</h3>`);
        return;
      }
      const b = document.createElement('button');
      b.className = `setting focusable type-${item.type}`;
      b.dataset.group = 'settings-list';
      b.dataset.index = i;
      b.innerHTML = `
        ${item.icon ? '<span class="setting-icon"></span>' : ''}
        <div class="setting-text">
          <div class="setting-label">${UI.esc(item.label)}</div>
          ${item.desc ? `<div class="setting-desc">${UI.esc(item.desc)}</div>` : ''}
        </div>
        <div class="setting-value">${valueHtml(item)}</div>`;
      if (item.icon) (/\.(png|jpe?g|webp)$/i.test(item.icon) ? api.imageData(item.icon) : api.fileIcon(item.icon)).then((url) => { if (url) b.querySelector('.setting-icon').innerHTML = `<img src="${url}" alt="">`; });
      item._row = b;
      if (item.type !== 'info') b.addEventListener('click', () => change(item, b));
      listEl.appendChild(b);
    });
    if (sec.id === 'emulators') loadFolderSummary();
    if (sec.id === 'controllers' && !ctl) refreshCtl();
    if (sec.id === 'apps' && !apps) refreshApps(false);
  }

  // ---------- Apps (installed from GitHub releases) ----------
  let apps = null;
  async function refreshApps(check, toast) {
    const t = check ? UI.toast('Checking for updates…', { spinner: true, duration: 0 }) : null;
    try { apps = await api.appsStatus(!!check); } finally { if (t) t.remove(); }
    if (active === 'apps') renderList();
    if (toast) {
      const n = apps.filter((a) => a.update).length;
      UI.toast(n ? `${n} update${n === 1 ? '' : 's'} available` : 'All apps are up to date', { icon: n ? 'refresh' : 'check' });
    }
  }

  async function installApp(a) {
    if (a.installed && !a.update && a.latest) { UI.toast(`${a.name} is up to date`, { icon: 'check' }); return; }
    const what = a.installed ? `Update ${a.name}${a.latest ? ` to ${a.latest}` : ''}?` : `Install ${a.name}?`;
    const ok = await UI.confirm(what, `${a.desc}.\nDownloaded from its GitHub releases into MediaDeck's Apps folder.${a.installed ? ' Its settings and sign-ins stay.' : ''}`,
      a.installed ? 'Update' : 'Install');
    if (!ok) return;
    const r = await api.appsInstall([a.id]);
    if (r.error) { UI.toast(r.error, { icon: 'alert', error: true }); return; }
    if (r.config) App.state.config = r.config;
    for (const x of r.results) {
      if (x.ok) UI.toast(`${x.name} ${x.version} ${a.installed ? 'updated' : 'installed'}${x.tile ? ' — it\'s on the Home screen' : ''}`, { icon: 'check', duration: 6000 });
      else UI.toast(`${x.name}: ${x.error}`, { icon: 'alert', error: true, duration: 8000 });
    }
    await refreshApps(false);
  }

  // ---------- MediaDeck's own updates ----------
  let selfLatest = null;
  async function selfUpdateNow() {
    const t = UI.toast('Checking for updates…', { spinner: true, duration: 0 });
    let r;
    try { r = await api.selfCheck(); } finally { t.remove(); }
    if (r.error) { UI.toast(r.error, { icon: 'alert', error: true }); return; }
    if (!r.update) { selfLatest = null; UI.toast(`MediaDeck ${r.current} is up to date`, { icon: 'check' }); return; }
    selfLatest = r.latest;
    if (!r.canInstall) { UI.toast(`MediaDeck ${r.latest} is out. Running from source: update with git pull.`, { icon: 'refresh', duration: 7000 }); return; }
    const ok = await UI.confirm(`Update MediaDeck to ${r.latest}?`, 'It downloads the new version, closes, updates itself and starts again. Your settings, apps, emulators and games stay.', 'Update');
    if (!ok) return;
    const x = await api.selfInstall();
    if (x && x.error) UI.toast(x.error, { icon: 'alert', error: true, duration: 8000 });
  }
  if (api.onSelfUpdate) api.onSelfUpdate((v) => { selfLatest = v; UI.toast(`MediaDeck ${v} is out. Settings → About → Check for MediaDeck updates`, { icon: 'refresh', duration: 9000 }); });

  // ---------- Controllers ----------
  let ctl = null;
  const ctlLabel = (s) => (!s ? '…' : s === 'running' ? 'Installed' : s === 'installed' ? 'Installed (not running)' : 'Not installed - install');

  async function refreshCtl(toast) {
    ctl = { ...(await api.controllerStatus()), gameBar: await api.gameBarGet() };
    if (active === 'controllers') renderList();
    if (toast) UI.toast('Status updated', { icon: 'check', duration: 1500 });
  }

  async function installPart(which, name) {
    if (ctl && ctl[which] !== 'missing') { UI.toast(`${name} is already installed`, { icon: 'check' }); return; }
    const ok = await UI.confirm(`Install ${name}?`,
      `The ${name} installer starts. Windows asks you to allow it (administrator), then follow its steps. ` +
      'A restart of the PC may be asked for afterwards.', 'Start installer');
    if (!ok) return;
    const err = await api.installController(which);
    if (err) UI.menu({ title: `Couldn't start the ${name} installer`, message: err, items: [{ label: 'OK', icon: 'check' }] });
    else UI.toast(`${name} installer started - choose "Check again" when it's done`, { icon: 'gamepad', duration: 5000 });
  }

  async function toggleGameBar() {
    const on = !ctl.gameBar;
    if (!(await api.gameBarSet(on))) { UI.toast('Could not change the Windows setting', { icon: 'info' }); return; }
    ctl.gameBar = await api.gameBarGet();
    renderList();
    UI.toast(ctl.gameBar ? 'The Xbox button opens Game Bar again' : 'Game Bar no longer opens from the controller', { icon: 'gamepad' });
  }

  function setupHelp() {
    UI.menu({ title: 'PS4 controller setup', message: [
      '1. Install ViGEmBus (and HidHide), allow them in Windows, restart if asked.',
      '2. Open DS4Windows. The first time it asks where to keep its settings: choose "Program folder".',
      '3. Your controller appears in DS4Windows; games now see an Xbox controller.',
      '4. In DS4Windows Settings, turn on "Hide DS4 Controller" (uses HidHide) so games don\'t see it twice.',
      '5. Switch on "Start DS4Windows with MediaDeck" here.',
      'The PS button then works as the Xbox Guide button: it brings MediaDeck back from any game.',
    ].join('\n'), items: [{ label: 'OK', icon: 'check' }] });
  }

  async function downloadAllCovers() {
    const ok = await UI.confirm('Download covers for all games?',
      'Box art comes from the libretro thumbnail library (the one RetroArch uses). Game names are sent to it to find the pictures; nothing else. This can take a few minutes.',
      'Download');
    if (!ok) return;
    const emus = App.state.config.tiles.filter((t) => t.section === 'emulators' && t.moduleId);
    const toast = UI.toast('Looking for covers…', { spinner: true, duration: 0 });
    const label = toast.el.querySelector('span');
    let found = 0, total = 0;
    for (const t of emus) {
      label.textContent = `Covers: ${t.name}…`;
      const r = await api.downloadCovers(t.moduleId);
      if (r) { found += r.found; total += r.total; }
    }
    toast.remove();
    UI.toast(total ? `${found} of ${total} covers found` : 'All games already have a cover', { icon: 'image', duration: 5000 });
  }

  // Show hidden drives again
  async function manageHiddenDrives() {
    for (;;) {
      const list = s().hiddenDrives || [];
      if (!list.length) { UI.toast('No drives are hidden', { icon: 'eye' }); return; }
      const c = await UI.menu({ title: 'Hidden drives', message: 'Choose a drive to show it again', items: [
        ...list.map((h, i) => ({ label: `${h.label}  (was ${h.letter}:)`, icon: 'eye', value: i })),
        { label: 'Show all drives', icon: 'check', value: 'all' },
      ] });
      if (c === null || c === undefined) return;
      s().hiddenDrives = c === 'all' ? [] : list.filter((x, i) => i !== c);
      await save();
      if (c === 'all') return;
    }
  }

  // "2 folders · 340 games" next to each emulator in Settings → Emulators
  const folderSummary = {};
  async function loadFolderSummary(onlyId) {
    const ids = onlyId ? [onlyId] : App.state.config.tiles.filter((t) => t.section === 'emulators' && t.moduleId).map((t) => t.moduleId);
    await Promise.all(ids.map(async (id) => {
      const r = await api.emulatorFolders(id);
      if (!r) return;
      const games = r.folders.reduce((n, f) => n + f.games, 0);
      folderSummary[id] = r.folders.length
        ? `${r.folders.length} folder${r.folders.length === 1 ? '' : 's'}  ·  ${games} game${games === 1 ? '' : 's'}`
        : 'No folders';
    }));
    if (active !== 'emulators') return;
    listEl.querySelectorAll('.setting').forEach((b) => {
      const sec = section();
      const items = typeof sec.items === 'function' ? sec.items() : sec.items;
      const item = items[b.dataset.index];
      if (item && item.value) b.querySelector('.setting-value').innerHTML = valueHtml(item);
    });
  }

  function valueHtml(item) {
    if (item.type === 'toggle') return `<span class="switch${s()[item.key] !== false && s()[item.key] ? ' on' : ''}"><i></i></span>`;
    let v = item.value ? item.value() : s()[item.key];
    if (item.type === 'choice') v = choiceName(item.options(), v);
    if ((item.type === 'file' || item.type === 'folder') && !v) v = 'Not set';
    if (item.type === 'text' && !v) v = 'Not set';
    const chevron = ['choice', 'file', 'folder', 'text'].includes(item.type) ? Icons.right : '';
    return `<span class="setting-value-text">${UI.esc(v == null ? '' : String(v))}</span>${chevron}`;
  }

  function refreshRow(button, item) {
    button.querySelector('.setting-value').innerHTML = valueHtml(item);
  }

  // ---------- Changing a setting ----------
  async function change(item, button) {
    const set = s();
    if (item.type === 'toggle') {
      set[item.key] = !set[item.key];
    } else if (item.type === 'choice') {
      const opts = item.options();
      const v = await UI.menu({ title: item.label, focus: set[item.key],
        items: opts.map((o) => ({ label: o.label, value: o.value, icon: o.value === set[item.key] ? 'check' : '' })) });
      if (v === null || v === undefined) return;
      set[item.key] = v;
    } else if (item.type === 'text') {
      const v = await UI.prompt({ title: item.label, message: item.desc, value: set[item.key] || '' });
      if (v === null) return;
      set[item.key] = v;
    } else if (item.type === 'file' || item.type === 'folder') {
      const current = item.value ? item.value() : set[item.key];
      const what = await UI.menu({ title: item.label, message: current || 'Not set', items: [
        { label: item.type === 'folder' ? 'Choose a folder…' : 'Choose a file…', icon: 'folder', value: 'pick' },
        ...(set[item.key] ? [{ label: item.type === 'folder' ? 'Use the default' : 'Clear (find it automatically)', icon: 'close', value: 'clear' }] : []),
        ...(current ? [{ label: 'Open its folder', icon: 'external', value: 'open' }] : []),
      ] });
      if (!what) return;
      if (what === 'open') { api.openPath(item.type === 'folder' ? current : current.replace(/[\\/][^\\/]*$/, '')); return; }
      if (what === 'clear') set[item.key] = '';
      if (what === 'pick') {
        const picked = await api.pickFile({
          title: item.label, folder: item.type === 'folder', defaultPath: current || undefined,
          filters: item.filter ? [{ name: 'Programs', extensions: [item.filter] }] : undefined,
        });
        if (!picked) return;
        set[item.key] = picked;
      }
    } else if (item.type === 'action') {
      await item.run();
      refreshRow(button, item);
      return;
    }
    await save();
    if (item.after) await item.after(set[item.key]);
    refreshRow(button, item);
  }

  // ---------- Game folders, by console (each console: which emulators play it, and their folders) ----------
  let consoleList = null;
  function gameFolderRows() {
    if (!consoleList) { api.consoles().then((c) => { consoleList = c || []; if (active === 'emulators') renderList(); }).catch(() => {}); return [{ heading: 'Game folders' }]; }
    const rows = [];
    let maker = null;
    for (const c of [...consoleList].sort((a, b) => String(a.maker).localeCompare(String(b.maker)) || String(a.name).localeCompare(String(b.name)))) {
      if (c.maker !== maker) { maker = c.maker; rows.push({ heading: `Game folders · ${maker || 'Other'}` }); }
      const emus = c.emulators || [];
      rows.push({
        label: c.name, desc: emus.map((e) => e.name).join(' · '), type: 'action', icon: c.icon,
        value: () => (c.count != null ? `${c.count} games` : ''),
        run: async () => {
          let moduleId = emus.length === 1 ? emus[0].moduleId : null;
          if (!moduleId) moduleId = await UI.menu({ title: `${c.name}: game folders`, message: 'Which emulator\'s folders?', items: [
            ...emus.map((e) => ({ label: `${e.name}${folderSummary[e.moduleId] ? `  —  ${folderSummary[e.moduleId]}` : ''}`, value: e.moduleId, icon: 'folder' })),
            { label: 'Back', value: null, icon: 'close' }] });
          if (!moduleId) return;
          await RomFolders.edit(moduleId);
          await loadFolderSummary(moduleId);
          consoleList = null; renderList();
        },
      });
    }
    return rows;
  }

  // ---------- Updates: newer versions of installed emulators ----------
  let updateInfo = null;
  async function updateEmulators() {
    const t = UI.toast('Checking for updates…', { spinner: true, duration: 0 });
    let list;
    try { list = await api.checkEmulatorUpdates(); } finally { t.remove(); }
    const todo = list.filter((x) => x.update);
    updateInfo = todo.length;
    if (active === 'emulators') renderList();
    if (!todo.length) { UI.toast('All your emulators are up to date', { icon: 'check' }); return; }
    const chosen = new Set(todo.map((x) => x.moduleId));
    let focus;
    for (;;) {
      const v = await UI.menu({
        title: 'Emulator updates', message: 'A ticks / unticks. Settings, saves and BIOS stay; replaced files are kept in the "Emulator backups" folder.', focus,
        items: [
          // only the emulators that have an update
          ...todo.map((x) => ({ label: `${chosen.has(x.moduleId) ? '☑' : '☐'}  ${x.name}:  ${x.installed || 'version unknown'}  →  ${x.latest}`, value: 'u:' + x.moduleId })),
          { label: chosen.size ? `Update selected (${chosen.size})` : 'Update selected', value: 'go', icon: 'refresh' },
          { label: 'Back', value: 'back', icon: 'close' },
        ],
      });
      if (!v || v === 'back') return;
      if (v === 'go') { if (chosen.size) break; focus = v; continue; }
      if (v.startsWith('u:')) { const id = v.slice(2); if (chosen.has(id)) chosen.delete(id); else chosen.add(id); }
      focus = v;
    }
    const r = await api.updateEmulators([...chosen]);
    if (r.error) { UI.toast(r.error, { icon: 'alert', error: true }); return; }
    App.state.config = r.config;
    for (const x of r.results) {
      if (x.ok) UI.toast(`${x.name} updated to ${x.version}`, { icon: 'check', duration: 6000 });
      else UI.toast(`${x.name}: ${x.error}`, { icon: 'alert', error: true, duration: 8000 });
    }
    updateInfo = null;
    await rescan(false);
  }

  // ---------- Install emulators: consoles → tick the emulators → install ----------
  async function installEmulators(consoleFocus) {
    let cat;
    try { cat = await api.installCatalog(); } catch { UI.toast('Could not read the emulator list', { icon: 'alert', error: true }); return; }
    const pick = await UI.menu({
      title: 'Install emulators', message: 'Pick a console. Emulators come from their official download pages (latest version).',
      focus: consoleFocus,
      items: [
        ...cat.map((c) => {
          const have = c.emulators.filter((e) => e.installed).length;
          return { label: `${c.maker}  ·  ${c.name}  —  ${have ? `${have} installed, ` : ''}${c.emulators.length - have} more available`, value: c.id, icon: 'gamepad' };
        }),
        { label: 'Done', value: null, icon: 'close' },
      ],
    });
    if (!pick) return;
    const c = cat.find((x) => x.id === pick);
    const chosen = new Set();
    let focus;
    for (;;) {
      const v = await UI.menu({
        title: `${c.name}: emulators`, message: 'A ticks / unticks. Installed ones are already set up.', focus,
        items: [
          ...c.emulators.map((e) => ({
            label: e.installed ? `✓  ${e.name}  (installed) — ${e.desc}` : `${chosen.has(e.id) ? '☑' : '☐'}  ${e.name} — ${e.desc}`,
            value: 'emu:' + e.id, icon: e.installed ? 'check' : undefined,
          })),
          { label: chosen.size ? `Install selected (${chosen.size})` : 'Install selected', value: 'go', icon: 'plus' },
          { label: 'Back', value: 'back', icon: 'close' },
        ],
      });
      if (!v || v === 'back') return installEmulators(pick);
      if (v === 'go') { if (chosen.size) break; UI.toast('Tick at least one emulator first', { icon: 'alert' }); focus = v; continue; }
      const id = v.slice(4);
      if (!c.emulators.find((e) => e.id === id).installed) { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); }
      focus = v;
    }
    const t = UI.toast('Starting…', { spinner: true, duration: 0 });
    const r = await api.installEmulators([...chosen].map((emuId) => ({ emuId, consoleId: c.id })));
    t.remove();
    if (r.error) { UI.toast(r.error, { icon: 'alert', error: true }); return; }
    App.state.config = r.config;
    for (const x of r.results) {
      if (x.ok) UI.toast(`${x.name} ${x.version || ''} installed${x.biosCopied ? ' (BIOS copied)' : ''}${x.romFolders.length ? '' : ' — add its game folder'}`, { icon: 'check', duration: 6000 });
      else UI.toast(`Install failed: ${x.error}`, { icon: 'alert', error: true, duration: 8000 });
    }
    await rescan(false);
    return installEmulators(pick);
  }
  // updates found by the daily check at start (Streamlink already updated itself)
  if (api.onAppUpdates) api.onAppUpdates((list) => { apps = null; UI.toast(`App updates: ${list.map((x) => x.name).join(', ')}. Settings → Apps`, { icon: 'refresh', duration: 9000 }); });
  // covers found by the daily automatic download
  if (api.onCoversAuto) api.onCoversAuto(({ found }) => UI.toast(`${found} new game cover${found === 1 ? '' : 's'} downloaded`, { icon: 'check', duration: 5000 }));

  // the daily check at start: remember the count; tell once when it is new
  if (api.onEmulatorUpdates) {
    api.onEmulatorUpdates(({ list, fresh }) => {
      updateInfo = list.length;
      if (active === 'emulators') renderList();
      if (fresh && list.length) UI.toast(`Emulator updates: ${list.map((x) => x.name).join(', ')}. Settings → Emulators → Check for updates`, { icon: 'refresh', duration: 9000 });
    });
  }
  if (api.onInstallProgress) {
    let last = null;
    api.onInstallProgress((p) => { if (last) last.remove(); last = UI.toast(p.text, { spinner: p.pct < 1, duration: p.pct >= 1 ? 2500 : 0 }); });
  }

  async function rescan(showToast) {
    const r = await api.rescanEmulators();
    App.state.config = r.config;
    info = { ...(info || {}), emuDir: r.dir, emuCount: r.mods.filter((m) => !m.hidden && m.ok).length };
    if (active === 'emulators') renderList();
    if (showToast) UI.toast(`${info.emuCount} emulators in Emu_modules`, { icon: 'gamepad' });
  }

  // ---------- Focus and input ----------
  function focusList() {
    const first = listEl.querySelector('.setting');
    if (first) Nav.focus(first);
  }

  // A section opens only when chosen (A / Enter / click); the panel folds while you're in the list
  function openSection(id) {
    if (id !== active) {
      active = id;
      navEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.section === active));
      renderList();
    }
    focusList();
  }

  el.addEventListener('nav-focus', (e) => {
    const t = e.target;
    el.classList.toggle('collapsed', !t.closest('.sidebar'));
    if (t.classList.contains('setting') && e.detail.scroll) {
      // Back at the first item: show the section's title and description again
      const page = t.closest('.settings-page');
      if (page && t === page.querySelector('.setting')) page.scrollTo({ top: 0, behavior: 'smooth' });
      else t.scrollIntoView({ block: 'center', behavior: 'smooth' });   // the chosen row stays in the middle
    }
  });

  function handle(action) {
    const cur = Nav.current;
    const inNav = cur && cur.closest('.sidebar');
    if (action === 'up' || action === 'down') {
      Nav.move(action, (n) => !!n.closest('.sidebar') === !!inNav);
      return true;
    }
    if (action === 'right' && inNav) { focusList(); return true; }
    if (action === 'left' && !inNav) { Nav.focus(navEl.querySelector('.tab.active')); return true; }
    if (action === 'back') {
      if (!inNav) Nav.focus(navEl.querySelector('.tab.active'));
      else App.back();
      return true;
    }
    return false;
  }

  function init() {
    Nav.bindMouse(el);
    const back = el.querySelector('.back-btn');
    back.innerHTML = Icons.back;
    back.addEventListener('click', () => App.back());
    el.appendChild(UI.hints([['a', 'Change'], ['b', 'Back']]));
  }

  async function enter(params) {
    Nav.setRoot(el);
    UI.glow(null);
    active = (params && params.section) || 'general';
    renderNav();
    renderList();
    Nav.focus(navEl.querySelector('.tab.active'));
    info = await api.appInfo();
    rescan(false);
    renderList();
    // from the Home screen's + card: straight into the emulator installer
    if (params && params.run === 'installEmulators') installEmulators();
  }

  function resume() { Nav.setRoot(el); }

  return { el, init, enter, resume, handle };
})();
