// Twitch window (SmartTwitchTV):
//  - Twitch's embed player is replaced by a stand-in before the page runs: what SmartTwitchTV
//    would play there (a channel, or a video from a time) goes to main.js, which plays it in
//    MediaDeck's own player through Streamlink, without the ads
//  - the controller, read here (only while this window has the focus) and sent to twitch.js as
//    key presses: D-pad / left stick = arrows, A = OK, B / Back = back, X / Start = play-pause,
//    LB / RB = page up / down, Guide = MediaDeck (when the browser reports it; else the PS
//    button reaches MediaDeck through its own controller watcher)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const post = (req) => window.postMessage({ mcTwitch: req }, '*');
    let current = null;
    const player = {
      play() {}, pause() {}, seek() {}, setMuted() {}, getMuted: () => false, setVolume() {}, getVolume: () => 1,
      // more than one, or SmartTwitchTV keeps asking for them
      getQualities: () => [{ group: 'auto', name: 'Auto' }, { group: 'chunked', name: 'Source' }],
      setQuality() {}, getQuality: () => 'auto', isPaused: () => false, getCurrentTime: () => 0, getDuration: () => 0,
      addEventListener() {}, removeEventListener() {},
    };
    function Embed(id, o = {}) {
      this.listeners = {};
      current = this;
      if (o.channel) post({ channel: String(o.channel) });
      else if (o.video && String(o.video) !== '0') post({ video: String(o.video), time: String(o.time || '') });
    }
    Embed.VIDEO_READY = 'video.ready';
    Embed.VIDEO_PLAY = 'video.play';
    Embed.ENDED = 'ended';
    Embed.prototype.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
    Embed.prototype.removeEventListener = function () {};
    Embed.prototype.setChannel = function (c) { if (c) post({ channel: String(c) }); };
    Embed.prototype.setVideo = function (v, t) { if (v && String(v) !== '0') post({ video: String(v), time: String(t || '') }); };
    Embed.prototype.getPlayer = () => player;
    Object.defineProperty(window, 'Twitch', { value: Object.freeze({ Embed, Player: Embed }), writable: false, configurable: false });
    // called by twitch.js when MediaDeck's player has closed: SmartTwitchTV's own "exit player"
    // button (straight back to where you were; its "ended" event would say "has ended, exiting in 3 …")
    Object.defineProperty(window, '__mcTwitchEnded', {
      value: () => {
        const exit = document.getElementById('twitch-embed_exit');
        if (exit) { exit.click(); return; }
        const e = current;
        if (e) for (const fn of e.listeners[Embed.ENDED] || []) { try { fn(); } catch {} }
      },
    });
  },
});

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data.mcTwitch !== 'object') return;
  const r = e.data.mcTwitch;
  if (r.channel && /^[A-Za-z0-9_]{1,40}$/.test(r.channel)) ipcRenderer.send('tw-play', { channel: r.channel.toLowerCase() });
  else if (r.video && /^\d{1,15}$/.test(r.video)) ipcRenderer.send('tw-play', { video: r.video, time: /^[0-9hms]{0,12}$/.test(r.time) ? r.time : '' });
});

const BUTTONS = { 0: 'ok', 1: 'back', 2: 'play', 4: 'pageup', 5: 'pagedown', 8: 'back', 9: 'play', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home' };
const REPEATS = new Set(['up', 'down', 'left', 'right']);
const FIRST = 420, EVERY = 110;
const held = new Map();

function pressed() {
  const set = new Set();
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!pad || !pad.connected) continue;
    pad.buttons.forEach((b, i) => { if (BUTTONS[i] && (b.pressed || b.value > 0.6)) set.add(BUTTONS[i]); });
    const [x = 0, y = 0] = pad.axes;
    if (x < -0.55) set.add('left');
    if (x > 0.55) set.add('right');
    if (y < -0.55) set.add('up');
    if (y > 0.55) set.add('down');
  }
  return set;
}

function send(action) {
  if (action === 'home') ipcRenderer.send('tw-home');
  else ipcRenderer.send('tw-key', action);
}

let focused = false;
function poll(now) {
  requestAnimationFrame(poll);
  if (!document.hasFocus()) { held.clear(); focused = false; return; }
  const active = pressed();
  // buttons already down when the window got the focus (the A that opened Twitch) wait for release
  if (!focused) { focused = true; for (const a of active) held.set(a, { since: now, last: now, ignored: true }); }
  for (const a of [...held.keys()]) if (!active.has(a)) held.delete(a);
  for (const a of active) {
    const h = held.get(a);
    if (h && h.ignored) continue;
    if (!h) { held.set(a, { since: now, last: now }); send(a); }
    else if (REPEATS.has(a) && now - h.since > FIRST && now - h.last > EVERY) { h.last = now; send(a); }
  }
}
window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
