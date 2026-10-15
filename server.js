// Local media server: serves files, thumbnails, media info, subtitles and
// ffmpeg-converted streams to the renderer. Listens on 127.0.0.1 only and
// requires a random token on every request.
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const EXT = {
  video: ['.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.vob', '.ogv', '.3gp', '.divx', '.rmvb', '.asf'],
  audio: ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.wma', '.alac', '.ape', '.mka', '.ac3', '.dts', '.aiff', '.m4b'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.jfif'],
  sub: ['.srt', '.vtt', '.ass', '.ssa', '.sub'],
};

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

// What Chromium can play natively
const DIRECT_CONTAINERS = ['.mp4', '.m4v', '.mov', '.webm'];
const DIRECT_AUDIO_FILES = ['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus'];
const OK_VCODECS = ['h264', 'hevc', 'av1', 'vp8', 'vp9'];
const OK_ACODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
const COPY_ACODECS = ['aac', 'mp3', 'opus'];
const BITMAP_SUBS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'];
const PIX_8BIT = ['yuv420p', 'yuvj420p'];
const ART_NAMES = ['poster', 'folder', 'cover', 'show', 'season', 'fanart', 'front', 'album'];

const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  for (const k of Object.keys(EXT)) if (EXT[k].includes(ext)) return k;
  return 'other';
}

// Runs a program and returns its output as raw bytes (images, subtitles)
function runBuffer(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 60000 }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); reject(err); } else resolve(stdout);
    });
  });
}

// Encrypted cache files: [12-byte IV][16-byte tag][data], AES-256-GCM.
// File names are HMACs, so a name can't be matched to a guessed file path.
class Vault {
  constructor(key) { this.key = key; }
  name(text) { return crypto.createHmac('sha256', this.key).update(text).digest('hex').slice(0, 40); }
  seal(buf) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }
  open(buf) {
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  }
  async write(file, buf) {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, this.seal(buf));
    await fsp.rename(tmp, file);
  }
  async read(file) { return this.open(await fsp.readFile(file)); }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 60000 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve(stdout);
    });
  });
}

class Limiter {
  constructor(max) { this.max = max; this.active = 0; this.queue = []; }
  run(fn, isCancelled) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, isCancelled, resolve, reject });
      this.next();
    });
  }
  next() {
    while (this.active < this.max && this.queue.length) {
      const job = this.queue.shift();
      if (job.isCancelled && job.isCancelled()) { job.reject(new Error('cancelled')); continue; }
      this.active++;
      job.fn().then(job.resolve, job.reject).finally(() => { this.active--; this.next(); });
    }
  }
}

class MediaServer {
  constructor({ dataDir, getSettings, cacheKey }) {
    this.dataDir = dataDir;
    this.vault = new Vault(cacheKey);
    this.failed = new Set();   // thumbnails that couldn't be made (kept in memory only)
    this.thumbDir = path.join(dataDir, 'cache', 'thumbs');
    this.subDir = path.join(dataDir, 'cache', 'subs');
    this.coverDir = path.join(dataDir, 'covers');   // downloaded game covers (encrypted, kept)
    this.getSettings = getSettings;
    this.token = crypto.randomBytes(16).toString('hex');
    this.probeCache = new Map();
    this.artCache = new Map();
    this.sessions = new Map();
    this.thumbs = new Limiter(3);
    this.inflight = new Map();
    this.streams = new Set();
    this.ffmpeg = null;
    this.ffprobe = null;
    this.nvenc = false;
  }

  async start() {
    fs.mkdirSync(this.thumbDir, { recursive: true });
    fs.mkdirSync(this.subDir, { recursive: true });
    fs.mkdirSync(this.coverDir, { recursive: true });
    this.removePlainCache();
    await this.findTools();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => this.fail(res, e)));
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    return this.port;
  }

  stop() {
    for (const p of this.streams) try { p.kill('SIGKILL'); } catch {}
    if (this.server) this.server.close();
  }

  async findTools() {
    const s = this.getSettings();
    const set = require('./paths').resolve(s.ffmpegPath);
    let ff = set && fs.existsSync(set) ? set : null;
    // the bundled one (Apps\ffmpeg\bin), else one on the PATH
    const bundled = path.join(require('./paths').APPS, 'ffmpeg', 'bin', 'ffmpeg.exe');
    if (!ff && fs.existsSync(bundled)) ff = bundled;
    if (!ff) {
      try { ff = (await run('where', ['ffmpeg'])).split(/\r?\n/).map((l) => l.trim()).find((l) => l.toLowerCase().endsWith('.exe')); } catch {}
    }
    if (!ff) return;
    this.ffmpeg = ff;
    const probe = path.join(path.dirname(ff), 'ffprobe.exe');
    this.ffprobe = fs.existsSync(probe) ? probe : null;
    try {
      await run(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x144', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { timeout: 15000 });
      this.nvenc = true;
    } catch { this.nvenc = false; }
  }

  status() {
    return { port: this.port, token: this.token, ffmpeg: !!this.ffmpeg, ffprobe: !!this.ffprobe, nvenc: this.nvenc };
  }

  // ---------- HTTP ----------
  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.searchParams.get('k') !== this.token) { res.writeHead(403); return res.end(); }
    const p = url.searchParams.get('p');
    switch (url.pathname) {
      case '/file': return this.serveFile(req, res, p);
      case '/thumb': return this.serveThumb(req, res, p, +url.searchParams.get('w') || 480);
      case '/art': return this.serveArt(req, res, p, +url.searchParams.get('w') || 480);
      case '/info': return this.json(res, await this.info(p));
      case '/prepare': return this.json(res, await this.prepare(p, url.searchParams));
      case '/stream': return this.serveStream(req, res, url.searchParams.get('id'));
      case '/subs': return this.serveSubs(req, res, p, url.searchParams);
      case '/cover': return this.serveCover(res, p);
      default: res.writeHead(404); res.end();
    }
  }

  json(res, obj) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  fail(res, e) {
    if (res.headersSent) { try { res.destroy(); } catch {} return; }
    const code = e && e.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }

  async serveFile(req, res, p) {
    const st = await fsp.stat(p);
    const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (!range[1] && range[2]) { start = st.size - parseInt(range[2], 10); end = st.size - 1; }
      if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'no-store',
      });
      fs.createReadStream(p, { start, end }).on('error', () => res.destroy()).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
    }
  }

  // Old, unencrypted cache files (from before the cache was encrypted)
  removePlainCache() {
    for (const dir of [this.thumbDir, this.subDir]) {
      for (const n of fs.readdirSync(dir)) {
        if (!n.endsWith('.enc')) { try { fs.rmSync(path.join(dir, n), { force: true }); } catch {} }
      }
    }
  }

  // Deletes the thumbnail and subtitle cache (on exit, or from Settings)
  clearCache() {
    for (const dir of [this.thumbDir, this.subDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(dir, { recursive: true });
    }
    this.failed.clear();
  }

  // ---------- Thumbnails ----------
  async thumbFile(p, w, isCancelled) {
    if (!this.ffmpeg) throw new Error('ffmpeg not found');
    const st = await fsp.stat(p);
    const key = this.vault.name(`${p}|${st.size}|${st.mtimeMs}|${w}`);
    const out = path.join(this.thumbDir, key + '.enc');
    if (fs.existsSync(out)) return this.vault.read(out);
    if (this.failed.has(key)) throw new Error('no thumbnail');
    if (this.inflight.has(key)) return this.inflight.get(key);

    const job = this.thumbs.run(async () => {
      const kind = kindOf(p);
      const scale = `scale='min(${w},iw)':-2`;
      let args;
      if (kind === 'video') {
        let ss = 10, vf = scale;
        const info = await this.info(p).catch(() => null);
        if (info && info.duration) ss = Math.min(info.duration * 0.15, 600);
        if (info && info.video && info.video.hdr) vf = `${TONEMAP},${scale}`;
        args = ['-ss', ss.toFixed(2), '-i', p, '-map', '0:v:0', '-frames:v', '1', '-vf', vf, '-q:v', '4'];
      } else if (kind === 'audio') {
        args = ['-i', p, '-an', '-map', '0:v:0', '-frames:v', '1', '-vf', scale, '-q:v', '3'];
      } else {
        args = ['-i', p, '-frames:v', '1', '-vf', scale, '-q:v', '3'];
      }
      try {
        // The picture comes back in memory and is only written encrypted
        const jpg = await runBuffer(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, '-f', 'mjpeg', 'pipe:1'], { timeout: 45000 });
        if (!jpg.length) throw new Error('no output');
        await this.vault.write(out, jpg);
        return jpg;
      } catch (e) {
        this.failed.add(key);
        throw e;
      }
    }, isCancelled);
    this.inflight.set(key, job);
    job.finally(() => this.inflight.delete(key)).catch(() => {});
    return job;
  }

  async serveThumb(req, res, p, w) {
    let closed = false;
    res.on('close', () => { closed = true; });
    try {
      const jpg = await this.thumbFile(p, w, () => closed);
      if (!closed) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': jpg.length });
        res.end(jpg);
      }
    } catch {
      if (!closed) { res.writeHead(404); res.end(); }
    }
  }

  // A folder's picture: poster.jpg / folder.jpg / cover.jpg …, otherwise the
  // biggest video inside it (a film folder shows a frame from its film).
  async findArt(dir) {
    if (this.artCache.has(dir)) return this.artCache.get(dir);
    let found = null;
    try {
      const names = await fsp.readdir(dir);
      const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
      outer: for (const base of ART_NAMES) {
        for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
          if (lower.has(base + ext)) { found = path.join(dir, lower.get(base + ext)); break outer; }
        }
      }
      if (!found) {
        const videos = names.filter((n) => EXT.video.includes(path.extname(n).toLowerCase()) && !/sample|trailer/i.test(n));
        let best = 0;
        for (const n of videos.slice(0, 40)) {
          try {
            const st = await fsp.stat(path.join(dir, n));
            if (st.size > best) { best = st.size; found = path.join(dir, n); }
          } catch {}
        }
      }
    } catch {}
    this.artCache.set(dir, found);
    return found;
  }

  async serveArt(req, res, dir, w) {
    const art = await this.findArt(dir);
    if (!art) { res.writeHead(404); return res.end(); }
    return this.serveThumb(req, res, art, w);
  }

  // ---------- Media info ----------
  async probe(p) {
    if (!this.ffprobe) throw new Error('ffprobe not found');
    const st = await fsp.stat(p);
    const key = `${p}|${st.mtimeMs}`;
    if (this.probeCache.has(key)) return this.probeCache.get(key);
    const out = await run(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p], { timeout: 30000 });
    const data = JSON.parse(out);
    this.probeCache.set(key, data);
    return data;
  }

  async externalSubs(p) {
    const dir = path.dirname(p);
    const base = path.basename(p, path.extname(p)).toLowerCase();
    try {
      const names = await fsp.readdir(dir);
      return names
        .filter((n) => EXT.sub.includes(path.extname(n).toLowerCase()) && n.toLowerCase().startsWith(base))
        .map((n) => {
          const mid = n.slice(base.length, -path.extname(n).length).replace(/^[._ -]+/, '');
          return { file: path.join(dir, n), lang: mid || '', title: mid || 'External', codec: path.extname(n).slice(1) };
        });
    } catch { return []; }
  }

  async info(p) {
    const data = await this.probe(p);
    const streams = data.streams || [];
    const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const tag = (s, k) => (s.tags && (s.tags[k] || s.tags[k.toUpperCase()])) || '';
    const audios = streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({
      index: i, codec: s.codec_name, channels: s.channels, lang: tag(s, 'language'), title: tag(s, 'title'),
      default: !!(s.disposition && s.disposition.default),
    }));
    const subs = streams.filter((s) => s.codec_type === 'subtitle').map((s, i) => ({
      index: i, codec: s.codec_name, lang: tag(s, 'language'), title: tag(s, 'title'),
      bitmap: BITMAP_SUBS.includes(s.codec_name),
      default: !!(s.disposition && s.disposition.default), forced: !!(s.disposition && s.disposition.forced),
    }));
    return {
      path: p,
      kind: kindOf(p),
      duration: parseFloat(data.format && data.format.duration) || 0,
      startTime: parseFloat(data.format && data.format.start_time) || 0,
      title: tag(data.format || {}, 'title'),
      artist: tag(data.format || {}, 'artist'),
      album: tag(data.format || {}, 'album'),
      video: v ? {
        codec: v.codec_name, width: v.width, height: v.height, pixFmt: v.pix_fmt,
        hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
      } : null,
      audios, subs,
      externalSubs: await this.externalSubs(p),
    };
  }

  // ---------- Playback ----------
  // force: 0 = auto, 1 = stream (copy allowed), 2 = stream (always re-encode video)
  async prepare(p, q) {
    const t = Math.max(0, parseFloat(q.get('t')) || 0);
    const audio = parseInt(q.get('a') || '-1', 10);
    const burn = parseInt(q.get('b') || '-1', 10);
    const force = parseInt(q.get('force') || '0', 10);
    const info = await this.info(p);
    const ext = path.extname(p).toLowerCase();
    const defAudio = Math.max(0, info.audios.findIndex((a) => a.default));
    const aIdx = audio >= 0 && audio < info.audios.length ? audio : defAudio;
    const a = info.audios[aIdx];
    const v = info.video;

    if (force === 0 && burn < 0) {
      const audioOk = !a || OK_ACODECS.includes(a.codec);
      const sameTrack = aIdx === 0 || info.audios.length <= 1;
      if (info.kind === 'audio' && DIRECT_AUDIO_FILES.includes(ext)) return this.directPlan(p, info);
      if (info.kind === 'video' && DIRECT_CONTAINERS.includes(ext) && audioOk && sameTrack &&
          (!v || (OK_VCODECS.includes(v.codec) && (v.codec !== 'h264' || PIX_8BIT.includes(v.pixFmt))))) {
        return this.directPlan(p, info);
      }
    }
    if (!this.ffmpeg) throw new Error('This file needs ffmpeg to play, and ffmpeg was not found.');

    const audioOnly = info.kind === 'audio' || !v;
    const copyVideo = !audioOnly && force < 2 && burn < 0 &&
      ['h264', 'hevc', 'av1'].includes(v.codec) && (v.codec !== 'h264' || PIX_8BIT.includes(v.pixFmt));

    let ss = t;
    if (copyVideo && t > 0) ss = await this.keyframeBefore(p, t, info.startTime);

    const args = ['-hide_banner', '-loglevel', 'error'];
    if (ss > 0) args.push('-ss', ss.toFixed(3));
    args.push('-i', p);

    if (audioOnly) {
      args.push('-map', `0:a:${aIdx}`, '-vn');
    } else if (burn >= 0) {
      const base = v.hdr ? `[0:v:0]${TONEMAP}[base]` : '[0:v:0]null[base]';
      args.push('-filter_complex', `${base};[base][0:s:${burn}]overlay=(W-w)/2:H-h,format=yuv420p[v]`, '-map', '[v]');
    } else {
      args.push('-map', '0:v:0');
      if (!copyVideo) args.push('-vf', v.hdr ? TONEMAP : 'format=yuv420p');
    }
    if (!audioOnly && a) args.push('-map', `0:a:${aIdx}`);

    if (!audioOnly) {
      if (copyVideo) {
        args.push('-c:v', 'copy');
        if (v.codec === 'hevc') args.push('-tag:v', 'hvc1');
      } else if (this.nvenc && this.getSettings().hardwareEncode !== false) {
        args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-g', '60');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '60');
      }
    }
    if (a) {
      if (COPY_ACODECS.includes(a.codec) && !audioOnly) args.push('-c:a', 'copy');
      else args.push('-c:a', 'aac', '-ac', '2', '-b:a', '256k');
    }
    args.push('-sn', '-dn', '-map_chapters', '-1', '-max_muxing_queue_size', '4096',
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');

    const id = crypto.randomBytes(8).toString('hex');
    this.sessions.set(id, { args, audioOnly });
    if (this.sessions.size > 30) this.sessions.delete(this.sessions.keys().next().value);
    return {
      mode: copyVideo ? 'copy' : (audioOnly ? 'audio' : 'transcode'),
      url: `/stream?id=${id}`, offset: ss, duration: info.duration, audio: aIdx, burn,
    };
  }

  directPlan(p, info) {
    return { mode: 'direct', url: `/file?p=${encodeURIComponent(p)}`, offset: 0, duration: info.duration, audio: 0, burn: -1 };
  }

  // Exact time of the last video keyframe at or before t, so a copied stream's
  // first frame lines up with the time we report.
  async keyframeBefore(p, t, startTime) {
    if (!this.ffprobe) return t;
    const abs = t + startTime;
    try {
      const out = await run(this.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags',
        '-of', 'csv=p=0', '-read_intervals', `${Math.max(0, abs - 20).toFixed(3)}%${(abs + 0.5).toFixed(3)}`, p], { timeout: 20000 });
      let best = null;
      for (const line of out.split(/\r?\n/)) {
        const [pts, flags] = line.split(',');
        const time = parseFloat(pts);
        if (flags && flags.includes('K') && !isNaN(time) && time <= abs + 0.01 && (best === null || time > best)) best = time;
      }
      if (best === null) return t;
      return Math.max(0, best - startTime + 0.001);
    } catch { return t; }
  }

  serveStream(req, res, id) {
    const s = this.sessions.get(id);
    if (!s) { res.writeHead(404); return res.end(); }
    const proc = spawn(this.ffmpeg, s.args, { windowsHide: true });
    this.streams.add(proc);
    let err = '';
    proc.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    proc.on('exit', (code) => {
      this.streams.delete(proc);
      if (code && err) console.error('[ffmpeg]', err.trim());
    });
    res.writeHead(200, { 'Content-Type': s.audioOnly ? 'audio/mp4' : 'video/mp4', 'Cache-Control': 'no-store' });
    proc.stdout.pipe(res);
    res.on('close', () => { try { proc.kill('SIGKILL'); } catch {} });
  }

  // ---------- Game covers (downloaded, stored encrypted) ----------
  coverFile(rom) { return path.join(this.coverDir, this.vault.name('cover|' + rom.toLowerCase()) + '.enc'); }
  hasCover(rom) { return fs.existsSync(this.coverFile(rom)); }
  saveCover(rom, buf) { return this.vault.write(this.coverFile(rom), buf); }

  async serveCover(res, rom) {
    const file = this.coverFile(rom || '');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const img = await this.vault.read(file);
    // libretro covers are PNG, GameTDB's (PS3) JPEG
    const type = img[0] === 0xff && img[1] === 0xd8 ? 'image/jpeg' : 'image/png';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': img.length });
    res.end(img);
  }

  // ---------- Subtitles (converted to WebVTT, cached on disk) ----------
  async serveSubs(req, res, p, q) {
    const ext = q.get('x');
    const idx = parseInt(q.get('s') || '0', 10);
    const src = ext || p;
    const st = await fsp.stat(src);
    const key = this.vault.name(`${src}|${st.mtimeMs}|${ext ? 'x' : idx}`);
    const out = path.join(this.subDir, key + '.enc');
    let vtt;
    if (fs.existsSync(out)) {
      vtt = await this.vault.read(out);
    } else {
      if (!this.ffmpeg) throw new Error('ffmpeg not found');
      const args = ['-hide_banner', '-loglevel', 'error', '-i', src];
      if (!ext) args.push('-map', `0:s:${idx}`);
      args.push('-vn', '-an', '-f', 'webvtt', 'pipe:1');
      vtt = await runBuffer(this.ffmpeg, args, { timeout: 180000 });
      await this.vault.write(out, vtt);
    }
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': vtt.length });
    res.end(vtt);
  }
}

module.exports = { MediaServer, kindOf, EXT };
