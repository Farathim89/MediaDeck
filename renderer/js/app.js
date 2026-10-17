// App start-up, screen stack, clock and input routing.
// A screen is { el, init(), enter(params), resume(), leave(), handle(action) }.
const App = {
  state: null,
  stack: [],

  get current() { return this.stack[this.stack.length - 1]; },

  async init() {
    this.state = await api.getState();
    this.applyTheme(this.state.config.settings.theme);
    this.applyGameView(this.state.config.settings.gameView);
    for (const s of [Home, MediaHome, Browser, Photos, Settings]) s.init();
    Input.setHandler((action) => this.dispatch(action));
    api.onAppFocus(() => { if (this.current && this.current.refocus) this.current.refocus(); });
    api.onDrivesChanged((data) => { MediaHome.drivesChanged(data); Browser.drivesChanged(data); });
    api.onPlayerClosed((progress) => {
      this.state.progress = progress;
      if (this.current && this.current.resume) this.current.resume();
    });
    api.onRunningMenu((info) => this.runningMenu(info));
    // PS / Guide at home: the Exit menu; pressed again (any menu open): it closes
    if (api.onPowerMenu) api.onPowerMenu(() => { if (UI.isOpen) UI.dismiss(); else Home.powerMenu(); });
    if (api.onYouTubeMenu) api.onYouTubeMenu(() => this.youtubeMenu());
    if (api.onTwitchMenu) api.onTwitchMenu(() => this.twitchMenu());
    api.onToast((text) => UI.toast(text, { icon: 'check' }));
    this.startClock();
    this.open(Home);
  },

  THEMES: [
    { id: 'oled', name: 'OLED Black' },
    { id: 'midnight', name: 'Midnight' },
    { id: 'graphite', name: 'Graphite' },
    { id: 'ocean', name: 'Ocean' },
    { id: 'amethyst', name: 'Amethyst' },
    { id: 'ember', name: 'Ember' },
  ],

  applyTheme(id) {
    document.documentElement.dataset.theme = this.THEMES.some((t) => t.id === id) ? id : 'oled';
  },

  // A console's games: big covers, small covers or a list (no covers loaded)
  applyGameView(v) {
    document.documentElement.dataset.gameView = ['small', 'list'].includes(v) ? v : 'big';
  },

  async chooseTheme() {
    const s = this.state.config.settings;
    const current = s.theme || 'oled';
    const c = await UI.menu({
      title: 'Theme', focus: current,
      items: this.THEMES.map((t) => ({ label: t.name, value: t.id, icon: t.id === current ? 'check' : 'palette' })),
    });
    if (!c) return;
    s.theme = c;
    this.applyTheme(c);
    await api.saveConfig(this.state.config);
  },

  // Before starting a game/app: is something started from here still running?
  async beforeLaunch(newName) {
    const r = await api.runningInfo();
    if (!r) return true;
    const c = await UI.menu({
      title: `${r.name} is still running`,
      message: `Start ${newName} anyway?`,
      items: [
        { label: `Back to ${r.name}`, icon: 'play', value: 'resume' },
        { label: `Close ${r.name} and start ${newName}`, icon: 'close', value: 'close' },
        { label: 'Cancel', icon: 'back', value: 'cancel' },
      ],
    });
    if (c === 'resume') { api.resumeRunning(); return false; }
    if (c !== 'close') return false;
    let res = await api.closeRunning(false);
    if (!res.closed) {
      const f = await UI.menu({ title: `${r.name} is not closing`, message: 'It may be asking something (save?) in its own window.', items: [
        { label: `Go to ${r.name}`, icon: 'play', value: 'resume' },
        { label: 'Force close (unsaved progress is lost)', icon: 'close', value: 'force', danger: true },
      ] });
      if (f === 'resume') { api.resumeRunning(); return false; }
      if (f !== 'force') return false;
      res = await api.closeRunning(true);
    }
    return res.closed;
  },

  // Controller combo (Back + Start held, or Guide) while a game/app runs: close it or go back
  // PS button while YouTube is in front: YouTube waits (paused) behind this menu
  async youtubeMenu() {
    const c = await UI.menu({
      title: 'YouTube',
      message: 'Paused',
      items: [
        { label: 'Back to YouTube', icon: 'play', value: 'resume' },
        { label: 'YouTube settings (TizenTube)', icon: 'settings', value: 'tizentube' },
        { label: 'Close YouTube', icon: 'close', value: 'close', danger: true },
        { label: 'Stay in MediaDeck', icon: 'home', value: 'stay' },
      ],
    });
    await api.youtubeAction(c || 'stay');
    if (c === 'close') UI.toast('YouTube closed', { icon: 'check' });
  },

  // PS button while Twitch is in front: Twitch waits behind this menu
  async twitchMenu() {
    const c = await UI.menu({
      title: 'Twitch',
      items: [
        { label: 'Back to Twitch', icon: 'play', value: 'resume' },
        { label: 'Close Twitch', icon: 'close', value: 'close', danger: true },
        { label: 'Stay in MediaDeck', icon: 'home', value: 'stay' },
      ],
    });
    await api.twitchAction(c || 'stay');
    if (c === 'close') UI.toast('Twitch closed', { icon: 'check' });
  },

  async runningMenu(info) {
    if (!info || !info.alive) {
      UI.toast('Back in MediaDeck', { icon: 'home' });
      return;
    }
    // Emulator actions the game supports (save/load state …) sit between "Back" and "Close"
    const EXTRA = { saveState: ['Save state', 'check'], loadState: ['Load state', 'restart'], pause: ['Pause / continue', 'pause'], screenshot: ['Screenshot', 'image'], options: ['Emulator options', 'settings'] };
    const extra = (info.actions || []).filter((a) => EXTRA[a]).map((a) => ({ label: EXTRA[a][0], icon: EXTRA[a][1], value: a }));
    const c = await UI.menu({
      title: info.name,
      message: info.emulator ? `Still running in ${info.emulator}` : 'Still running',
      items: [
        { label: `Back to ${info.name}`, icon: 'play', value: 'resume' },
        ...extra,
        { label: `Close ${info.name}`, icon: 'close', value: 'close', danger: true },
        { label: 'Stay in MediaDeck', icon: 'home', value: 'stay' },
      ],
    });
    if (c === 'resume') return api.resumeRunning();
    if (EXTRA[c]) return api.runningAction(c);
    if (c !== 'close') return;
    const busy = UI.toast(`Closing ${info.name}…`, { spinner: true, duration: 0 });
    let r = await api.closeRunning(false);
    busy.remove();
    if (!r.closed) {
      const f = await UI.menu({ title: `${info.name} is not closing`, message: 'It may be asking something (save?) in its own window.', items: [
        { label: `Go to ${info.name}`, icon: 'play', value: 'resume' },
        { label: 'Force close (unsaved progress is lost)', icon: 'close', value: 'force', danger: true },
      ] });
      if (f === 'resume') return api.resumeRunning();
      if (f === 'force') r = await api.closeRunning(true);
    }
    if (r.closed) UI.toast(r.forced ? `${info.name} closed (it had no window left)` : `${info.name} closed`, { icon: 'check' });
  },

  open(screen, params) {
    if (this.current) this.current.el.classList.remove('active');
    this.stack.push(screen);
    screen.el.classList.add('active');
    screen.enter(params || {});
  },

  back() {
    if (this.stack.length <= 1) return;
    const top = this.stack.pop();
    top.el.classList.remove('active');
    if (top.leave) top.leave();
    this.current.el.classList.add('active');
    this.current.resume();
  },

  // Go back until this screen is on top
  backTo(screen) {
    while (this.stack.length > 1 && this.current !== screen) this.back();
  },

  dispatch(action) {
    if (UI.handle(action)) return;
    if (this.current && this.current.handle && this.current.handle(action)) return;
    if (['up', 'down', 'left', 'right'].includes(action)) Nav.move(action);
    else if (action === 'ok') Nav.activate();
    else if (action === 'back') this.back();
  },

  startClock() {
    const tick = () => {
      const now = new Date();
      const h24 = this.state.config.settings.clock24h !== false;
      const time = now.toLocaleTimeString(h24 ? 'en-GB' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: !h24 });
      const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      document.querySelectorAll('.clock-time').forEach((e) => { e.textContent = time; });
      document.querySelectorAll('.clock-date').forEach((e) => { e.textContent = date; });
    };
    tick();
    setInterval(tick, 5000);
  },
};

// Starts mpv playback in its own layer over the app
const Player = {
  async play(list, index, opts = {}) {
    if (!list.length) return;
    const r = await api.play(list, Math.max(0, index), opts);
    if (!r || !r.ok) UI.menu({ title: `Can't play`, message: (r && r.error) || 'The player could not start.', items: [{ label: 'OK', icon: 'check' }] });
  },
};

App.init();
