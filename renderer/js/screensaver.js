// Screensaver (Settings → Screensaver): after a while without a button, key or mouse move while MediaDeck is the
// window in front, your pictures (MediaDeck's Screensaver folder, or the one chosen), your games' covers gliding by
// in rows, or the moving console backgrounds cover the screen, with a clock that moves to another place every minute. Any button, key or mouse move
// ends it, and that press does nothing else. Never over a game, a video, YouTube or Twitch (MediaDeck isn't in front).
const Screensaver = (() => {
  const el = document.getElementById('screensaver');
  const canvas = el.querySelector('.ss-canvas');
  const ctx = canvas.getContext('2d');
  const slides = [...el.querySelectorAll('.ss-slide')];
  const clock = el.querySelector('.ss-clock');
  const wall = el.querySelector('.ss-wall');
  const S = () => App.state.config.settings;

  let showing = false, startedAt = 0, endedAt = -1e9, lastInput = performance.now(), active = true, mousePos = null;
  let mode = null;                       // 'pictures', 'covers', or the console background showing ('waves' …)
  let order = [], pos = 0, front = 0;    // pictures: their order, and which of the two slides is in front
  let styles = [], styleAt = 0;          // console backgrounds taking turns
  let slideTimer = 0, clockTimer = 0, raf = 0, last = 0, w = 0, h = 0, t0 = 0;

  // Clock colour (Settings → Screensaver): accent = the theme's own colour
  const CLOCK_COLORS = [
    { id: 'white', name: 'White', color: '#f2f2f2' }, { id: 'accent', name: 'The theme\'s colour', color: 'var(--accent)' },
    { id: 'blue', name: 'Blue', color: '#8fb8ff' }, { id: 'cyan', name: 'Cyan', color: '#5ee3e3' }, { id: 'green', name: 'Green', color: '#74e08f' },
    { id: 'gold', name: 'Gold', color: '#f5c542' }, { id: 'orange', name: 'Orange', color: '#ff9f43' }, { id: 'red', name: 'Red', color: '#ff6b6b' },
    { id: 'purple', name: 'Purple', color: '#c39bff' },
  ];
  const secs = () => Math.max(5, Number(S().screensaverSlide) || 30);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // what Chromium shows itself; the rest (TIFF) as a picture made by MediaDeck's media server
  const DIRECT = /\.(jpe?g|jfif|png|gif|webp|bmp|avif)$/i;
  const srcOf = (f) => (DIRECT.test(f) ? Media.url('file', { p: f }) : Media.url('thumb', { p: f, w: 2560 }));

  // ---------- Showing ----------
  // now: Settings → Show it now (also when it is set to Off: the console backgrounds then)
  async function start(now = false) {
    if (showing) return;
    let want = S().screensaver || 'off';
    if (want === 'off') { if (!now) return; want = 'backgrounds'; }
    showing = true;
    startedAt = performance.now();
    el.classList.add('show');
    ThemeBg.hold(true);
    if (S().screensaverClock !== false) { clock.hidden = false; placeClock(true); clockTimer = setInterval(() => placeClock(), 60000); } else clock.hidden = true;
    clock.dataset.outline = S().screensaverClockOutline || 'off';
    clock.style.setProperty('--ss-clock', Number(S().screensaverClockSize) || 1);
    clock.style.setProperty('--ss-clock-color', (CLOCK_COLORS.find((x) => x.id === S().screensaverClockColor) || CLOCK_COLORS[0]).color);
    if (want === 'pictures') {
      const r = await api.screensaverPictures().catch(() => null);
      if (!showing) return;           // ended while the folder was read
      const files = (r && r.files) || [];
      if (files.length) {
        order = S().screensaverShuffle !== false ? shuffle(files.slice()) : files.slice();
        pos = 0;
        mode = 'pictures';
        nextPicture();
        return;
      }
      want = 'backgrounds';           // no pictures yet: the console backgrounds
    }
    if (want === 'covers' || want === 'covers-one') {
      const list = await api.screensaverCovers().catch(() => null);
      if (!showing) return;
      if (list && list.length && want === 'covers') { startWall(list); return; }
      if (list && list.length) {      // one at a time: the slideshow, with covers
        order = shuffle(list.slice());
        pos = 0;
        mode = 'pictures';
        if (!clock.hidden) placeClock(true);   // (now it knows to keep beside the cover)
        nextPicture();
        return;
      }
      want = 'backgrounds';           // no covers downloaded yet
    }
    const all = ThemeBg.STYLES.map((x) => x.id);
    startBackgrounds(want === 'backgrounds' ? shuffle(all) : all.includes(want) ? [want] : shuffle(all));
  }

  // ---------- Pictures (or game covers, one at a time): one fades into the next, each slowly zooming in ----------
  // order: picture files, or covers ({ rom / file, title, console }) - a cover shows at a size box art keeps sharp,
  // in the middle, with the game's name and console under it
  function nextPicture(tries = 0) {
    if (!showing || mode !== 'pictures') return;
    const item = order[pos % order.length];
    const cover = typeof item !== 'string';
    pos++;
    const img = new Image();
    img.onload = () => {
      if (!showing || mode !== 'pictures') return;
      const next = slides[1 - front], prev = slides[front];
      next.querySelector('.ss-blur').style.backgroundImage = `url("${img.src}")`;
      next.querySelector('.ss-pic').src = img.src;
      next.classList.toggle('is-cover', cover);
      next.querySelector('.ss-caption b').textContent = cover ? item.title || '' : '';
      next.querySelector('.ss-caption span').textContent = cover ? item.console || '' : '';
      next.style.setProperty('--ss-zoom', `${secs() + 3}s`);
      next.style.setProperty('--ss-ox', cover ? '50%' : `${20 + Math.random() * 60}%`);
      next.style.setProperty('--ss-oy', cover ? '50%' : `${20 + Math.random() * 60}%`);
      next.classList.remove('zoom');
      void next.offsetWidth;          // its zoom starts over
      next.classList.add('zoom', 'show');
      prev.classList.remove('show');  // (keeps zooming while it fades out)
      front = 1 - front;
      slideTimer = setTimeout(nextPicture, secs() * 1000);
    };
    // a file that can't be shown: the next one (all of them failing: the console backgrounds)
    img.onerror = () => { if (tries < Math.min(20, order.length)) nextPicture(tries + 1); else startBackgrounds(shuffle(ThemeBg.STYLES.map((x) => x.id))); };
    img.src = cover ? coverSrc(item) : srcOf(item);
  }

  // ---------- Console backgrounds: full screen in their console's colours, taking turns ----------
  function startBackgrounds(list) {
    mode = list[0];
    styles = list;
    styleAt = 0;
    t0 = performance.now();
    size();
    canvas.classList.add('show');
    if (!raf) raf = requestAnimationFrame(loop);
    if (styles.length > 1) slideTimer = setTimeout(nextBackground, secs() * 1000);
  }
  function nextBackground() {
    if (!showing) return;
    canvas.classList.remove('show');
    slideTimer = setTimeout(() => {
      if (!showing) return;
      styleAt = (styleAt + 1) % styles.length;
      mode = styles[styleAt];
      t0 = performance.now();
      canvas.classList.add('show');
      slideTimer = setTimeout(nextBackground, secs() * 1000);
    }, 1300);                         // (dark in between: the canvas fades out, then in with the next one)
  }
  // half the screen's pixels, like the backgrounds behind the screens: soft pictures, light to draw
  function size() {
    const nw = Math.max(1, Math.round(innerWidth * devicePixelRatio * 0.5)), nh = Math.max(1, Math.round(innerHeight * devicePixelRatio * 0.5));
    if (nw !== w || nh !== h) { w = canvas.width = nw; h = canvas.height = nh; }
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return;      // about 30 frames a second is plenty for something this slow
    last = now;
    if (mode && mode !== 'pictures') ThemeBg.paint(ctx, mode, w, h, (now - t0) / 1000 + 30);
  }

  // ---------- Your games' covers: rows of box art gliding by, every other row the other way; a cover that has gone
  // past makes room for the next one, so the wall keeps changing ----------
  let rows = [], pool = [], poolAt = 0, wallRaf = 0, wallLast = 0;
  const coverSrc = (g) => (g.file ? Media.url('thumb', { p: g.file, w: 480 }) : Media.url('cover', { p: g.rom, ...(g.c ? { c: g.c } : {}) }));
  function startWall(list) {
    mode = 'covers';
    pool = shuffle(list.slice());
    poolAt = 0;
    wall.innerHTML = '';
    el.classList.add('covers');
    const rowH = Math.round(innerHeight * 0.235), gap = Math.round(innerHeight * 0.02);
    wall.style.setProperty('--ss-row', `${rowH}px`);
    wall.style.setProperty('--ss-gap', `${gap}px`);
    wall.classList.add('show');
    const W = wall.clientWidth;
    rows = Array.from({ length: 5 }, (_, i) => {
      const row = document.createElement('div');
      row.className = 'ss-row';
      const track = document.createElement('div');
      track.className = 'ss-track';
      row.appendChild(track);
      wall.appendChild(row);
      const dir = i % 2 ? 1 : -1;
      // (one going right fills from the right edge back, one going left from the left edge on)
      return { track, dir, speed: W * (0.011 + 0.004 * ((i * 2) % 3)), x: dir > 0 ? W * 1.05 : -W * 0.05, items: [], h: rowH, gap, loading: false };
    });
    wallLast = performance.now();
    wallRaf = requestAnimationFrame(wallLoop);
  }
  function wallLoop(now) {
    wallRaf = requestAnimationFrame(wallLoop);
    const dt = Math.min(0.1, (now - wallLast) / 1000);
    wallLast = now;
    const W = wall.clientWidth, M = W * 0.05;
    for (const r of rows) {
      r.x += r.dir * r.speed * dt;
      const total = r.items.reduce((s, it) => s + it.w, 0) + r.gap * Math.max(0, r.items.length - 1);
      if (r.dir < 0) {
        const first = r.items[0];
        if (first && r.x + first.w < -M) { first.el.remove(); r.items.shift(); r.x += first.w + r.gap; }
        if (r.x + total < W + M) addCover(r);
      } else {
        const lastOne = r.items[r.items.length - 1];
        if (lastOne && r.x + total - lastOne.w > W + M) { lastOne.el.remove(); r.items.pop(); }
        if (r.x > -M) addCover(r);
      }
      r.track.style.transform = `translate3d(${r.x}px, 0, 0)`;
    }
  }
  // the next cover of the (shuffled) list, at the row's end it comes in from; one that can't be shown: the one after
  function addCover(r, tries = 0) {
    if (r.loading || !pool.length) return;
    r.loading = true;
    const img = new Image();
    img.className = 'ss-cover';
    img.alt = '';
    img.onload = () => {
      r.loading = false;
      if (!showing || mode !== 'covers' || !img.naturalHeight) return;
      const w = Math.round((r.h * img.naturalWidth) / img.naturalHeight);
      img.style.width = `${w}px`;
      if (r.dir < 0) { r.track.appendChild(img); r.items.push({ el: img, w }); }
      else { r.track.prepend(img); r.items.unshift({ el: img, w }); r.x -= w + r.gap; }
    };
    img.onerror = () => { r.loading = false; if (tries < 10) addCover(r, tries + 1); };
    img.src = coverSrc(pool[poolAt++ % pool.length]);
  }

  // ---------- The clock: another place every minute, so nothing stays burnt into the screen - or in the place
  // chosen (Clock position: a corner or the middle), where it stays ----------
  function placeClock(first = false) {
    const place = S().screensaverClockPlace || 'moving';
    if (place !== 'moving') {
      if (!first) return;
      clock.style.left = clock.style.top = '';
      clock.dataset.place = place;
      setTimeout(() => { if (showing) clock.classList.add('show'); }, 400);
      return;
    }
    delete clock.dataset.place;
    clock.classList.remove('show');
    setTimeout(() => {
      if (!showing) return;
      // (a cover in the middle, one at a time: the clock beside it, left or right, not over it)
      const beside = mode === 'pictures' && typeof order[0] !== 'string';
      const left = beside ? (Math.random() < 0.5 ? 3 + Math.random() * 10 : 67 + Math.random() * 8) : 6 + Math.random() * 58;
      // (a big clock is kept inside the screen)
      const room = (size, whole) => Math.max(2, 97 - (size / whole) * 100);
      clock.style.left = `${Math.min(left, room(clock.offsetWidth, innerWidth))}%`;
      clock.style.top = `${Math.min(8 + Math.random() * 66, room(clock.offsetHeight, innerHeight))}%`;
      clock.classList.add('show');
    }, first ? 400 : 1600);
  }

  // ---------- Ending ----------
  function stop() {
    if (!showing) return false;
    showing = false;
    endedAt = performance.now();
    mode = null;
    clearTimeout(slideTimer);
    clearInterval(clockTimer);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (wallRaf) { cancelAnimationFrame(wallRaf); wallRaf = 0; }
    rows = [];
    wall.classList.remove('show');
    el.classList.remove('show');
    canvas.classList.remove('show');
    clock.classList.remove('show');
    slides.forEach((s) => s.classList.remove('show'));
    setTimeout(() => {               // (after the fade) the pictures let go
      if (showing) return;
      slides.forEach((s) => { s.classList.remove('zoom', 'is-cover'); s.querySelector('.ss-pic').removeAttribute('src'); s.querySelector('.ss-blur').style.backgroundImage = ''; });
      wall.innerHTML = '';
      el.classList.remove('covers');
    }, 700);
    ThemeBg.hold(false);
    lastInput = performance.now();
    Input.ignoreHeld();              // the buttons still held from waking it do nothing when let go
    return true;
  }

  // ---------- Waking it, and the time without input ----------
  // every action (controller, keyboard, remote, the mouse's back button) passes here first - the mouse's back button
  // that woke it acts when it is let go: that one goes no further either
  Input.setGate(() => { lastInput = performance.now(); return stop() || performance.now() - wokeByMouse < 1000; });
  // keys that aren't actions too; the key that ends it goes no further
  window.addEventListener('keydown', (e) => {
    lastInput = performance.now();
    if (showing) { e.preventDefault(); e.stopImmediatePropagation(); stop(); }
  }, true);
  // a real mouse move (Chromium also sends one when the page changes under a pointer that doesn't move)
  window.addEventListener('mousemove', (e) => {
    const p = `${e.screenX},${e.screenY}`;
    const moved = mousePos !== null && p !== mousePos;
    mousePos = p;
    if (!moved) return;
    lastInput = performance.now();
    if (showing && performance.now() - startedAt > 800) stop();
  }, true);
  // a click or a wheel turn that ends it doesn't also click or scroll what is under it
  let wokeByMouse = -1e9;
  const byMouse = (e) => {
    lastInput = performance.now();
    if (!showing) return;
    e.preventDefault();
    e.stopPropagation();
    wokeByMouse = performance.now();
    stop();
  };
  window.addEventListener('mousedown', byMouse, true);
  window.addEventListener('wheel', byMouse, { capture: true, passive: false });
  window.addEventListener('click', (e) => { if (performance.now() - wokeByMouse < 1000) { e.preventDefault(); e.stopPropagation(); } }, true);

  // MediaDeck not in front (a game, a video, YouTube, another program): it ends, and the time starts again after
  if (window.api && api.onWinActive) api.onWinActive((on) => { active = on; lastInput = performance.now(); if (!on) stop(); });
  window.addEventListener('blur', () => { if (showing) stop(); });
  window.addEventListener('resize', () => { if (showing) size(); });

  setInterval(() => {
    if (showing || !App.state) return;
    if ((S().screensaver || 'off') === 'off') return;
    if (!active || !document.hasFocus() || document.hidden) { lastInput = performance.now(); return; }
    if (performance.now() - lastInput >= Math.max(1, Number(S().screensaverAfter) || 10) * 60000) start();
  }, 2000);

  return {
    CLOCK_COLORS,
    start,
    stop,
    get showing() { return showing; },
    // PS / Guide from main (the Exit menu): it only ends the screensaver - also when the controller's own PS press got
    // there first a moment ago
    wake() { return stop() || performance.now() - endedAt < 1500; },
  };
})();
