'use strict';
const fs = require('fs');
const path = require('path');

/** Lecture JSON tolérante : renvoie `fallback` si le fichier est absent ou corrompu (et le met de côté). */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { fs.renameSync(file, file + '.corrompu-' + Date.now()); } catch { /* ignoré */ }
    }
    return fallback;
  }
}

/** Écriture atomique (fichier temporaire puis renommage), lisible uniquement par l'utilisateur. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson };
