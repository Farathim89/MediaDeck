// The in-game overlay menu (shown over the running game by the PS / Guide button).
(() => {
  const list = document.querySelector('.ov-list');
  const LABELS = {
    resume: ['Back to the game', 'play'],
    saveState: ['Save state', 'check'],
    loadState: ['Load state', 'restart'],
    pause: ['Pause / continue', 'pause'],
    screenshot: ['Screenshot', 'image'],
    home: ['Go to MediaDeck', 'home'],
    close: ['Close the game', 'close'],
  };
  let busy = false;

  function render(info) {
    if (!info) return;
    Input.ignoreHeld();
    document.documentElement.dataset.theme = info.theme || 'oled';
    document.querySelector('.ov-name').textContent = info.name || '';
    document.querySelector('.ov-emu').textContent = info.emulator || '';
    list.innerHTML = '';
    for (const a of info.actions) {
      if (a === 'home') list.insertAdjacentHTML('beforeend', '<div class="ov-sep"></div>');
      const [label, icon] = LABELS[a];
      const b = document.createElement('button');
      b.className = 'menu-item focusable' + (a === 'close' ? ' danger' : '');
      b.dataset.group = 'overlay';
      b.innerHTML = `${Icons[icon] || ''}<span>${UI.esc(label)}</span>`;
      b.addEventListener('click', () => run(a));
      list.appendChild(b);
    }
    Nav.setRoot(document.body);
    Nav.focus(list.querySelector('.menu-item'));
  }

  async function run(a) {
    if (busy) return;
    busy = true;
    try { await overlay.action(a); } finally { busy = false; }
  }

  Input.setHandler((action) => {
    if (UI.handle(action)) return;
    if (action === 'back' || action === 'home' || action === 'start') { run('resume'); return; }
    if (['up', 'down', 'left', 'right'].includes(action)) Nav.move(action);
    else if (action === 'ok') Nav.activate();
  });
  Nav.bindMouse(document.body);


  const tick = () => { document.querySelector('.clock-time').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 5000);

  overlay.onOpen(render);
  overlay.info().then(render);
})();
