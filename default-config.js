// First-run config. Tiles whose program isn't on this PC are left out.
const fs = require('fs');
const path = require('path');
const P = require('./paths');

// Apps installed from MediaDeck (Settings → Apps) live in Apps\<name>, next to MediaDeck
const CANDIDATES = [
  { section: 'apps', name: 'Plex', args: '--fullscreen --tv', path: path.join('Apps', 'PlexDeck', 'PlexDeck.exe'), subtitle: 'Movies & TV' },
  { section: 'apps', name: 'Audiobookshelf', path: path.join('Apps', 'Audiobookshelf', 'ABS Desktop App.exe'), subtitle: 'Audiobooks & podcasts' },
];

// (MediaDeck's own mpv in Apps\mpv is found by itself; this is only for one installed elsewhere)
const MPV_CANDIDATES = ['C:\\Program Files\\mpv\\mpv.exe'];

function defaultConfig() {
  let n = 0;
  return {
    version: 1,
    tiles: [
      { id: 'media', section: 'apps', builtin: 'media', name: 'Media Player', subtitle: 'Videos, music & photos from your drives', path: '', args: '', image: '' },
      // the first one found per name
      ...CANDIDATES.filter((t) => fs.existsSync(P.resolve(t.path))).filter((t, i, all) => all.findIndex((x) => x.name === t.name) === i)
        .map((t) => ({ id: `t${++n}`, args: '', image: '', ...t })),
    ],
    favorites: [],
    settings: {
      theme: 'oled',
      uiScale: 1,                // Settings → Appearance → Screen size: everything × this (0.8 … 1.5)
      textScale: 1,              // … → Text size: only text × this (0.9 … 1.5)
      fullscreen: false,
      window: null,
      minimizeOnLaunch: true,
      showAllFiles: false,
      sortBy: 'name',
      hardwareEncode: true,
      mpvGpuApi: 'd3d11',
      recentPosition: 'below',
      mpvPath: MPV_CANDIDATES.find((p) => fs.existsSync(p)) || '',
      vlcPath: fs.existsSync('C:\\Program Files\\VideoLAN\\VLC\\vlc.exe') ? 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe' : '',
      ffmpegPath: '',
      gamesFolder: '',
      audioLang: '',
      audioDevice: 'auto',       // mpv's sound output: 'auto' = Windows' default, else 'wasapi/{id}'
      audioChannels: 'auto',     // 'auto' (Windows' speaker setup) | 'stereo' | '5.1' | '7.1' (= up to; exclusive mode)
      rtxSuperRes: 'on',         // NVIDIA RTX Video Super Resolution for videos smaller than the screen (RTX cards only)
      rtxHdr: 'off',             // NVIDIA RTX Video HDR for SDR videos (RTX cards only) - only when switched on, never with upscaling by itself
      audioPassthrough: 'on',    // 'on' (Dolby / DTS to the receiver; optical: Dolby Digital / DTS) | 'spdif' | 'off'
      subLang: 'eng',
      subtitles: 'auto',
      subSize: 'Normal',
      autoplayNext: true,
      skipBack: 10,
      skipForward: 30,
      skipBig: 60,
      resumeMode: 'ask',
      watchedAt: 92,
      osdHide: 4,
      volume: 100,
      defaultSpeed: 1,
      playerClock: true,
      progressColor: 'orange',       // the seek bar and the cards' bars: red / orange (dark orange) / amber / blue
      rememberSubs: true,
      thumbnails: true,
      folderArt: true,
      keepThumbnails: false,
      continueInFolders: true,       // Continue watching: a row at the top of a folder (its videos stopped part way)
      continueOnHome: false,         // … and/or the row on the Media Player start screen
      usbOnly: false,
      startDs4: false,
      inGameOverlay: false,
      showEmptyConsoles: false,
      groupVersions: true,
      checkEmuUpdates: false,        // emulators: checked from Settings → Emulators when you want, not at every start
      checkAppUpdates: true,
      checkMediaDeckUpdates: true,   // at every start: a new MediaDeck version → a window asks whether to update
      autoCovers: true,
      portableData: true,        // private files readable on any PC (key in data\portable.key); false = this Windows account only
      powerMenuPc: false,        // Exit menu: Sleep / Restart PC / Shut down PC (Settings → General); false = MediaDeck only
      setupDone: false,          // the first-start setup ran (or was skipped); Settings → About runs it again
      gameView: 'big',           // a console's games: 'big' covers, 'small' covers, or a 'list' without covers
      twitchQuality: 'best',
      hideCursor: 10,
      hiddenDrives: [],
      clock24h: true,
    },
  };
}

module.exports = { defaultConfig };
