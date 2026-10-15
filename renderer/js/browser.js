// Folder browser: a grid of folders and media files with thumbnails and the name underneath.
const Browser = (() => {
  const el = document.getElementById('browser');
  const scroller = el.querySelector('.grid-scroll');
  const grid = el.querySelector('.grid');
  const crumbsEl = el.querySelector('.crumbs');
  const infoEl = el.querySelector('.browser-info');
  const emptyEl = el.querySelector('.empty-note');

  let rootPath = '';
  let rootLabel = '';
  let current = null;   // { path, entries }
  let history = [];     // [{ path, focus }] folders we came through
  let loadId = 0;

  const SORTS = { name: 'Name', date: 'Newest', size: 'Size' };
  const settings = () => App.state.config.settings;

  function openRoot(path, label, focusPath) {
    App.open(Browser, { path, label, focus: focusPath });
  }

  // ---------- Loading a folder ----------
  async function load(path, focusPath) {
    const id = ++loadId;
    grid.innerHTML = '';
    emptyEl.textContent = '';
    infoEl.textContent = 'Loading…';
    renderCrumbs(path);
    let dir;
    try {
      dir = await api.listDir(path);
    } catch (e) {
      if (id !== loadId) return;
      UI.toast(`Can't open this folder`, { icon: 'alert', error: true });
      if (history.length) return goBack(); else return App.back();
    }
    if (id !== loadId) return;
    current = { path, entries: Media.sortEntries(dir.entries, settings().sortBy) };
    render(focusPath);
  }

  function render(focusPath) {
    const entries = current.entries;
    grid.innerHTML = '';
    const observer = Media.lazy(scroller);
    const frag = document.createDocumentFragment();
    for (const item of entries) {
      const card = cardEl(item);
      frag.appendChild(card);
      observer.observe(card.querySelector('.thumb'));
    }
    grid.appendChild(frag);
    const folders = entries.filter((e) => e.kind === 'folder').length;
    const files = entries.length - folders;
    infoEl.innerHTML = `${[folders && `${folders} folder${folders > 1 ? 's' : ''}`, files && `${files} file${files > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
      <span class="sort-chip">${Icons.sort}${SORTS[settings().sortBy] || 'Name'}</span>`;
    emptyEl.textContent = entries.length ? '' : 'Nothing to play in this folder';
    const target = (focusPath && grid.querySelector(`[data-path="${CSS.escape(focusPath)}"]`)) || grid.querySelector('.card');
    if (target) Nav.focus(target);
    else Nav.focus(el.querySelector('.back-btn'));
    if (!target || target === grid.querySelector('.card')) scroller.scrollTop = 0;
  }

  function cardEl(item) {
    const b = document.createElement('button');
    b.className = `card focusable kind-${item.kind}`;
    b.dataset.path = item.path;
    b._item = item;
    const w = item.kind === 'video' || item.kind === 'audio' ? Media.watchState(item.path) : null;
    const ext = Media.extOf(item.name).toUpperCase();
    const meta = item.kind === 'folder' ? 'Folder'
      : w && w.watched ? `Watched · ${Media.formatSize(item.size)}`
      : [ext, Media.formatSize(item.size)].filter(Boolean).join(' · ');
    b.innerHTML = `
      <div class="thumb" data-src='${UI.esc(JSON.stringify(Media.thumbSources(item)))}'>
        <span class="thumb-icon">${Media.kindIcon(item.kind)}</span>
        ${w && w.pct ? `<div class="thumb-progress"><i style="width:${w.pct}%"></i></div>` : ''}
        ${w && w.watched ? `<span class="thumb-watched">${Icons.check}</span>` : ''}
      </div>
      <div class="card-name">${UI.esc(item.kind === 'folder' ? item.name : Media.stripExt(item.name))}</div>
      <div class="card-meta">${UI.esc(meta)}</div>`;
    b.addEventListener('click', () => openItem(item));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Nav.focus(b, { scroll: false }); options(item); });
    return b;
  }

  function renderCrumbs(path) {
    const rel = path.length > rootPath.length ? path.slice(rootPath.length).split(/[\\/]/).filter(Boolean) : [];
    const parts = [rootLabel, ...rel];
    const shown = parts.length > 4 ? [parts[0], '…', ...parts.slice(-2)] : parts;
    crumbsEl.innerHTML = shown.map((p, i) => `<span class="crumb${i === shown.length - 1 ? ' last' : ''}">${UI.esc(p)}</span>`).join(`<span class="crumb-sep">${Icons.right}</span>`);
  }

  // ---------- Focus scrolling ----------
  el.addEventListener('nav-focus', (e) => {
    const card = e.target.closest('.card');
    if (!card) { UI.glow('#334155'); return; }
    if (e.detail.scroll) {
      // The focused row stays in the middle of the screen (TV style)
      scroller.scrollTop = Math.max(0, card.offsetTop + card.offsetHeight / 2 - scroller.clientHeight / 2);
    }
    const kindColor = { folder: '#ca8a04', video: '#2563eb', audio: '#9333ea', image: '#0891b2' }[card._item.kind];
    const img = card.querySelector('.thumb-img');
    UI.glow(kindColor, img && card._item.kind !== 'folder' ? img.src : null);
  });

  // ---------- Actions ----------
  function siblings(kind) {
    return current.entries.filter((e) => e.kind === kind);
  }

  function openItem(item, opts = {}) {
    if (item.kind === 'folder') {
      history.push({ path: current.path, focus: item.path, scroll: scroller.scrollTop });
      load(item.path);
    } else if (item.kind === 'video' || item.kind === 'audio') {
      const list = siblings(item.kind).map((e) => e.path);
      Player.play(list, list.indexOf(item.path), opts);
    } else if (item.kind === 'image') {
      const list = siblings('image');
      App.open(Photos, { list, index: list.indexOf(item), slideshow: !!opts.slideshow });
    } else {
      api.openExternalPlayer(item.path);
    }
  }

  function goBack() {
    if (!history.length) return App.back();
    const h = history.pop();
    load(h.path, h.focus);
  }

  async function options(item) {
    const favs = App.state.config.favorites;
    const isFav = favs.some((f) => f.path === item.path);
    const w = Media.watchState(item.path);
    const list = [];
    if (item.kind === 'folder') {
      list.push({ label: 'Open', icon: 'folder', value: 'open' });
      list.push({ label: 'Play all videos', icon: 'play', value: 'playall' });
      list.push(isFav ? { label: 'Remove from favourites', icon: 'star', value: 'unfav' } : { label: 'Add to favourites', icon: 'star', value: 'fav' });
    } else if (item.kind === 'image') {
      list.push({ label: 'View', icon: 'image', value: 'open' }, { label: 'Slideshow from here', icon: 'play', value: 'slideshow' });
    } else {
      list.push({ label: w && w.pct ? 'Resume' : 'Play', icon: 'play', value: 'open' });
      if (w && w.pct) list.push({ label: 'Play from the beginning', icon: 'restart', value: 'start' });
      list.push(w && w.watched ? { label: 'Mark as unwatched', icon: 'eye', value: 'unwatched' } : { label: 'Mark as watched', icon: 'check', value: 'watched' });
      list.push({ label: 'Open with VLC', icon: 'external', value: 'vlc' });
    }
    list.push({ label: `Sort: ${SORTS[settings().sortBy]}`, icon: 'sort', value: 'sort' });

    const c = await UI.menu({ title: item.kind === 'folder' ? item.name : Media.stripExt(item.name), items: list });
    if (!c) return;
    if (c === 'open') openItem(item);
    if (c === 'slideshow') openItem(item, { slideshow: true });
    if (c === 'start') openItem(item, { fromStart: true });
    if (c === 'vlc') api.openExternalPlayer(item.path);
    if (c === 'sort') cycleSort();
    if (c === 'playall') playAll(item.path);
    if (c === 'fav' || c === 'unfav') {
      if (c === 'fav') favs.push({ path: item.path, name: item.name });
      else favs.splice(favs.findIndex((f) => f.path === item.path), 1);
      await api.saveConfig(App.state.config);
      UI.toast(c === 'fav' ? `${item.name} added to favourites` : 'Removed from favourites', { icon: 'star' });
    }
    if (c === 'watched' || c === 'unwatched') {
      const data = c === 'watched' ? { pos: 0, dur: (App.state.progress[item.path] || {}).dur || 0, watched: true } : null;
      if (data) App.state.progress[item.path] = data; else delete App.state.progress[item.path];
      await api.setProgress(item.path, data);
      refresh();
    }
  }

  async function playAll(folder) {
    try {
      const dir = await api.listDir(folder);
      const videos = Media.sortEntries(dir.entries, 'name').filter((e) => e.kind === 'video').map((e) => e.path);
      if (!videos.length) return UI.toast('No videos in that folder', { icon: 'alert' });
      Player.play(videos, 0);
    } catch {
      UI.toast(`Can't open that folder`, { icon: 'alert', error: true });
    }
  }

  async function cycleSort() {
    const keys = Object.keys(SORTS);
    const s = settings();
    s.sortBy = keys[(keys.indexOf(s.sortBy) + 1) % keys.length];
    await api.saveConfig(App.state.config);
    const focus = Nav.current && Nav.current.dataset.path;
    current.entries = Media.sortEntries(current.entries, s.sortBy);
    render(focus);
    UI.toast(`Sorted by ${SORTS[s.sortBy].toLowerCase()}`, { icon: 'sort', duration: 1500 });
  }

  // Redraw (watched marks may have changed) keeping focus and scroll
  function refresh() {
    if (!current) return;
    const focus = Nav.current && Nav.current.dataset.path;
    const top = scroller.scrollTop;
    render(focus);
    scroller.scrollTop = top;
  }

  function pageMove(dir) {
    const cards = [...grid.querySelectorAll('.card')];
    if (!cards.length) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / cards[0].offsetWidth));
    const i = Math.max(0, cards.indexOf(Nav.current));
    const rows = Math.max(1, Math.floor(scroller.clientHeight / cards[0].offsetHeight));
    Nav.focus(cards[Math.min(cards.length - 1, Math.max(0, i + dir * cols * rows))]);
  }

  function handle(action) {
    if (action === 'back') { goBack(); return true; }
    if (action === 'menu') {
      const card = Nav.current && Nav.current.closest('.card');
      if (card) options(card._item);
      return true;
    }
    if (action === 'x') { cycleSort(); return true; }
    if (action === 'lb' || action === 'lt') { pageMove(-1); return true; }
    if (action === 'rb' || action === 'rt') { pageMove(1); return true; }
    return false;
  }

  function drivesChanged({ drives }) {
    if (!current) return;
    const letter = current.path[0].toUpperCase();
    if (/^[A-Z]:/i.test(current.path) && !drives.some((d) => d.letter === letter)) {
      current = null;
      App.backTo(MediaHome);
    }
  }

  function init() {
    Nav.bindMouse(el);
    el.querySelector('.back-btn').innerHTML = Icons.back;
    el.querySelector('.back-btn').addEventListener('click', () => goBack());
    el.appendChild(UI.hints([['a', 'Open'], ['y', 'Options'], ['x', 'Sort'], ['b', 'Back']]));
  }

  function enter({ path, label, focus }) {
    Nav.setRoot(el);
    rootPath = path;
    rootLabel = label || path;
    history = [];
    current = null;
    // Opening a folder at a file (Continue watching → Open folder) focuses that file
    load(path, focus);
  }

  function resume() {
    Nav.setRoot(el);
    refresh();
  }

  function leave() {
    grid.innerHTML = '';
    current = null;
  }

  return { el, init, enter, resume, leave, handle, openRoot, refresh, drivesChanged };
})();
