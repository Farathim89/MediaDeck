// Photo viewer: full screen, left/right to browse, A for slideshow.
const Photos = (() => {
  const el = document.getElementById('photos');
  const imgs = [el.querySelector('.photo-a'), el.querySelector('.photo-b')];
  const caption = el.querySelector('.photo-caption');
  const nameEl = el.querySelector('.photo-name');
  const metaEl = el.querySelector('.photo-meta');
  const stateEl = el.querySelector('.photo-state');
  let list = [];
  let index = 0;
  let front = 0;
  let slideshow = null;
  let captionTimer = null;
  let rotation = 0;

  const DIRECT = ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'bmp', 'avif'];
  const SLIDE_MS = 6000;

  function srcFor(item) {
    return DIRECT.includes(Media.extOf(item.name).toLowerCase())
      ? Media.url('file', { p: item.path })
      : Media.url('thumb', { p: item.path, w: 2560 });
  }

  function show(i) {
    index = (i + list.length) % list.length;
    rotation = 0;
    const item = list[index];
    const next = imgs[1 - front];
    const prev = imgs[front];
    next.onload = () => {
      next.style.transform = '';
      next.classList.add('show');
      prev.classList.remove('show');
      front = 1 - front;
    };
    next.onerror = () => { metaEl.textContent = `Can't show this picture · ${index + 1} of ${list.length}`; };
    next.src = srcFor(item);
    nameEl.textContent = Media.stripExt(item.name);
    metaEl.textContent = `${index + 1} of ${list.length}  ·  ${Media.formatDate(item.mtime)}  ·  ${Media.formatSize(item.size)}`;
    showCaption();
    // Load the next picture ahead of time
    if (list.length > 1) new Image().src = srcFor(list[(index + 1) % list.length]);
  }

  function showCaption() {
    caption.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => caption.classList.remove('show'), 3500);
  }

  function flash(text) {
    stateEl.textContent = text;
    stateEl.classList.remove('show');
    void stateEl.offsetWidth;
    stateEl.classList.add('show');
  }

  function toggleSlideshow(on = !slideshow) {
    clearInterval(slideshow);
    slideshow = null;
    if (on) slideshow = setInterval(() => show(index + 1), SLIDE_MS);
    flash(on ? 'Slideshow' : 'Slideshow stopped');
  }

  function handle(action) {
    if (action === 'left' || action === 'lb') { show(index - 1); if (slideshow) toggleSlideshow(true); }
    else if (action === 'right' || action === 'rb') { show(index + 1); if (slideshow) toggleSlideshow(true); }
    else if (action === 'ok' || action === 'playpause' || action === 'start') toggleSlideshow();
    else if (action === 'up' || action === 'down' || action === 'menu') showCaption();
    else if (action === 'x') {
      rotation = (rotation + 90) % 360;
      imgs[front].style.transform = `rotate(${rotation}deg)${rotation % 180 ? ' scale(0.75)' : ''}`;
    } else if (action === 'back') App.back();
    return true;
  }

  function init() {
    el.addEventListener('click', (e) => {
      const x = e.clientX / window.innerWidth;
      if (x < 0.25) handle('left'); else if (x > 0.75) handle('right'); else showCaption();
    });
    el.addEventListener('wheel', (e) => handle(e.deltaY > 0 ? 'right' : 'left'));
    el.appendChild(UI.hints([['a', 'Slideshow'], ['x', 'Rotate'], ['b', 'Back']]));
  }

  function enter(p) {
    Nav.setRoot(el);
    list = p.list;
    imgs.forEach((i) => { i.classList.remove('show'); i.removeAttribute('src'); });
    show(Math.max(0, p.index));
    if (p.slideshow) toggleSlideshow(true);
  }

  function leave() {
    clearInterval(slideshow);
    slideshow = null;
    imgs.forEach((i) => { i.classList.remove('show'); i.removeAttribute('src'); });
  }

  return { el, init, enter, leave, handle, resume() { Nav.setRoot(el); } };
})();
