// Renders the link preview card (docs/og.png, 1200x630) from inline SVG.
// Run: npx electron scripts/make-og.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const bubble = 'M512 230c-170 0-300 120-300 270 0 82 39 155 102 205v96l92-50c33 9 69 14 106 14 170 0 300-120 300-265S682 230 512 230z';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#8a3cff"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <g transform="translate(90 135) scale(0.35)">
    <rect x="100" y="100" width="824" height="824" rx="185" fill="#fff" fill-opacity="0.18"/>
    <path d="${bubble}" fill="#fff"/>
    <circle cx="400" cy="500" r="34" fill="#6a63ff"/><circle cx="512" cy="500" r="34" fill="#6a63ff"/><circle cx="624" cy="500" r="34" fill="#6a63ff"/>
  </g>
  <g font-family="-apple-system, BlinkMacSystemFont, Helvetica, sans-serif" fill="#fff">
    <text x="490" y="290" font-size="92" font-weight="700">messageBae</text>
    <text x="494" y="360" font-size="38" fill-opacity="0.9">Facebook Messenger for Mac</text>
    <text x="494" y="420" font-size="30" fill-opacity="0.75">Free · Keyboard first · Apple silicon</text>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 630, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
      c.getContext('2d').drawImage(img, 0, 0);
      res(c.toDataURL('image/png'));
    };
    img.onerror = rej;
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
  })`);
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'og.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('docs/og.png written');
  app.quit();
});
