// Media Player start screen: Continue watching, Drives (with live USB detection), Favourite folders.
const MediaHome = (() => {
  const el = document.getElementById('media');
  const rowsEl = el.querySelector('.rows');
  const hero = el.querySelector('.hero');
  const heroKicker = el.querySelector('.hero-kicker');
  const heroTitle = el.querySelector('.hero-title');
  const heroSub = el.querySelector('.hero-sub');
  let inner = null;
  let drives = [];
  let lastFocusKey = null;
  const items = new Map(); // focus key -> data for the hero

  const ACCENT = '#4f7bd9';
  const KIND_ORDER = { usb: 0, hdd: 1, network: 2, disc: 3 };
  const KIND_NAME = { usb: 'USB drive', hdd: 'Drive', network: 'Network drive', disc: 'Disc' };

  function continueList() {
    return Object.entries(App.state.progress)
      .filter(([, p]) => !p.watched && p.pos > 30 && (!p.dur || p.pos < p.dur - 20))
      .sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
      .slice(0, 20)
      .map(([path, p]) => ({ path, ...p }));
  }

  // ---------- Rows ----------
  function render(focusKey) {
    items.clear();
    rowsEl.innerHTML = '<div class="rows-inner"></div>';
    inner = rowsEl.firstChild;

    const cont = continueList();
    if (cont.length) addRow('continue', 'Continue watching', cont.map(continueTile));

    const sorted = visibleDrives().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.letter.localeCompare(b.letter));
    const hiddenCount = drives.length - sorted.length;
    const empty = !drivesLoaded ? 'Looking for drives…'
      : App.state.config.settings.usbOnly ? 'No USB drive connected. Plug one in and it shows up here.'
      : 'All drives are hidden. Show them again in Settings → Media Player.';
    addRow('drives', hiddenCount ? `Drives <small class="row-note">${hiddenCount} hidden</small>` : 'Drives', sorted.map(driveTile), sorted.length ? '' : empty);

    const favs = App.state.config.favorites;
    if (favs.length) addRow('favorites', 'Favourite folders', favs.map(favoriteTile));

    const target = (focusKey && el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)) ||
      (lastFocusKey && el.querySelector(`[data-key="${CSS.escape(lastFocusKey)}"]`)) ||
      el.querySelector('.rows .tile');
    Nav.focus(target || el.querySelector('.back-btn'));
  }

  function addRow(id, title, tiles, emptyText) {
    const row = document.createElement('section');
    row.className = 'row';
    row.innerHTML = `<h2 class="row-title">${title}<small>${tiles.length || ''}</small></h2><div class="row-track"></div>`;
    const track = row.querySelector('.row-track');
    tiles.forEach((t) => { t.dataset.group = id; track.appendChild(t); });
    if (!tiles.length && emptyText) track.innerHTML = `<div class="row-empty">${emptyText}</div>`;
    inner.appendChild(row);
  }

  function continueTile(p) {
    const b = document.createElement('button');
    const key = 'c:' + p.path;
    b.className = 'tile tile-media focusable';
    b.dataset.key = key;
    const name = Media.stripExt(Media.baseName(p.path));
    const pct = p.dur ? Math.min(100, (p.pos / p.dur) * 100) : 0;
    b.innerHTML = `
      <div class="thumb" data-src='${UI.esc(JSON.stringify([Media.url('thumb', { p: p.path, w: 480 })]))}'>${Icons.film}</div>
      <div class="tile-label">${UI.esc(name)}<small>${Media.formatTime(p.dur - p.pos)} left</small></div>
      <div class="tile-progress"><i style="width:${pct}%"></i></div>`;
    Media.loadThumb(b.querySelector('.thumb'));
    items.set(key, { kicker: 'Continue watching', title: name, sub: `${Media.formatTime(p.pos)} of ${Media.formatTime(p.dur)}  ·  ${Media.baseName(Media.dirOf(p.path))}`, image: Media.url('thumb', { p: p.path, w: 480 }) });
    b.addEventListener('click', () => playContinue(p));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); continueOptions(p); });
    b.dataset.menu = 'continue';
    b._data = p;
    return b;
  }

  function driveTile(d) {
    const b = document.createElement('button');
    const key = 'd:' + d.letter;
    const used = d.size ? (1 - d.free / d.size) * 100 : 0;
    b.className = `tile tile-drive focusable ${d.kind}${used > 92 ? ' full' : ''}${d.isNew ? ' is-new' : ''}`;
    b.dataset.key = key;
    b.innerHTML = `
      <div class="drive-top"><span class="drive-icon">${Icons[d.kind] || Icons.hdd}</span><span class="drive-letter">${d.letter}:</span></div>
      ${d.kind === 'usb' ? '<span class="badge">USB</span>' : ''}
      <div class="drive-name">${UI.esc(d.label)}</div>
      <div class="drive-meta">${Media.formatSize(d.free)} free of ${Media.formatSize(d.size)}</div>
      <div class="drive-bar"><i style="width:${used.toFixed(1)}%"></i></div>`;
    items.set(key, {
      kicker: KIND_NAME[d.kind] || 'Drive', title: d.label,
      sub: `${d.letter}:  ·  ${Media.formatSize(d.free)} free of ${Media.formatSize(d.size)}`,
      color: d.kind === 'usb' ? ACCENT : '#475569',
    });
    b.addEventListener('click', () => Browser.openRoot(d.path, `${d.label} (${d.letter}:)`));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); driveOptions(d); });
    b.dataset.menu = 'drive';
    b._data = d;
    return b;
  }

  function favoriteTile(f) {
    const b = document.createElement('button');
    const key = 'f:' + f.path;
    b.className = 'tile tile-media tile-folder focusable';
    b.dataset.key = key;
    b.innerHTML = `
      <div class="thumb" data-src='${UI.esc(JSON.stringify([Media.url('art', { p: f.path, w: 480 })]))}'>${Icons.folder}</div>
      <div class="tile-label">${UI.esc(f.name)}<small>${UI.esc(f.path)}</small></div>`;
    Media.loadThumb(b.querySelector('.thumb'));
    items.set(key, { kicker: 'Favourite folder', title: f.name, sub: f.path, color: '#ca8a04' });
    b.addEventListener('click', () => Browser.openRoot(f.path, f.name));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); favoriteOptions(f); });
    b.dataset.menu = 'favorite';
    b._data = f;
    return b;
  }

  // ---------- Focus ----------
  el.addEventListener('nav-focus', (e) => {
    const target = e.target;
    el.querySelectorAll('.row.has-focus').forEach((r) => r.classList.remove('has-focus'));
    const row = target.closest('.row');
    if (row) {
      row.classList.add('has-focus');
      if (e.detail.scroll) UI.scrollRow(inner, row, target);
    }
    if (target.dataset.key) lastFocusKey = target.dataset.key;
    const info = items.get(target.dataset.key);
    const changed = heroTitle.textContent !== (info ? info.title : 'Media Player');
    if (changed) { hero.classList.remove('swap'); void hero.offsetWidth; hero.classList.add('swap'); }
    heroKicker.textContent = info ? info.kicker : 'Back';
    heroTitle.textContent = info ? info.title : 'Media Player';
    heroSub.textContent = info ? info.sub : 'Return to the home screen';
    UI.glow(info ? info.color || ACCENT : ACCENT, info && info.image);
  });

  // ---------- Actions ----------
  async function playContinue(p) {
    try {
      const dir = await api.listDir(Media.dirOf(p.path));
      const videos = Media.sortEntries(dir.entries, 'name').filter((e) => e.kind === 'video').map((e) => e.path);
      const idx = videos.indexOf(p.path);
      Player.play(idx >= 0 ? videos : [p.path], Math.max(0, idx));
    } catch {
      UI.toast('That drive is not connected', { icon: 'alert', error: true });
    }
  }

  async function continueOptions(p) {
    const c = await UI.menu({ title: Media.stripExt(Media.baseName(p.path)), items: [
      { label: 'Resume', icon: 'play', value: 'play' },
      { label: 'Play from the beginning', icon: 'restart', value: 'start' },
      { label: 'Open folder', icon: 'folder', value: 'folder' },
      { label: 'Remove from Continue watching', icon: 'close', value: 'remove' },
    ] });
    if (c === 'play') playContinue(p);
    if (c === 'start') { await api.setProgress(p.path, null); delete App.state.progress[p.path]; playContinue(p); }
    if (c === 'folder') Browser.openRoot(Media.dirOf(p.path), Media.baseName(Media.dirOf(p.path)), p.path);
    if (c === 'remove') {
      App.state.progress[p.path] = { ...App.state.progress[p.path], watched: true };
      await api.setProgress(p.path, App.state.progress[p.path]);
      render();
    }
  }

  async function favoriteOptions(f) {
    const favs = App.state.config.favorites;
    const i = favs.indexOf(f);
    const list = [{ label: 'Open', icon: 'folder', value: 'open' }, { label: 'Rename', icon: 'edit', value: 'rename' }];
    if (i > 0) list.push({ label: 'Move left', icon: 'left', value: 'left' });
    if (i < favs.length - 1) list.push({ label: 'Move right', icon: 'right', value: 'right' });
    list.push({ label: 'Remove from favourites', icon: 'trash', value: 'remove', danger: true });
    const c = await UI.menu({ title: f.name, items: list });
    if (c === 'open') Browser.openRoot(f.path, f.name);
    if (c === 'rename') { const n = await UI.prompt({ title: 'Rename', value: f.name }); if (n) f.name = n; }
    if (c === 'left' || c === 'right') { const j = i + (c === 'left' ? -1 : 1); [favs[i], favs[j]] = [favs[j], favs[i]]; }
    if (c === 'remove') favs.splice(i, 1);
    if (c && c !== 'open') { await api.saveConfig(App.state.config); render('f:' + f.path); }
  }

  async function confirmExit() {
    const c = await UI.menu({
      title: 'Exit Media Player?',
      message: 'Return to the home screen.',
      items: [
        { label: 'Exit to home screen', icon: 'exit', value: 'exit' },
        { label: 'Stay', icon: 'close', value: 'stay' },
      ],
    });
    if (c === 'exit') App.back();
  }

  function handle(action) {
    const cur = Nav.current;
    if (action === 'back') { confirmExit(); return true; }
    if (action === 'menu' && cur && cur._data) {
      if (cur.dataset.menu === 'continue') continueOptions(cur._data);
      if (cur.dataset.menu === 'favorite') favoriteOptions(cur._data);
      if (cur.dataset.menu === 'drive') driveOptions(cur._data);
      return true;
    }
    if (action === 'lb' || action === 'rb') {
      const row = cur && cur.closest('.row');
      if (row) { const t = [...row.querySelectorAll('.tile')]; Nav.focus(action === 'lb' ? t[0] : t[t.length - 1]); }
      return true;
    }
    return false;
  }

  // ---------- Drives ----------
  // A drive is known by its name and size (USB drives can get another letter)
  const driveKey = (d) => `${d.label}|${d.size}`;
  let drivesLoaded = false;

  function visibleDrives() {
    const set = App.state.config.settings;
    const hidden = new Set((set.hiddenDrives || []).map((h) => h.key));
    return drives.filter((d) => !hidden.has(driveKey(d)) && (!set.usbOnly || d.kind === 'usb'));
  }

  async function driveOptions(d) {
    const c = await UI.menu({ title: `${d.label} (${d.letter}:)`, items: [
      { label: 'Open', icon: 'folder', value: 'open' },
      { label: 'Hide this drive', icon: 'eye', value: 'hide' },
    ] });
    if (c === 'open') Browser.openRoot(d.path, `${d.label} (${d.letter}:)`);
    if (c === 'hide') {
      const set = App.state.config.settings;
      set.hiddenDrives = [...(set.hiddenDrives || []).filter((h) => h.key !== driveKey(d)), { key: driveKey(d), label: d.label, letter: d.letter }];
      await api.saveConfig(App.state.config);
      UI.toast(`${d.label} hidden. Show it again in Settings → Media Player.`, { icon: 'eye', duration: 4000 });
      render();
    }
  }

  function drivesChanged({ drives: next, added }) {
    const removed = drives.filter((d) => !next.some((n) => n.letter === d.letter));
    drives = next.map((d) => ({ ...d, isNew: added.some((a) => a.letter === d.letter) }));
    const shown = new Set(visibleDrives().map((d) => d.letter));
    for (const d of added.filter((x) => shown.has(x.letter))) UI.toast(`${d.kind === 'usb' ? 'USB drive' : 'Drive'} connected: ${d.label} (${d.letter}:)`, { icon: d.kind === 'usb' ? 'usb' : 'hdd' });
    for (const d of removed) UI.toast(`Drive removed: ${d.label} (${d.letter}:)`, { icon: 'alert' });
    if (App.current === MediaHome) render(added.length ? 'd:' + added[0].letter : undefined);
  }

  function init() {
    Nav.bindMouse(el);
    el.querySelector('.back-btn').innerHTML = Icons.back;
    el.querySelector('.back-btn').addEventListener('click', () => confirmExit());
    el.appendChild(UI.hints([['a', 'Open'], ['y', 'Options'], ['b', 'Back']]));
  }

  async function enter() {
    Nav.setRoot(el);
    lastFocusKey = null;
    render();
    drives = (await api.watchDrives(true)).map((d) => ({ ...d }));
    drivesLoaded = true;
    if (App.current === MediaHome) render();
  }

  function resume() {
    Nav.setRoot(el);
    render();
  }

  function leave() {
    api.watchDrives(false);
  }

  return { el, init, enter, resume, leave, handle, drivesChanged, get drives() { return drives; } };
})();
