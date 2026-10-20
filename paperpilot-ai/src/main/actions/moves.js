'use strict';
/** Planification, exécution et annulation des déplacements de fichiers. Rien n'est jamais écrasé ni supprimé. */
const fs = require('fs');
const path = require('path');
const { ActionError } = require('./paths');

const CATEGORIES = {
  Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic', 'avif'],
  Documents: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md'],
  Tableurs: ['xls', 'xlsx', 'ods', 'csv', 'tsv'],
  'Présentations': ['ppt', 'pptx', 'odp', 'key'],
  Audio: ['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a', 'opus', 'aac'],
  'Vidéos': ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'],
  Archives: ['zip', 'tar', 'gz', 'tgz', 'xz', '7z', 'rar', 'bz2', 'zst'],
  Installateurs: ['deb', 'rpm', 'appimage'],
};
const CAT_BY_EXT = new Map();
for (const [cat, exts] of Object.entries(CATEGORIES)) for (const e of exts) CAT_BY_EXT.set(e, cat);

const MAX_MOVES = 1000;
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Nom libre : « fichier (1).pdf » si le nom existe déjà ou est déjà prévu. */
function uniqueTarget(target, taken) {
  if (!exists(target) && !taken.has(target)) { taken.add(target); return target; }
  const { dir, name, ext } = path.parse(target);
  for (let i = 1; i < 1000; i++) {
    const t = path.join(dir, `${name} (${i})${ext}`);
    if (!exists(t) && !taken.has(t)) { taken.add(t); return t; }
  }
  throw new ActionError('conflict', `Impossible de trouver un nom libre pour « ${path.basename(target)} ».`);
}

async function planOrganize(dir, strategy) {
  const ents = await fs.promises.readdir(dir, { withFileTypes: true });
  const moves = [];
  const skipped = { unknown: 0, hidden: 0, folders: 0, blocked: 0 };
  const taken = new Set();
  const blockedCats = new Set();
  for (const e of ents) {
    if (e.name.startsWith('.')) { skipped.hidden++; continue; }
    if (!e.isFile()) { skipped.folders++; continue; }
    const from = path.join(dir, e.name);
    let cat;
    if (strategy === 'by_month') {
      const st = await fs.promises.stat(from);
      cat = new Date(st.mtimeMs).toISOString().slice(0, 7);
    } else {
      cat = CAT_BY_EXT.get(path.extname(e.name).slice(1).toLowerCase());
      if (!cat) { skipped.unknown++; continue; }
    }
    const destDir = path.join(dir, cat);
    if (exists(destDir) && !fs.statSync(destDir).isDirectory()) { skipped.blocked++; blockedCats.add(cat); continue; }
    if (moves.length >= MAX_MOVES) { skipped.unknown++; continue; }
    moves.push({ from, to: uniqueTarget(path.join(destDir, e.name), taken) });
  }
  return { moves, skipped, root: dir, blockedCats: [...blockedCats] };
}

async function planMove(sources, dest, P) {
  const destination = await P.assertAllowed(dest);
  if (exists(destination) && !fs.statSync(destination).isDirectory()) throw new ActionError('not_dir', 'La destination existe déjà et n’est pas un dossier.');
  const taken = new Set();
  const moves = [];
  let already = 0;
  for (const s of sources) {
    const from = await P.assertAllowed(s, { mustExist: true });
    if (await P.isRootOrHome(from)) throw new ActionError('too_broad', 'Un dossier autorisé entier ne peut pas être déplacé.');
    if (P.inside(destination, from)) throw new ActionError('bad_args', `On ne peut pas déplacer « ${path.basename(from)} » dans lui-même.`);
    if (path.dirname(from) === destination) { already++; continue; }
    moves.push({ from, to: uniqueTarget(path.join(destination, path.basename(from)), taken) });
  }
  if (!moves.length) throw new ActionError('nothing', 'Rien à déplacer : les éléments sont déjà dans ce dossier.');
  return { moves, destination, skipped: { already }, root: destination };
}

async function planRename(from, newName, P) {
  if (/[\\/\u0000]/.test(newName) || newName === '.' || newName === '..') throw new ActionError('bad_args', 'Le nouveau nom ne doit pas contenir de « / » et doit être un nom de fichier valide.');
  const real = await P.assertAllowed(from, { mustExist: true });
  if (await P.isRootOrHome(real)) throw new ActionError('too_broad', 'Un dossier autorisé entier ne peut pas être renommé.');
  const to = path.join(path.dirname(real), newName);
  if (to === real) throw new ActionError('nothing', 'Le nouveau nom est identique à l’ancien.');
  if (exists(to)) throw new ActionError('exists', `« ${newName} » existe déjà dans ce dossier : rien n’a été modifié.`);
  return { moves: [{ from: real, to }], destination: path.dirname(real), skipped: {}, root: path.dirname(real) };
}

function previewOrganize(dir, plan) {
  const counts = new Map();
  for (const m of plan.moves) { const k = path.basename(path.dirname(m.to)); counts.set(k, (counts.get(k) || 0) + 1); }
  const notes = [];
  const s = plan.skipped;
  if (s.unknown) notes.push(`${plural(s.unknown, 'fichier ignoré', 'fichiers ignorés')} (type non reconnu)`);
  if (s.hidden) notes.push(`${plural(s.hidden, 'fichier caché laissé', 'fichiers cachés laissés')} en place`);
  if (s.folders) notes.push(`${plural(s.folders, 'dossier laissé', 'dossiers laissés')} en place`);
  if (plan.blockedCats.length) notes.push(`Ignorés, car un fichier porte déjà ce nom : ${plan.blockedCats.join(', ')}`);
  return {
    title: `Ranger ${plural(plan.moves.length, 'fichier', 'fichiers')} dans « ${path.basename(dir)} »`,
    groups: [...counts].map(([label, count]) => ({ label, count })),
    samples: plan.moves.slice(0, 6).map((m) => ({ from: path.basename(m.from), to: path.relative(dir, m.to) })),
    notes,
  };
}

function previewMoves(plan) {
  const one = plan.moves.length === 1 && path.dirname(plan.moves[0].from) === path.dirname(plan.moves[0].to);
  return {
    title: one ? 'Renommer un élément' : `Déplacer ${plural(plan.moves.length, 'élément', 'éléments')} vers « ${path.basename(plan.destination)} »`,
    groups: [],
    samples: plan.moves.slice(0, 8).map((m) => ({ from: path.basename(m.from), to: one ? path.basename(m.to) : path.relative(plan.destination, m.to) })),
    notes: plan.moves.length > 8 ? [`et ${plan.moves.length - 8} autres`] : [],
  };
}

async function moveOne(from, to) {
  try {
    await fs.promises.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    const st = await fs.promises.stat(from);
    if (!st.isFile()) throw new Error('le déplacement d’un dossier vers un autre disque n’est pas pris en charge');
    await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fs.promises.unlink(from);
  }
}

/** Dossiers manquants sur le chemin, du plus haut au plus bas (pour pouvoir les retirer à l'annulation). */
function missingDirs(dir) {
  const out = [];
  let cur = dir;
  while (!exists(cur)) { out.unshift(cur); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return out;
}

async function executeMoves(plan, P, { verb }) {
  const done = [], failed = [], createdDirs = [];
  for (const m of plan.moves) {
    try {
      await P.assertAllowed(m.from, { mustExist: true });
      await P.assertAllowed(m.to);
      if (exists(m.to)) throw new Error('un élément de ce nom existe déjà à destination');
      for (const d of missingDirs(path.dirname(m.to))) { await fs.promises.mkdir(d); createdDirs.push(d); }
      await moveOne(m.from, m.to);
      done.push(m);
    } catch (e) {
      failed.push({ from: m.from, error: e.code === 'ENOENT' ? 'l’élément a disparu' : e.message || String(e) });
    }
  }
  if (!done.length) throw new ActionError('move_failed', 'Aucun élément n’a pu être déplacé : ' + (failed[0] ? failed[0].error : 'erreur inconnue') + '.');
  const n = done.length;
  const summary = `${plural(n, 'élément', 'éléments')} ${verb}${n > 1 ? 's' : ''}` + (failed.length ? `, ${plural(failed.length, 'échec', 'échecs')}` : '') + '.';
  return { summary, data: { done: n, failed, moves: done.slice(0, 200) }, undo: { type: 'moves', moves: done, createdDirs } };
}

async function undoMoves(undo, P) {
  const restored = [], failed = [];
  for (const m of [...undo.moves].reverse()) {
    try {
      await P.assertAllowed(m.from);
      await P.assertAllowed(m.to, { mustExist: true });
      if (exists(m.from)) throw new Error('l’emplacement d’origine est déjà occupé');
      await moveOne(m.to, m.from);
      restored.push(m);
    } catch (e) {
      failed.push({ from: m.to, error: e.code === 'ENOENT' ? 'l’élément n’est plus là' : e.message || String(e) });
    }
  }
  for (const d of [...(undo.createdDirs || [])].reverse()) { try { await fs.promises.rmdir(d); } catch { /* non vide : laissé en place */ } }
  if (!restored.length) throw new ActionError('undo_failed', 'Rien n’a pu être restauré : ' + (failed[0] ? failed[0].error : 'erreur inconnue') + '.');
  return { summary: `${plural(restored.length, 'élément remis', 'éléments remis')} à sa place` + (failed.length ? `, ${plural(failed.length, 'échec', 'échecs')}` : '') + '.', data: { restored: restored.length, failed } };
}

module.exports = { planOrganize, planMove, planRename, previewOrganize, previewMoves, executeMoves, undoMoves, CATEGORIES };
