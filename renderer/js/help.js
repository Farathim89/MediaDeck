// Help: how MediaDeck works, with the controller - one topic per tab, its text in blocks you move through with the
// controller (Right to read, Up / Down to scroll, Left / B back to the topics). Opened from the Home screen's
// help button and from Settings → Help.
const Help = (() => {
  const el = document.getElementById('help');
  const tabsEl = el.querySelector('.tabs');
  const pageEl = el.querySelector('.settings-page');
  let active = 'controller';

  const k = (t) => `<span class="key">${t}</span>`;
  const TOPICS = [
    { id: 'controller', title: 'The controller', icon: 'gamepad', desc: 'Every button, in MediaDeck and over a game', blocks: [
      ['Moving around', `${k('D-pad')} or the ${k('left stick')} moves, ${k('A')} chooses, ${k('B')} goes back. ${k('Y')} opens a game's or file's options (start, favourite, open its folder …). ${k('LB')} / ${k('RB')} jump through a long list - by letter in a console's games, a page at a time in folders, to the start or end of a row. In a video, ${k('LB')} / ${k('RB')} play the previous / next file and ${k('LT')} / ${k('RT')} skip a big step back / forward.`],
      ['The PS / Guide button', `At home it opens the ${k('Exit')} menu (sleep, restart, shut down, exit MediaDeck) - press it again to close the menu. Over a game it brings up MediaDeck's menu: back to the game, save / load state, pause, screenshot, emulator options, close the game. Holding ${k('Back + Start')} (or ${k('Share + Options')}) for a second does the same.`],
      ['PlayStation controllers', `Most games and emulators expect an Xbox controller. Settings → Controllers installs ${k('DS4Windows')} (with ViGEmBus and HidHide), which makes a DualShock 4 or DualSense look like an Xbox controller to Windows. MediaDeck itself reads PlayStation controllers directly.`],
      ['Keyboard and mouse', `${k('Arrows')} move, ${k('Enter')} chooses, ${k('Esc')} / ${k('Backspace')} go back, ${k('M')} or the context-menu key opens options, ${k('Ctrl + Alt + Home')} brings MediaDeck to the front from anywhere. The mouse works everywhere too (right-click = options).`],
    ] },
    { id: 'games', title: 'Adding games', icon: 'plus', desc: 'Where games go and how MediaDeck finds them', blocks: [
      ['MediaDeck\'s Games folder', `MediaDeck has its own ${k('Games')} folder with a folder for every console, made at the first start: ${k('Games\\Nintendo\\SNES')}, ${k('Games\\Sony\\PlayStation')}, ${k('Games\\Sega\\Mega Drive')} … Put each game in its console's folder. It is portable: copy the MediaDeck folder to another drive or a USB stick and your games come along.`],
      ['One folder per console', `Or use a games folder of your own, with one folder per console, named after it - for example ${k('Games\\SNES')}, ${k('Games\\PlayStation 2')}, ${k('Games\\Mega Drive')}. Maker folders work too: ${k('Games\\Nintendo\\SNES')}. Settings → Emulators → Games folder tells MediaDeck where it is.`],
      ['New games', `Copy them into their console's folder - MediaDeck lists them the next time you open that console (or after a restart). Box art comes by itself once a day, or straight away with ${k('Covers')} on the console's page.`],
      ['Disc games', `A disc game that is several files (a ${k('.cue')} with its ${k('.bin')} tracks) or several discs goes in a folder of its own; a ${k('.cue')} or ${k('.m3u')} shows the whole game as one card. ${k('.chd')} and ${k('.iso')} files work too.`],
      ['Tabs for extras', `A folder whose name starts with ${k('0 - ')} inside a console folder - ${k('0 - Homebrew')}, ${k('0 - Translations')}, ${k('0 - Hacks')} - becomes its own tab on that console's page.`],
      ['Several versions', `Different regions or revisions of one game (USA, Europe, Rev 1 …) show as one card; starting it asks which version (Settings → Emulators → Group versions of a game).`],
      ['ROM Collection Checker', 'The companion app (github.com/Farathim89/rom-collection-checker) sorts a folder of new games into this layout, names them after No-Intro / Redump and finds what you are missing.'],
    ] },
    { id: 'emulators', title: 'Emulators', icon: 'gamepad', desc: 'Installing, choosing and updating them', blocks: [
      ['Installing', `Settings → Emulators → ${k('Install emulators')}: pick a console, tick the emulators you want. MediaDeck downloads them from their official pages, makes them portable and puts them in its Emu_modules folder, ready to use.`],
      ['Which one plays a console', `On a console's page, ${k('Emulator')} chooses which installed emulator starts its games. Standalone emulators are picked before RetroArch.`],
      ['Updates', `Settings → Emulators → ${k('Check for updates')}. Updating keeps the emulator's settings, saves and BIOS files.`],
      ['Your own emulator', `Put an emulator's folder in Emu_modules and press ${k('Look for new emulators')}; its game folders are set from Settings → Emulators.`],
    ] },
    { id: 'bios', title: 'BIOS files', icon: 'disc', desc: 'What they are and where they go', blocks: [
      ['What a BIOS is', 'Some consoles (PlayStation, PS2, Saturn, Sega CD, Xbox, Neo Geo …) need their own start-up program to run games. It isn\'t part of the games and MediaDeck never downloads it - dump it from your own console.'],
      ['Where it goes', `In MediaDeck's ${k('BIOS')} folder, in the console's folder - e.g. ${k('BIOS\\Sony - PlayStation\\scph5501.bin')}. Settings → Emulators → ${k('BIOS check')} shows, per console, which files it needs, which are there and opens the folder.`],
      ['Import them in one go', `Your BIOS files in a folder or zip, named any way? ${k('BIOS check')} → ${k('Import BIOS files…')}: each file is recognised by its checksum, named and put in its console's folder, and copied to the emulators. Your folder is only read.`],
      ['Added later', `BIOS files you put in ${k('BIOS')} later are copied to the emulators that need them at the next start of MediaDeck (nothing is overwritten). Straight away: ${k('BIOS check')} → ${k('Copy BIOS files to the emulators')}.`],
      ['PS3 and Switch', 'They need firmware, not a BIOS file: install it from RPCS3\'s File menu (PS3UPDAT.PUP from playstation.com). For the Switch, put prod.keys, title.keys and the firmware .zip from your own Switch in BIOS\\Nintendo - Switch before installing Eden: MediaDeck puts them into it (Ryujinx: its Tools menu).'],
    ] },
    { id: 'saves', title: 'Saves', icon: 'check', desc: 'Where your progress is kept', blocks: [
      ['In-game saves', 'Each emulator keeps its saves (memory cards, battery saves) in its own folder in Emu_modules - they stay when the emulator is updated. Back up Emu_modules to keep them safe.'],
      ['Save states', `From the PS / Guide menu over a game: ${k('Save state')} and ${k('Load state')} (for emulators that have them). Closing a game from that menu answers the emulator's "Are you sure?" for you; emulators that save a resume state on close (DuckStation) still do.`],
    ] },
    { id: 'media', title: 'Films, music & streams', icon: 'film', desc: 'The Media Player, YouTube and Twitch', blocks: [
      ['Media Player', `Browse your drives and folders; videos play in MediaDeck's own player (mpv) with subtitles and audio tracks. Pictures open in the photo viewer. USB sticks show up when they are plugged in.`],
      ['YouTube and Twitch', `The TV versions, without ads, played with the controller. The PS / Guide button brings MediaDeck back while they run.`],
      ['Apps', `Add other programs as tiles (Plex, Kodi, Steam …): Settings → Apps. MediaDeck can install some of them for you.`],
    ] },
    { id: 'problems', title: 'Problems?', icon: 'alert', desc: 'Common problems and what to do', blocks: [
      ['A game doesn\'t show up', `Check it is in a console folder MediaDeck uses (the console's page → ${k('Game folders')}) and that the emulator plays its file type. A CloneCD game (.ccd / .img) needs a .cue for DuckStation. Restart MediaDeck to read the folders again.`],
      ['A game starts with a black screen', `Usually a missing BIOS - see ${k('BIOS check')}. For some consoles the emulator shows what it misses: open it without a game from the console's page.`],
      ['The controller does nothing in a game', `PlayStation controllers: set up DS4Windows (Settings → Controllers). In the emulator itself, check its controller settings (the PS / Guide menu → Emulator options).`],
      ['MediaDeck doesn\'t come back over a game', `Press the PS / Guide button, or hold Back + Start. ${k('Ctrl + Alt + Home')} brings it to the front from the keyboard.`],
      ['No covers', `Covers come from the game's name: well-named games (No-Intro / Redump names) find theirs best. ${k('Covers')} on a console's page tries again.`],
      ['Updates', `MediaDeck looks for a new version at every start and asks (Settings → About). Your settings, apps, emulators and games stay.`],
    ] },
  ];

  function renderNav() {
    tabsEl.innerHTML = '';
    for (const t of TOPICS) {
      const b = document.createElement('button');
      b.className = 'tab focusable' + (t.id === active ? ' active' : '');
      b.dataset.group = 'help-nav';
      b.dataset.topic = t.id;
      b.innerHTML = `<span class="tab-icon">${Icons[t.icon] || ''}</span><span class="tab-label">${UI.esc(t.title)}</span>`;
      b.addEventListener('click', () => { open(t.id); const f = pageEl.querySelector('.help-block'); if (f) Nav.focus(f); });
      tabsEl.appendChild(b);
    }
  }

  function renderPage() {
    const t = TOPICS.find((x) => x.id === active);
    pageEl.innerHTML = `<div class="hero-kicker">Help</div><h1 class="settings-title">${UI.esc(t.title)}</h1>
      <div class="settings-desc">${UI.esc(t.desc)}</div><div class="settings-list">${t.blocks.map(([h, body]) =>
      `<div class="setting help-block focusable" data-group="help-list"><div class="setting-text"><div class="setting-label">${UI.esc(h)}</div>
      <div class="setting-desc help-text">${body}</div></div></div>`).join('')}</div>`;
    pageEl.scrollTop = 0;
  }

  function open(id) {
    active = id;
    tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.topic === id));
    renderPage();
  }

  function handle(action) {
    const inNav = Nav.current && Nav.current.closest('.sidebar');
    if (action === 'up' || action === 'down') {
      Nav.move(action, (n) => !!n.closest('.sidebar') === !!inNav);
      if (inNav && Nav.current && Nav.current.dataset.topic) open(Nav.current.dataset.topic);
      return true;
    }
    if (action === 'right' && inNav) { const f = pageEl.querySelector('.help-block'); if (f) Nav.focus(f); return true; }
    if ((action === 'left' || action === 'back') && !inNav) { Nav.focus(tabsEl.querySelector(`[data-topic="${active}"]`)); return true; }
    if (action === 'ok' && !inNav) return true;
    return false;
  }

  function init() {
    Nav.bindMouse(el);
    const back = el.querySelector('.back-btn');
    back.innerHTML = Icons.back;
    back.addEventListener('click', () => App.back());
    el.appendChild(UI.hints([['b', 'Back']]));
  }
  function enter(params = {}) {
    Nav.setRoot(el);
    UI.glow(null);
    active = params.topic || active;
    renderNav();
    renderPage();
    Nav.focus(tabsEl.querySelector(`[data-topic="${active}"]`));
  }
  function resume() { Nav.setRoot(el); }

  return { el, init, enter, resume, handle, TOPICS };
})();
