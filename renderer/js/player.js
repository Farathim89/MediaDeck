// Player controls over mpv: seek bar, buttons, audio/subtitle tracks, playlist,
// resume, auto-next and watched progress.
(() => {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const seekEl = $('#seek');
  const fillEl = $('.seek-fill');
  const knobEl = $('.seek-knob');
  const previewEl = $('.seek-preview');
  const timePosEl = $('#time-pos');
  const timeEndEl = $('#time-end');
  const centerEl = $('#center-icon');

  const VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', 'vob', 'ogv', '3gp', 'divx', 'rmvb', 'asf'];
  // Player settings (Settings → Playback)
  const S = () => (data && data.settings) || {};
  const skipBack = () => Number(S().skipBack) || 10;
  const skipFwd = () => Number(S().skipForward) || 30;
  const skipBig = () => Number(S().skipBig) || 60;
  const hideAfter = () => (S().osdHide === 'never' ? 0 : (Number(S().osdHide) || 4) * 1000);

  let data = null;          // { list, index, opts, settings, progress, server }
  let index = 0;
  let file = '';
  let isMusic = false;
  const st = { time: 0, dur: 0, paused: false, tracks: [], eof: false, loaded: false };
  let hideTimer = null;
  let lastSaved = 0;
  let pendingSeek = null;   // target time while scrubbing
  let seekTimer = null;
  let seekStep = { at: 0, count: 0 };
  let ending = false;
  let subLangChoice = null; // language picked by hand, kept for the next files
  let closing = false;

  const name = (p) => p.split(/[\\/]/).pop();
  const stripExt = (n) => n.replace(/\.[^.]{1,5}$/, '');
  const ext = (p) => ((/\.([^.]{1,5})$/.exec(p) || [])[1] || '').toLowerCase();
  const folderName = (p) => { const parts = p.split(/[\\/]/).filter(Boolean); return parts.length > 1 ? parts[parts.length - 2] : ''; };
  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  // An online stream (Twitch …): opts.title / subtitle name it; live ones can't seek and keep no progress
  const stream = () => !!(data && data.opts && data.opts.stream);
  const live = () => !!(data && data.opts && data.opts.live);
  const url = (route, params) => `http://127.0.0.1:${data.server.port}/${route}?${new URLSearchParams({ k: data.server.token, ...params })}`;
  const cmd = (c) => player.cmd(c);

  let langNames = null;
  try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch {}
  const ISO2 = { eng: 'en', swe: 'sv', jpn: 'ja', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', nor: 'no', dan: 'da', fin: 'fi', chi: 'zh', zho: 'zh', kor: 'ko', rus: 'ru', por: 'pt', dut: 'nl', nld: 'nl', pol: 'pl', ara: 'ar', hin: 'hi', tur: 'tr' };
  function langName(code) {
    if (!code || code === 'und') return '';
    try { return langNames ? langNames.of(ISO2[code] || code) : code; } catch { return code; }
  }

  // ---------- Loading files ----------
  async function load(i, { fromStart = false } = {}) {
    index = i;
    file = data.list[i];
    isMusic = !stream() && !VIDEO_EXT.includes(ext(file));
    body.classList.toggle('is-live', live());
    body.classList.toggle('is-music', isMusic);
    st.time = 0; st.dur = 0; st.eof = false; st.loaded = false;
    ending = false;
    lastSaved = 0;
    updateTitle();
    updateButtons();
    if (isMusic) loadMusicInfo();

    let start = stream() ? Number(data.opts.start) || 0 : 0;
    const p = stream() ? null : data.progress[file];
    const mode = S().resumeMode || 'ask';
    if (!fromStart && mode !== 'start' && p && !p.watched && p.pos > 30 && (!p.dur || p.pos < p.dur - 30)) {
      const c = mode === 'resume' ? 'resume' : await UI.menu({
        title: stripExt(name(file)),
        items: [
          { label: `Resume from ${fmt(p.pos)}`, icon: 'play', value: 'resume' },
          { label: 'Start from the beginning', icon: 'restart', value: 'start' },
        ],
      });
      if (c === null) return close();
      if (c === 'resume') start = p.pos;
    }
    const args = ['loadfile', file, 'replace', -1];
    if (start > 0) args.push(`start=${start.toFixed(2)}`);
    await cmd(args);
    await cmd(['set_property', 'pause', false]);
    showOsd();
  }

  function updateTitle() {
    if (stream()) {
      $('#title').textContent = data.opts.title || 'Stream';
      $('#subtitle').textContent = data.opts.subtitle || '';
      return;
    }
    $('#title').textContent = stripExt(name(file));
    const parts = [folderName(file)];
    if (data.list.length > 1) parts.push(`${index + 1} of ${data.list.length}`);
    $('#subtitle').textContent = parts.filter(Boolean).join('  ·  ');
  }

  function loadMusicInfo() {
    const cover = $('.cover');
    const img = cover.querySelector('img');
    cover.classList.remove('has-img');
    $('.music-bg').style.backgroundImage = '';
    $('.music-kicker').textContent = data.list.length > 1 ? `Track ${index + 1} of ${data.list.length}` : 'Now playing';
    $('.music-title').textContent = stripExt(name(file));
    $('.music-artist').textContent = '';
    $('.music-album').textContent = folderName(file);
    const dir = file.replace(/[\\/][^\\/]*$/, '');
    const sources = [url('thumb', { p: file, w: 800 }), url('art', { p: dir, w: 800 })];
    const tryNext = (n) => {
      if (n >= sources.length) return;
      img.onload = () => { cover.classList.add('has-img'); $('.music-bg').style.backgroundImage = `url("${img.src}")`; };
      img.onerror = () => tryNext(n + 1);
      img.src = sources[n];
    };
    tryNext(0);
  }

  function applyMetadata(meta) {
    if (!isMusic || !meta) return;
    const get = (k) => meta[k] || meta[k.toUpperCase()] || meta[k[0].toUpperCase() + k.slice(1)] || '';
    if (get('title')) $('.music-title').textContent = get('title');
    $('.music-artist').textContent = get('artist') || get('album_artist');
    if (get('album')) $('.music-album').textContent = get('album');
  }

  // ---------- mpv events ----------
  player.onEvent((m) => {
    if (m.prop === 'time-pos') { if (typeof m.value === 'number') { st.time = m.value; tick(); } }
    else if (m.prop === 'duration') { st.dur = m.value || 0; tick(); }
    else if (m.prop === 'pause') { st.paused = !!m.value; updateButtons(); if (st.paused) showOsd(); else scheduleHide(); }
    else if (m.prop === 'paused-for-cache') body.classList.toggle('buffering', !!m.value);
    else if (m.prop === 'track-list') { st.tracks = m.value || []; updateButtons(); }
    else if (m.prop === 'metadata') applyMetadata(m.value);
    else if (m.prop === 'eof-reached') { if (m.value === true && st.loaded) onEnd(); }
    else if (m.event === 'file-loaded') { st.loaded = true; applySubChoice(); }
    else if (m.event === 'end-file' && m.reason === 'error') {
      UI.toast(`Can't play ${name(file)}`, { icon: 'alert', error: true, duration: 4000 });
      if (index < data.list.length - 1) load(index + 1, { fromStart: true }); else setTimeout(close, 1500);
    } else if (m.event === 'mpv-exit' && !closing) close();
    else if (m.event === 'passthrough-fallback') {     // mpv.js: the output refused that format, now it plays
      flashText(m.to ? 'This output takes only Dolby Digital and DTS' : 'No passthrough on this output: decoding the sound');
    }
  });

  function tick() {
    const t = pendingSeek !== null ? pendingSeek : st.time;
    const pct = st.dur ? Math.min(100, (t / st.dur) * 100) : 0;
    fillEl.style.width = pct + '%';
    knobEl.style.left = pct + '%';
    timePosEl.textContent = live() ? 'LIVE' : fmt(t);
    if (live()) timeEndEl.textContent = '';
    else if (st.dur) {
      const endsAt = new Date(Date.now() + (st.dur - st.time) * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      timeEndEl.textContent = `${fmt(st.dur)}  ·  ends ${endsAt}`;
    }
    if (Date.now() - lastSaved > 5000) saveProgress();
  }

  function saveProgress(final = false) {
    lastSaved = Date.now();
    if (stream()) return;
    if (!file || !st.dur || st.dur < 600) return;   // only long things: films, episodes, audiobooks
    const watched = st.eof || st.time / st.dur > (Number(S().watchedAt) || 92) / 100;
    const entry = { pos: watched ? 0 : st.time, dur: st.dur, watched };
    if (!final && st.time < 5 && !data.progress[file]) return;
    data.progress[file] = entry;
    player.progress(file, entry);
  }

  async function onEnd() {
    if (ending) return;
    ending = true;
    st.eof = true;
    saveProgress(true);
    if (index < data.list.length - 1 && data.settings.autoplayNext !== false) {
      flashText(`Next: ${stripExt(name(data.list[index + 1]))}`);
      setTimeout(() => load(index + 1, { fromStart: true }), 1200);
    } else if (opt.repeat === 'list' && data.list.length) {
      setTimeout(() => load(0, { fromStart: true }), 800);
    } else {
      setTimeout(close, 800);
    }
  }

  // ---------- Tracks ----------
  function applySubChoice() {
    if (!subLangChoice || S().rememberSubs === false) return;
    if (subLangChoice === 'off') { cmd(['set_property', 'sid', 'no']); return; }
    const t = st.tracks.find((x) => x.type === 'sub' && x.lang === subLangChoice);
    if (t) cmd(['set_property', 'sid', t.id]);
  }

  function trackLabel(t) {
    const lang = langName(t.lang);
    const main = [t.title, lang && !(t.title || '').toLowerCase().includes(lang.toLowerCase()) ? lang : ''].filter(Boolean).join(' — ') || `Track ${t.id}`;
    const extra = [];
    if (t.codec) extra.push(t.codec.toUpperCase().replace('HDMV_PGS_SUBTITLE', 'PGS').replace('SUBRIP', 'SRT'));
    if (t.type === 'audio' && t['demux-channel-count']) extra.push({ 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' }[t['demux-channel-count']] || `${t['demux-channel-count']} ch`);
    if (t.forced) extra.push('Forced');
    if (t.external) extra.push('External');
    return extra.length ? `${main}  (${extra.join(', ')})` : main;
  }

  async function trackMenu(type) {
    const list = st.tracks.filter((t) => t.type === type);
    if (type === 'audio' && list.length < 2) { flashText(list.length ? 'Only one audio track' : 'No audio'); return; }
    if (type === 'sub' && !list.length) { flashText('No subtitles'); return; }
    const current = list.find((t) => t.selected);
    const items = list.map((t) => ({ label: trackLabel(t), value: t.id, icon: t.selected ? 'check' : '' }));
    if (type === 'sub') items.unshift({ label: 'Off', value: 'no', icon: current ? '' : 'check' });
    const c = await UI.menu({ title: type === 'audio' ? 'Audio' : 'Subtitles', items, focus: current ? current.id : 'no' });
    if (c === null) return;
    await cmd(['set_property', type === 'audio' ? 'aid' : 'sid', c]);
    if (type === 'sub') {
      const t = list.find((x) => x.id === c);
      subLangChoice = c === 'no' ? 'off' : (t && t.lang) || null;
      flashText(c === 'no' ? 'Subtitles off' : trackLabel(t));
    } else {
      flashText(trackLabel(list.find((x) => x.id === c)));
    }
  }

  async function playlistMenu() {
    if (data.list.length < 2) { flashText('Only one file'); return; }
    const items = data.list.map((p, i) => ({ label: `${i + 1}.  ${stripExt(name(p))}`, value: i, cls: i === index ? 'current' : '' }));
    const c = await UI.menu({ title: 'Playlist', items, focus: index });
    if (c !== null && c !== index) { saveProgress(true); load(c); }
  }

  // ---------- Buttons ----------
  function updateButtons() {
    const toggle = document.querySelector('[data-act="toggle"]');
    toggle.innerHTML = st.paused ? Icons.play : Icons.pause;
    document.querySelector('[data-act="prev"]').classList.toggle('disabled', index === 0);
    document.querySelector('[data-act="next"]').classList.toggle('disabled', index >= data.list.length - 1);
    const subs = st.tracks.filter((t) => t.type === 'sub');
    const audios = st.tracks.filter((t) => t.type === 'audio');
    const curSub = subs.find((t) => t.selected);
    const curAudio = audios.find((t) => t.selected);
    document.querySelector('[data-act="subs"] .pl').textContent = curSub ? (langName(curSub.lang) || curSub.title || 'On') : (subs.length ? 'Subtitles off' : 'No subtitles');
    document.querySelector('[data-act="audio"] .pl').textContent = curAudio ? (langName(curAudio.lang) || curAudio.title || 'Audio') : 'Audio';
    document.querySelector('[data-act="subs"]').style.display = isMusic ? 'none' : '';
    document.querySelector('[data-act="audio"]').style.display = isMusic && audios.length < 2 ? 'none' : '';
  }

  const ACTIONS = {
    toggle: () => togglePause(),
    rew: () => seekBy(-skipBack()),
    fwd: () => seekBy(skipFwd()),
    options: () => optionsMenu(),
    prev: () => prev(),
    next: () => next(),
    audio: () => trackMenu('audio'),
    subs: () => trackMenu('sub'),
    list: () => playlistMenu(),
  };

  function togglePause() {
    cmd(['cycle', 'pause']);
    flashIcon(st.paused ? Icons.play : Icons.pause);
  }

  function prev() {
    // Restart the file if we're past the first few seconds, like a CD player
    if (st.time > 8 || index === 0) { cmd(['seek', 0, 'absolute']); return; }
    saveProgress(true);
    load(index - 1, { fromStart: true });
  }

  function next() {
    if (index >= data.list.length - 1) return;
    saveProgress(true);
    load(index + 1, { fromStart: true });
  }

  // Seeking: repeated presses build up; the jump happens once the presses stop
  function seekBy(sec) {
    if (live()) { flashText('Live'); return; }
    const now = Date.now();
    seekStep = now - seekStep.at < 450 ? { at: now, count: seekStep.count + 1 } : { at: now, count: 0 };
    const mult = seekStep.count > 12 ? 6 : seekStep.count > 6 ? 3 : 1;
    const base = pendingSeek !== null ? pendingSeek : st.time;
    pendingSeek = Math.max(0, Math.min(st.dur ? st.dur - 1 : Infinity, base + sec * mult));
    seekEl.classList.add('seeking');
    previewEl.textContent = fmt(pendingSeek);
    previewEl.style.left = (st.dur ? (pendingSeek / st.dur) * 100 : 0) + '%';
    tick();
    showOsd();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, 450);
  }

  async function commitSeek() {
    if (pendingSeek === null) return;
    const t = pendingSeek;
    await cmd(['seek', t, 'absolute']);
    st.time = t;
    pendingSeek = null;
    seekEl.classList.remove('seeking');
    tick();
  }

  // ---------- OSD visibility ----------
  function showOsd(focusEl) {
    body.classList.add('osd-visible');
    if (focusEl) Nav.focus(focusEl);
    else if (!Nav.current) Nav.focus(document.querySelector('[data-act="toggle"]'));
    scheduleHide();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (isMusic || !hideAfter()) return;
    hideTimer = setTimeout(() => {
      if (!st.paused && !UI.isOpen && pendingSeek === null) body.classList.remove('osd-visible');
    }, hideAfter());
  }

  function hideOsd() {
    clearTimeout(hideTimer);
    body.classList.remove('osd-visible');
  }

  const osdVisible = () => body.classList.contains('osd-visible');

  function flashIcon(svg) {
    centerEl.className = '';
    centerEl.innerHTML = svg;
    void centerEl.offsetWidth;
    centerEl.className = 'flash';
  }

  function flashText(text) {
    centerEl.className = '';
    centerEl.textContent = text;
    void centerEl.offsetWidth;
    centerEl.className = 'flash-text flash';
  }

  // ---------- Options menu (Y): subtitles, audio, speed, timing, picture … ----------
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const SUB_SIZES = [{ v: 0.7, l: 'Smaller' }, { v: 0.85, l: 'Small' }, { v: 1, l: 'Normal' }, { v: 1.2, l: 'Large' }, { v: 1.45, l: 'Larger' }, { v: 1.75, l: 'Huge' }];
  const SUB_POS = [{ v: 100, l: 'Bottom' }, { v: 92, l: 'A bit higher' }, { v: 84, l: 'Higher' }];
  const ASPECTS = [{ v: 'auto', l: 'Original' }, { v: '16:9', l: '16:9' }, { v: '4:3', l: '4:3' }, { v: '2.39:1', l: 'Cinema (21:9)' }, { v: 'fill', l: 'Fill the screen (crop)' }, { v: 'stretch', l: 'Stretch' }];
  const opt = { speed: 1, subScale: 1, subPos: 100, subDelay: 0, audioDelay: 0, aspect: 'auto', volume: 100, repeat: 'off', deinterlace: false };

  // Sound: output, speakers, passthrough - applied at once and kept (Settings → Sound)
  const SPEAKERS = [{ v: 'auto', l: 'Automatic' }, { v: 'stereo', l: 'Stereo' }, { v: '5.1', l: 'Up to 5.1 surround' }, { v: '7.1', l: 'Up to 7.1 surround' }];
  const PASSTHROUGH = [{ v: 'on', l: 'On' }, { v: 'spdif', l: 'Dolby Digital and DTS only (optical)' }, { v: 'off', l: 'Off' }];
  let soundDevices = [];
  const shortDevice = (desc) => desc.replace(/\s*\([^()]*\)\s*$/, '');      // "DENON-AVR (NVIDIA High Definition Audio)"
  const soundOutputLabel = () => {
    const id = S().audioDevice || 'auto';
    if (id === 'auto') return 'Windows default';
    const x = soundDevices.find((dv) => dv.name === id);
    return x ? shortDevice(x.description) : 'Not connected';
  };
  async function soundMenu(key) {
    const cur = S()[key] || (key === 'audioDevice' ? 'auto' : key === 'audioPassthrough' ? 'on' : 'auto');
    let list;
    if (key === 'audioDevice') {
      soundDevices = await player.audioDevices();
      list = [{ v: 'auto', l: 'Windows default' }, ...soundDevices.map((dv) => ({ v: dv.name, l: dv.description }))];
    } else list = key === 'audioChannels' ? SPEAKERS : PASSTHROUGH;
    const title = { audioDevice: 'Sound output', audioChannels: 'Speakers', audioPassthrough: 'Passthrough' }[key];
    const v = await UI.menu({ title, focus: cur, items: list.map((x) => ({ label: x.l, value: x.v, icon: x.v === cur ? 'check' : '' })) });
    if (v == null || v === cur) return;
    S()[key] = v;
    await player.audio(key, v);
    flashText(`${title}: ${key === 'audioDevice' ? soundOutputLabel() : (list.find((x) => x.v === v) || {}).l}`);
  }

  const signed = (sec) => `${sec > 0 ? '+' : ''}${sec.toFixed(1)} s`;
  const speedLabel = (v) => (v === 1 ? 'Normal' : `${v}×`);

  async function applyStartOptions() {
    opt.volume = Math.max(0, Math.min(130, Number(S().volume) || 100));
    opt.speed = Number(S().defaultSpeed) || 1;
    opt.subScale = { Small: 0.85, Normal: 1, Large: 1.2, Huge: 1.45 }[S().subSize] || 1;
    await cmd(['set_property', 'volume', opt.volume]);
    if (opt.speed !== 1) await cmd(['set_property', 'speed', opt.speed]);
  }

  async function optionsMenu() {
    const curSub = st.tracks.find((t) => t.type === 'sub' && t.selected);
    const curAudio = st.tracks.find((t) => t.type === 'audio' && t.selected);
    const items = [];
    if (!isMusic) items.push({ label: `Subtitles  ·  ${curSub ? (langName(curSub.lang) || curSub.title || 'On') : 'Off'}`, icon: 'subs', value: 'subs' });
    items.push({ label: `Audio  ·  ${curAudio ? (langName(curAudio.lang) || curAudio.title || 'Track ' + curAudio.id) : '—'}`, icon: 'audio', value: 'audio' });
    items.push({ label: `Playback speed  ·  ${speedLabel(opt.speed)}`, icon: 'forward', value: 'speed' });
    if (!isMusic) {
      items.push({ label: `Subtitle size  ·  ${(SUB_SIZES.find((x) => x.v === opt.subScale) || {}).l || 'Normal'}`, icon: 'subs', value: 'subsize' });
      items.push({ label: `Subtitle position  ·  ${(SUB_POS.find((x) => x.v === opt.subPos) || {}).l}`, icon: 'subs', value: 'subpos' });
      items.push({ label: `Subtitle timing  ·  ${signed(opt.subDelay)}`, icon: 'restart', value: 'subdelay' });
    }
    items.push({ label: `Audio timing  ·  ${signed(opt.audioDelay)}`, icon: 'restart', value: 'audiodelay' });
    if (!isMusic) items.push({ label: `Picture shape  ·  ${(ASPECTS.find((x) => x.v === opt.aspect) || {}).l}`, icon: 'fullscreen', value: 'aspect' });
    items.push({ label: `Volume  ·  ${opt.volume}%`, icon: 'audio', value: 'volume' });
    items.push({ label: `Sound output  ·  ${soundOutputLabel()}`, icon: 'audio', value: 'audioDevice' });
    items.push({ label: `Speakers  ·  ${(SPEAKERS.find((x) => x.v === (S().audioChannels || 'auto')) || SPEAKERS[0]).l}`, icon: 'audio', value: 'audioChannels' });
    items.push({ label: `Passthrough  ·  ${(PASSTHROUGH.find((x) => x.v === (S().audioPassthrough || 'on')) || PASSTHROUGH[0]).l}`, icon: 'audio', value: 'audioPassthrough' });
    items.push({ label: `Repeat  ·  ${{ off: 'Off', file: 'This file', list: 'Whole list' }[opt.repeat]}`, icon: 'restart', value: 'repeat' });
    if (!isMusic) items.push({ label: `Deinterlace  ·  ${opt.deinterlace ? 'On' : 'Off'}`, icon: 'film', value: 'deint' });
    if (!isMusic) {      // NVIDIA RTX Video (mpv.js decides per video whether it applies)
      items.push({ label: `RTX Super Resolution  ·  ${S().rtxSuperRes === 'off' ? 'Off' : 'On'}`, icon: 'film', value: 'rtxSuperRes' });
      items.push({ label: `RTX HDR  ·  ${S().rtxHdr === 'on' ? 'On' : 'Off'}`, icon: 'film', value: 'rtxHdr' });
    }
    items.push({ label: 'File info', icon: 'info', value: 'info' });
    items.push({ label: 'Player settings', icon: 'settings', value: 'playerSettings' });

    const c = await UI.menu({ title: 'Options', items });
    if (!c) return;
    if (c === 'subs') return trackMenu('sub');
    if (c === 'audio') return trackMenu('audio');
    if (c === 'speed') {
      const v = await UI.menu({ title: 'Playback speed', focus: opt.speed, items: SPEEDS.map((x) => ({ label: speedLabel(x), value: x, icon: x === opt.speed ? 'check' : '' })) });
      if (v != null) { opt.speed = v; await cmd(['set_property', 'speed', v]); flashText(`Speed ${speedLabel(v)}`); }
    }
    if (c === 'subsize') {
      const v = await UI.menu({ title: 'Subtitle size', focus: opt.subScale, items: SUB_SIZES.map((x) => ({ label: x.l, value: x.v, icon: x.v === opt.subScale ? 'check' : '' })) });
      if (v != null) { opt.subScale = v; await cmd(['set_property', 'sub-scale', v]); }
    }
    if (c === 'subpos') {
      const v = await UI.menu({ title: 'Subtitle position', focus: opt.subPos, items: SUB_POS.map((x) => ({ label: x.l, value: x.v, icon: x.v === opt.subPos ? 'check' : '' })) });
      if (v != null) { opt.subPos = v; await cmd(['set_property', 'sub-pos', v]); }
    }
    if (c === 'subdelay' || c === 'audiodelay') await delayMenu(c === 'subdelay' ? 'sub' : 'audio');
    if (c === 'aspect') {
      const v = await UI.menu({ title: 'Picture shape', focus: opt.aspect, items: ASPECTS.map((x) => ({ label: x.l, value: x.v, icon: x.v === opt.aspect ? 'check' : '' })) });
      if (v != null) {
        opt.aspect = v;
        await cmd(['set_property', 'keepaspect', v !== 'stretch']);
        await cmd(['set_property', 'panscan', v === 'fill' ? 1 : 0]);
        await cmd(['set_property', 'video-aspect-override', ['auto', 'fill', 'stretch'].includes(v) ? '-1' : v]);
      }
    }
    if (c === 'volume') {
      const levels = [130, 115, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
      const v = await UI.menu({ title: 'Volume', focus: opt.volume, items: levels.map((x) => ({ label: x > 100 ? `${x}% (boost)` : `${x}%`, value: x, icon: x === opt.volume ? 'check' : '' })) });
      if (v != null) { opt.volume = v; await cmd(['set_property', 'volume', v]); flashText(`Volume ${v}%`); }
    }
    if (c === 'repeat') {
      const v = await UI.menu({ title: 'Repeat', focus: opt.repeat, items: [
        { label: 'Off', value: 'off', icon: opt.repeat === 'off' ? 'check' : '' },
        { label: 'This file', value: 'file', icon: opt.repeat === 'file' ? 'check' : '' },
        { label: 'Whole list', value: 'list', icon: opt.repeat === 'list' ? 'check' : '' },
      ] });
      if (v != null) { opt.repeat = v; await cmd(['set_property', 'loop-file', v === 'file' ? 'inf' : 'no']); }
    }
    if (c === 'audioDevice' || c === 'audioChannels' || c === 'audioPassthrough') await soundMenu(c);
    if (c === 'rtxSuperRes' || c === 'rtxHdr') {
      const isOn = c === 'rtxHdr' ? S()[c] === 'on' : S()[c] !== 'off';     // (RTX HDR: off unless switched on)
      const v = isOn ? 'off' : 'on';
      S()[c] = v;
      await player.audio(c, v);          // applied to this video at once and kept (Settings → Video)
      flashText(`${c === 'rtxHdr' ? 'RTX HDR' : 'RTX Super Resolution'} ${v}`);
    }
    if (c === 'deint') { opt.deinterlace = !opt.deinterlace; await cmd(['set_property', 'deinterlace', opt.deinterlace]); flashText(`Deinterlace ${opt.deinterlace ? 'on' : 'off'}`); }
    if (c === 'info') await infoMenu();
    if (c === 'playerSettings') await playerSettingsMenu();
  }

  // Y → Options → Player settings: the player's defaults - the same list as MediaDeck's Settings → Media Player
  // (player-settings.js), saved there too. Most apply at once; sound and NVIDIA RTX are in Options itself.
  async function playerSettingsMenu() {
    let secFocus;
    for (;;) {
      const secId = await UI.menu({ title: 'Player settings', focus: secFocus,
        message: 'The same as MediaDeck\'s Settings → Media Player, and saved there. Sound and NVIDIA RTX are in Options.',
        items: PlayerSettings.SECTIONS.map((x) => ({ label: x.title, value: x.id, icon: x.icon })) });
      if (!secId) return;
      secFocus = secId;
      const sec = PlayerSettings.SECTIONS.find((x) => x.id === secId);
      let focus;
      for (;;) {
        const key = await UI.menu({ title: sec.title, focus,
          items: sec.items.map((i) => ({ label: `${i.label}  ·  ${PlayerSettings.valueLabel(i, S()[i.key])}`, value: i.key })) });
        if (!key) break;
        focus = key;
        const item = sec.items.find((i) => i.key === key);
        const cur = S()[key];
        let v;
        if (item.type === 'toggle') v = !(cur !== false && cur);
        else if (item.type === 'text') {
          v = await UI.prompt({ title: item.label, message: item.desc, value: cur || '' });
          if (v === null) continue;
        } else {
          v = await UI.menu({ title: item.label, focus: cur, items: item.options().map((o) => ({ label: o.label, value: o.value, icon: o.value === cur ? 'check' : '' })) });
          if (v == null || v === cur) continue;
        }
        if (!(await player.audio(key, v))) continue;      // (checked and saved by mpv.js)
        S()[key] = v;
        if (key === 'playerClock') document.querySelector('#top .clock').style.display = v === false ? 'none' : '';
        if (key === 'subSize') {
          opt.subScale = { Small: 0.85, Normal: 1, Large: 1.2, Huge: 1.45 }[v] || 1;
          await cmd(['set_property', 'sub-scale', opt.subScale]);
        }
        if (key === 'subtitles' && v === 'off') await cmd(['set_property', 'sid', 'no']);
        flashText(`${item.label}: ${PlayerSettings.valueLabel(item, v)}`);
      }
    }
  }

  // Timing: nudge in small steps; the menu stays open so you can press several times
  async function delayMenu(kind) {
    const key = kind === 'sub' ? 'subDelay' : 'audioDelay';
    const prop = kind === 'sub' ? 'sub-delay' : 'audio-delay';
    const steps = [{ l: '−1 s', d: -1 }, { l: '−0.1 s', d: -0.1 }, { l: '+0.1 s', d: 0.1 }, { l: '+1 s', d: 1 }, { l: 'Reset', d: 0 }];
    let focus = 1;
    for (;;) {
      const v = await UI.menu({
        title: kind === 'sub' ? 'Subtitle timing' : 'Audio timing',
        message: `Now: ${signed(opt[key])}  ·  ${kind === 'sub' ? '− = subtitles earlier' : '− = sound earlier'}`,
        focus, items: steps.map((x, i) => ({ label: x.l, value: i })),
      });
      if (v == null) return;
      focus = v;
      opt[key] = steps[v].d === 0 ? 0 : Math.round((opt[key] + steps[v].d) * 10) / 10;
      await cmd(['set_property', prop, opt[key]]);
    }
  }

  async function infoMenu() {
    const get = async (p) => { try { return await cmd(['get_property', p]); } catch { return null; } };
    const [vp, vcodec, acodec, fps, hw, ch, size, aout, vf, vout] = await Promise.all([
      get('video-params'), get('video-codec'), get('audio-codec-name'), get('container-fps'), get('hwdec-current'), get('current-tracks/audio/demux-channel-count'), get('file-size'),
      get('audio-out-params'), get('vf'), get('video-out-params'),
    ]);
    const lines = [];
    if (vp && vp.w) lines.push(`Picture: ${vp.w}×${vp.h}${fps ? `  ·  ${Math.round(fps * 100) / 100} fps` : ''}${vp.gamma === 'pq' || vp.gamma === 'hlg' ? '  ·  HDR' : ''}`);
    if (vcodec) lines.push(`Video: ${String(vcodec).split(' ')[0]}${hw && hw !== 'no' ? '  ·  graphics card decoding' : ''}`);
    const rtx = (Array.isArray(vf) ? vf : []).find((f) => f.label === 'rtx');
    if (rtx) {
      const p = rtx.params || {};
      const what = [];
      if (p['scaling-mode'] === 'nvidia') what.push(`Super Resolution ${vp && vp.h ? `${vp.h}p → ${vout && vout.h ? vout.h : '?'}p` : ''}`.trim());
      if ('nvidia-true-hdr' in p) what.push('RTX HDR (SDR made HDR)');      // (a flag: mpv gives it as "")
      if (what.length) lines.push(`NVIDIA: ${what.join('  ·  ')}`);
    }
    if (acodec) lines.push(`Audio: ${acodec}${ch ? `  ·  ${{ 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' }[ch] || ch + ' channels'}` : ''}`);
    const spdif = aout && /^spdif-(.+)$/.exec(aout.format || '');
    if (spdif) lines.push(`Sound: passthrough - your receiver decodes it (${{ ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', dtshd: 'DTS-HD' }[spdif[1]] || spdif[1]})`);
    else if (aout && aout['channel-count']) lines.push(`Sound: decoded, sent as ${{ 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' }[aout['channel-count']] || aout['channel-count'] + ' channels'}`);
    if (size) lines.push(`Size: ${(size / 1073741824).toFixed(2)} GB`);
    lines.push(file);
    await UI.menu({ title: stripExt(name(file)), message: lines.join('\n'), items: [{ label: 'OK', icon: 'check' }] });
  }

  // ---------- Input ----------
  function dispatch(action) {
    if (UI.handle(action)) { scheduleHide(); return; }

    // Works the same whether the controls are showing or not
    if (action === 'playpause' || action === 'start') { togglePause(); showOsd(); return; }
    if (action === 'next' || action === 'rb') { next(); return; }
    if (action === 'prev' || action === 'lb') { prev(); return; }
    if (action === 'lt') { seekBy(-skipBig()); return; }
    if (action === 'rt') { seekBy(skipBig()); return; }
    if (action === 'x') { trackMenu('sub'); return; }
    if (action === 'menu') { optionsMenu(); return; }

    if (!osdVisible()) {
      if (action === 'left') { seekBy(-skipBack()); showOsd(seekEl); return; }
      if (action === 'right') { seekBy(skipFwd()); showOsd(seekEl); return; }
      if (action === 'ok') { togglePause(); showOsd(document.querySelector('[data-act="toggle"]')); return; }
      if (action === 'up' || action === 'down') { showOsd(document.querySelector('[data-act="toggle"]')); return; }
      if (action === 'back') { close(); return; }
      return;
    }

    scheduleHide();
    if (action === 'back') { if (isMusic) close(); else hideOsd(); return; }
    if (Nav.current === seekEl && (action === 'left' || action === 'right')) { seekBy(action === 'left' ? -skipBack() : skipFwd()); return; }
    if (action === 'ok') {
      if (Nav.current === seekEl) { if (pendingSeek !== null) { clearTimeout(seekTimer); commitSeek(); } else togglePause(); return; }
      Nav.activate();
      return;
    }
    if (['up', 'down', 'left', 'right'].includes(action)) Nav.move(action);
  }

  async function close() {
    if (closing) return;
    closing = true;
    saveProgress(true);
    player.close();
  }

  // ---------- Mouse ----------
  function bindMouse() {
    Nav.bindMouse(document.body);
    document.addEventListener('mousemove', () => { if (Input.source === 'mouse') showOsd(); });
    document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.act]()));
    seekEl.addEventListener('click', (e) => {
      if (!st.dur) return;
      const r = seekEl.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.dur;
      cmd(['seek', t, 'absolute']);
    });
    document.addEventListener('click', (e) => {
      if (e.target === document.body || e.target.id === 'music' || e.target.closest('.music-inner')) {
        if (osdVisible()) togglePause(); else showOsd();
      }
    });
    document.addEventListener('dblclick', (e) => { if (e.target === document.body) togglePause(); });
  }

  function startClock() {
    const t = () => {
      const now = new Date();
      document.querySelector('.clock-time').textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      document.querySelector('.clock-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    t();
    setInterval(t, 5000);
  }

  async function start() {
    data = await player.init();
    if (!data || !data.list || !data.list.length) return player.close();
    player.audioDevices().then((l) => { soundDevices = l || []; });      // names for Y → Sound output
    document.documentElement.dataset.theme = data.settings.theme || 'oled';
    document.documentElement.style.setProperty('--ui-scale', Number(data.settings.uiScale) || 1);       // Settings → Appearance
    document.documentElement.style.setProperty('--text-scale', Number(data.settings.textScale) || 1);
    document.querySelector('[data-act="prev"]').innerHTML = Icons.prev;
    // The skip buttons show how far they jump
    document.querySelector('[data-act="rew"]').innerHTML = Icons.rewind.replace('>10<', `>${skipBack()}<`);
    document.querySelector('[data-act="fwd"]').innerHTML = Icons.forward.replace('>30<', `>${skipFwd()}<`);
    document.querySelector('[data-act="options"] .pi').innerHTML = Icons.settings;
    document.querySelector('[data-act="rew"]').title = `Back ${skipBack()} s`;
    document.querySelector('[data-act="fwd"]').title = `Forward ${skipFwd()} s`;
    if (S().playerClock === false) document.querySelector('#top .clock').style.display = 'none';
    document.querySelector('[data-act="next"]').innerHTML = Icons.next;
    document.querySelector('[data-act="audio"] .pi').innerHTML = Icons.audio;
    document.querySelector('[data-act="subs"] .pi').innerHTML = Icons.subs;
    document.querySelector('[data-act="list"] .pi').innerHTML = Icons.list;
    $('.cover-icon').innerHTML = Icons.music;
    Nav.setRoot(document.body);
    Input.setHandler(dispatch);
    bindMouse();
    startClock();
    window.addEventListener('beforeunload', () => saveProgress(true));
    applyStartOptions();
    await load(Math.max(0, data.index || 0), { fromStart: !!(data.opts && data.opts.fromStart) });
  }

  start();
})();
