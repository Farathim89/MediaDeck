// The media player's own defaults (every video): MediaDeck's Settings → Media Player → Playback / Subtitles & audio
// and the player's Y → Options → Player settings both use this list, so the two never differ.
// Row types as in settings.js: choice (options), toggle, text.
const PlayerSettings = (() => {
  // How far a video is played: the player's seek bar and the bars on the cards (CSS --progress)
  const COLORS = { red: { name: 'Red', hex: '#e53935' }, orange: { name: 'Dark orange', hex: '#e8710a' },
    amber: { name: 'Amber', hex: '#e5a00d' }, blue: { name: 'Blue', hex: '#2f7cf6' } };
  const applyColor = (v) => document.documentElement.style.setProperty('--progress', (COLORS[v] || COLORS.orange).hex);

  const secs = (list) => list.map((v) => ({ value: v, label: v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? '' : 's'}` }));

  const SECTIONS = [
    {
      id: 'playback', title: 'Playback', icon: 'play', desc: 'Skipping, resuming and the player controls',
      items: [
        { label: 'Skip back (left arrow)', type: 'choice', key: 'skipBack', options: () => secs([5, 10, 15, 30]) },
        { label: 'Skip forward (right arrow)', type: 'choice', key: 'skipForward', options: () => secs([10, 15, 30, 60]) },
        { label: 'Big skip (LT / RT)', desc: 'The triggers on the controller', type: 'choice', key: 'skipBig', options: () => secs([30, 60, 120, 300, 600]) },
        { label: 'When a video was started before', type: 'choice', key: 'resumeMode', options: () => [
          { value: 'ask', label: 'Ask' }, { value: 'resume', label: 'Always resume' }, { value: 'start', label: 'Always start over' }] },
        { label: 'Play the next file automatically', type: 'toggle', key: 'autoplayNext' },
        { label: 'Count as watched at', desc: 'How far into a video it is marked as watched', type: 'choice', key: 'watchedAt', options: () =>
          [85, 90, 92, 95, 98].map((v) => ({ value: v, label: `${v}%` })) },
        { label: 'Hide the controls after', type: 'choice', key: 'osdHide', options: () => [
          ...[3, 4, 6, 10].map((v) => ({ value: v, label: `${v} seconds` })), { value: 'never', label: 'Never' }] },
        { label: 'Start volume', type: 'choice', key: 'volume', options: () => [100, 90, 80, 70, 60, 50].map((v) => ({ value: v, label: `${v}%` })) },
        { label: 'Start speed', type: 'choice', key: 'defaultSpeed', options: () =>
          [0.75, 1, 1.25, 1.5].map((v) => ({ value: v, label: v === 1 ? 'Normal' : `${v}×` })) },
        { label: 'Clock in the player', type: 'toggle', key: 'playerClock' },
        { label: 'Progress bar colour', desc: 'The seek bar in the player, and how far you got on the cards', type: 'choice', key: 'progressColor',
          options: () => Object.entries(COLORS).map(([value, c]) => ({ value, label: c.name })), preview: applyColor, after: applyColor },
      ],
    },
    {
      id: 'subs', title: 'Subtitles & audio', icon: 'subs', desc: 'Which languages and how subtitles look',
      items: [
        { label: 'Audio language', desc: 'Language codes in order, e.g. jpn,eng (empty = the file\'s default)', type: 'text', key: 'audioLang' },
        { label: 'Subtitle language', desc: 'Language codes in order, e.g. eng,swe', type: 'text', key: 'subLang' },
        { label: 'Subtitles', type: 'choice', key: 'subtitles', options: () => [
          { value: 'auto', label: 'Automatic' }, { value: 'off', label: 'Off' }] },
        { label: 'Subtitle size', type: 'choice', key: 'subSize', options: () => ['Small', 'Normal', 'Large', 'Huge'].map((v) => ({ value: v, label: v })) },
        { label: 'Remember my subtitle choice', desc: 'Keeps the language you pick for the next files', type: 'toggle', key: 'rememberSubs' },
      ],
    },
  ];

  // every key here may be saved from the player (mpv.js checks against this list too, via the preload)
  const KEYS = SECTIONS.flatMap((s) => s.items.map((i) => i.key));
  // the value as shown in a list ("10 seconds", "On" …)
  function valueLabel(item, v) {
    if (item.type === 'toggle') return v !== false && v ? 'On' : 'Off';
    if (item.type === 'text') return v || 'Not set';
    const o = item.options().find((x) => x.value === v);
    return o ? o.label : String(v ?? '');
  }
  // a value the player may save for this key (the main process checks with it)
  function valid(key, v) {
    const item = SECTIONS.flatMap((s) => s.items).find((i) => i.key === key);
    if (!item) return false;
    if (item.type === 'toggle') return typeof v === 'boolean';
    if (item.type === 'text') return typeof v === 'string' && v.length < 200;
    return item.options().some((o) => o.value === v);
  }
  return { SECTIONS, KEYS, COLORS, applyColor, valueLabel, valid };
})();
if (typeof module !== 'undefined') module.exports = PlayerSettings;     // (main.js / mpv.js: the same list)
