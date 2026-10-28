// The background behind every screen (Settings → Appearance → Background): a slowly moving picture in a console's
// style, drawn here (no logos, no console makers' artwork), or the user's own picture. A console's page gets that
// console's (Appearance → Background per console; the console's Y menu picks another). It only moves while MediaDeck is
// the window in front - under a game, a video, YouTube or Twitch it stands still.
const ThemeBg = (() => {
  // the console theme whose colours a style has on a console's page
  const STYLES = [
    { id: 'waves', name: 'PlayStation waves', theme: 'playstation' },
    { id: 'glow', name: 'Xbox glow', theme: 'xbox' },
    { id: 'dots', name: 'Nintendo dots', theme: 'nintendo' },
    { id: 'cubes', name: 'GameCube cubes', theme: 'gamecube' },
    { id: 'lcd', name: 'Game Boy screen', theme: 'gameboy' },
    { id: 'swirl', name: 'Dreamcast swirls', theme: 'dreamcast' },
    { id: 'stripes', name: 'Mega Drive stripes', theme: 'megadrive' },
  ];

  // A console's own: by its name first (GameCube, the Game Boys, Dreamcast), then by its maker
  const BY_MAKER = { Sony: 'waves', Microsoft: 'glow', Nintendo: 'dots', Sega: 'stripes' };
  function styleOfConsole(c) {
    const what = `${c.id || ''} ${c.name || ''}`;
    if (/GameCube/i.test(what)) return 'cubes';
    if (/Game Boy|\bGBA?C?\b/i.test(what)) return 'lcd';
    if (/Dreamcast/i.test(what)) return 'swirl';
    return BY_MAKER[c.maker] || null;
  }

  const canvas = document.getElementById('theme-bg');
  const pic = document.getElementById('theme-pic');
  const ctx = canvas.getContext('2d');
  const S = () => App.state.config.settings;

  let context = null;        // Home's console page ({ id, name, maker }) or maker page ({ maker })
  let onHome = true;         // the Home screen is the one showing (other screens have the theme's background)
  let preview;               // Settings: the background shown while moving through the list
  let style = null, palette = null, consoleMode = false;
  let picFile = '', picLoad = null;
  let active = true;         // MediaDeck is the window in front (main's 'win-active')
  let raf = 0, last = 0, w = 0, h = 0;
  const t0 = performance.now();

  // ---------- Colours ----------
  const WHITE = [255, 255, 255];
  function rgbOf(v) {
    const s = String(v || '').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const r = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
    return r ? [+r[1], +r[2], +r[3]] : [0, 0, 0];
  }
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  // the same "random" number for the same i every frame
  const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  function paletteFor(w) {
    if (w.console) {
      const t = App.THEMES.find((x) => x.id === STYLES.find((y) => y.id === w.id).theme);
      const [bg, card, accent] = t.swatch.map(rgbOf);
      return { bg, card, accent };
    }
    const cs = getComputedStyle(document.documentElement);
    return { bg: rgbOf(cs.getPropertyValue('--bg')), card: rgbOf(cs.getPropertyValue('--surface-1')), accent: rgbOf(cs.getPropertyValue('--accent')) };
  }

  // ---------- The styles: (ctx, w, h, t seconds, palette) - see-through, so the screens stay easy to read ----------
  const DRAW = {
    // light ribbons flowing over each other
    waves(ctx, w, h, t, p) {
      const light = mix(p.accent, WHITE, 0.4);
      for (let i = 0; i < 5; i++) {
        const dir = i % 2 ? 1 : -1, k = (Math.PI * 2) / (w * (0.9 + 0.22 * i)), ph = t * (0.12 + 0.03 * i) * dir + i * 1.7;
        const amp = h * (0.06 + 0.02 * i), yc = h * (0.48 + 0.06 * i);
        const y = (x) => yc + amp * Math.sin(x * k + ph) + amp * 0.35 * Math.sin(x * k * 2.3 - ph * 1.4);
        const thick = (x) => h * (0.035 + 0.025 * Math.sin(x * k * 0.6 + ph * 0.8 + i));
        ctx.beginPath();
        for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, y(x));
        for (let x = w + 8; x >= 0; x -= 8) ctx.lineTo(x, y(x) + thick(x));
        ctx.closePath();
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, rgba(p.accent, 0.04)); g.addColorStop(0.5, rgba(p.accent, 0.15)); g.addColorStop(1, rgba(p.accent, 0.05));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.beginPath();
        for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, y(x));
        ctx.strokeStyle = rgba(light, 0.24);
        ctx.lineWidth = Math.max(1, h / 450);
        ctx.stroke();
      }
    },
    // a glow rising from the bottom, soft beams fanning out of it, light motes drifting up
    glow(ctx, w, h, t, p) {
      const breathe = 0.85 + 0.15 * Math.sin(t * 0.5);
      const g = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, h * 0.95);
      g.addColorStop(0, rgba(p.accent, 0.34 * breathe)); g.addColorStop(0.45, rgba(p.accent, 0.1 * breathe)); g.addColorStop(1, rgba(p.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.3 + Math.sin(t * 0.07 + i) * 0.05, len = h * 1.15;
        const b = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, len);
        b.addColorStop(0, rgba(p.accent, 0.11 * breathe)); b.addColorStop(1, rgba(p.accent, 0));
        ctx.beginPath(); ctx.moveTo(w / 2, h * 1.05); ctx.arc(w / 2, h * 1.05, len, a - 0.045, a + 0.045); ctx.closePath();
        ctx.fillStyle = b;
        ctx.fill();
      }
      const mote = mix(p.accent, WHITE, 0.5);
      for (let i = 0; i < 46; i++) {
        const life = (t * (0.012 + rnd(i + 99) * 0.02) + rnd(i + 7)) % 1;
        const x = rnd(i) * w + Math.sin(t * 0.3 + i) * w * 0.01, y = h * (1.02 - life * 1.1);
        ctx.fillStyle = rgba(mote, Math.sin(life * Math.PI) * 0.35);
        ctx.beginPath(); ctx.arc(x, y, h * (0.0015 + rnd(i + 3) * 0.0025), 0, Math.PI * 2); ctx.fill();
      }
    },
    // a fine dot grid with slow rings of light going through it
    dots(ctx, w, h, t, p) {
      const g = ctx.createRadialGradient(w * 0.85, h * 0.08, 0, w * 0.85, h * 0.08, h * 1.1);
      g.addColorStop(0, rgba(p.accent, 0.16)); g.addColorStop(1, rgba(p.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const s = h / 34, r = s * 0.12, off = (t * s * 0.15) % s, L = 8;
      const cx = w * (0.5 + 0.3 * Math.sin(t * 0.05)), cy = h * (0.4 + 0.2 * Math.cos(t * 0.04));
      const paths = Array.from({ length: L }, () => new Path2D());
      for (let y = -s + off; y < h + s; y += s) {
        for (let x = -s + off; x < w + s; x += s) {
          const v = Math.pow(0.5 + 0.5 * Math.sin((Math.hypot(x - cx, y - cy) / h) * 9 - t * 0.9), 3);
          const path = paths[Math.min(L - 1, Math.floor(v * L))];
          path.moveTo(x + r, y);
          path.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      paths.forEach((path, i) => { ctx.fillStyle = rgba(p.accent, 0.05 + i * 0.018); ctx.fill(path); });
    },
    // cube outlines floating by and turning
    cubes(ctx, w, h, t, p) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, h);
      g.addColorStop(0, rgba(p.accent, 0.1)); g.addColorStop(1, rgba(p.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
      const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      ctx.lineWidth = Math.max(1, h / 420);
      for (let i = 0; i < 10; i++) {
        const size = h * (0.03 + rnd(i) * 0.06);
        const x = (((rnd(i + 20) + t * 0.004 * (0.5 + rnd(i))) % 1.2) - 0.1) * w;
        const y = h * (0.12 + rnd(i + 40) * 0.78) + Math.sin(t * 0.2 + i) * h * 0.02;
        const ax = t * (0.12 + rnd(i + 5) * 0.18) + i, ay = t * (0.09 + rnd(i + 6) * 0.14) + i * 2;
        const pts = V.map(([a, b, c]) => {
          const x1 = a * Math.cos(ay) + c * Math.sin(ay), z1 = -a * Math.sin(ay) + c * Math.cos(ay);
          return [x + x1 * size, y + (b * Math.cos(ax) - z1 * Math.sin(ax)) * size];
        });
        ctx.strokeStyle = rgba(mix(p.accent, WHITE, 0.15), 0.1 + rnd(i + 9) * 0.16);
        ctx.beginPath();
        for (const [m, n] of E) { ctx.moveTo(pts[m][0], pts[m][1]); ctx.lineTo(pts[n][0], pts[n][1]); }
        ctx.stroke();
      }
    },
    // a handheld's dot-matrix screen with a slow light sweeping over it
    lcd(ctx, w, h, t, p) {
      const c = h / 48, gap = c * 0.18, L = 8;
      const paths = Array.from({ length: L }, () => new Path2D());
      for (let y = 0; y * c < h; y++) {
        for (let x = 0; x * c < w; x++) {
          const band = Math.max(0, Math.sin(((x + y * 0.6) * c / w) * 4 - t * 0.35));
          const spark = rnd(x * 131 + y) > 0.93 ? 0.3 * (0.5 + 0.5 * Math.sin(t * 0.8 + x + y)) : 0;
          paths[Math.min(L - 1, Math.floor((Math.pow(band, 4) * 0.85 + spark) * L))].rect(x * c + gap / 2, y * c + gap / 2, c - gap, c - gap);
        }
      }
      paths.forEach((path, i) => { ctx.fillStyle = rgba(p.accent, 0.035 + i * 0.022); ctx.fill(path); });
    },
    // arcs of light turning slowly round a glow
    swirl(ctx, w, h, t, p) {
      const cx = w * 0.7, cy = h * 0.42;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.75);
      g.addColorStop(0, rgba(p.accent, 0.17)); g.addColorStop(1, rgba(p.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = 'round';
      const light = mix(p.accent, WHITE, 0.15);
      for (let i = 0; i < 8; i++) {
        const a0 = t * (0.06 + 0.015 * i) * (i % 2 ? -1 : 1) + i * 0.9;
        ctx.strokeStyle = rgba(light, 0.07 + 0.13 * (1 - i / 8));
        ctx.lineWidth = h * (0.014 - i * 0.0011);
        ctx.beginPath(); ctx.arc(cx, cy, h * (0.08 + 0.075 * i), a0, a0 + 1.1 + 0.9 * rnd(i + 3)); ctx.stroke();
      }
    },
    // slanted bands sliding slowly, strong at the top right, fading towards the bottom left
    stripes(ctx, w, h, t, p) {
      const sp = w / 14, slant = h * 0.6, off = (t * sp * 0.05) % (sp * 2);   // (two bands a period: thin / wide stay apart)
      for (let i = -4; i < 20; i++) {
        const x = i * sp + off, strong = i % 2 === 0;
        const a = (strong ? 0.22 : 0.09) * Math.max(0, Math.min(1, (x - w * 0.15) / (w * 0.7)));
        if (a < 0.005) continue;
        const bw = sp * (strong ? 0.28 : 0.55);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, rgba(p.accent, a)); g.addColorStop(1, rgba(p.accent, a * 0.1));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + bw, 0); ctx.lineTo(x + bw - slant, h); ctx.lineTo(x - slant, h); ctx.closePath();
        ctx.fill();
      }
    },
  };

  // ---------- What shows ----------
  function wanted() {
    const s = S();
    const ctxNow = onHome ? context : null;
    if (preview === undefined && s.bgPerConsole !== false && ctxNow) {
      const own = ctxNow.id ? (s.consoleBg || {})[ctxNow.id] : '';
      const id = own && own !== 'auto' ? own : ctxNow.id ? styleOfConsole(ctxNow) : BY_MAKER[ctxNow.maker];
      if (id === 'none') return { id: 'none' };
      if (DRAW[id]) return { id, console: true };
    }
    let id = preview !== undefined ? preview : s.bgStyle || 'theme';
    if (id === 'theme') id = (App.themeList().find((t) => t.id === s.theme) || {}).bg || 'none';
    return { id };
  }

  function apply() {
    const want = wanted();
    showPicture(want.id === 'picture' ? S().bgPicture : '');
    style = DRAW[want.id] ? want.id : null;
    consoleMode = !!want.console;
    palette = style ? paletteFor(want) : null;
    canvas.classList.toggle('show', !!style);
    if (style) { size(); draw(); }
    update();
  }

  function showPicture(file) {
    if (!file) { pic.classList.remove('show'); return; }
    if (file !== picFile) {
      picFile = file;
      const mine = picLoad = api.bgImage(file).then((url) => {
        if (picLoad !== mine) return;
        if (!url) { pic.classList.remove('show'); UI.toast("Couldn't open the background picture", { icon: 'close', error: true }); return; }
        pic.style.backgroundImage = `url("${url}")`;
        pic.classList.add('show');
      });
      return;
    }
    if (pic.style.backgroundImage) pic.classList.add('show');
  }

  // half the screen's pixels: these are soft pictures, and it keeps the drawing light
  function size() {
    const nw = Math.max(1, Math.round(innerWidth * devicePixelRatio * 0.5)), nh = Math.max(1, Math.round(innerHeight * devicePixelRatio * 0.5));
    if (nw !== w || nh !== h) { w = canvas.width = nw; h = canvas.height = nh; }
  }

  function draw(now = performance.now()) {
    ctx.clearRect(0, 0, w, h);
    if (consoleMode) {   // a console's page: its colour under it
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba(palette.bg, 0.55)); g.addColorStop(1, rgba(palette.bg, 0.92));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    DRAW[style](ctx, w, h, (now - t0) / 1000, palette);
  }

  // ---------- Moving: only while MediaDeck is the window in front ----------
  const moving = () => S().bgMotion !== false && active && document.hasFocus() && !document.hidden;
  function update() {
    const run = !!style && moving();
    pic.classList.toggle('moving', S().bgMotion !== false);
    pic.classList.toggle('still', !moving());
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return;   // about 30 frames a second is plenty for something this slow
    last = now;
    draw(now);
  }

  if (window.api && api.onWinActive) api.onWinActive((on) => { active = on; update(); });
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('resize', () => { if (style) { size(); draw(); } });

  return {
    STYLES,
    styleOfConsole,
    apply,
    // Home's console / maker page (null: anything else on Home)
    setContext(c) {
      const next = c ? { id: c.id, name: c.name, maker: c.maker } : null;
      if (JSON.stringify(next) === JSON.stringify(context)) return;
      context = next;
      apply();
    },
    // which screen shows: other screens than Home have the theme's own background
    setScreen(home) { if (home !== onHome) { onHome = home; apply(); } },
    // Settings: a background while moving through the list (undefined: back to the saved one)
    preview(id) { preview = id; apply(); },
  };
})();
