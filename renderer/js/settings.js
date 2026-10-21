// Settings screen: sections on the left, settings on the right.
// Row types: toggle, choice, text, file, folder, action, info.
const Settings = (() => {
  const el = document.getElementById('settings');
  const navEl = el.querySelector('.tabs');
  const listEl = el.querySelector('.settings-list');
  const titleEl = el.querySelector('.settings-title');
  const descEl = el.querySelector('.settings-desc');
  const subEl = document.createElement('div');      // a group's sub-tabs (Media Player: Playback, Sound …)
  subEl.className = 'settings-subtabs';
  descEl.after(subEl);
  let active = 'general';
  let info = null;

  const s = () => App.state.config.settings;
  const save = () => api.saveConfig(App.state.config);
  const choiceName = (opts, v) => (opts.find((o) => o.value === v) || {}).label || v || '';

  // ---------- Sound (the player: mpv) ----------
  const SPEAKERS = [{ value: 'auto', label: 'Automatic' }, { value: 'stereo', label: 'Stereo' }, { value: '5.1', label: 'Up to 5.1 surround' }, { value: '7.1', label: 'Up to 7.1 surround' }];
  const PASSTHROUGH = [{ value: 'on', label: 'On' }, { value: 'spdif', label: 'Dolby Digital and DTS only (optical)' }, { value: 'off', label: 'Off' }];
  let soundDevices = null;          // [{ name, description }] from mpv
  // ---------- Screen resolution / refresh rate (Settings → General) ----------
  const RES_NAMES = { '7680x4320': '8K', '4096x2160': 'DCI 4K', '3840x2160': '4K', '2560x1440': '1440p', '1920x1080': '1080p', '1280x720': '720p' };
  const fmtHz = (hz) => `${{ 23: '23.976', 29: '29.97', 47: '47.952', 59: '59.94', 71: '71.928', 119: '119.88', 143: '143.86', 239: '239.76' }[hz] || hz} Hz`;
  const fmtRes = (w, h) => `${w} × ${h}${RES_NAMES[`${w}x${h}`] ? `  (${RES_NAMES[`${w}x${h}`]})` : ''}`;
  let screenInfo = null;            // { device, current: { w, h, hz }, modes: [{ w, h, hz }] }
  const screenValue = (what) => {
    if (!screenInfo) {
      api.displayModes().then((i) => {
        screenInfo = i || { current: {}, modes: [] };
        for (const it of SECTIONS.find((x) => x.id === 'general').items) if (it._row) refreshRow(it._row, it);
      });
      return '…';
    }
    const c = screenInfo.current || {};
    if (!c.w) return 'Unknown';
    return what === 'hz' ? fmtHz(c.hz) : fmtRes(c.w, c.h);
  };
  async function pickScreenMode(what) {
    screenInfo = await api.displayModes();
    if (!screenInfo || !screenInfo.modes.length) { await UI.menu({ title: 'Screen', message: 'Windows did not list the modes of this screen.', items: [{ label: 'OK', icon: 'check' }] }); return; }
    const cur = screenInfo.current;
    let w = cur.w, h = cur.h, hz = cur.hz;
    if (what === 'res') {
      const seen = new Set();
      const res = screenInfo.modes.filter((m) => !seen.has(`${m.w}x${m.h}`) && seen.add(`${m.w}x${m.h}`)).sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w);
      const v = await UI.menu({ title: 'Screen resolution', focus: `${cur.w}x${cur.h}`,
        items: res.map((m) => ({ label: fmtRes(m.w, m.h), value: `${m.w}x${m.h}`, icon: m.w === cur.w && m.h === cur.h ? 'check' : '' })) });
      if (!v || v === `${cur.w}x${cur.h}`) return;
      [w, h] = v.split('x').map(Number);
      const rates = screenInfo.modes.filter((m) => m.w === w && m.h === h).map((m) => m.hz);
      hz = rates.includes(cur.hz) ? cur.hz : Math.max(...rates);       // the same refresh rate when it has it
    } else {
      const rates = [...new Set(screenInfo.modes.filter((m) => m.w === cur.w && m.h === cur.h).map((m) => m.hz))].sort((a, b) => b - a);
      const v = await UI.menu({ title: `Refresh rate  ·  ${fmtRes(cur.w, cur.h)}`, focus: cur.hz,
        items: rates.map((r) => ({ label: fmtHz(r), value: r, icon: r === cur.hz ? 'check' : '' })) });
      if (v == null || v === cur.hz) return;
      hz = v;
    }
    const r = await api.displaySet(w, h, hz, 'try');
    if (!r || !r.ok) { await UI.menu({ title: 'Screen', message: (r && r.error) || 'That did not work.', items: [{ label: 'OK', icon: 'check' }] }); return; }
    await new Promise((res) => setTimeout(res, 1200));       // the screen settles (it can go black for a moment)
    const keep = await UI.menu({ title: 'Keep this screen mode?', focus: 'keep',
      items: [{ label: 'Keep it', value: 'keep', icon: 'check' }, { label: 'Go back', value: 'back', icon: 'back' }],
      timeout: { secs: 15, value: 'back', text: (n) => `${fmtRes(w, h)} at ${fmtHz(hz)}. Going back in ${n} s.` } });
    await api.displaySet(w, h, hz, keep === 'keep' ? 'keep' : 'revert');
    screenInfo = await api.displayModes();
    for (const it of SECTIONS.find((x) => x.id === 'general').items) if (it._row) refreshRow(it._row, it);
  }

  // NVIDIA RTX Video (the player): only on an RTX card, and only with the Direct3D 11 renderer
  const ON_OFF = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];
  let rtxName = null;
  const rtxValue = (key) => {
    if (rtxName === null) {
      api.rtxCard().then((n) => {
        rtxName = n || '';
        for (const it of SECTIONS.find((x) => x.id === 'video').items) if (it._row) refreshRow(it._row, it);
      });
      return '…';
    }
    if (!rtxName) return 'Needs an NVIDIA RTX card';
    if ((s().mpvGpuApi || 'd3d11') !== 'd3d11') return 'Needs the Direct3D 11 renderer';
    if (key === 'rtxHdr') return s()[key] === 'on' ? 'on' : 'off';      // RTX HDR: off unless switched on
    return s()[key] === 'off' ? 'off' : 'on';
  };
  const soundOutputName = () => {
    const id = s().audioDevice;
    if (!id || id === 'auto') return 'Windows default';
    if (!soundDevices) {
      api.audioDevices().then((l) => {
        soundDevices = l;
        const row = SECTIONS.find((x) => x.id === 'sound').items[0];
        if (row._row) refreshRow(row._row, row);
      });
      return '…';
    }
    return (soundDevices.find((x) => x.name === id) || {}).description || 'Not connected';
  };
  async function pickSoundOutput() {
    soundDevices = await api.audioDevices(true);
    const cur = s().audioDevice || 'auto';
    const v = await UI.menu({ title: 'Sound output', focus: cur, items: [
      { label: 'Windows default', value: 'auto', icon: cur === 'auto' ? 'check' : 'audio' },
      ...soundDevices.map((x) => ({ label: x.description, value: x.name, icon: x.name === cur ? 'check' : 'audio' })),
      ...(cur !== 'auto' && !soundDevices.some((x) => x.name === cur) ? [{ label: 'The one chosen before (not connected now)', value: cur, icon: 'check' }] : []),
    ] });
    if (v == null || v === cur) return;
    s().audioDevice = v;
    await save();
  }

  const SECTIONS = [
    {
      id: 'general', title: 'General', icon: 'settings', desc: 'How MediaDeck starts and behaves',
      items: [
        { label: 'Display mode', desc: 'Borderless window (full screen) covers the whole screen, as games do today; Window is a normal window you can move and resize. F11 switches between them, and MediaDeck remembers it.',
          type: 'action', value: () => (s().fullscreen ? 'Borderless window (full screen)' : 'Window'),
          run: async () => {
            const full = !!s().fullscreen;
            const v = await UI.menu({ title: 'Display mode', focus: full ? 'full' : 'window', items: [
              { label: 'Borderless window (full screen)', value: 'full', icon: full ? 'check' : '' },
              { label: 'Window', value: 'window', icon: full ? '' : 'check' }] });
            if (v && (v === 'full') !== full) s().fullscreen = await api.toggleFullscreen();
          } },
        { label: 'Screen resolution', desc: 'For the screen MediaDeck is on. You are asked to keep the new one; without an answer it goes back by itself after 15 seconds.',
          type: 'action', value: () => screenValue('res'), run: () => pickScreenMode('res') },
        { label: 'Refresh rate', desc: 'Pictures per second. 23.976 / 24 Hz suits films, 50 Hz PAL TV, 60 Hz and up games and menus.',
          type: 'action', value: () => screenValue('hz'), run: () => pickScreenMode('hz') },
        { label: '24-hour clock', type: 'toggle', key: 'clock24h' },
        { label: 'Minimise when an app starts', desc: 'MediaDeck comes back when the app closes', type: 'toggle', key: 'minimizeOnLaunch' },
        { label: 'Sleep, restart and shut down PC in the Exit menu', desc: 'Off: the Exit menu (Power button, PS / Guide at home) only has Restart MediaDeck and Exit MediaDeck', type: 'toggle', key: 'powerMenuPc' },
        { label: 'Hide the mouse pointer', desc: 'In full-screen apps and games, when the mouse has not moved for a while', type: 'choice', key: 'hideCursor', options: () => [
          { value: 0, label: 'Never' }, { value: 5, label: 'After 5 seconds' }, { value: 10, label: 'After 10 seconds' }, { value: 30, label: 'After 30 seconds' }] },
      ],
    },
    {
      id: 'appearance', title: 'Appearance', icon: 'palette', desc: 'Theme and colours',
      items: [
        { label: 'Theme', type: 'choice', key: 'theme', options: () => App.THEMES.map((t) => ({ value: t.id, label: t.name, swatch: t.swatch })), preview: (v) => App.applyTheme(v),
          after: (v) => App.applyTheme(v) },
        { label: 'Screen size', desc: 'Makes everything bigger or smaller: menus, cards, text and the player\'s controls. Bigger for a TV across the room, smaller for more on the screen.',
          type: 'choice', key: 'uiScale', options: () => App.UI_SCALES.map((x) => ({ value: x.v, label: x.l })),
          preview: (v) => App.applyScale(v), after: () => App.applyScale() },
        { label: 'Text size', desc: 'Only the text gets bigger or smaller; cards and menus keep their size.',
          type: 'choice', key: 'textScale', options: () => App.TEXT_SCALES.map((x) => ({ value: x.v, label: x.l })),
          preview: (v) => App.applyScale(undefined, v), after: () => App.applyScale() },
      ],
    },
    // the media player's own defaults (shared with the player's Y → Options → Player settings)
    ...PlayerSettings.SECTIONS.map((x) => ({ ...x, group: 'player' })),
    {
      id: 'sound', group: 'player', title: 'Sound', icon: 'audio', desc: 'Where the player\'s sound goes, and how (also Y → Options while something plays)',
      items: [
        { label: 'Sound output', desc: 'The speakers, receiver or TV the Media Player and Twitch play on. Windows default follows Windows\' sound settings.',
          type: 'action', value: () => soundOutputName(), run: () => pickSoundOutput() },
        { label: 'Speakers', desc: 'Automatic follows Windows\' speaker setup for that output. Stereo mixes surround down to two speakers. Up to 5.1 / 7.1 sends each film as it is up to that many channels, so a stereo film stays stereo and your receiver can upmix it. With a choice here the player has the output to itself while it plays.',
          type: 'choice', key: 'audioChannels', options: () => SPEAKERS },
        { label: 'Passthrough', desc: 'Dolby and DTS sound go to your receiver untouched, so it decodes them (Dolby Atmos, DTS:X too). An optical / coaxial output only takes Dolby Digital and DTS; MediaDeck notices that itself. Off: the player decodes the sound.',
          type: 'choice', key: 'audioPassthrough', options: () => PASSTHROUGH },
      ],
    },
    {
      id: 'video', group: 'player', title: 'Video', icon: 'film', desc: 'How videos are drawn and converted',
      items: [
        { label: 'Video renderer', desc: 'How mpv draws the picture. Direct3D 11 is the safe choice.', type: 'choice', key: 'mpvGpuApi', options: () => [
          { value: 'd3d11', label: 'Direct3D 11' }, { value: 'vulkan', label: 'Vulkan' }, { value: 'opengl', label: 'OpenGL' }] },
        { label: 'Hardware video converting', desc: 'Uses the graphics card when a video has to be converted', type: 'toggle', key: 'hardwareEncode' },
        { label: 'NVIDIA RTX Super Resolution', desc: 'AI upscaling: videos smaller than the screen (DVD, 720p, 1080p on a 4K TV) are made sharp by the graphics card. Also switch on "RTX Video Enhancement → Super resolution" in the NVIDIA App (or NVIDIA Control Panel → Video) - without that the driver leaves the picture as it is.',
          type: 'choice', key: 'rtxSuperRes', options: () => ON_OFF, value: () => rtxValue('rtxSuperRes') },
        { label: 'NVIDIA RTX HDR', desc: 'Turns normal (SDR) videos into HDR with AI, for an HDR TV or monitor with HDR switched on in Windows. HDR films, pictures and album covers stay as they are.',
          type: 'choice', key: 'rtxHdr', options: () => ON_OFF, value: () => rtxValue('rtxHdr') },
      ],
    },
    {
      id: 'media', group: 'player', title: 'Browsing', icon: 'folder', desc: 'Browsing your drives and folders in the Media Player',
      items: [
        { label: 'Show all files', desc: 'Off: only folders, videos, music and pictures', type: 'toggle', key: 'showAllFiles' },
        { label: 'Show only USB drives', desc: 'Hides the PC\'s own drives in the Media Player; USB sticks and drives still show up', type: 'toggle', key: 'usbOnly' },
        { label: 'Hidden drives', desc: 'Hide a drive with Y on it in the Media Player', type: 'action',
          value: () => { const n = (s().hiddenDrives || []).length; return n ? `${n} hidden` : 'None'; }, run: () => manageHiddenDrives() },
        { label: 'Sort folders by', type: 'choice', key: 'sortBy', options: () => [
          { value: 'name', label: 'Name' }, { value: 'date', label: 'Newest first' }, { value: 'size', label: 'Size' }] },
        { label: 'Continue watching in folders', desc: 'A row at the top of a folder with its videos you stopped part way (also Y in a folder)', type: 'toggle', key: 'continueInFolders' },
        { label: 'Continue watching on the start screen', desc: 'The same row, for all your drives, on the Media Player start screen', type: 'toggle', key: 'continueOnHome' },
        { label: 'Thumbnails', desc: 'Pictures of videos, music and photos. Turn off for very slow drives.', type: 'toggle', key: 'thumbnails' },
        { label: 'Folder pictures', desc: 'poster.jpg / folder.jpg, or a frame from the film inside', type: 'toggle', key: 'folderArt' },
        { label: 'Keep thumbnails after closing', desc: 'Off: thumbnails are deleted when MediaDeck closes. They are always stored encrypted.', type: 'toggle', key: 'keepThumbnails' },
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
        { label: 'BIOS check', desc: 'Which BIOS files your consoles need, which are there, and where they go', type: 'action', run: () => App.open(Setup, { only: 'bios' }) },
        { label: 'Check for updates', desc: 'Newer versions of your emulators. Settings, saves and BIOS stay.', type: 'action', icon: 'refresh',
          value: () => (updateInfo == null ? '' : updateInfo ? `${updateInfo} available` : 'All up to date'), run: () => updateEmulators() },
        { label: 'Games folder', desc: 'Where your games are, one folder per console (or per maker, then console). New emulators get their console\'s folder from here.', type: 'folder', key: 'gamesFolder',
          value: () => fullPath(s().gamesFolder) },
        { label: 'Emu_modules folder', desc: 'Put an emulator\'s folder here and it shows up in the app', type: 'folder', key: 'emuModulesPath',
          value: () => s().emuModulesPath || (info && info.emuDir) || '', after: () => rescan(true) },
        { label: 'Game cards', desc: 'How a console\'s games are shown: big covers, small covers (more on the screen), a list with a small cover on the left, or a list of names without covers', type: 'choice', key: 'gameView',
          options: () => [{ value: 'big', label: 'Big covers' }, { value: 'small', label: 'Small covers' }, { value: 'rows', label: 'List with small covers' }, { value: 'list', label: 'List (no covers)' }],
          after: (v) => App.applyGameView(v) },
        { label: 'Check for updates at start', desc: 'Once a day, a while after MediaDeck opens. Only asks the emulators\' download pages.', type: 'toggle', key: 'checkEmuUpdates' },
        { label: 'Group versions of a game', desc: 'Rev 1, Sample, other regions, .smc / .sfc: one card, and starting it asks which version', type: 'toggle', key: 'groupVersions' },
        { label: 'Show consoles without games', desc: 'On: a console shows on Home and Consoles as soon as its emulator is installed, also with an empty games folder. Off: only once it has games.',
          type: 'toggle', key: 'showEmptyConsoles', after: () => Home.refreshConsoles() },
        { label: 'Open the Emu_modules folder', type: 'action', run: () => api.openPath(s().emuModulesPath || (info && info.emuDir)) },
        { label: 'Download covers automatically', desc: 'Once a day, a while after start: box art for games that have none (new games too). Game names / PS3 serials / Xbox 360 title IDs go to libretro, GameTDB and XboxUnity.', type: 'toggle', key: 'autoCovers' },
        { label: 'Download covers for all emulators', desc: 'Box art from the libretro library (game names are sent to it), PS3 and Switch from GameTDB, Xbox 360 from XboxUnity (title IDs). Stored encrypted.', type: 'action',
          run: () => downloadAllCovers() },
        { label: 'Scan for new games', desc: 'Reads every game folder again - for games added while MediaDeck runs (it also looks by itself when it comes back to the front)', type: 'action', run: () => Home.scanGames() },
        { label: 'Look for new emulators', type: 'action', value: () => (info && info.emuCount != null ? `${info.emuCount} found` : ''), run: () => rescan(true) },
        ...gameFolderRows(),
      ],
    },
    {
      id: 'controllers', title: 'Controllers', icon: 'gamepad', desc: 'PlayStation controllers work everywhere through DS4Windows',
      items: () => [
        { label: 'Set up a controller…', desc: 'A pad that isn\'t Xbox or PlayStation (USB N64, SNES, GameCube …): press each button when asked. It then works in MediaDeck, Start + Back held opens MediaDeck\'s menu in games, and emulators see it as an Xbox controller.', type: 'action',
          run: () => pickPadType() },
        ...Object.entries(App.state.config.controllers || {}).map(([key, p]) => ({
          label: p.name, desc: `${(PadSetup.TYPES.find((x) => x.id === p.type) || {}).name || 'Set up'} pad (${key}) - choose to set it up again or forget it`, type: 'action', value: () => 'Set up',
          run: async () => {
            const c = await UI.menu({ title: p.name, items: [{ label: 'Set it up again', value: 'again', icon: 'gamepad' }, { label: 'Forget it', value: 'forget', icon: 'trash', danger: true }, { label: 'Cancel', value: '', icon: 'back' }] });
            if (c === 'again') pickPadType(p.type);
            if (c === 'forget') { const r = await api.padForget(key); App.state.config.controllers = r.controllers; Input.setMaps(r.controllers); renderList(); }
          } })),
        { label: 'GameCube controller adapter', desc: 'Nintendo\'s adapter, or Mayflash\'s in Wii U mode: real GameCube pads in Dolphin with every button, analog L / R and rumble. Choose to see if it is ready.', type: 'action',
          run: () => gcAdapter() },
        { label: 'Set up the controller in the emulators', desc: 'Player 1 = your first controller in every emulator that has none set yet (buttons by position). Controls you set yourself stay.', type: 'action',
          run: async () => {
            const r = await api.padsSetup();
            UI.toast(r.length ? `Controller set up in ${r.join(', ')}` : 'Every emulator has a controller set up already', { icon: 'check', duration: 5000 });
          } },
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
        { label: 'Help & guide', desc: 'The controller, adding games, BIOS files, saves and fixes for common problems', type: 'action', run: () => App.open(Help) },
        { label: 'Run the setup again', desc: 'Games folder, emulators, BIOS, controller and covers, step by step', type: 'action', run: () => App.open(Setup) },
        { label: 'Check for MediaDeck updates', desc: 'From MediaDeck\'s GitHub releases. Your settings, apps and emulators stay.', type: 'action',
          value: () => (selfLatest ? `${selfLatest} available - install` : ''), run: () => selfUpdateNow() },
        { label: 'Check for MediaDeck updates at start', desc: 'At start and every 6 hours while it runs: when there is a new version, a window asks whether to update (when MediaDeck is in front - never while a game runs)', type: 'toggle', key: 'checkMediaDeckUpdates' },
        { label: 'Portable: works on any PC', desc: 'On: history, favourites and covers are locked with a key in MediaDeck\'s data folder, so the MediaDeck folder works on another PC or a USB stick. '
          + 'Off: locked to this Windows account (more private; on another PC they are not readable).', type: 'toggle', key: 'portableData' },
        { label: 'App folder', type: 'info', value: () => (info ? info.appDir : '') },
        { label: 'Exit MediaDeck', type: 'action', run: () => api.quit() },
      ],
    },
  ];

  const section = () => SECTIONS.find((x) => x.id === active);

  // ---------- Drawing ----------
  // Settings → Controllers → Set up a controller: which kind of pad first, so the setup asks for its own buttons
  async function pickPadType(current) {
    const t = await UI.menu({ title: 'What kind of controller?', message: 'MediaDeck then asks for its buttons by their own names.', focus: current,
      items: [...PadSetup.TYPES.map((x) => ({ label: x.name, value: x.id, icon: 'gamepad' })), { label: 'Cancel', value: '', icon: 'back' }] });
    if (t) App.open(PadSetup, { type: t });
  }

  // Settings → Controllers → GameCube controller adapter: is it plugged in, has it got the WinUSB driver Dolphin
  // needs (installed by the player with Zadig), and does Dolphin use it
  async function gcAdapter() {
    UI.toast('Looking for the adapter…', { icon: 'gamepad', duration: 2000 });
    const s = await api.gcAdapter();
    const title = 'GameCube controller adapter';
    if (!s.dolphin) return UI.menu({ title, message: 'Dolphin isn\'t installed. Install it in Settings → Emulators first.', items: [{ label: 'OK', value: '', icon: 'check' }] });
    if (!s.plugged && !s.inDolphin) return UI.menu({ title, message: 'No adapter is plugged in. Plug it in (Mayflash: switch it to Wii U mode; both USB plugs for rumble), then choose this again.', items: [{ label: 'OK', value: '', icon: 'check' }] });
    if (s.plugged && !s.winusb) {
      return UI.menu({ title, message: 'The adapter is plugged in, but Windows hasn\'t got the WinUSB driver for it yet - Dolphin needs it. Once: download Zadig (zadig.akeo.ie), choose Options → List All Devices, pick "WUP-028", choose WinUSB and click Replace Driver. Then choose this again.',
        items: [{ label: 'OK', value: '', icon: 'check' }] });
    }
    const message = s.inDolphin
      ? `Dolphin uses the adapter for its four GameCube ports${s.plugged ? '' : ' (it isn\'t plugged in right now)'}. The Xbox controller and set-up pads don't work in GameCube games while it does.`
      : 'The adapter is ready. Dolphin can use it for its four GameCube ports - each pad in the adapter is one player, with every button, analog L / R and rumble.';
    const v = await UI.menu({ title, message, items: [
      s.inDolphin ? { label: 'Stop using it in Dolphin', value: 'off', icon: 'close' } : { label: 'Use it in Dolphin', value: 'on', icon: 'check' },
      { label: 'Cancel', value: '', icon: 'back' }] });
    if (!v) return;
    await api.gcAdapter(v === 'on');
    UI.toast(v === 'on' ? 'Dolphin uses the GameCube adapter now' : 'Dolphin uses the controllers again', { icon: 'check', duration: 4000 });
  }

  // Sections of one group (the media player's) share one entry on the left and get sub-tabs on the page;
  // LB / RB go to the previous / next sub-tab. A group opens on the sub-tab used last.
  const GROUPS = { player: { title: 'Media Player', icon: 'media' } };
  const groupLast = {};
  const membersOf = (g) => SECTIONS.filter((x) => x.group === g);
  const isActiveTab = (b) => (b.dataset.sectionGroup ? b.dataset.sectionGroup === section().group : b.dataset.section === active);

  function renderNav() {
    navEl.innerHTML = '';
    const done = new Set();
    for (const sec of SECTIONS) {
      if (sec.group && done.has(sec.group)) continue;
      const g = sec.group && GROUPS[sec.group];
      if (g) done.add(sec.group);
      const b = document.createElement('button');
      b.className = 'tab focusable';
      b.dataset.group = 'settings-nav';
      if (g) b.dataset.sectionGroup = sec.group; else b.dataset.section = sec.id;
      b.innerHTML = `<span class="tab-icon">${Icons[(g || sec).icon] || ''}</span><span class="tab-label">${UI.esc((g || sec).title)}</span>`;
      b.addEventListener('click', () => openSection(g ? (groupLast[sec.group] || sec.id) : sec.id));
      b.classList.toggle('active', isActiveTab(b));
      navEl.appendChild(b);
    }
  }

  function renderSubtabs(sec) {
    subEl.innerHTML = '';
    subEl.hidden = !sec.group;
    if (!sec.group) return;
    for (const m of membersOf(sec.group)) {
      const b = document.createElement('button');
      b.className = 'chip focusable subtab' + (m.id === sec.id ? ' active' : '');
      b.dataset.group = 'settings-subtabs';
      b.dataset.section = m.id;
      b.innerHTML = `${Icons[m.icon] || ''}<span>${UI.esc(m.title)}</span>`;
      b.addEventListener('click', () => openSection(m.id, { stayOnTab: true }));
      subEl.appendChild(b);
    }
  }

  function renderList() {
    const sec = section();
    titleEl.textContent = sec.group ? GROUPS[sec.group].title : sec.title;
    descEl.textContent = sec.desc || '';
    renderSubtabs(sec);
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
  // At start (main → 'mediadeck-update'): the update window; when another window is open only a toast
  if (api.onSelfUpdate) api.onSelfUpdate(async (v) => {
    const { latest, notes = [] } = typeof v === 'string' ? { latest: v } : v;
    selfLatest = latest;
    if (UI.isOpen) { UI.toast(`MediaDeck ${latest} is out. Settings → About → Check for MediaDeck updates`, { icon: 'refresh', duration: 9000 }); return; }
    const news = notes.length ? `What's new: ${notes.join(' · ')}. ` : '';
    const c = await UI.menu({ title: `MediaDeck ${latest} is out`,
      message: `${news}It downloads the new version, closes, updates itself and starts again. Your settings, apps, emulators and games stay.`,
      items: [{ label: 'Update now', icon: 'check', value: 'update' }, { label: 'Later', icon: 'close', value: 'later' }] });
    if (c !== 'update') return;
    const x = await api.selfInstall();
    if (x && x.error) UI.toast(x.error, { icon: 'alert', error: true, duration: 8000 });
  });

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
      'Box art comes from the libretro thumbnail library (the one RetroArch uses). Game names are sent to it to find the pictures (PS3 serials go to GameTDB, Xbox 360 title IDs to XboxUnity); nothing else. This can take a few minutes.',
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

  // A path saved relative to MediaDeck's folder (Games) as a full one
  const fullPath = (p) => (p && !/^([a-z]:|\\)/i.test(p) && info && info.appDir ? `${info.appDir}\\${p}` : p || '');

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
      const v = await UI.menu({ title: item.label, focus: set[item.key], onFocus: item.preview,
        items: opts.map((o) => ({ label: o.label, value: o.value, icon: o.value === set[item.key] ? 'check' : '', swatch: o.swatch })) });
      if (v === null || v === undefined) { if (item.preview) item.preview(set[item.key]); return; }   // back to what it was
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
    // one message that changes its text (a new one each time would flash in again on every MB)
    let last = null, done = null;
    api.onInstallProgress((p) => {
      clearTimeout(done);
      if (!last || !last.el.isConnected || last.el.classList.contains('out')) last = UI.toast(p.text, { spinner: true, duration: 0 });
      else last.el.querySelector('span').textContent = p.text;
      // finished steps ("… installed"): the spinner becomes a tick and the message goes after a while
      if (p.pct >= 1 && /installed|updated/i.test(p.text)) {
        const spin = last.el.querySelector('.spinner');
        if (spin) spin.outerHTML = Icons.check;
        const t = last;
        done = setTimeout(() => { t.remove(); if (last === t) last = null; }, 2500);
      }
    });
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
  function openSection(id, opts = {}) {
    if (id !== active) {
      active = id;
      if (section().group) groupLast[section().group] = id;
      navEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', isActiveTab(b)));
      renderList();
    }
    const tab = opts.stayOnTab && subEl.querySelector(`.subtab[data-section="${id}"]`);
    if (tab) Nav.focus(tab); else focusList();
  }

  // LB / RB, or left / right on the sub-tabs: the group's previous / next sub-tab
  function stepSubtab(dir, stayOnTab) {
    const sec = section();
    if (!sec.group) return false;
    const list = membersOf(sec.group);
    const i = list.findIndex((x) => x.id === sec.id) + dir;
    if (i < 0 || i >= list.length) return true;
    openSection(list[i].id, { stayOnTab });
    return true;
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
    if (action === 'lb' || action === 'rb') return stepSubtab(action === 'lb' ? -1 : 1, !!(cur && cur.classList.contains('subtab')));
    if (cur && cur.classList.contains('subtab') && (action === 'right' || (action === 'left' && cur.previousElementSibling))) {
      return stepSubtab(action === 'left' ? -1 : 1, true);       // along the sub-tabs (the first one: left goes to the menu)
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
