// Spatial focus: moves between ".focusable" elements by where they are on screen.
// Elements can share a data-group (a row); coming back into a group returns to
// the element that was focused there last.
const Nav = (() => {
  let root = document;
  let current = null;
  const memory = new Map();

  function visible(el) {
    if (!el.isConnected || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function items() {
    return [...root.querySelectorAll('.focusable')].filter((el) => !el.disabled && visible(el));
  }

  function focus(el, opts = {}) {
    if (!el) return;
    if (current && current !== el) current.classList.remove('focused');
    current = el;
    el.classList.add('focused');
    if (el.dataset.group) memory.set(el.dataset.group, el);
    if (el.matches('input, textarea, select')) el.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    // a side list (Settings, Help, Home's menu) scrolls to it - with a bigger Screen size it can be taller than the screen
    if (opts.scroll !== false && el.closest('.tabs')) el.scrollIntoView({ block: 'nearest' });
    el.dispatchEvent(new CustomEvent('nav-focus', { bubbles: true, detail: { scroll: opts.scroll !== false } }));
  }

  function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  // Gap between two ranges on one axis (0 when they overlap)
  function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }

  // accept: optional filter for which elements may be moved to
  function move(dir, accept) {
    const list = accept ? items().filter((el) => el === current || accept(el)) : items();
    if (!list.length) return false;
    if (!current || !list.includes(current)) { focus(list[0]); return true; }

    const r = current.getBoundingClientRect();
    const c = centre(r);
    let best = null;
    let bestScore = Infinity;

    for (const el of list) {
      if (el === current) continue;
      const rr = el.getBoundingClientRect();
      const cc = centre(rr);
      let primary, secondary;
      // Must really lie on that side (a little overlap is allowed for scaled/focused items),
      // not just have its centre there: a narrow card below isn't "to the left"
      const tolX = Math.min(r.width, rr.width) * 0.25;
      const tolY = Math.min(r.height, rr.height) * 0.25;
      if (dir === 'right') { if (cc.x <= c.x + 1 || rr.left < r.right - tolX) continue; primary = rr.left - r.right; secondary = gap(r.top, r.bottom, rr.top, rr.bottom); }
      if (dir === 'left') { if (cc.x >= c.x - 1 || rr.right > r.left + tolX) continue; primary = r.left - rr.right; secondary = gap(r.top, r.bottom, rr.top, rr.bottom); }
      if (dir === 'down') { if (cc.y <= c.y + 1 || rr.top < r.bottom - tolY) continue; primary = rr.top - r.bottom; secondary = Math.abs(cc.x - c.x); }
      if (dir === 'up') { if (cc.y >= c.y - 1 || rr.bottom > r.top + tolY) continue; primary = r.top - rr.bottom; secondary = Math.abs(cc.x - c.x); }
      const vertical = dir === 'up' || dir === 'down';
      const score = Math.max(primary, -8) + secondary * (vertical ? 0.6 : 4);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;

    // Entering another row: go back to where we were in it
    const g = best.dataset.group;
    if ((dir === 'up' || dir === 'down') && g && g !== current.dataset.group) {
      const remembered = memory.get(g);
      if (remembered && list.includes(remembered)) best = remembered;
    }
    focus(best);
    return true;
  }

  return {
    get current() { return current; },
    get root() { return root; },
    setRoot(el) { root = el || document; },
    items,
    focus,
    move,
    remember(group) { return memory.get(group); },
    forget(group) { memory.delete(group); },
    activate() { if (current && current.isConnected) current.click(); },
    // Clicks / hover with the mouse
    bindMouse(container) {
      container.addEventListener('mousemove', (e) => {
        const el = e.target.closest('.focusable');
        if (el && el !== current && root.contains(el) && Input.source === 'mouse') focus(el, { scroll: false });
      });
    },
  };
})();
