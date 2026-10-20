'use strict';
const fs = require('fs');
const path = require('path');

/** Erreur d'action avec un message déjà rédigé pour l'utilisateur. */
class ActionError extends Error {
  constructor(code, message) { super(message); this.name = 'ActionError'; this.code = code; }
}

const inside = (child, root) => child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Gestion des chemins : tout accès passe par `assertAllowed`, qui suit les liens symboliques. */
function paths({ getSettings, getPath, homedir }) {
  function expand(p) {
    const s = String(p).trim();
    if (s.includes('\u0000')) throw new ActionError('bad_path', 'Chemin invalide.');
    if (s === '~') return homedir;
    if (s.startsWith('~/')) return path.join(homedir, s.slice(2));
    if (!path.isAbsolute(s)) throw new ActionError('bad_path', `« ${s.slice(0, 80)} » n’est pas un chemin absolu. Utilisez le chemin exact d’un résultat de recherche.`);
    return path.normalize(s);
  }

  /** Chemin réel (liens symboliques résolus) du fichier ou, s'il n'existe pas encore, de son plus proche parent existant. */
  async function realOrParent(abs) {
    let cur = abs;
    const rest = [];
    for (;;) {
      try {
        const real = await fs.promises.realpath(cur);
        return { real: path.join(real, ...rest), exists: rest.length === 0 };
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw new ActionError('inaccessible', `Accès impossible à « ${path.basename(abs)} » (${e.code}).`);
        const parent = path.dirname(cur);
        if (parent === cur) return { real: abs, exists: false };
        rest.unshift(path.basename(cur));
        cur = parent;
      }
    }
  }

  async function allowedRoots() {
    const roots = [];
    for (const f of getSettings().allowedFolders) {
      try {
        const real = await fs.promises.realpath(f);
        if ((await fs.promises.stat(real)).isDirectory() && !roots.includes(real)) roots.push(real);
      } catch { /* dossier supprimé ou inaccessible : ignoré */ }
    }
    return roots;
  }

  async function assertAllowed(p, { mustExist = false } = {}) {
    const { real, exists } = await realOrParent(expand(p));
    if (mustExist && !exists) throw new ActionError('not_found', `Introuvable : « ${path.basename(String(p))} ». Utilisez le chemin exact d’un résultat de recherche.`);
    const roots = await allowedRoots();
    if (!roots.some((r) => inside(real, r))) {
      throw new ActionError('not_allowed', `« ${path.basename(real) || real} » se trouve hors des dossiers autorisés. L’utilisateur peut ajouter ce dossier dans Confidentialité.`);
    }
    return real;
  }

  async function isRootOrHome(real) {
    return real === homedir || real === path.parse(real).root || (await allowedRoots()).includes(real);
  }

  return { expand, realOrParent, allowedRoots, assertAllowed, isRootOrHome, homedir, inside };
}

module.exports = { ActionError, paths, inside };
