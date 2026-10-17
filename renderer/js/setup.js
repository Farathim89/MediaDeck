// First-start setup: games folder → emulators → BIOS → controller → covers → done. Every step can be skipped and
// everything can be changed later in Settings. Opened at the first start, from Settings → About ("Run the setup
// again"), and as the BIOS check alone (Settings → Emulators → "BIOS check": { only: 'bios' }).
const Setup = (() => {
  const el = document.getElementById('setup');
  const STEPS = [
    { id: 'welcome', name: 'Welcome' }, { id: 'games', name: 'Games' }, { id: 'emulators', name: 'Emulators' },
    { id: 'bios', name: 'BIOS' }, { id: 'controller', name: 'Controller' }, { id: 'covers', name: 'Covers' }, { id: 'done', name: 'Done' },
  ];
  let step = 0, only = null;
  let root = '', candidates = null, rows = null, bios = null, picks = new Set(), busy = false, padTimer = null, lastPress = '';
  let appDirs = null, catalog = null;
  const isOwn = (p) => !!(p && appDirs && p.toLowerCase().replace(/[\\/]+$/, '') === String(appDirs.gamesDir || '').toLowerCase());
  // With no games yet (a new MediaDeck\Games): the emulators for the best-known consoles, none ticked
  const POPULAR = ['nes', 'snes', 'n64', 'gb', 'nds', 'gcwii', 'ps1', 'ps2', 'psp', 'md', 'saturn', 'dc'];
  const s = () => App.state.config.settings;
  const save = () => api.saveConfig(App.state.config);
  const esc = (t) => UI.esc(t);
  const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;

  // ---------- Drawing ----------
  function row({ act, id = '', label, desc = '', value = '', icon = '', cls = '' }) {
    return `<button class="setting focusable ${cls}" data-group="setup-list" data-act="${act}" data-id="${esc(id)}">
      ${icon ? `<span class="setup-mark">${icon}</span>` : ''}
      <div class="setting-text"><div class="setting-label">${esc(label)}</div>${desc ? `<div class="setting-desc">${esc(desc)}</div>` : ''}</div>
      ${value ? `<div class="setting-value"><span class="setting-value-text">${value}</span></div>` : ''}
    </button>`;
  }
  const info = (label, desc = '', icon = '', cls = '') => `<div class="setting type-info ${cls}">${icon ? `<span class="setup-mark">${icon}</span>` : ''}
      <div class="setting-text"><div class="setting-label">${esc(label)}</div>${desc ? `<div class="setting-desc">${esc(desc)}</div>` : ''}</div></div>`;
  const button = (act, label, primary) => `<button class="btn focusable${primary ? ' primary' : ''}" data-group="setup-buttons" data-act="${act}">${esc(label)}</button>`;
  const OK = '<b class="ok">✓</b>', NO = '<b class="no">!</b>', OPT = '<b class="opt">○</b>';

  function frame(title, desc, body, buttons, focusSel) {
    const dots = only ? '' : `<div class="setup-steps">${STEPS.map((x, i) =>
      `<span class="${i === step ? 'on' : i < step ? 'done' : ''}">${esc(x.name)}</span>`).join('')}</div>`;
    el.innerHTML = `<section class="setup-page">${dots}
      <div class="hero-kicker">${only ? 'BIOS check' : `MediaDeck setup · step ${step + 1} of ${STEPS.length}`}</div>
      <h1 class="setup-title">${esc(title)}</h1><div class="setup-desc">${desc}</div>
      <div class="settings-list setup-body">${body}</div>
      <div class="setup-buttons">${buttons}</div></section>`;
    el.appendChild(UI.hints([['a', 'Choose'], ['b', step || only ? 'Back' : 'Skip setup']]));
    Nav.bindMouse(el);
    const f = (focusSel && el.querySelector(focusSel)) || el.querySelector('.setup-buttons .btn.primary') || Nav.items()[0];
    if (f) Nav.focus(f);
  }

  function busyFrame(title, text) {
    el.innerHTML = `<section class="setup-page"><div class="hero-kicker">MediaDeck setup</div><h1 class="setup-title">${esc(title)}</h1>
      <div class="setup-desc"><span class="spinner"></span> ${esc(text)}</div></section>`;
  }

  // The games folder and its consoles, for whichever step needs them first (also when a step is opened alone)
  async function ensureRows(title) {
    if (!root) root = await api.setupRoot() || '';
    if (root && !rows) { busyFrame(title, 'Counting the games…'); rows = await api.setupScan(root); }
  }

  // ---------- Steps ----------
  const views = {
    welcome() {
      frame('Welcome to MediaDeck',
        'Your games, films, music, YouTube and Twitch on the TV, all with the controller.<br>This setup takes a minute: '
        + 'it finds your games, installs the emulators that play them, checks BIOS files and your controller, and gets box art. '
        + 'Every step can be skipped, and everything can be changed later in Settings.',
        info('Your games', 'MediaDeck has its own Games folder with a folder for every console, ready made (Games\\Nintendo\\SNES, Games\\Sony\\PlayStation …) - '
          + 'or use a games folder you already have. MediaDeck never downloads games or BIOS files.', '🎮')
        + info('Portable', 'Everything stays in the MediaDeck folder - settings, emulators, saves, covers and the games in its Games folder. '
          + 'Copy it to another drive or a USB stick and it works on any PC.', '💾'),
        button('skip', 'Skip setup') + button('next', 'Start', true));
    },

    async games() {
      if (!appDirs) appDirs = await api.appInfo();
      if (!root) root = await api.setupRoot() || '';
      const own = isOwn(root);
      if (root && !rows) { busyFrame('Your games', 'Counting the games…'); rows = await api.setupScan(root); }
      const games = (rows || []).reduce((a, r) => a + r.games, 0);
      // MediaDeck's own Games folder still empty (or none set): games somewhere else on this PC are offered too
      if ((!root || (own && !games)) && !candidates) {
        busyFrame('Your games', 'Looking for games on this PC… (this can take a moment)');
        candidates = await api.setupFind();
      }
      const counts = rows && rows.length ? `${n(rows.length, 'console', 'consoles')} · ${n(games, 'game', 'games')}` : '';
      const others = (candidates || []).filter((c) => c.path !== root).slice(0, 3)
        .map((c) => row({ act: 'use', id: c.path, label: c.path, desc: `${n(c.consoles, 'console', 'consoles')} · ${n(c.games, 'game', 'games')} - use this folder instead`, icon: OPT })).join('');
      const list = (own
        ? row({ act: 'openown', label: `${root} (MediaDeck's own)`, icon: OK, value: 'Open',
          desc: games ? counts : 'Ready: a folder for every console (Nintendo\\SNES, Sony\\PlayStation, Sega\\Mega Drive …) - put your games in them. '
            + 'It moves with MediaDeck: copy the MediaDeck folder to another drive or a USB stick and your games come along.' })
        : (root ? row({ act: 'pick', label: root, desc: counts || 'No console folders found in it', value: 'Change…', icon: rows && rows.length ? OK : NO }) : '')
          + row({ act: 'own', label: 'Use MediaDeck\'s own Games folder', icon: OPT,
            desc: 'Portable: MediaDeck\\Games, with a folder for every console made for you. Copy the MediaDeck folder anywhere and the games come along.' }))
        + (others ? `<div class="settings-heading">${own && !games ? 'Games found on this PC' : 'Other games folders'}</div>${others}` : '')
        + (own || !root ? row({ act: 'pick', label: 'Choose another folder…', desc: 'A folder with one folder per console, anywhere on this PC', value: 'Change…', icon: OPT }) : '')
        + (rows && rows.length ? `<div class="setup-consoles">${rows.slice(0, 40).map((r) => `<span>${esc(r.name)} <i>${r.games}</i></span>`).join('')}</div>` : '');
      frame('Your games', own && !games
        ? 'Your games go in MediaDeck\'s own Games folder: one folder per console, already made. Already have games somewhere? Pick that folder below.'
        : 'MediaDeck looks for one folder per console, named after it (SNES, PlayStation 2, Mega Drive …). Is this where your games are?',
        list, button('back', 'Back') + button('next', root ? 'Use this folder' : 'Skip', true));
    },

    async emulators() {
      await ensureRows('Emulators');
      const empty = !(rows || []).length;
      if (empty && !catalog) catalog = await api.installCatalog();
      const need = empty
        ? POPULAR.map((id) => (catalog || []).find((c) => c.id === id)).filter((c) => c && !c.emulators.some((e) => e.installed))
          .map((c) => ({ consoleId: c.id, consoleName: c.name, emulator: c.emulators[0], installed: [], games: 0 }))
        : (rows || []).filter((r) => r.emulator && !r.installed.length);
      views.emulators.need = need;
      const have = (rows || []).filter((r) => r.installed.length);
      const none = (rows || []).filter((r) => !r.emulator && !r.installed.length);
      if (!picks.size && !views.emulators.touched && !empty) need.forEach((r) => picks.add(r.consoleId));
      const seen = new Set();
      const body = (need.length ? need.filter((r) => !seen.has(r.consoleId) && seen.add(r.consoleId)).map((r) => row({
        act: 'tick', id: r.consoleId, label: `${r.consoleName} - ${r.emulator.name}`,
        desc: `${r.emulator.desc || ''}${r.emulator.desc ? ' · ' : ''}${empty ? 'for when you add its games' : n(r.games, 'game', 'games')}`,
        value: `<span class="switch${picks.has(r.consoleId) ? ' on' : ''}"><i></i></span>` })).join('') : '')
        + (have.length ? `<div class="settings-heading">Already installed</div>` + have.map((r) => info(`${r.name} - ${r.installed.join(', ')}`, n(r.games, 'game', 'games'), OK)).join('') : '')
        + (none.length ? `<div class="settings-heading">No emulator in MediaDeck yet</div>` + none.map((r) => info(r.name, `${n(r.games, 'game', 'games')} - add an emulator for it to Emu_modules yourself`, OPT)).join('') : '')
        || info('No consoles found', 'Pick your games folder in the step before, or add emulators later: Settings → Emulators → Install emulators.', OPT);
      const count = [...picks].filter((id) => need.some((r) => r.consoleId === id)).length;
      frame('Emulators', empty && need.length ? 'No games yet - tick the consoles you will play and MediaDeck gets their emulators now from their official pages '
        + '(portable, in Emu_modules), set up for your controller. Others: Settings → Emulators → Install emulators, any time.'
        : need.length ? 'These consoles have games but no emulator yet. MediaDeck downloads the ones you tick from their official pages and sets them up (portable, in Emu_modules).'
        : 'Every console with games already has an emulator.', body,
        button('back', 'Back') + (count ? button('install', `Install ${n(count, 'emulator', 'emulators')}`, true) + button('next', 'Skip') : button('next', 'Next', true)));
    },

    async bios() {
      if (!only) await ensureRows('BIOS files');
      busyFrame('BIOS files', 'Checking the BIOS files…');
      bios = await api.biosStatus(only ? null : (rows || []).map((r) => r.system));
      const icon = (b) => (b.ok ? OK : b.ok === null ? OPT : b.need === 'required' ? NO : OPT);
      // missing: the recommended file names (any one for your region, or all of them for consoles that need several)
      const recText = (b) => (b.rec && b.rec.length ? `${b.allParts ? 'all of' : b.rec.length > 1 ? 'one of' : ''} ${b.rec.map((r) => `${r.name} (${r.what})`).join(b.allParts ? ', ' : ' · ')}`.trim() : b.files);
      const state = (b) => (b.ok ? `found: ${b.found.join(', ')}` : b.ok === null ? recText(b) : `${b.need === 'required' ? 'needed' : b.need === 'cd' ? 'needed for CD games' : 'optional'}: ${recText(b)}`);
      const missing = bios.filter((b) => b.ok === false && b.need === 'required').length;
      const body = bios.length ? bios.map((b) => row({ act: 'biosdir', id: b.folder, label: b.name, desc: state(b), icon: icon(b),
        value: b.ok ? '' : 'Open its folder' })).join('') : info('No BIOS needed', 'None of your consoles needs a BIOS file.', OK);
      frame('BIOS files', 'Some consoles need a BIOS (the console\'s own start-up program) to run games. MediaDeck never downloads them: '
        + 'dump them from your own consoles. Have them in a folder or zip already? Import BIOS files… recognises each one and puts it in place; '
        + 'or put them in the console\'s folder in MediaDeck\'s BIOS folder yourself - names as shown.'
        + (missing ? `<br><b>${n(missing, 'console needs', 'consoles need')} a BIOS that isn't there yet.</b>` : ''),
        body, (only ? button('close', 'Done', true) : button('back', 'Back')) + button('import', 'Import BIOS files…', !missing ? false : true) + button('recheck', 'Check again') + button('sync', 'Copy BIOS files to the emulators')
        + (only ? '' : button('next', 'Next', true)));
    },

    controller() {
      const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
      frame('Your controller', 'MediaDeck works with Xbox, PlayStation and most other controllers (and the keyboard). Press a button to test it.',
        (pads.length ? pads.map((p) => info(p.id.replace(/\s*\(.*?\)\s*/g, ' ').trim(), 'Connected', OK)).join('')
          : info('No controller seen yet', 'Plug one in or switch it on, then press a button. PlayStation controllers: Settings → Controllers sets up DS4Windows so games see them as Xbox controllers.', OPT))
        + info(lastPress ? `You pressed: ${lastPress}` : 'Press a button…', 'A = choose · B = back · Y = options · PS / Guide = MediaDeck menu (also over a game)', '🎮')
        + row({ act: 'controllers', label: 'Controller settings…', desc: 'DS4Windows, ViGEmBus and HidHide for PlayStation controllers, the in-game overlay', value: 'Open' }),
        button('back', 'Back') + button('next', 'Next', true));
      clearInterval(padTimer);
      let count = pads.length;
      padTimer = setInterval(() => {
        const now = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean).length;
        if (now !== count && STEPS[step].id === 'controller') { count = now; views.controller(); }
      }, 700);
    },

    covers() {
      frame('Box art', 'MediaDeck can get covers for your games from the libretro thumbnail library (the one RetroArch uses), '
        + 'PS3 and Switch covers from GameTDB, Xbox 360 from XboxUnity. Only the game names (or serial / title ID) are sent. Covers are stored encrypted on this PC.',
        row({ act: 'auto', label: 'Get covers for new games automatically', desc: 'Once a day, a while after MediaDeck starts', value: `<span class="switch${s().autoCovers !== false ? ' on' : ''}"><i></i></span>` }),
        button('back', 'Back') + button('download', 'Download covers now', true) + button('next', 'Later'));
    },

    done() {
      frame('All set', 'Have fun! A few things worth knowing:',
        info('PS / Guide button', 'Opens the MediaDeck menu - over a game too (back to the game, save state, close it). At home it opens the Exit menu.', '🎮')
        + info('Help', 'The Help page (Settings → Help) explains the controller, adding games, BIOS files and common problems.', '❔')
        + info('Settings', 'Everything from this setup is in Settings: Emulators (install, BIOS check, game folders), Controllers, Appearance. Settings → About runs this setup again.', '⚙')
        + info('New games', 'Put them in their console\'s folder - MediaDeck finds them at the next start; covers come by themselves.', '➕'),
        button('back', 'Back') + button('finish', 'Start using MediaDeck', true));
    },
  };

  async function show(i) {
    clearInterval(padTimer);
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    await views[STEPS[step].id]();
  }

  function finish() {
    clearInterval(padTimer);
    if (!only) { s().setupDone = true; save(); }
    App.back();
  }

  // ---------- Actions ----------
  async function act(a, id, btn) {
    if (busy) return;
    if (a === 'next') return show(step + 1);
    if (a === 'back') return show(step - 1);
    if (a === 'skip' || a === 'finish' || a === 'close') return finish();
    if (a === 'pick') {
      const p = await api.pickFile({ folder: true, title: 'Your games folder', defaultPath: root || undefined });
      if (p) { root = p; rows = null; s().gamesFolder = p; save(); await show(step); }
      return;
    }
    if (a === 'use') { root = id; rows = null; s().gamesFolder = id; save(); return show(step); }
    if (a === 'own') { const r = await api.setupStarter(); root = r.path; rows = null; candidates = null; s().gamesFolder = r.path; save(); return show(step); }
    if (a === 'openown') return api.openPath(root);
    if (a === 'tick') { views.emulators.touched = true; picks.has(id) ? picks.delete(id) : picks.add(id); return views.emulators(); }
    if (a === 'install') {
      const list = (views.emulators.need || []).filter((r) => picks.has(r.consoleId) && r.emulator && !r.installed.length)
        .filter((r, i, all) => all.findIndex((x) => x.consoleId === r.consoleId) === i).map((r) => ({ emuId: r.emulator.id, consoleId: r.consoleId }));
      if (!list.length) return;
      busy = true;
      try {
        if (root && root !== s().gamesFolder) { s().gamesFolder = root; await save(); }
        busyFrame('Emulators', `Installing ${n(list.length, 'emulator', 'emulators')} - each one is downloaded from its own page…`);
        const r = await api.installEmulators(list);
        if (r && r.config) App.state.config = r.config;
        const bad = ((r && r.results) || []).filter((x) => !x.ok);
        UI.toast(bad.length ? `${list.length - bad.length} installed, ${bad.length} failed: ${bad.map((x) => x.error).join('; ').slice(0, 120)}` : `${n(list.length, 'emulator', 'emulators')} installed`,
          { icon: bad.length ? 'alert' : 'check', error: !!bad.length, duration: bad.length ? 9000 : 3500 });
        rows = await api.setupScan(root);
        picks = new Set();
      } finally { busy = false; }
      return views.emulators();
    }
    if (a === 'biosdir') return api.openPath(id);
    if (a === 'recheck') return views.bios();
    if (a === 'import') {
      const p = await api.pickFile({ folder: true, title: 'The folder with your BIOS files' });
      if (!p) return;
      busy = true;
      let r;
      try { busyFrame('BIOS files', 'Recognising your BIOS files by their checksums…'); r = await api.biosImport([p]); }
      finally { busy = false; }
      const by = {};
      for (const x of r.added) (by[x.folder] = by[x.folder] || []).push(x.name);
      const lines = Object.entries(by).map(([f, names]) => `${f}: ${names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ')}`);
      const msg = [r.added.length ? `${n(r.added.length, 'BIOS file', 'BIOS files')} added:\n${lines.join('\n')}` : 'No new BIOS files in that folder.',
        r.already ? `${n(r.already, 'file was', 'files were')} already there.` : '',
        r.kept.length ? `Kept the different file already in: ${r.kept.slice(0, 3).join(', ')}${r.kept.length > 3 ? ' …' : ''}` : '',
        r.badDumps.length ? `Not a known good dump (checksum doesn't match): ${[...new Set(r.badDumps)].slice(0, 5).join(', ')}` : '',
        r.copied ? `${n(r.copied, 'file', 'files')} copied to the emulators.` : ''].filter(Boolean).join('\n\n');
      await UI.menu({ title: 'BIOS import', message: msg, items: [{ label: 'OK', value: true, icon: 'check' }] });
      return views.bios();
    }
    if (a === 'sync') {
      const ok = await UI.confirm('Copy BIOS files to the emulators?', 'Emulators get their BIOS files from MediaDeck\'s BIOS folder only when they are installed. '
        + 'This copies the files you added since into each emulator\'s own BIOS folder (only missing ones; nothing is overwritten or moved).', 'Copy');
      if (!ok) return;
      const copied = await api.biosSync();
      UI.toast(copied.length ? `${n(copied.length, 'BIOS file', 'BIOS files')} copied` : 'Every emulator has its BIOS files already', { icon: 'check' });
      return views.bios();
    }
    if (a === 'controllers') { clearInterval(padTimer); return App.open(Settings, { section: 'controllers' }); }
    if (a === 'auto') { s().autoCovers = s().autoCovers === false; save(); return views.covers(); }
    if (a === 'download') {
      const emus = App.state.config.tiles.filter((t) => t.section === 'emulators' && t.moduleId);
      busy = true;
      const t = UI.toast('Getting covers…', { spinner: true, duration: 0 });
      let found = 0, total = 0;
      try {
        for (const [i, e] of emus.entries()) {
          t.el.querySelector('span').textContent = `Getting covers… ${e.name} (${i + 1} of ${emus.length})`;
          const r = await api.downloadCovers(e.moduleId);
          if (r) { found += r.found || 0; total += r.total || 0; }
        }
      } finally { busy = false; t.remove(); }
      UI.toast(total ? `${found} of ${total} covers found` : 'Every game has a cover already', { icon: 'check', duration: 4000 });
      return show(step + 1);
    }
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) act(b.dataset.act, b.dataset.id, b);
  });

  // ---------- Screen ----------
  const PRESS = { ok: 'A (choose)', back: 'B (back)', x: 'X', menu: 'Y (options)', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'Start', select: 'Back / Select',
    up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
  function handle(action) {
    if (STEPS[step].id === 'controller' && !only && PRESS[action] && action !== 'ok' && action !== 'back') {
      lastPress = PRESS[action];
      const lbl = [...el.querySelectorAll('.setting-label')].find((x) => /^(You pressed|Press a button)/.test(x.textContent));
      if (lbl) lbl.textContent = `You pressed: ${lastPress}`;
    }
    if (action === 'back') {
      if (only) finish();
      else if (step > 0) show(step - 1);
      else UI.confirm('Skip the setup?', 'You can run it any time from Settings → About → Run the setup again.', 'Skip setup').then((yes) => yes && finish());
      return true;
    }
    return false;
  }

  function init() {}
  function enter(params = {}) {
    only = params.only || null;
    root = ''; candidates = null; rows = null; catalog = null; bios = null; picks = new Set(); views.emulators.touched = false; lastPress = '';
    Nav.setRoot(el);
    UI.glow(null);
    show(only ? STEPS.findIndex((x) => x.id === only) : 0);
  }
  function resume() { Nav.setRoot(el); show(step); }
  function leave() { clearInterval(padTimer); }

  return { el, init, enter, resume, leave, handle, show };
})();
