'use strict';
/**
 * Détection et lancement des applications installées (fichiers .desktop).
 * Le modèle ne fournit jamais de commande : il désigne une application par son nom ou son identifiant,
 * et seules les applications autorisées par l'utilisateur peuvent être lancées.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const DIRS = () => [
  '/usr/share/applications', '/usr/local/share/applications',
  path.join(os.homedir(), '.local/share/applications'),
  '/var/lib/flatpak/exports/share/applications', path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
  '/var/lib/snapd/desktop/applications',
];

/** Applications courantes autorisées par défaut (le reste est à activer dans Confidentialité). */
const DEFAULT_ALLOWED = ['firefox', 'org.mozilla.firefox', 'org.kde.dolphin', 'org.kde.kate', 'org.kde.okular', 'org.kde.gwenview', 'org.kde.ark', 'org.kde.spectacle', 'org.kde.kcalc', 'systemsettings', 'google-chrome', 'chromium', 'thunderbird', 'libreoffice-writer', 'libreoffice-calc', 'libreoffice-impress', 'org.libreoffice.LibreOffice.writer', 'org.libreoffice.LibreOffice.calc', 'org.libreoffice.LibreOffice.impress', 'vlc', 'org.videolan.VLC'];

const lang = () => (process.env.LANG || 'fr_FR').split('.')[0];

function parseDesktop(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const entry = {};
  let inMain = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inMain = line === '[Desktop Entry]'; continue; }
    if (!inMain || !line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) entry[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (entry.Type !== 'Application' || entry.NoDisplay === 'true' || entry.Hidden === 'true' || entry.Terminal === 'true') return null;
  const l = lang();
  const name = entry[`Name[${l}]`] || entry[`Name[${l.split('_')[0]}]`] || entry.Name;
  if (!name || !entry.Exec) return null;
  return {
    id: path.basename(file, '.desktop'), name,
    comment: entry[`Comment[${l.split('_')[0]}]`] || entry.Comment || '',
    exec: entry.Exec, file,
  };
}

let cache = { at: 0, apps: [] };
function listApps({ fresh = false, dirs = DIRS() } = {}) {
  if (!fresh && Date.now() - cache.at < 60000 && cache.apps.length) return cache.apps;
  const byId = new Map();
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.desktop')) continue;
      const app = parseDesktop(path.join(dir, n));
      if (app) byId.set(app.id, app); // les dossiers suivants (utilisateur) prennent le dessus
    }
  }
  cache = { at: Date.now(), apps: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })) };
  return cache.apps;
}

const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Retrouve une application parmi celles autorisées. */
function resolveApp(query, allowedIds, apps = listApps()) {
  const q = norm(query);
  const pool = apps.filter((a) => allowedIds.includes(a.id));
  const exact = pool.filter((a) => norm(a.id) === q || norm(a.name) === q);
  if (exact.length === 1) return { app: exact[0] };
  const partial = pool.filter((a) => norm(a.name).includes(q) || norm(a.id).includes(q));
  if (partial.length === 1) return { app: partial[0] };
  if (partial.length > 1) return { error: 'ambiguous', candidates: partial.map((a) => a.name) };
  const installedNotAllowed = apps.find((a) => norm(a.name).includes(q) || norm(a.id).includes(q));
  if (installedNotAllowed) return { error: 'not_allowed', name: installedNotAllowed.name };
  return { error: 'not_found' };
}

/** Découpe la ligne Exec d'un .desktop en arguments (sans shell), en retirant les codes %f, %u, etc. */
function parseExec(exec) {
  const args = [];
  let cur = '', quote = null, has = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i];
    if (quote) {
      if (c === '\\' && i + 1 < exec.length) cur += exec[++i];
      else if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (/\s/.test(c)) { if (cur || has) args.push(cur); cur = ''; has = false; }
    else cur += c;
  }
  if (cur || has) args.push(cur);
  return args.map((a) => a.replace(/%%/g, '\u0000').replace(/%[a-zA-Z]/g, '').replace(/\u0000/g, '%')).filter((a) => a !== '');
}

function launch(app) {
  return new Promise((resolve, reject) => {
    execFile('gio', ['launch', app.file], { timeout: 10000 }, (err) => {
      if (!err) return resolve({ method: 'gio' });
      if (err.code !== 'ENOENT' && err.killed !== true && typeof err.code === 'number') return reject(new Error('Le système n’a pas pu lancer cette application (code ' + err.code + ').'));
      // Repli : exécution directe de la commande du fichier .desktop, sans shell.
      const [cmd, ...args] = parseExec(app.exec);
      if (!cmd) return reject(new Error('Commande de lancement introuvable pour cette application.'));
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.once('error', (e) => reject(new Error('Impossible de lancer la commande : ' + e.message)));
      child.once('spawn', () => { child.unref(); resolve({ method: 'exec' }); });
    });
  });
}

module.exports = { listApps, resolveApp, launch, parseExec, parseDesktop, DEFAULT_ALLOWED };
