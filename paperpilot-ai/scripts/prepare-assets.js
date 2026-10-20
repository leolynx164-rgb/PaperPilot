#!/usr/bin/env node
/**
 * Prépare les ressources embarquées (polices hors-ligne et icônes).
 * Les fichiers générés sont versionnés : ce script n'est utile que pour les régénérer.
 *   npm run prepare-assets
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'src', 'renderer', ...p);

// ---------- Polices (licence SIL OFL) ----------
const fonts = [
  ['@fontsource-variable/newsreader/files/newsreader-latin-standard-normal.woff2', 'newsreader-normal.woff2'],
  ['@fontsource-variable/newsreader/files/newsreader-latin-standard-italic.woff2', 'newsreader-italic.woff2'],
  ['@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', 'instrument-sans.woff2'],
];
fs.mkdirSync(out('assets', 'fonts'), { recursive: true });
for (const [src, dest] of fonts) fs.copyFileSync(nm(src), out('assets', 'fonts', dest));
fs.copyFileSync(nm('@fontsource-variable/newsreader/LICENSE'), out('assets', 'fonts', 'LICENSE-Newsreader-OFL.txt'));
fs.copyFileSync(nm('@fontsource-variable/instrument-sans/LICENSE'), out('assets', 'fonts', 'LICENSE-InstrumentSans-OFL.txt'));

// ---------- Icônes (Lucide, licence ISC) ----------
const names = [
  'plus', 'x', 'pin', 'pin-off', 'maximize-2', 'settings', 'sliders-horizontal', 'send', 'arrow-up', 'square',
  'copy', 'rotate-cw', 'search', 'folder', 'folder-open', 'file', 'file-text', 'file-image', 'file-spreadsheet',
  'file-audio', 'file-video', 'file-archive', 'file-code', 'presentation', 'external-link', 'check',
  'triangle-alert', 'info', 'message-square', 'history', 'list-checks', 'plug', 'cpu', 'palette', 'shield-check',
  'lock', 'trash-2', 'undo-2', 'chevron-down', 'chevron-right', 'keyboard', 'globe', 'app-window', 'eye',
  'eye-off', 'download', 'minus', 'folder-plus', 'key-round', 'hard-drive', 'circle-alert', 'book-open-text',
  'folder-search', 'notebook-pen', 'wand-sparkles', 'panel-left',
];
const icons = {};
for (const n of names) {
  const svg = fs.readFileSync(nm('lucide-static', 'icons', n + '.svg'), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
  icons[n] = inner;
}
const header = '// Fichier généré par scripts/prepare-assets.js (icônes Lucide, licence ISC). Ne pas modifier à la main.\n';
fs.writeFileSync(out('shared', 'icons-data.js'), header + 'export const ICONS = ' + JSON.stringify(icons, null, 1) + ';\n');
console.log('Polices copiées, ' + names.length + ' icônes générées.');
