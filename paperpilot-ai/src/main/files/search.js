'use strict';
/**
 * Recherche de fichiers par nom dans les dossiers autorisés.
 *
 * Évolutivité : `search()` est le « moteur par nom ». Pour ajouter plus tard la recherche dans le contenu
 * ou la recherche sémantique, on ajoutera des moteurs de même signature (query, options) → résultats,
 * et l'action `search_files` fusionnera leurs résultats. Rien d'autre n'a besoin de changer.
 */
const fs = require('fs');
const path = require('path');

const KIND_EXT = {
  pdf: ['pdf'],
  word: ['doc', 'docx', 'odt', 'rtf'],
  text: ['txt', 'md', 'markdown', 'rst', 'log', 'tex'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic', 'avif'],
  audio: ['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a', 'opus', 'aac'],
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'],
  archive: ['zip', 'tar', 'gz', 'tgz', 'xz', '7z', 'rar', 'bz2', 'zst'],
  code: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'rb', 'php', 'sh', 'json', 'yml', 'yaml', 'html', 'css'],
};
KIND_EXT.document = [...KIND_EXT.pdf, ...KIND_EXT.word, ...KIND_EXT.text, ...KIND_EXT.spreadsheet, ...KIND_EXT.presentation];
const KINDS = Object.keys(KIND_EXT);

const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'site-packages', '.git', '.cache', '.Trash', 'lost+found']);

const normalize = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const singular = (t) => (t.length > 3 && /[sx]$/.test(t) ? t.slice(0, -1) : t);
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

function kindOf(ext) {
  for (const k of ['pdf', 'word', 'text', 'spreadsheet', 'presentation', 'image', 'audio', 'video', 'archive', 'code']) if (KIND_EXT[k].includes(ext)) return k;
  return 'other';
}

/** Découpe la requête en mots-clés, avec leur forme au singulier. */
function tokenize(query) {
  return normalize(query || '').split(/[\s_\-.,;:'"()«»]+/).filter((t) => t.length > 0).map((t) => [...new Set([t, singular(t)])]);
}

/** Score d'un nom de fichier : 0 si un mot-clé est absent (tous les mots doivent correspondre). */
function scoreName(normName, words, tokens) {
  if (!tokens.length) return 1;
  let score = 0;
  for (const variants of tokens) {
    let best = 0;
    for (const v of variants) {
      if (words.includes(v)) best = Math.max(best, 3);
      else if (words.some((w) => w.startsWith(v))) best = Math.max(best, 2);
      else if (normName.includes(v)) best = Math.max(best, 1);
    }
    if (!best) return 0;
    score += best;
  }
  if (words.length && tokens[0].some((v) => words[0].startsWith(v))) score += 1;
  return score - Math.min(normName.length, 120) / 400;
}

/**
 * @param {object} o
 * @param {string[]} o.roots  dossiers à explorer (déjà validés)
 * @param {string} [o.query]
 * @param {string} [o.kind]   clé de KIND_EXT
 * @param {string[]} [o.exts]
 * @param {number} [o.after] / [o.before]  horodatages ms (date de modification)
 * @param {'relevance'|'recent'|'name'|'size'} [o.sort]
 */
async function search(o) {
  const t0 = Date.now();
  const { roots, query = '', kind, after, before, limit = 25, signal, onProgress, includeHidden = false } = o;
  const maxDepth = o.maxDepth ?? 12;
  const maxScanned = o.maxScanned ?? 400000;
  const budgetMs = o.budgetMs ?? 15000;
  const exts = new Set([...(o.exts || []), ...(kind && KIND_EXT[kind] ? KIND_EXT[kind] : [])].map((e) => e.replace(/^\./, '').toLowerCase()));
  const tokens = tokenize(query);
  const sort = o.sort || (tokens.length ? 'relevance' : 'recent');

  // Retire les racines imbriquées dans une autre pour ne rien compter deux fois.
  const uniq = [...new Set(roots)].sort();
  const top = uniq.filter((r, i) => !uniq.slice(0, i).some((p) => r === p || r.startsWith(p + path.sep)));

  const found = [];
  const unreadable = [];
  let scanned = 0, dirs = 0, unreadableCount = 0, truncated = false, lastProgress = 0;

  const stop = () => {
    if (signal && signal.aborted) return true;
    if (scanned >= maxScanned || Date.now() - t0 > budgetMs) { truncated = true; return true; }
    return false;
  };

  for (const root of top) {
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length && !stop()) {
      const { dir, depth } = stack.pop();
      let handle;
      try {
        handle = await fs.promises.opendir(dir);
        dirs++;
      } catch (e) {
        unreadableCount++;
        if (unreadable.length < 20) unreadable.push({ path: dir, code: e.code || 'ERR' });
        continue;
      }
      try {
        for await (const ent of handle) {
          if (ent.isSymbolicLink()) continue;
          const name = ent.name;
          if (!includeHidden && name.startsWith('.')) continue;
          if (ent.isDirectory()) {
            if (depth < maxDepth && !SKIP_DIRS.has(name)) stack.push({ dir: path.join(dir, name), depth: depth + 1 });
            continue;
          }
          if (!ent.isFile()) continue;
          scanned++;
          const ext = extOf(name);
          if (exts.size && !exts.has(ext)) continue;
          const norm = normalize(name.slice(0, ext ? -(ext.length + 1) : undefined));
          const words = norm.split(/[\s_\-.,;:'"()]+/).filter(Boolean);
          let score = scoreName(norm, words, tokens);
          if (!score && tokens.length && tokens.some((t) => t.includes(ext))) score = 0.5; // « pdf » dans la requête
          if (!score) continue;
          found.push({ name, path: path.join(dir, name), dir, ext, score });
          if (scanned % 400 === 0) {
            if (stop()) break;
            if (onProgress && Date.now() - lastProgress > 150) { lastProgress = Date.now(); onProgress({ scanned, matches: found.length }); }
          }
        }
      } catch (e) {
        unreadableCount++;
        if (unreadable.length < 20) unreadable.push({ path: dir, code: e.code || 'ERR' });
      }
    }
    if (stop()) break;
  }

  // Les dates et tailles ne sont lues que pour les correspondances.
  const stats = [];
  for (const f of found.slice(0, 20000)) {
    try {
      const st = await fs.promises.stat(f.path);
      if (after && st.mtimeMs < after) continue;
      if (before && st.mtimeMs > before) continue;
      stats.push({ ...f, size: st.size, mtime: st.mtimeMs, kind: kindOf(f.ext) });
    } catch (e) {
      unreadableCount++;
      if (unreadable.length < 20) unreadable.push({ path: f.path, code: e.code || 'ERR' });
    }
  }
  const cmp = {
    relevance: (a, b) => b.score - a.score || b.mtime - a.mtime,
    recent: (a, b) => b.mtime - a.mtime,
    name: (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }),
    size: (a, b) => b.size - a.size,
  }[sort] || ((a, b) => b.score - a.score);
  stats.sort(cmp);

  return {
    results: stats.slice(0, limit).map(({ score, ...r }) => r),
    total: stats.length,
    scanned, dirs, unreadableCount, unreadable, truncated,
    cancelled: !!(signal && signal.aborted),
    elapsedMs: Date.now() - t0,
  };
}

module.exports = { search, tokenize, scoreName, normalize, kindOf, KIND_EXT, KINDS };
