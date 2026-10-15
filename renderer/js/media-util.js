// Shared bits for the media screens: server links, thumbnails, sorting, formatting.
const Media = (() => {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function url(route, params = {}) {
    const s = App.state.server;
    const q = new URLSearchParams({ k: s.token, ...params });
    return `http://127.0.0.1:${s.port}/${route}?${q}`;
  }

  const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '') || p;
  const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  const stripExt = (n) => n.replace(/\.[^.]{1,5}$/, '');
  const extOf = (n) => (/\.([^.]{1,5})$/.exec(n) || [])[1] || '';

  function formatSize(bytes) {
    if (!bytes) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(ms) {
    return ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  function sortEntries(entries, by) {
    const list = [...entries];
    const cmp = {
      name: (a, b) => collator.compare(a.name, b.name),
      date: (a, b) => b.mtime - a.mtime || collator.compare(a.name, b.name),
      size: (a, b) => b.size - a.size || collator.compare(a.name, b.name),
    }[by] || ((a, b) => collator.compare(a.name, b.name));
    return list.sort((a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : cmp(a, b));
  }

  // Watched state for a file: null, { pct } or { watched: true }
  function watchState(path) {
    const p = App.state.progress[path];
    if (!p) return null;
    if (p.watched) return { watched: true };
    if (p.dur > 0 && p.pos > 5) return { pct: Math.min(100, (p.pos / p.dur) * 100) };
    return null;
  }

  // Where a thumbnail comes from, in the order to try
  function thumbSources(item) {
    const set = App.state.config.settings;
    if (item.kind === 'folder' && set.folderArt === false) return [];
    if (item.kind !== 'folder' && set.thumbnails === false) return [];
    if (item.kind === 'folder') return [url('art', { p: item.path, w: 480 })];
    if (item.kind === 'video' || item.kind === 'image') return [url('thumb', { p: item.path, w: 480 })];
    if (item.kind === 'audio') return [url('thumb', { p: item.path, w: 480 }), url('art', { p: dirOf(item.path), w: 480 })];
    return [];
  }

  // Thumbnails load only when they scroll near the screen
  let observer = null;
  function lazy(root) {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer.unobserve(e.target);
        loadThumb(e.target);
      }
    }, { root, rootMargin: '600px 0px' });
    return observer;
  }

  function loadThumb(holder) {
    const sources = JSON.parse(holder.dataset.src || '[]');
    const tryNext = (i) => {
      if (i >= sources.length) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!holder.isConnected) return;
        holder.classList.add('loaded');
        // Posters and covers: blurred copy behind, whole picture on top
        const wide = img.naturalWidth / img.naturalHeight > 1.5;
        holder.classList.toggle('fit', !wide);
        holder.style.setProperty('--thumb', `url("${img.src}")`);
        img.className = 'thumb-img';
        holder.appendChild(img);
      };
      img.onerror = () => tryNext(i + 1);
      img.src = sources[i];
    };
    tryNext(0);
  }

  function kindIcon(kind) {
    return { folder: Icons.folder, video: Icons.film, audio: Icons.music, image: Icons.image }[kind] || Icons.file;
  }

  return { url, dirOf, baseName, stripExt, extOf, formatSize, formatTime, formatDate, sortEntries, watchState, thumbSources, lazy, loadThumb, kindIcon, collator };
})();
