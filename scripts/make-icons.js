// Renders the app icon + tray icon from inline SVG using Electron.
// Run: npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const bubble = 'M512 230c-170 0-300 120-300 270 0 82 39 155 102 205v96l92-50c33 9 69 14 106 14 170 0 300-120 300-265S682 230 512 230z';

const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#8a3cff"/></linearGradient></defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#g)"/>
  <path d="${bubble}" fill="#fff"/>
  <circle cx="400" cy="500" r="34" fill="#6a63ff"/><circle cx="512" cy="500" r="34" fill="#6a63ff"/><circle cx="624" cy="500" r="34" fill="#6a63ff"/>
</svg>`;

const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="150 170 724 724">
  <path d="${bubble}" fill="#000"/>
</svg>`;

// One window renders every SVG to canvas (repeat page loads fail in Electron here).
let win;
async function render(svg, size, out) {
  if (!win) {
    win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('about:blank');
  }
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
      res(c.toDataURL('image/png'));
    };
    img.onerror = rej;
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
  })`);
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

app.whenReady().then(async () => {
  const master = path.join(root, 'build', 'icon-1024.png');
  await render(appSvg, 1024, master);
  // Render tray large, then downscale (tiny offscreen windows fail to load).
  const trayMaster = path.join(root, 'build', 'tray-1024.png');
  await render(traySvg, 1024, trayMaster);
  execSync(`sips -z 16 16 "${trayMaster}" --out "${path.join(root, 'assets', 'trayTemplate.png')}"`, { stdio: 'ignore' });
  execSync(`sips -z 32 32 "${trayMaster}" --out "${path.join(root, 'assets', 'trayTemplate@2x.png')}"`, { stdio: 'ignore' });
  fs.rmSync(trayMaster);

  const set = path.join(root, 'build', 'icon.iconset');
  fs.mkdirSync(set, { recursive: true });
  for (const s of [16, 32, 128, 256, 512]) {
    execSync(`sips -z ${s} ${s} "${master}" --out "${set}/icon_${s}x${s}.png"`, { stdio: 'ignore' });
    execSync(`sips -z ${s * 2} ${s * 2} "${master}" --out "${set}/icon_${s}x${s}@2x.png"`, { stdio: 'ignore' });
  }
  execSync(`iconutil -c icns "${set}" -o "${path.join(root, 'build', 'icon.icns')}"`);
  fs.rmSync(set, { recursive: true });
  console.log('icons written');
  app.quit();
});
