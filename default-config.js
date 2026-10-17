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
      rememberSubs: true,
      thumbnails: true,
      folderArt: true,
      keepThumbnails: false,
      usbOnly: false,
      startDs4: false,
      inGameOverlay: false,
      showEmptyConsoles: false,
      groupVersions: true,
      checkEmuUpdates: true,
      checkAppUpdates: true,
      checkMediaDeckUpdates: true,   // at every start: a new MediaDeck version → a window asks whether to update
      autoCovers: true,
      portableData: true,        // private files readable on any PC (key in data\portable.key); false = this Windows account only
      powerMenuPc: true,         // Exit menu: Sleep / Restart PC / Shut down PC (Settings → General); false = MediaDeck only
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
