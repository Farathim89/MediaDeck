// Menus, dialogs and toasts — all controller-friendly.
const UI = (() => {
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');
  let open = null; // { el, resolve, prevRoot, prevFocus }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(build) {
    return new Promise((resolve) => {
      if (open) close(null);
      const scrim = document.createElement('div');
      scrim.className = 'modal-scrim';
      const box = document.createElement('div');
      box.className = 'modal';
      scrim.appendChild(box);
      modalRoot.appendChild(scrim);
      open = { el: scrim, resolve, prevRoot: Nav.root, prevFocus: Nav.current };
      scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(null); });
      Nav.setRoot(box);
      Nav.bindMouse(box);
      const first = build(box, (v) => close(v));
      Nav.focus(first || Nav.items()[0]);
    });
  }

  function close(value) {
    if (!open) return;
    const { el, resolve, prevRoot, prevFocus } = open;
    open = null;
    el.remove();
    Nav.setRoot(prevRoot);
    if (prevFocus && prevFocus.isConnected) Nav.focus(prevFocus, { scroll: false });
    resolve(value);
  }

  function itemButton(item, done) {
    const b = document.createElement('button');
    b.className = 'menu-item focusable' + (item.danger ? ' danger' : '') + (item.cls ? ' ' + item.cls : '');
    b._value = item.value;
    const dots = item.swatch ? `<span class="menu-swatch">${item.swatch.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>` : '';
    b.innerHTML = `${item.icon && Icons[item.icon] ? Icons[item.icon] : ''}<span>${esc(item.label)}</span>${dots}`;
    b.addEventListener('click', () => done(item.value !== undefined ? item.value : item.label));
    return b;
  }

  // focus: the value of the item to start on (e.g. what's playing now)
  // onFocus(value): called for the item under the focus (a live preview, e.g. the theme)
  // timeout: { secs, value, text(secondsLeft) } - counts down in the message and answers value when the time is up
  // (Settings → Screen resolution: an unanswered "Keep it?" goes back by itself)
  function menu({ title, message, items, focus, onFocus, timeout }) {
    return show((box, done) => {
      box.innerHTML = `${title ? `<h2>${esc(title)}</h2>` : ''}${message || timeout ? `<p>${esc(message || '')}</p>` : ''}<div class="menu-list"></div>`;
      const list = box.querySelector('.menu-list');
      const buttons = items.map((it) => itemButton(it, done));
      buttons.forEach((b) => list.appendChild(b));
      if (timeout) {
        let left = timeout.secs;
        const p = box.querySelector('p');
        const tick = () => { if (p) p.textContent = timeout.text ? timeout.text(left) : `${message || ''} (${left} s)`; };
        tick();
        const t = setInterval(() => {
          if (!box.isConnected) { clearInterval(t); return; }
          left -= 1;
          if (left <= 0) { clearInterval(t); done(timeout.value); return; }
          tick();
        }, 1000);
      }
      box.addEventListener('nav-focus', (e) => { e.target.scrollIntoView({ block: 'nearest' }); if (onFocus && e.target._value !== undefined) onFocus(e.target._value); });
      const i = focus !== undefined ? items.findIndex((it) => it.value === focus) : -1;
      return buttons[i >= 0 ? i : 0];
    });
  }

  async function confirm(title, message, okLabel = 'OK', danger = false) {
    const v = await menu({ title, message, items: [
      { label: okLabel, value: true, icon: 'check', danger },
      { label: 'Cancel', value: false, icon: 'close' },
    ] });
    return v === true;
  }

  function prompt({ title, message, value = '', okLabel = 'Save' }) {
    return show((box, done) => {
      box.innerHTML = `<h2>${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}
        <input type="text" class="focusable" spellcheck="false"><div class="menu-list"></div>`;
      const input = box.querySelector('input');
      input.value = value;
      const list = box.querySelector('.menu-list');
      list.appendChild(itemButton({ label: okLabel, icon: 'check', value: '__ok' }, () => done(input.value.trim())));
      list.appendChild(itemButton({ label: 'Cancel', icon: 'close', value: null }, () => done(null)));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim()); } });
      setTimeout(() => input.select(), 0);
      return input;
    });
  }

  const COLORS = ['#e5a00d', '#e11d48', '#db2777', '#9333ea', '#7c3aed', '#5b5fc7', '#2563eb', '#1e3a8a', '#0891b2', '#2f8f83', '#ca8a04', '#b45309', '#ea580c', '#64748b', '#334155', '#111827'];

  // list: other colours than these (the Custom theme's background adds black)
  function colors({ title, current, list = COLORS }) {
    return show((box, done) => {
      box.innerHTML = `<h2>${esc(title)}</h2><div class="swatches"></div><div class="menu-list"></div>`;
      const wrap = box.querySelector('.swatches');
      let first = null;
      list.forEach((c) => {
        const s = document.createElement('button');
        s.className = 'swatch focusable' + (c === current ? ' current' : '');
        s.style.setProperty('--c', c);
        s.addEventListener('click', () => done(c));
        wrap.appendChild(s);
        if (c === current || !first) first = c === current ? s : first || s;
      });
      box.querySelector('.menu-list').appendChild(itemButton({ label: 'Cancel', icon: 'close', value: null }, () => done(null)));
      return first;
    });
  }

  // Returns true when an open dialog used the action
  function handle(action) {
    if (!open) return false;
    if (action === 'back') close(null);
    else if (action === 'ok') Nav.activate();
    else if (['up', 'down', 'left', 'right'].includes(action)) Nav.move(action);
    return true;
  }

  function toast(text, { icon = 'check', duration = 3000, error = false, spinner = false } = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (error ? ' error' : '');
    t.innerHTML = `${spinner ? '<div class="spinner"></div>' : (Icons[icon] || '')}<span>${esc(text)}</span>`;
    toastRoot.appendChild(t);
    while (toastRoot.children.length > 3) toastRoot.firstChild.remove();
    const remove = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    if (duration) setTimeout(remove, duration);
    return { remove, el: t };
  }

  // ---- Backdrop glow in the colour of what's focused (cross-fades between two layers) ----
  const glows = [document.getElementById('glow-a'), document.getElementById('glow-b')];
  let glowIdx = 0;
  let glowKey;

  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return `rgba(80,90,110,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // color: '#rrggbb' or null; image: optional picture shown blurred behind
  function glow(color, image) {
    const key = `${color}|${image || ''}`;
    if (key === glowKey) return;
    glowKey = key;
    const next = glows[glowIdx = 1 - glowIdx];
    const prev = glows[1 - glowIdx];
    const tint = color
      ? `radial-gradient(55% 65% at 72% 12%, ${rgba(color, 0.55)}, transparent 70%), radial-gradient(45% 55% at 12% 0%, ${rgba(color, 0.22)}, transparent 70%)`
      : 'radial-gradient(55% 65% at 72% 12%, rgba(90,100,120,0.25), transparent 70%)';
    next.style.background = image ? `${tint}, center / cover no-repeat url("${image}")` : tint;
    next.classList.toggle('has-image', !!image);
    next.classList.add('show');
    prev.classList.remove('show');
  }

  // Rows: scroll the focused row to the top and keep the tile in view sideways
  function scrollRow(inner, row, tile) {
    inner.style.transform = `translateY(${-row.offsetTop}px)`;
    const track = row.querySelector('.row-track');
    const pad = parseFloat(getComputedStyle(document.documentElement).fontSize) * 4;
    const left = tile.offsetLeft;
    const right = left + tile.offsetWidth;
    if (right > track.scrollLeft + track.clientWidth - pad) track.scrollLeft = right - track.clientWidth + pad;
    else if (left < track.scrollLeft + pad) track.scrollLeft = Math.max(0, left - pad);
  }

  // Button hints along the bottom: [['a', 'Open'], ['y', 'Options']] - in a solid box (nothing shows through), with the
  // buttons of the controller in use: PlayStation's ✕ ○ □ △ in their colours, or A / B / X / Y (Input.padKind)
  const PS_GLYPHS = {
    a: '<path d="M2.3 2.3l5.4 5.4M7.7 2.3l-5.4 5.4" stroke="#8fb8ff" stroke-width="1.5" stroke-linecap="round"/>',
    b: '<circle cx="5" cy="5" r="3" fill="none" stroke="#ff7b7b" stroke-width="1.35"/>',
    x: '<rect x="2.2" y="2.2" width="5.6" height="5.6" fill="none" stroke="#f39ad6" stroke-width="1.35"/>',
    y: '<path d="M5 1.9 8.3 7.7H1.7Z" fill="none" stroke="#4fe0c0" stroke-width="1.3" stroke-linejoin="round"/>',
  };
  const glyph = (b) => (Input.padKind === 'playstation' && PS_GLYPHS[b] ? `<svg viewBox="0 0 10 10">${PS_GLYPHS[b]}</svg>` : b.toUpperCase());
  function hints(list) {
    const h = document.createElement('div');
    h.className = 'hints';
    h.innerHTML = `<div class="hints-box">${list.map(([b, label]) => `<span class="hint"><span class="btn-glyph ${b}" data-b="${b}">${glyph(b)}</span>${esc(label)}</span>`).join('')}</div>`;
    return h;
  }
  document.addEventListener('padkind', () => { for (const g of document.querySelectorAll('.btn-glyph[data-b]')) g.innerHTML = glyph(g.dataset.b); });

  return { menu, confirm, prompt, colors, COLORS, toast, handle, esc, glow, hints, scrollRow, get isOpen() { return !!open; },
    dismiss: () => close(null) };
})();
