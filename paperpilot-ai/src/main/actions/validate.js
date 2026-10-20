'use strict';
const { ActionError } = require('./paths');
const bad = (name, why) => new ActionError('bad_args', `Argument « ${name} » invalide : ${why}.`);

exports.str = (v, name, { max = 500, required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(name, 'valeur requise'); return undefined; }
  if (typeof v !== 'string') throw bad(name, 'une chaîne de texte est attendue');
  const s = v.trim();
  if (s.includes('\u0000')) throw bad(name, 'caractère interdit');
  if (s.length > max) throw bad(name, `trop long (${max} caractères maximum)`);
  if (required && !s) throw bad(name, 'valeur requise');
  return s;
};

exports.int = (v, name, { min, max, def }) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(name, 'un nombre est attendu');
  return Math.min(max, Math.max(min, Math.round(n)));
};

exports.oneOf = (v, name, list, def) => {
  if (v === undefined || v === null || v === '') return def;
  if (!list.includes(v)) throw bad(name, `valeurs possibles : ${list.join(', ')}`);
  return v;
};

exports.date = (v, name) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(name, 'format AAAA-MM-JJ attendu');
  return v;
};

exports.list = (v, name, { max = 50, required = false } = {}) => {
  if (v === undefined || v === null) { if (required) throw bad(name, 'liste requise'); return undefined; }
  const arr = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(arr) || !arr.length && required) throw bad(name, 'une liste non vide est attendue');
  if (arr.length > max) throw bad(name, `${max} éléments maximum`);
  return arr.map((x) => { if (typeof x !== 'string' || !x.trim() || x.length > 1000 || x.includes('\u0000')) throw bad(name, 'liste de chemins invalide'); return x.trim(); });
};
