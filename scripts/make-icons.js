// Génère les icônes PNG à partir de build/icon.svg avec Electron (aucun outil externe requis).
//   xvfb-run -a npx electron scripts/make-icons.js --no-sandbox
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build', 'icons');
  fs.mkdirSync(out, { recursive: true });
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) fs.writeFileSync(path.join(out, `${s}x${s}.png`), img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  fs.copyFileSync(path.join(out, '512x512.png'), path.join(__dirname, '..', 'build', 'icon.png'));
  console.log('Icônes générées.');
  app.quit();
});
