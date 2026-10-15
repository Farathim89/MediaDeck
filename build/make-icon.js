// Builds build\icon.ico (16–256 px, PNG entries) and build\icon.png (512 px) from build\icon.svg.
// Run with Electron (it draws the SVG):  npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');

// draws the SVG on a canvas in the page at the given size and returns the PNG
async function render(win, size) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const url = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size});
      res(c.toDataURL('image/png'));
    };
    img.onerror = () => rej(new Error('svg'));
    img.src = ${JSON.stringify(src)};
  })`);
  return Buffer.from(url.split(',')[1], 'base64');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const pngs = [];
  for (const s of SIZES) pngs.push(await render(win, s));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), await render(win, 512));
  // ICO: header, one 16-byte entry per size, then the PNGs
  const head = Buffer.alloc(6 + 16 * SIZES.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let offset = head.length;
  SIZES.forEach((s, i) => {
    const o = 6 + i * 16;
    head[o] = s >= 256 ? 0 : s; head[o + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(pngs[i].length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...pngs]));
  console.log('icon.ico', SIZES.join(','), 'and icon.png written');
  app.quit();
});
