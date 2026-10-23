// Folder browser: a grid of folders and media files with thumbnails and the name underneath.
const Browser = (() => {
  const el = document.getElementById('browser');
  const scroller = el.querySelector('.grid-scroll');
  const grid = el.querySelector('.grid');
  const contEl = el.querySelector('.continue-strip');
  const contRow = el.querySelector('.continue-row');
  const crumbsEl = el.querySelector('.crumbs');
  const infoEl = el.querySelector('.browser-info');
  const emptyEl = el.querySelector('.empty-note');

  let rootPath = '';
  let rootLabel = '';
  let current = null;   // { path, entries }
  let history = [];     // [{ path, focus }] folders we came through
  let loadId = 0;
  let renderId = 0;

  const SORTS = { name: 'Name', date: 'Newest', size: 'Size' };
  const settings = () => App.state.config.settings;

  function openRoot(path, label, focusPath) {
    App.open(Browser, { path, label, focus: focusPath });
  }

  // ---------- Loading a folder ----------
  async function load(path, focusPath) {
    const id = ++loadId;
    grid.innerHTML = '';
    contRow.innerHTML = '';
    contEl.hidden = true;
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

  // focusCont: focusPath is a Continue watching card
  function render(focusPath, focusCont) {
    const entries = current.entries;
    const rid = ++renderId;
    grid.innerHTML = '';
    const observer = Media.lazy(scroller);
    const frag = document.createDocumentFragment();
    for (const item of entries) {
      const card = cardEl(item);
      frag.appendChild(card);
      observer.observe(card.querySelector('.thumb'));
    }
    grid.appendChild(frag);
    renderContinue(observer);
    const folders = entries.filter((e) => e.kind === 'folder').length;
    const files = entries.length - folders;
    infoEl.innerHTML = `${[folders && `${folders} folder${folders > 1 ? 's' : ''}`, files && `${files} file${files > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
      <span class="sort-chip">${Icons.sort}${SORTS[settings().sortBy] || 'Name'}</span>`;
    emptyEl.textContent = entries.length ? '' : 'Nothing to play in this folder';
    const first = scroller.querySelector('.card');
    const sel = focusPath && `[data-path="${CSS.escape(focusPath)}"]`;
    const target = (sel && ((focusCont && contRow.querySelector(sel)) || grid.querySelector(sel))) || first;
    if (target) Nav.focus(target);
    else Nav.focus(el.querySelector('.back-btn'));
    if (!target || target === first) scroller.scrollTop = 0;
    markFolders(rid);
  }

  // Continue watching: the videos in here (or further down) stopped part way, last watched first - one row of them
  function renderContinue(observer) {
    contRow.innerHTML = '';
    const list = settings().continueInFolders === false ? [] : Media.continueList(current.path);
    contEl.hidden = !list.length;
    if (!list.length) return;
    list.forEach((p) => contRow.appendChild(continueCard(p)));
    const cols = (getComputedStyle(contRow).gridTemplateColumns.match(/px/g) || []).length || 6;
    [...contRow.children].slice(cols).forEach((c) => c.remove());
    contRow.querySelectorAll('.thumb').forEach((t) => observer.observe(t));
  }

  function continueCard(p) {
    const item = { kind: 'video', path: p.path, name: Media.baseName(p.path), size: 0, cont: p };
    const b = document.createElement('button');
    b.className = 'card focusable kind-video is-continue';
    b.dataset.path = p.path;
    b._item = item;
    const dir = Media.dirOf(p.path);
    // where it is, unless that is this folder or just the film's own folder (same name)
    const folder = Media.baseName(dir).toLowerCase();
    const where = dir.toLowerCase() !== current.path.toLowerCase() && folder !== Media.stripExt(item.name).toLowerCase();
    const meta = [p.dur ? `${Media.formatTime(p.dur - p.pos)} left` : '', where ? Media.baseName(dir) : ''];
    b.innerHTML = `
      <div class="thumb" data-src='${UI.esc(JSON.stringify(Media.thumbSources(item)))}'>
        <span class="thumb-icon">${Media.kindIcon('video')}</span>
        ${marksHtml(Media.watchState(p.path))}
      </div>
      <div class="card-name">${UI.esc(Media.stripExt(item.name))}</div>
      <div class="card-meta">${UI.esc(meta.filter(Boolean).join(' · '))}</div>`;
    b.addEventListener('click', () => Media.playContinue(p));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Nav.focus(b, { scroll: false }); options(item); });
    return b;
  }

  async function continueOptions(p) {
    const dir = Media.dirOf(p.path);
    const items = [{ label: 'Resume', icon: 'play', value: 'play' }, { label: 'Play from the beginning', icon: 'restart', value: 'start' }];
    if (dir.toLowerCase() !== current.path.toLowerCase()) items.push({ label: 'Open its folder', icon: 'folder', value: 'folder' });
    items.push({ label: 'Remove from Continue watching', icon: 'close', value: 'remove' }, { label: 'Hide Continue watching', icon: 'eye', value: 'hide' });
    const c = await UI.menu({ title: Media.stripExt(Media.baseName(p.path)), items });
    if (c === 'play') Media.playContinue(p);
    if (c === 'start') { await api.setProgress(p.path, null); delete App.state.progress[p.path]; Media.playContinue(p); }
    if (c === 'folder') { history.push({ path: current.path, focus: null, scroll: scroller.scrollTop }); load(dir, p.path); }
    // forgets where it stopped (it is not marked as watched)
    if (c === 'remove') { delete App.state.progress[p.path]; await api.setProgress(p.path, null); refresh(); }
    if (c === 'hide') toggleContinue();
  }

  async function toggleContinue() {
    const s = settings();
    s.continueInFolders = s.continueInFolders === false;
    await api.saveConfig(App.state.config);
    refresh();
    Nav.focus(Nav.current);   // the row above came or went: the focused card back in the middle
    UI.toast(s.continueInFolders ? 'Continue watching shows in folders again' : 'Continue watching hidden - Y in a folder shows it again', { icon: 'eye' });
  }

  // Watched marks: a tick in the corner when it is watched, else a bar for how far
  const marksHtml = (w) => (w && w.pct ? `<div class="thumb-progress"><i style="width:${w.pct}%"></i></div>` : '') +
    (w && w.watched ? `<span class="thumb-watched">${Icons.check}</span>` : '');

  // Folders get the tick from the videos in them, looked at only when something in there has been played
  async function markFolders(rid) {
    const played = Object.keys(App.state.progress).map((p) => p.toLowerCase());
    if (!played.length) return;
    const cards = [...grid.querySelectorAll('.card.kind-folder')].filter((c) => {
      const pre = c._item.path.toLowerCase().replace(/[\\/]*$/, '\\');
      return played.some((p) => p.startsWith(pre));
    });
    if (!cards.length) return;
    let lists;
    try { lists = await api.folderVideos(cards.map((c) => c._item.path)); } catch { return; }
    if (rid !== renderId) return;
    cards.forEach((card, i) => {
      const w = Media.folderWatchState(lists[i]);
      if (!w) return;
      if (w.watched) card.querySelector('.thumb').insertAdjacentHTML('beforeend', marksHtml(w));   // folders: no bar
      card.querySelector('.card-meta').textContent = w.watched ? 'Folder · Watched' : w.count ? `Folder · ${w.count} of ${w.of} watched` : 'Folder';
    });
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
        ${marksHtml(w)}
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
    if (item.cont) return continueOptions(item.cont);
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
    list.push({ label: settings().continueInFolders === false ? 'Show Continue watching' : 'Hide Continue watching', icon: 'eye', value: 'cont' });

    const c = await UI.menu({ title: item.kind === 'folder' ? item.name : Media.stripExt(item.name), items: list });
    if (!c) return;
    if (c === 'open') openItem(item);
    if (c === 'slideshow') openItem(item, { slideshow: true });
    if (c === 'start') openItem(item, { fromStart: true });
    if (c === 'vlc') api.openExternalPlayer(item.path);
    if (c === 'sort') cycleSort();
    if (c === 'playall') playAll(item.path);
    if (c === 'cont') toggleContinue();
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
    const cur = Nav.current;
    const top = scroller.scrollTop;
    render(cur && cur.dataset.path, !!(cur && cur.classList.contains('is-continue')));
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
    // a folder still loading is forgotten (it focused its card behind the next screen, or a failed one threw you
    // out of the Media Player seconds later)
    loadId++;
    renderId++;
    grid.innerHTML = '';
    contRow.innerHTML = '';
    current = null;
  }

  return { el, init, enter, resume, leave, handle, openRoot, refresh, drivesChanged };
})();
