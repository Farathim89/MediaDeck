// Home screen: tabs on the left (Home, one per app, Consoles) and the selected tab's page
// on the right. Consoles are cards; a console's page lists its games and lets you choose
// which emulator plays them.
const Home = (() => {
  const el = document.getElementById('home');
  const tabsEl = el.querySelector('.tabs');
  const pageEl = el.querySelector('.page');
  let activeTab = 'home';      // 'home' | 'emus' (Consoles) | 't:<tile id>'
  let emuDetail = null;        // on the Consoles tab: the console whose page is open
  let emuMaker = null;         // on the Consoles tab: the maker whose consoles are shown (Nintendo, Sony, …)
  let emuFromHome = false;     // that maker was opened from the Home tab: Back returns there
  let consoles = [];           // [{ id, name, icon, ratio, emulators: [{ moduleId, name }], emulator }]
  const consoleById = (id) => consoles.find((c) => c.id === id);
  const loadConsoles = async () => { consoles = await api.consoles(); };
  let inner = null;            // rows container on Home / Emulators pages
  let lastFocus = null;
  const logoColors = new Map(); // tile id -> { r, g, b } or null
  const iconCache = new Map();  // exe path -> data URL

  const SECTIONS = [
    { id: 'apps', title: 'Apps', kicker: 'App' },
    { id: 'consoles', title: 'Consoles', kicker: 'Console' },
  ];

  const cfg = () => App.state.config;
  const tiles = () => cfg().tiles;
  const tileById = (id) => tiles().find((t) => t.id === id);
  const inSection = (id) => tiles().filter((t) => (t.section || 'apps') === id);
  const isTab = (node) => node && node.classList.contains('tab');

  // ---------- Logos and their colours ----------
  async function logoUrl(t) {
    if (!t.path) return null;
    if (!iconCache.has(t.path)) iconCache.set(t.path, await api.fileIcon(t.path));
    const url = iconCache.get(t.path);
    if (url && !logoColors.has(t.id)) logoColors.set(t.id, await logoColor(url));
    return url;
  }

  // Puts the app's logo into holder (the built-in Media Player uses its own icon)
  async function fillLogo(t, holder) {
    if (t.builtin === 'media') {
      logoColors.set(t.id, { r: 96, g: 140, b: 230 });
      holder.innerHTML = Icons.media;
      return;
    }
    if (t.builtin === 'youtube') {
      logoColors.set(t.id, { r: 255, g: 0, b: 0 });
      holder.innerHTML = Icons.youtube;
      return;
    }
    if (t.builtin === 'twitch') {
      logoColors.set(t.id, { r: 145, g: 70, b: 255 });
      holder.innerHTML = Icons.twitch;
      return;
    }
    const url = await logoUrl(t);
    holder.innerHTML = url ? `<img src="${url}" alt="">` : Icons.rocket;
  }

  // The main colour of a logo: average of its colourful pixels (grey logos give null)
  function logoColor(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 32, 32);
        const px = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 200) continue;
          const max = Math.max(px[i], px[i + 1], px[i + 2]), min = Math.min(px[i], px[i + 1], px[i + 2]);
          const sat = max ? (max - min) / max : 0;
          if (sat < 0.25 || max < 40) continue;
          r += px[i] * sat; g += px[i + 1] * sat; b += px[i + 2] * sat; w += sat;
        }
        resolve(w > 8 ? { r: r / w, g: g / w, b: b / w } : null);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Same hue, set lightness: for card backgrounds
  function shade(c, light) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const s = Math.min(0.7, d / (1 - Math.abs(max + min - 1) || 1));
    return `hsl(${Math.round(h * 60 + 360) % 360} ${Math.round(s * 100)}% ${Math.round(light * 100)}%)`;
  }

  function glowColor(t) {
    const c = logoColors.get(t.id);
    if (!c) return null;
    const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }

  // ---------- Tabs ----------
  function renderTabs() {
    tabsEl.innerHTML = '';
    tabsEl.appendChild(tabEl('home', 'Home', Icons.home));
    for (const t of inSection('apps')) tabsEl.appendChild(tabEl('t:' + t.id, t.name, '', t));
    // Consoles: one tab; the consoles are cards on its page
    tabsEl.appendChild(tabEl('emus', 'Consoles', Icons.gamepad, null, consoles.length));
    markActive();
  }

  function tabEl(key, label, icon, t, count) {
    const b = document.createElement('button');
    b.className = 'tab focusable';
    b.dataset.group = 'tabs';
    b.dataset.tab = key;
    b.innerHTML = `<span class="tab-icon">${icon}</span><span class="tab-label">${UI.esc(label)}</span>${count ? `<span class="tab-count">${count}</span>` : ''}`;
    if (t) fillLogo(t, b.querySelector('.tab-icon'));
    // A tab opens only when chosen (A / Enter / click), then the panel folds away
    b.addEventListener('click', () => { selectTab(key); focusPage(); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (t) options(t); });
    return b;
  }

  function markActive() {
    tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
  }

  const activeTabEl = () => tabsEl.querySelector(`[data-tab="${CSS.escape(activeTab)}"]`);

  function selectTab(key) {
    if (key === activeTab && pageEl.firstChild) return;
    activeTab = key;
    emuDetail = null;
    emuMaker = null;
    emuFromHome = false;
    markActive();
    renderPage();
    if (key === 'emus') rescanEmulators();
  }

  // Picks up emulators added to (or removed from) Emu_modules while the app runs
  async function rescanEmulators() {
    const r = await api.rescanEmulators();
    const before = JSON.stringify(consoles);
    App.state.config = r.config;
    await loadConsoles();
    if (JSON.stringify(consoles) === before || activeTab !== 'emus' || emuDetail || emuMaker) return;
    const focusId = Nav.current && Nav.current.dataset.id;
    const onTab = isTab(Nav.current);
    renderTabs();
    renderPage();
    Nav.focus((!onTab && focusId && pageEl.querySelector(`[data-id="${focusId}"]`)) || activeTabEl());
  }

  // Three levels: makers (Home / Consoles tab) -> a maker's consoles -> a console's games.
  // Back goes up one level; a maker opened from Home returns to Home.
  function showMaker(name, fromHome) {
    if (fromHome) { activeTab = 'emus'; markActive(); }
    emuFromHome = !!fromHome;
    emuMaker = name;
    emuDetail = null;
    renderPage();
    focusPage();
  }

  function showConsole(c) {
    if (activeTab !== 'emus') { activeTab = 'emus'; markActive(); emuFromHome = true; }
    emuMaker = c.maker;
    emuDetail = c.id;
    renderPage();
    focusPage();
  }

  const consoleCard = (id) => [...pageEl.querySelectorAll('[data-console]')].find((b) => b.dataset.console === id);
  const makerCard = (name) => [...pageEl.querySelectorAll('[data-maker]')].find((b) => b.dataset.maker === name);

  function closeEmuDetail() {
    const id = emuDetail;
    emuDetail = null;
    renderPage();
    Nav.focus(consoleCard(id) || pageEl.querySelector('.tile') || activeTabEl());
  }

  function closeMaker() {
    const name = emuMaker;
    emuMaker = null;
    if (emuFromHome) { emuFromHome = false; activeTab = 'home'; markActive(); }
    renderPage();
    Nav.focus(makerCard(name) || pageEl.querySelector('.tile') || activeTabEl());
  }

  // Makers in a fixed order (Nintendo, Sony, Sega, then the rest), each with its consoles
  const MAKERS = ['Nintendo', 'Sony', 'Sega', 'Microsoft', 'Atari', 'NEC', 'SNK', 'Arcade', 'Philips'];
  function makers() {
    const rank = (m) => { const i = MAKERS.indexOf(m); return i < 0 ? 99 : i; };
    return [...new Set(consoles.map((c) => c.maker))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((name) => {
        const list = consoles.filter((c) => c.maker === name);
        return { name, consoles: list, count: list.reduce((n, c) => n + (c.count || 0), 0) };
      });
  }
  const makerSub = (m) => `${m.consoles.length} console${m.consoles.length === 1 ? '' : 's'}  ·  ${m.count.toLocaleString()} game${m.count === 1 ? '' : 's'}`;

  // Moves focus from the tabs into the page
  function focusPage() {
    const first = pageEl.querySelector('.btn.primary, .tile');
    if (first) Nav.focus(first);
  }

  // ---------- Pages ----------
  function renderPage() {
    pageEl.innerHTML = '';
    if (emuDetail && !consoleById(emuDetail)) emuDetail = null;
    if (emuMaker && !consoles.some((c) => c.maker === emuMaker)) emuMaker = null;
    if (activeTab === 'home') renderGridPage(SECTIONS, { kicker: 'MediaDeck', title: 'Home', sub: 'All your apps and consoles' });
    else if (activeTab === 'emus' && emuDetail) renderConsolePage(consoleById(emuDetail));
    else if (activeTab === 'emus' && emuMaker) {
      const m = makers().find((x) => x.name === emuMaker);
      renderGridPage([{ id: 'maker', maker: m }], { kicker: 'Consoles', title: m.name, sub: makerSub(m) });
    } else if (activeTab === 'emus') renderGridPage([SECTIONS[1]], { kicker: 'Consoles', title: 'Consoles', sub: `${consoles.length} consoles` }, true);
    else {
      const t = tileById(activeTab.slice(2));
      if (t) renderAppPage(t); else { activeTab = 'home'; markActive(); renderPage(); }
    }
  }

  // Home and Emulators: hero for the focused card, then card grids that grow downward
  function renderGridPage(sections, intro, withRecent) {
    pageEl.innerHTML = `
      <section class="hero">
        <div class="hero-kicker"></div><h1 class="hero-title"></h1><div class="hero-sub"></div>
      </section>
      <div class="grid-area"></div>`;
    inner = pageEl.querySelector('.grid-area');
    setHero(intro.kicker, intro.title, intro.sub);
    UI.glow(null);
    if (!withRecent) inner.appendChild(favSection());
    const row = (title, count, group) => {
      const sec = document.createElement('section');
      sec.className = 'row';
      sec.innerHTML = `<h2 class="row-title">${UI.esc(title)}<small>${count || ''}</small></h2><div class="card-grid"></div>`;
      inner.appendChild(sec);
      return sec.querySelector('.card-grid');
    };
    for (const s of sections) {
      if (s.id === 'consoles') {
        // Makers: Nintendo, Sony, Sega, … (each opens its consoles); + adds an emulator
        const list = makers();
        const grid = row('Consoles', list.length);
        list.forEach((m) => grid.appendChild(makerCardEl(m)));
        grid.appendChild(addCardEl({ id: 'emulators' }));
      } else if (s.id === 'maker') {
        // One maker's consoles
        const grid = row(`${s.maker.name} consoles`, s.maker.consoles.length);
        s.maker.consoles.forEach((c) => grid.appendChild(consoleCardEl(c)));
      } else {
        const list = inSection(s.id);
        const grid = row(s.title, list.length);
        list.forEach((t) => grid.appendChild(cardEl(t, s)));
        grid.appendChild(addCardEl(s));
      }
    }
    if (withRecent) {
      inner.appendChild(favSection());
      const recent = recentSection();
      if (cfg().settings.recentPosition === 'above') inner.prepend(recent); else inner.appendChild(recent);
    }
  }

  // The last 5 games played (kept encrypted on disk)
  function recentSection() {
    const sec = document.createElement('section');
    sec.className = 'row recent';
    sec.innerHTML = `<h2 class="row-title">Recently played<small></small></h2><div class="game-grid"></div>`;
    api.recentGames().then((list) => {
      if (!sec.isConnected) return;
      sec.querySelector('small').textContent = list.length || '';
      if (!list.length) {
        sec.querySelector('.game-grid').remove();
        sec.insertAdjacentHTML('beforeend', `<div class="empty-box">${Icons.gamepad}<div><b>No games played yet</b><span>The last 5 games you play will show up here.</span></div></div>`);
        return;
      }
      const grid = sec.querySelector('.game-grid');
      for (const g of list) {
        const tile = tiles().find((x) => x.moduleId === g.moduleId);
        grid.appendChild(gameCard(g, tile, g.emulator));
      }
      grid.querySelectorAll('.thumb').forEach((h) => Media.loadThumb(h));
    });
    return sec;
  }

  // Favourite games (kept encrypted on disk); the row only shows when there are some
  function favSection() {
    const sec = document.createElement('section');
    sec.className = 'row recent favs';
    sec.hidden = true;
    sec.innerHTML = `<h2 class="row-title">Favourite games<small></small></h2><div class="game-grid"></div>`;
    api.favGames().then((list) => {
      if (!sec.isConnected || !list.length) return;
      sec.hidden = false;
      sec.querySelector('small').textContent = list.length;
      const grid = sec.querySelector('.game-grid');
      for (const g of list) grid.appendChild(gameCard(g, tiles().find((x) => x.moduleId === g.moduleId), g.emulator));
      grid.querySelectorAll('.thumb').forEach((h) => Media.loadThumb(h));
    });
    return sec;
  }

  // ---------- Versions of one game ----------
  // The card shows the best one: a release before Sample / Beta / Proto / Demo, then USA, World,
  // Europe, other regions, Japan, then the newest Rev, then a plain file before a zip
  const REGION_RANK = { usa: 0, world: 1, europe: 2, japan: 4 };
  const versionScore = (g) => {
    const v = String(g.version || '').toLowerCase();
    const rev = parseFloat((/(?:rev\s*|v)(\d+(?:\.\d+)?)/.exec(v) || [])[1] || 0);
    return (/sample|demo|beta|proto|kiosk/.test(v) ? 1000 : 0)
      + (REGION_RANK[String(g.region || '').toLowerCase()] ?? 3) * 100
      - rev
      + (/\.(zip|7z)$/i.test(g.rom) ? 0.5 : 0);
  };
  function groupVersions(list) {
    const byTitle = new Map();
    for (const g of list) {
      const key = g.title.toLowerCase();
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(g);
    }
    const out = [];
    for (const g of list) {
      const all = byTitle.get(g.title.toLowerCase());
      if (!all) continue;   // already shown
      byTitle.delete(g.title.toLowerCase());
      if (all.length === 1) { out.push(g); continue; }
      const sorted = all.slice().sort((a, b) => versionScore(a) - versionScore(b));
      out.push({ ...sorted[0], versions: sorted });
    }
    return out;
  }
  // "USA · Rev 1 · SFC" for each version (the file name too where two would read the same)
  function versionLabels(versions) {
    const base = versions.map((v) => [v.region || 'No region', v.version || 'Release', v.type].filter(Boolean).join('  ·  '));
    return base.map((l, i) => (base.indexOf(l) !== base.lastIndexOf(l) ? `${l}  —  ${versions[i].rom.split(/[\\/]/).pop()}` : l));
  }
  const pickKey = (g) => `mediadeck.version:${g.moduleId}:${g.title.toLowerCase()}`;
  async function chooseVersion(g) {
    let last = null;
    try { last = localStorage.getItem(pickKey(g)); } catch {}
    const labels = versionLabels(g.versions);
    const rom = await UI.menu({
      title: g.title, message: `${g.versions.length} versions — which one?`,
      focus: g.versions.some((v) => v.rom === last) ? last : g.versions[0].rom,
      items: g.versions.map((v, i) => ({ label: labels[i], value: v.rom, icon: v.rom === last ? 'check' : 'play' })),
    });
    if (!rom) return null;
    try { localStorage.setItem(pickKey(g), rom); } catch {}
    return { ...g.versions.find((v) => v.rom === rom), moduleId: g.moduleId };
  }

  // ---------- Game cards ----------
  function gameCard(g, t, meta) {
    const b = document.createElement('button');
    b.className = 'game-card focusable';
    b.dataset.group = 'games';
    b.dataset.rom = g.rom;
    b._game = { ...g, moduleId: g.moduleId || (t && t.moduleId) };
    // A downloaded cover (encrypted store) first, then a picture found next to the game
    const src = [Media.url('cover', { p: g.rom }), ...(g.cover ? [Media.url('thumb', { p: g.cover, w: 480 })] : [])];
    b.innerHTML = `
      <div class="thumb game-art" data-src='${UI.esc(JSON.stringify(src))}'>
        <span class="thumb-icon game-logo"></span>
        <span class="game-art-title">${UI.esc(g.title)}</span>
      </div>
      <div class="card-name">${UI.esc(g.title)}</div>
      <div class="card-meta">${UI.esc(meta || (g.versions ? [g.region, `${g.versions.length} versions`] : [g.region, g.version, g.type]).filter(Boolean).join(' · '))}</div>`;
    if (t) fillLogo(t, b.querySelector('.game-logo'));
    b.addEventListener('click', () => startGame(b._game, t));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Nav.focus(b, { scroll: false }); gameOptions(b._game, t); });
    return b;
  }

  async function startGame(g, t) {
    if (g.versions && g.versions.length > 1) { g = await chooseVersion(g); if (!g) return; }
    if (!(await App.beforeLaunch(g.title))) return;
    const busy = UI.toast(`Starting ${g.title}…`, { spinner: true, duration: 0 });
    const r = await api.launchGame(g.moduleId, g.rom);
    setTimeout(busy.remove, r.ok ? 1500 : 0);
    if (!r.ok) UI.menu({ title: `Couldn't start ${g.title}`, message: r.error, items: [{ label: 'OK', icon: 'check' }] });
  }

  async function gameOptions(g, t) {
    const inRecent = activeTab === 'emus' && !emuDetail && Nav.current && Nav.current.closest('.recent:not(.favs)');
    const isFav = (await api.favGames()).some((x) => x.rom === g.rom);
    const c = await UI.menu({ title: g.title, message: [g.versions ? `${g.versions.length} versions` : g.region, g.versions ? '' : g.type, t && t.name].filter(Boolean).join('  ·  '), items: [
      { label: g.versions ? 'Choose version…' : 'Start', icon: 'play', value: 'start' },
      { label: isFav ? 'Remove from favourites' : 'Add to favourites', icon: 'star', value: 'fav' },
      { label: 'Open its folder', icon: 'folder', value: 'folder' },
      ...(t ? [{ label: `Open ${t.name} without a game`, icon: 'external', value: 'emu' }] : []),
      ...(inRecent ? [{ label: 'Remove from Recently played', icon: 'close', value: 'forget' }] : []),
    ] });
    if (c === 'start') startGame(g, t);
    if (c === 'folder') api.openPath(g.rom.replace(/[\\/][^\\/]*$/, ''));
    if (c === 'emu') open(t);
    if (c === 'fav') {
      const now = await api.toggleFav(g);
      UI.toast(now ? `${g.title} added to favourites` : 'Removed from favourites', { icon: 'star' });
      document.querySelectorAll(`.game-card`).forEach((b) => { if (b.dataset.rom === g.rom) b.classList.toggle('is-fav', now); });
      if (!emuDetail && activeTab !== 't:') {
        const focusRom = g.rom;
        renderPage();
        Nav.focus([...pageEl.querySelectorAll('.game-card')].find((b) => b.dataset.rom === focusRom) || pageEl.querySelector('.tile'));
      }
    }
    if (c === 'forget') {
      await api.removeRecent(g.rom);
      const focus = Nav.current;
      renderPage();
      Nav.focus(pageEl.querySelector('.game-card') || pageEl.querySelector('.tile') || focus);
    }
  }

  // The games of an emulator (on its page) or of a console (t.console: from the emulator chosen for it)
  async function showGameGrid(t, fresh) {
    const sec = pageEl.querySelector('.games-section');
    if (!sec) return;
    const info = await api.emulatorFolders(t.moduleId);
    const list = t.console ? (await api.consoleGames(t.console.id, t.moduleId, !!fresh)).list : await api.emulatorGames(t.moduleId, !!fresh);
    if (!sec.isConnected) return;
    const grid = sec.querySelector('.game-grid');
    const box = sec.querySelector('.games-box');
    sec.querySelector('.games-count').textContent = list.length || '';
    grid.innerHTML = '';
    if (!list.length) {
      box.hidden = false;
      box.querySelector('b').textContent = info && info.folders.length ? 'No games found' : 'No game folders yet';
      box.querySelector('span').textContent = info && info.folders.length
        ? `Nothing in ${t.name}'s game folders${t.console ? ` for ${t.console.name}` : ''} matches its game types (${(info.romExtensions || []).slice(0, 6).join(', ')}).`
        : `Choose "Game folders" to tell MediaDeck where your ${t.console ? t.console.name : t.system || t.name} games are.`;
      return;
    }
    box.hidden = true;
    gameLists.set(listKey(t), list);
    renderGameCards(t, sec, '');
  }

  const coverListeners = new Set();
  api.onCoversProgress((pr) => coverListeners.forEach((fn) => fn(pr)));
  const gameLists = new Map();   // module id (or "c:" + console id) -> all games (for search)
  const gameConsole = new Map(); // module id -> console shown (multi-console emulators)
  const listKey = (t) => (t.console ? 'c:' + t.console.id : t.moduleId);
  const letterOf = (title) => (/^[a-z]/i.test(title) ? title[0].toUpperCase() : '#');
  const gameGroup = new Map();   // list key -> sub tab shown ('' = All games)
  // "...\Nintendo Snes\0 - Randomizer\Zelda.sfc" -> "Randomizer"
  const groupOf = (g) => { const m = /[\\/]0 - ([^\\/]+)[\\/]/.exec(g.rom || ''); return m ? m[1].trim() : ''; };

  // Cards for the games matching the search; letters to jump with
  async function renderGameCards(t, sec, query) {
    const everything = gameLists.get(listKey(t)) || [];
    // Emulators for several consoles (RetroArch): one console at a time, chosen with chips
    const counts = new Map();
    for (const g of everything) counts.set(g.console, (counts.get(g.console) || 0) + 1);
    const consoles = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    let cur = gameConsole.get(t.moduleId);
    if (!consoles.includes(cur)) cur = consoles[0];
    // A–Z by the title shown on the card (files are filed by name: "Legend of Zelda, The" sits
    // under L but shows as "The Legend…"), numbers and symbols first
    const byTitle = (a, b) => (letterOf(a.title) === '#') !== (letterOf(b.title) === '#')
      ? (letterOf(a.title) === '#' ? -1 : 1)
      : a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    const inConsole = consoles.length > 1 ? everything.filter((g) => g.console === cur) : everything;
    // Sub tabs: a "0 - Name" folder in the console's folder ("0 - Randomizer") is a tab of its own;
    // its games are only shown there, the rest under "All games"
    const groupCounts = new Map();
    for (const g of inConsole) { const k = groupOf(g); groupCounts.set(k, (groupCounts.get(k) || 0) + 1); }
    let grp = gameGroup.get(listKey(t)) || '';
    if (!groupCounts.has(grp)) grp = '';
    const all = inConsole.filter((g) => groupOf(g) === grp).sort(byTitle);
    // The cards take the shape of this console's boxes (SNES/N64 wide, PS2 tall …)
    sec.style.setProperty('--art-ratio', (all[0] && all[0].ratio) || 0.75);
    let cbar = sec.querySelector('.console-bar');
    if (consoles.length > 1) {
      if (!cbar) { cbar = document.createElement('div'); cbar.className = 'game-bar console-bar'; sec.querySelector('.game-grid').before(cbar); }
      cbar.innerHTML = consoles.map((c) => `<button class="chip focusable console-chip${c === cur ? ' active' : ''}" data-group="consoles" data-console="${UI.esc(c)}">${UI.esc(c)} <small>${counts.get(c)}</small></button>`).join('');
      cbar.querySelectorAll('.console-chip').forEach((b) => b.addEventListener('click', async () => {
        gameConsole.set(t.moduleId, b.dataset.console);
        await renderGameCards(t, sec, '');
        Nav.focus([...sec.querySelectorAll('.console-chip')].find((x) => x.dataset.console === b.dataset.console));
      }));
    }
    const q = query.trim().toLowerCase();
    // versions of one game (Rev 1, Sample, other regions, .smc / .sfc) on one card; starting it asks which
    const grouped = (gs) => (cfg().settings.groupVersions === false ? gs : groupVersions(gs));
    const shown = grouped(all);
    const list = q ? shown.filter((g) => g.title.toLowerCase().includes(q)) : shown;
    const favs = new Set((await api.favGames()).map((x) => x.rom));
    sec.querySelector('.games-count').textContent = q ? `${list.length} of ${shown.length}` : shown.length;

    sec.querySelectorAll('.group-bar').forEach((x) => x.remove());   // (an older layout had its own row)
    let bar = sec.querySelector('.letters-bar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'game-bar letters-bar'; sec.querySelector('.game-grid').before(bar); }
    const letters = new Set(list.map((g) => letterOf(g.title)));
    // the sub tabs (All games | Randomizer | Homebrew …) and Search on one row; counts are cards, like the header
    const groups = [...groupCounts.keys()].filter(Boolean).sort((x, y) => x.localeCompare(y));
    const cardCount = (k) => (k === grp ? shown.length : grouped(inConsole.filter((g) => groupOf(g) === k)).length);
    const chip = (k, label) => `<button class="chip focusable group-chip${k === grp ? ' active' : ''}" data-group="gamebar" data-key="${UI.esc(k)}">${UI.esc(label)} <small>${cardCount(k)}</small></button>`;
    bar.innerHTML = (groups.length ? (groupCounts.has('') ? chip('', 'All games') : '') + groups.map((k) => chip(k, k)).join('') + '<span class="bar-gap"></span>' : '') + `
      <button class="chip focusable search-chip${q ? ' active' : ''}" data-group="gamebar">${Icons.search}<span>${q ? `"${UI.esc(query)}"` : 'Search'}</span></button>
      ${q ? `<button class="chip focusable clear-chip" data-group="gamebar">${Icons.close}<span>Clear</span></button>` : ''}`;
    bar.querySelectorAll('.group-chip').forEach((x) => x.addEventListener('click', async () => {
      gameGroup.set(listKey(t), x.dataset.key);
      await renderGameCards(t, sec, '');
      Nav.focus([...sec.querySelectorAll('.group-chip')].find((y) => y.dataset.key === x.dataset.key));
    }));
    // # A–Z down the right edge like Plex (letters without games are dimmed)
    let rail = sec.querySelector('.letters-rail');
    if (all.length > 30) {
      if (!rail) { rail = document.createElement('div'); rail.className = 'letters-rail'; sec.appendChild(rail); }
      rail.innerHTML = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => letters.has(l)
        ? `<button class="letter focusable" data-group="letters" data-letter="${l}">${l}</button>`
        : `<span class="letter off">${l}</span>`).join('');
      sec.classList.add('has-rail');
    } else if (rail) { rail.remove(); sec.classList.remove('has-rail'); }
    bar.querySelector('.search-chip').addEventListener('click', async () => {
      const v = await UI.prompt({ title: `Search ${t.console ? t.console.name : t.name} games`, value: query, okLabel: 'Search' });
      if (v === null) return;
      await renderGameCards(t, sec, v);
      Nav.focus(sec.querySelector('.game-card') || sec.querySelector('.search-chip'));
    });
    const clear = bar.querySelector('.clear-chip');
    if (clear) clear.addEventListener('click', async () => { await renderGameCards(t, sec, ''); Nav.focus(sec.querySelector('.search-chip')); });
    sec.querySelectorAll('.letters-rail button.letter').forEach((b) => b.addEventListener('click', () => {
      const first = [...sec.querySelectorAll('.game-card')].find((c) => c.dataset.letter === b.dataset.letter);
      if (!first) return;
      // The letter's first game at the top of the view, not just somewhere on screen
      // (instant: a long smooth scroll gets cut short while covers load on the way)
      Nav.focus(first, { scroll: false });
      first.scrollIntoView({ block: 'start', behavior: 'instant' });
    }));

    const grid = sec.querySelector('.game-grid');
    grid.innerHTML = '';
    if (!list.length) { grid.innerHTML = `<div class="row-empty">No games match "${UI.esc(query)}"</div>`; return; }
    const observer = Media.lazy(pageEl.querySelector('.app-page'));
    const frag = document.createDocumentFragment();
    for (const g of list) {
      const card = gameCard({ ...g, moduleId: t.moduleId }, t);
      card.dataset.letter = letterOf(g.title);
      if (favs.has(g.rom) || (g.versions && g.versions.some((v) => favs.has(v.rom)))) card.classList.add('is-fav');
      frag.appendChild(card);
      observer.observe(card.querySelector('.thumb'));
    }
    grid.appendChild(frag);
  }

  // Download box art for an emulator's games (asks first: it goes online)
  async function getCovers(t) {
    const ok = await UI.confirm('Download covers?',
      `Box art for the ${t.console ? t.console.name : t.name} games comes from the libretro thumbnail library (the one RetroArch uses). ` +
      'Game names are sent to it to find the pictures (PS3 serials go to GameTDB, Xbox 360 title IDs to XboxUnity); nothing else. Covers are stored encrypted on this PC.',
      'Download');
    if (!ok) return;
    const toast = UI.toast(`Looking for covers…`, { spinner: true, duration: 0 });
    const label = toast.el && toast.el.querySelector('span');
    const off = (pr) => { if (pr.moduleId === t.moduleId && label) label.textContent = `Covers: ${pr.done} of ${pr.total} checked, ${pr.found} found`; };
    coverListeners.add(off);
    const r = await api.downloadCovers(t.moduleId, t.console ? t.console.id : undefined);
    coverListeners.delete(off);
    toast.remove();
    if (!r) return;
    UI.toast(r.total ? `${r.found} of ${r.total} covers found` : 'All games already have a cover', { icon: 'image', duration: 4000 });
    if ((t.console && emuDetail === t.console.id) || activeTab === 't:' + t.id) showGameGrid(t);
  }

  // LB / RB on a game: jump to the previous / next letter
  function jumpLetter(cur, dir) {
    const cards = [...pageEl.querySelectorAll('.games-section .game-card')];
    const i = cards.indexOf(cur);
    if (i < 0) return false;
    // First card of the letter group that card k belongs to
    const groupStart = (k) => { while (k > 0 && cards[k - 1].dataset.letter === cards[k].dataset.letter) k--; return k; };
    let j;
    if (dir > 0) {
      j = i;
      while (j < cards.length && cards[j].dataset.letter === cur.dataset.letter) j++;
      if (j >= cards.length) j = cards.length - 1;
    } else {
      const start = groupStart(i);
      j = i > start ? start : groupStart(Math.max(0, start - 1));   // start of this letter, else the one before
    }
    Nav.focus(cards[j], { scroll: false });
    cards[j].scrollIntoView({ block: 'start', behavior: 'instant' });
    return true;
  }

  // Card styles: 'plain' (default), 'app' (colours from the app's logo), picture (t.image)
  function cardEl(t, section) {
    const b = document.createElement('button');
    b.className = 'tile tile-app focusable';
    b.dataset.group = section.id;
    b.dataset.id = t.id;
    // Emulators show which console they are for under their name
    const sys = section.id === 'emulators' ? (t.system || t.subtitle || '') : '';
    b.innerHTML = `<div class="tile-logo"></div><div class="tile-name">${UI.esc(t.name)}${sys ? `<small class="tile-system">${UI.esc(sys)}</small>` : ''}</div>`;
    if (sys) b.classList.add('has-system');
    fillLogo(t, b.querySelector('.tile-logo')).then(() => {
      applyStyle(t, b);
      if (Nav.current === b) updateHero(b);
    });
    if (t.image) loadImage(t, b);
    b.addEventListener('click', () => open(t));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Nav.focus(b, { scroll: false }); options(t); });
    return b;
  }

  function addCardEl(section) {
    const b = document.createElement('button');
    b.className = 'tile tile-add focusable';
    b.dataset.group = section.id;
    b.dataset.add = section.id;
    b.innerHTML = Icons.plus;
    b.addEventListener('click', () => addTile(section));
    return b;
  }

  function applyStyle(t, card) {
    const c = logoColors.get(t.id);
    const appStyle = t.style === 'app' && c;
    card.classList.toggle('app-style', !!appStyle);
    if (appStyle) {
      card.style.setProperty('--logo-light', shade(c, 0.4));
      card.style.setProperty('--logo-dark', shade(c, 0.13));
    }
  }

  async function loadImage(t, card) {
    const url = await api.imageData(t.image);
    if (!url || url === 'data:image/png;base64,') return;
    const img = document.createElement('img');
    img.className = 'tile-img';
    img.src = url;
    card.prepend(img);
    card.classList.add('has-img');
  }

  // One app: big logo, name, Open button; emulators also get their Games section
  function renderAppPage(t) {
    const emulator = t.section === 'emulators';
    const kicker = t.builtin ? 'Built in' : emulator ? 'Emulator' : 'App';
    pageEl.innerHTML = `
      <div class="app-page">
        <div class="app-hero">
          <div class="app-logo"></div>
          <div class="app-info">
            <div class="hero-kicker">${kicker}</div>
            <h1 class="app-name">${UI.esc(t.name)}</h1>
            <div class="app-sub">${UI.esc(t.subtitle || '')}</div>
            ${t.path ? `<div class="app-path">${UI.esc(t.path)}</div>` : ''}
          </div>
        </div>
        <div class="app-actions">
          <button class="btn primary focusable" data-group="actions" data-act="open">${Icons.play}<span>Open ${UI.esc(t.name)}</span></button>
          ${emulator && t.moduleId ? `<button class="btn focusable" data-group="actions" data-act="folders">${Icons.folder}<span>Game folders</span></button>
          <button class="btn focusable" data-group="actions" data-act="covers">${Icons.image}<span>Covers</span></button>` : ''}
          <button class="btn focusable" data-group="actions" data-act="options">${Icons.edit}<span>Options</span></button>
        </div>
        ${emulator ? `
        <section class="app-section games-section">
          <h2>Games <small class="games-count"></small></h2>
          <div class="empty-box games-box">${Icons.gamepad}<div><b>Looking for games…</b><span></span></div></div>
          <div class="game-grid"></div>
        </section>` : ''}
      </div>`;
    if (emulator && t.moduleId) {
      showGameGrid(t);
      pageEl.querySelector('[data-act="folders"]').addEventListener('click', async () => { await RomFolders.edit(t.moduleId); showGameGrid(t, true); });
      pageEl.querySelector('[data-act="covers"]').addEventListener('click', () => getCovers(t));
    }
    const logo = pageEl.querySelector('.app-logo');
    fillLogo(t, logo).then(() => {
      if (activeTab === 't:' + t.id || emuDetail === t.id) UI.glow(glowColor(t));
      if (t.style === 'app' && logoColors.get(t.id)) {
        logo.classList.add('app-style');
        logo.style.setProperty('--logo-light', shade(logoColors.get(t.id), 0.4));
        logo.style.setProperty('--logo-dark', shade(logoColors.get(t.id), 0.13));
      }
    });
    pageEl.querySelector('[data-act="open"]').addEventListener('click', () => open(t));
    pageEl.querySelector('[data-act="options"]').addEventListener('click', () => options(t));
  }

  // ---------- Consoles ----------
  const emuTile = (moduleId) => tiles().find((x) => x.moduleId === moduleId);
  const emuName = (c) => ((c.emulators.find((e) => e.moduleId === c.emulator) || {}).name || '');
  const iconUrls = new Map();   // console icon file -> data URL
  async function consoleIcon(c, holder) {
    if (!c.icon) { holder.innerHTML = Icons.gamepad; return; }
    if (!iconUrls.has(c.icon)) iconUrls.set(c.icon, await api.imageData(c.icon));
    holder.innerHTML = `<img src="${iconUrls.get(c.icon)}" alt="">`;
  }

  // Maker logos (renderer/img/makers); dark ones are shown white on the dark cards.
  // Makers without a logo (Arcade) show their consoles' icons instead.
  const MAKER_LOGOS = { Nintendo: 'Nintendo', Sony: 'Sony', Sega: 'Sega', Microsoft: 'Microsoft', Atari: 'Atari', NEC: 'NEC', SNK: 'SNK', Philips: 'Philips CD-i', Arcade: 'Arcade' };
  const WHITE_LOGOS = new Set(['Sony', 'NEC']);
  const BIG_LOGOS = new Set(['Nintendo', 'Atari', 'Philips', 'Microsoft']);   // these read small at the normal size

  // A maker card: its logo (or its consoles' icons), its name, how many consoles / games
  function makerCardEl(m) {
    const b = document.createElement('button');
    b.className = 'tile tile-app tile-maker focusable has-system';
    b.dataset.group = 'consoles';
    b.dataset.maker = m.name;
    const logo = MAKER_LOGOS[m.name];
    b.innerHTML = `${logo
      ? `<div class="tile-logo maker-logo${WHITE_LOGOS.has(m.name) ? ' logo-white' : ''}${BIG_LOGOS.has(m.name) ? ' logo-big' : ''}"><img src="img/makers/${encodeURIComponent(logo)}.svg" alt=""></div>`
      : `<div class="tile-logo maker-icons">${m.consoles.slice(0, 3).map(() => '<span></span>').join('')}</div>`}
      <div class="tile-name">${UI.esc(m.name)}<small class="tile-system">${UI.esc(makerSub(m))}</small></div>`;
    [...b.querySelectorAll('.maker-icons span')].forEach((s, i) => consoleIcon(m.consoles[i], s));
    b.addEventListener('click', () => showMaker(m.name, activeTab === 'home'));
    return b;
  }

  // A console card: its logo, its name and the emulator that plays it
  function consoleCardEl(c) {
    const b = document.createElement('button');
    b.className = 'tile tile-app tile-console focusable has-system';
    b.dataset.group = 'consoles';
    b.dataset.console = c.id;
    b.innerHTML = `<div class="tile-logo"></div><div class="tile-name">${UI.esc(c.name)}<small class="tile-system">${UI.esc(emuName(c))}${c.count ? `  ·  ${c.count.toLocaleString()} game${c.count === 1 ? '' : 's'}` : ''}</small></div>`;
    consoleIcon(c, b.querySelector('.tile-logo'));
    b.addEventListener('click', () => showConsole(c));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Nav.focus(b, { scroll: false }); consoleOptions(c); });
    return b;
  }

  // A console's page: which emulator plays it (dropdown), that emulator's buttons, the games
  function renderConsolePage(c) {
    if (c.system === 'PC - Windows') return renderPcGamesPage(c);
    const t = emuTile(c.emulator) || { id: 'm-' + c.emulator, moduleId: c.emulator, name: emuName(c) };
    const view = { ...t, console: c };
    const many = c.emulators.length > 1;
    pageEl.innerHTML = `
      <div class="app-page console-page">
        <div class="app-hero">
          <div class="app-logo console-logo"></div>
          <div class="app-info">
            <div class="hero-kicker">Console</div>
            <h1 class="app-name">${UI.esc(c.name)}</h1>
            <div class="app-sub">Played with ${UI.esc(t.name)}${many ? `  ·  ${c.emulators.length} emulators can play it` : ''}</div>
          </div>
        </div>
        <div class="app-actions">
          <button class="btn primary focusable emu-pick" data-group="actions" data-act="emu">${Icons.gamepad}<span>Emulator: ${UI.esc(t.name)}</span>${many ? '<span class="caret">▾</span>' : ''}</button>
          <button class="btn focusable" data-group="actions" data-act="open">${Icons.play}<span>Open ${UI.esc(t.name)}</span></button>
          <button class="btn focusable" data-group="actions" data-act="folders">${Icons.folder}<span>Game folders</span></button>
          <button class="btn focusable" data-group="actions" data-act="covers">${Icons.image}<span>Covers</span></button>
        </div>
        <section class="app-section games-section">
          <h2>Games <small class="games-count"></small></h2>
          <div class="empty-box games-box">${Icons.gamepad}<div><b>Looking for games…</b><span></span></div></div>
          <div class="game-grid"></div>
        </section>
      </div>`;
    consoleIcon(c, pageEl.querySelector('.console-logo'));
    UI.glow(null);
    showGameGrid(view);
    pageEl.querySelector('[data-act="emu"]').addEventListener('click', () => chooseEmulator(c));
    pageEl.querySelector('[data-act="open"]').addEventListener('click', () => open(t));
    pageEl.querySelector('[data-act="folders"]').addEventListener('click', async () => {
      await RomFolders.edit(c.emulator);
      await loadConsoles();
      if (consoleById(c.id)) showGameGrid({ ...view, console: consoleById(c.id) }, true); else closeEmuDetail();
    });
    pageEl.querySelector('[data-act="covers"]').addEventListener('click', () => getCovers(view));
  }

  // PC games: Windows games started directly (each one a .game file in Games\PC\PC games, its cover next to it)
  function renderPcGamesPage(c) {
    const view = { id: 'm-' + c.emulator, moduleId: c.emulator, name: 'PC games', console: c };
    pageEl.innerHTML = `
      <div class="app-page console-page">
        <div class="app-hero">
          <div class="app-logo console-logo"></div>
          <div class="app-info">
            <div class="hero-kicker">Console</div>
            <h1 class="app-name">${UI.esc(c.name)}</h1>
            <div class="app-sub">Windows games, started straight from here</div>
          </div>
        </div>
        <div class="app-actions">
          <button class="btn primary focusable" data-group="actions" data-act="add">${Icons.plus}<span>Add a PC game…</span></button>
          <button class="btn focusable" data-group="actions" data-act="folder">${Icons.folder}<span>Open the folder</span></button>
        </div>
        <section class="app-section games-section">
          <h2>Games <small class="games-count"></small></h2>
          <div class="empty-box games-box">${Icons.gamepad}<div><b>Looking for games…</b><span></span></div></div>
          <div class="game-grid"></div>
        </section>
      </div>`;
    consoleIcon(c, pageEl.querySelector('.console-logo'));
    UI.glow(null);
    showGameGrid(view);
    pageEl.querySelector('[data-act="folder"]').addEventListener('click', () => api.pcGameFolder());
    pageEl.querySelector('[data-act="add"]').addEventListener('click', async () => {
      const exe = await api.pickFile({ title: 'The game\'s program (.exe)', filters: [{ name: 'Programs', extensions: ['exe'] }] });
      if (!exe) return;
      const guess = exe.split(/[\\/]/).pop().replace(/\.exe$/i, '');
      const name = await UI.prompt({ title: 'Name of the game', message: 'As it shows on its card. A picture with the same name next to it in the folder becomes its cover.', value: guess, okLabel: 'Add' });
      if (name === null) return;
      const r = await api.pcGameAdd(exe, name || guess);
      if (!r || !r.ok) { UI.toast((r && r.error) || 'Could not add the game', { icon: 'alert', error: true }); return; }
      UI.toast(`${name || guess} added to PC games`, { icon: 'check' });
      await loadConsoles();
      showGameGrid({ ...view, console: consoleById(c.id) || c }, true);
    });
  }

  // The dropdown: which emulator plays this console (remembered per console)
  async function chooseEmulator(c) {
    const pick = await UI.menu({ title: `${c.name}: play with`, focus: c.emulator,
      message: c.emulators.length > 1 ? 'Each emulator uses its own game folders and keeps its own saves.' : 'Only this emulator has game folders for this console.',
      items: c.emulators.map((e) => ({ label: e.name, value: e.moduleId, icon: e.moduleId === c.emulator ? 'check' : '' })) });
    if (!pick || pick === c.emulator) return;
    const s = cfg().settings;
    s.consoleEmu = { ...(s.consoleEmu || {}), [c.id]: pick };
    await api.saveConfig(cfg());
    await loadConsoles();
    renderPage();
    Nav.focus(pageEl.querySelector('.emu-pick') || consoleCard(c.id) || activeTabEl());
    UI.toast(`${c.name} games now start in ${emuName(consoleById(c.id))}`, { icon: 'gamepad' });
  }

  async function consoleOptions(c) {
    const t = emuTile(c.emulator);
    const choice = await UI.menu({ title: c.name, message: `Played with ${emuName(c)}`, items: [
      { label: 'Show games', icon: 'gamepad', value: 'show' },
      ...(c.emulators.length > 1 ? [{ label: 'Choose emulator', icon: 'edit', value: 'emu' }] : []),
      ...(t ? [{ label: `Open ${t.name}`, icon: 'play', value: 'open' }] : []),
      { label: 'Game folders', icon: 'folder', value: 'folders' },
    ] });
    if (choice === 'show') showConsole(c);
    if (choice === 'emu') { await chooseEmulator(c); }
    if (choice === 'open' && t) open(t);
    if (choice === 'folders') { await RomFolders.edit(c.emulator); await loadConsoles(); renderPage(); Nav.focus(consoleCard(c.id) || activeTabEl()); }
  }

  // ---------- Focus: the side panel is open while you're in it, folded otherwise ----------
  el.addEventListener('nav-focus', (e) => {
    const target = e.target;
    lastFocus = target;
    el.classList.toggle('collapsed', !target.closest('.sidebar'));
    if (target.closest('.sidebar')) return;
    el.querySelectorAll('.row.has-focus').forEach((r) => r.classList.remove('has-focus'));
    const row = target.closest('.row');
    if (row) {
      row.classList.add('has-focus');
      // The focused row stays in the middle of the screen (TV style)
      if (e.detail.scroll) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      updateHero(target);
    } else if (e.detail.scroll) {
      // The page follows the focus both ways; the buttons at the top bring back the whole header
      const page = target.closest('.app-page');
      if (page && target.closest('.app-actions')) page.scrollTo({ top: 0, behavior: 'smooth' });
      else target.scrollIntoView({ block: target.closest('.game-grid') ? 'center' : 'nearest', behavior: 'smooth' });
    }
  });

  function setHero(kicker, title, sub) {
    const hero = pageEl.querySelector('.hero');
    if (!hero) return;
    const titleEl = hero.querySelector('.hero-title');
    if (titleEl.textContent !== title) { hero.classList.remove('swap'); void hero.offsetWidth; hero.classList.add('swap'); }
    hero.querySelector('.hero-kicker').textContent = kicker;
    titleEl.textContent = title;
    hero.querySelector('.hero-sub').textContent = sub;
  }

  function updateHero(target) {
    if (target.dataset.maker) {
      const m = makers().find((x) => x.name === target.dataset.maker);
      if (m) setHero('Consoles', m.name, m.consoles.map((c) => c.name).join(', '));
      UI.glow(null);
    } else if (target.dataset.console) {
      const c = consoleById(target.dataset.console);
      if (c) setHero('Console', c.name, `Played with ${emuName(c)}${c.emulators.length > 1 ? `  ·  ${c.emulators.length} emulators` : ''}`);
      UI.glow(null);
    } else if (target.dataset.id) {
      const t = tileById(target.dataset.id);
      const s = SECTIONS.find((x) => x.id === (t.section || 'apps'));
      setHero(t.builtin ? 'Built in' : s.kicker, t.name, t.subtitle || (t.path ? t.path.split('\\').pop() : ''));
      UI.glow(glowColor(t));
    } else if (target._game) {
      const g = target._game;
      setHero('Recently played', g.title, [g.emulator, g.region].filter(Boolean).join('  ·  '));
      UI.glow(null);
    } else if (target.dataset.add) {
      if (target.dataset.add === 'emulators') setHero('Add', 'Add an emulator', "Pick its .exe, or drop the emulator's folder into Emu_modules");
      else setHero('Add', 'Add an app', 'Pick a program (.exe) or shortcut to put on the home screen');
      UI.glow(null);
    }
  }

  // ---------- Actions ----------
  async function open(t) {
    if (t.builtin === 'media') { App.open(MediaHome); return; }
    if (t.builtin === 'youtube') { api.openYouTube(); return; }
    if (t.builtin === 'twitch') { api.openTwitch(); return; }
    if (!(await App.beforeLaunch(t.name))) return;
    const busy = UI.toast(`Starting ${t.name}…`, { spinner: true, duration: 0 });
    const r = await api.launch(t);
    setTimeout(busy.remove, r.ok ? 1200 : 0);
    if (!r.ok) UI.menu({ title: `Couldn't start ${t.name}`, message: r.error, items: [{ label: 'OK', icon: 'check' }] });
  }

  // Redraw tabs and page, then put the focus back where it belongs
  async function save(focusId) {
    await api.saveConfig(cfg());
    const onTab = isTab(Nav.current);
    if (activeTab.startsWith('t:') && !tileById(activeTab.slice(2))) activeTab = 'home';
    renderTabs();
    renderPage();
    const target = (!onTab && focusId && pageEl.querySelector(`[data-id="${focusId}"]`)) ||
      (!onTab && (activeTab === 't:' + focusId || emuDetail === focusId) && pageEl.querySelector('.btn.primary')) ||
      (focusId && tabsEl.querySelector(`[data-tab="t:${focusId}"]`)) || activeTabEl();
    Nav.focus(target);
  }

  async function options(t) {
    const list = tiles();
    const same = inSection(t.section || 'apps');
    const pos = same.indexOf(t);
    const items = [
      { label: 'Open', icon: 'play', value: 'open' },
      { label: 'Rename', icon: 'edit', value: 'rename' },
      { label: 'Card style', icon: 'palette', value: 'style' },
    ];
    if (pos > 0) items.push({ label: 'Move up / left', icon: 'left', value: 'left' });
    if (pos < same.length - 1) items.push({ label: 'Move down / right', icon: 'right', value: 'right' });
    if (!t.builtin) items.push({ label: 'Remove from Home', icon: 'trash', value: 'remove', danger: true });

    const choice = await UI.menu({ title: t.name, items });
    if (!choice) return;
    if (choice === 'open') return open(t);
    if (choice === 'rename') {
      const name = await UI.prompt({ title: 'Rename', value: t.name });
      if (name) { t.name = name; await save(t.id); }
      const sub = name !== null ? await UI.prompt({ title: 'Description', message: 'The small line under the name (can be empty)', value: t.subtitle || '' }) : null;
      if (sub !== null) { t.subtitle = sub; await save(t.id); }
    }
    if (choice === 'style') {
      const current = t.image ? 'picture' : t.style === 'app' ? 'app' : 'plain';
      const c = await UI.menu({ title: 'Card style', focus: current, items: [
        { label: 'Plain', icon: current === 'plain' ? 'check' : '', value: 'plain' },
        { label: 'App style (colours from its logo)', icon: current === 'app' ? 'check' : '', value: 'app' },
        { label: t.image ? 'Picture (choose another)' : 'Picture…', icon: current === 'picture' ? 'check' : 'image', value: 'picture' },
      ] });
      if (c === 'plain' || c === 'app') { t.style = c; t.image = ''; await save(t.id); }
      if (c === 'picture') {
        const file = await api.pickFile({ title: 'Choose a picture for the card', filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
        if (file) { t.image = file; await save(t.id); }
      }
    }
    if (choice === 'left' || choice === 'right') {
      const other = same[pos + (choice === 'left' ? -1 : 1)];
      const a = list.indexOf(t), b = list.indexOf(other);
      [list[a], list[b]] = [list[b], list[a]];
      await save(t.id);
    }
    if (choice === 'remove') {
      const fromModule = !!t.moduleId;
      const message = fromModule
        ? 'It is hidden, not deleted: its folder stays in Emu_modules. Set "hidden" to false in its emu-module file to bring it back.'
        : 'The program itself is not touched, only its card and tab.';
      if (await UI.confirm(`Remove ${t.name}?`, message, 'Remove', true)) {
        const next = same[pos + 1] || same[pos - 1];
        if (fromModule) {
          App.state.config = (await api.hideEmulator(t.moduleId)).config;
          if (emuDetail === t.id) emuDetail = null;
        } else {
          list.splice(list.indexOf(t), 1);
        }
        await save(next && next.id);
      }
    }
  }

  async function addTile(section) {
    // + : install one (Settings → Apps / the emulator installer), or pick a program on this PC
    const emus = section.id === 'emulators';
    const how = await UI.menu({ title: emus ? 'Add a console' : 'Add an app', items: [
      emus ? { label: 'Install emulators', icon: 'plus', value: 'install' } : { label: 'Install an app (PlexDeck, ABS-DA …)', icon: 'plus', value: 'install' },
      { label: emus ? 'Add an emulator from this PC…' : 'Add a program from this PC…', icon: 'folder', value: 'pick' },
    ] });
    if (!how) return;
    if (how === 'install') { App.open(Settings, emus ? { section: 'emulators', run: 'installEmulators' } : { section: 'apps' }); return; }
    const file = await api.pickFile({
      title: section.id === 'emulators' ? 'Choose an emulator' : 'Choose a program',
      filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (!file) return;
    const base = file.split('\\').pop().replace(/\.[^.]+$/, '');
    const name = (await UI.prompt({ title: 'Name', message: 'What should it be called?', value: base })) || base;
    // Emulators become modules in the Emu_modules folder
    if (section.id === 'emulators') {
      const r = await api.addEmulator(file, name);
      App.state.config = r.config;
      await save(r.tileId);
      UI.toast(`${name} added to Emu_modules`);
      return;
    }
    const t = { id: 't' + Date.now().toString(36), section: section.id, name, subtitle: '', path: file, args: '', image: '', style: 'plain' };
    tiles().push(t);
    await save(t.id);
    UI.toast(`${name} added`);
  }

  // ---------- Settings and power (bottom of the tab list) ----------
  const btnSettings = document.getElementById('btn-settings');
  const btnPower = document.getElementById('btn-power');
  btnSettings.innerHTML = Icons.settings;
  btnPower.innerHTML = Icons.power;

  btnSettings.addEventListener('click', () => App.open(Settings));
  const btnHelp = document.getElementById('btn-help');
  btnHelp.innerHTML = Icons.info;
  btnHelp.addEventListener('click', () => App.open(Help));


  // Also the PS / Guide button at home (main → 'power-menu')
  async function powerMenu() {
    const c = await UI.menu({ title: 'Power', items: [
      { label: 'Sleep', icon: 'moon', value: 'sleep' },
      { label: 'Restart PC', icon: 'restart', value: 'restart' },
      { label: 'Shut down PC', icon: 'power', value: 'shutdown', danger: true },
      { label: 'Exit MediaDeck', icon: 'exit', value: 'quit' },
    ] });
    if (c === 'quit') return api.quit();
    if (c === 'sleep') return api.power('sleep');
    if (c === 'restart' && await UI.confirm('Restart the PC?', 'Unsaved work in other programs will be lost.', 'Restart', true)) api.power('restart');
    if (c === 'shutdown' && await UI.confirm('Shut down the PC?', 'Unsaved work in other programs will be lost.', 'Shut down', true)) api.power('shutdown');
  }
  btnPower.addEventListener('click', powerMenu);

  // ---------- Input ----------
  function handle(action) {
    const cur = Nav.current;
    const inSidebar = cur && cur.closest('.sidebar');

    if (action === 'menu' && cur && cur._game) {
      gameOptions(cur._game, tiles().find((x) => x.moduleId === cur._game.moduleId));
      return true;
    }
    if (action === 'menu' && cur && cur.dataset.console) { const c = consoleById(cur.dataset.console); if (c) consoleOptions(c); return true; }
    if (action === 'menu' && emuDetail && !inSidebar) { const c = consoleById(emuDetail); if (c) consoleOptions(c); return true; }
    if (action === 'menu') {
      const id = cur && (cur.dataset.id || (cur.dataset.tab || '').replace(/^t:/, '') || (activeTab.startsWith('t:') && !inSidebar ? activeTab.slice(2) : ''));
      const t = id && tileById(id);
      if (t) options(t);
      return true;
    }
    if (action === 'back') {
      if (!inSidebar && emuDetail) closeEmuDetail();
      else if (!inSidebar && emuMaker) closeMaker();
      else if (!inSidebar) Nav.focus(activeTabEl());
      else if (isTab(cur) && activeTab !== 'home') Nav.focus(tabsEl.querySelector('[data-tab="home"]'));
      else if (!isTab(cur)) Nav.focus(activeTabEl());
      return true;
    }
    // Up / down stay on their own side (tab list or page)
    if (action === 'up' || action === 'down') {
      // From the last tab, down goes to Settings (the first button at the bottom)
      const tabs = [...tabsEl.querySelectorAll('.tab')];
      if (action === 'down' && cur === tabs[tabs.length - 1]) { Nav.focus(btnSettings); return true; }
      if (action === 'up' && cur && cur.closest('.sidebar-bottom')) { Nav.focus(tabs[tabs.length - 1]); return true; }
      Nav.move(action, (n) => !!n.closest('.sidebar') === !!inSidebar);
      return true;
    }
    // From the page, left goes to the selected tab (not just the nearest one)
    if (action === 'left' && !inSidebar) {
      if (!Nav.move('left', (n) => !n.closest('.sidebar'))) Nav.focus(activeTabEl());
      return true;
    }
    if (action === 'right' && isTab(cur)) { focusPage(); return true; }
    if (action === 'lb' || action === 'rb') {
      if (inSidebar) {
        const all = [...tabsEl.querySelectorAll('.tab')];
        const i = all.indexOf(activeTabEl());
        Nav.focus(all[Math.max(0, Math.min(all.length - 1, i + (action === 'lb' ? -1 : 1)))]);
      } else if (cur && cur.dataset.letter) {
        jumpLetter(cur, action === 'lb' ? -1 : 1);
      } else {
        const row = cur && cur.closest('.row');
        if (row) { const list = [...row.querySelectorAll('.tile')]; Nav.focus(action === 'lb' ? list[0] : list[list.length - 1]); }
      }
      return true;
    }
    return false;
  }

  function init() {
    Nav.bindMouse(el);
    el.appendChild(UI.hints([['a', 'Open'], ['y', 'Options'], ['b', 'Back']]));
  }

  async function enter() {
    Nav.setRoot(el);
    activeTab = 'home';
    await loadConsoles();
    renderTabs();
    renderPage();
    focusPage();
  }

  // Coming back (from Settings, the Media Player, …): redraw, since emulators or
  // settings may have changed, and return to the same spot
  async function resume() {
    Nav.setRoot(el);
    const id = lastFocus && lastFocus.dataset.id;
    const tab = lastFocus && lastFocus.dataset.tab;
    const con = lastFocus && lastFocus.dataset.console;
    const mk = lastFocus && lastFocus.dataset.maker;
    const sys = lastFocus && lastFocus.closest('.sidebar-bottom') ? lastFocus : null;
    await loadConsoles();
    renderTabs();
    renderPage();
    const target = sys || (id && pageEl.querySelector(`[data-id="${id}"]`)) || (con && consoleCard(con)) || (mk && makerCard(mk)) ||
      (tab && tabsEl.querySelector(`[data-tab="${CSS.escape(tab)}"]`)) || pageEl.querySelector('.btn.primary, .tile') || activeTabEl();
    Nav.focus(target);
  }

  // showConsoleById: for the test switch (opens a console's games page)
  return { el, init, enter, resume, handle, powerMenu, refocus() { if (Nav.current) Nav.focus(Nav.current); }, showConsoleById: (id) => { const c = consoleById(id); if (c) showConsole(c); return !!c; } };
})();
