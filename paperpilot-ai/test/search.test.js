'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { search } = require('../src/main/files/search');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-search-'));
  const w = (rel, mtime) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x'.repeat(10));
    if (mtime) fs.utimesSync(p, mtime / 1000, mtime / 1000);
    return p;
  };
  return { root, w };
}

test('trouve par nom, sans tenir compte des accents ni du pluriel', async () => {
  const { root, w } = fixture();
  w('Factures/Facture_2024.pdf'); w('Présentation été.pptx'); w('autre.txt');
  const r1 = await search({ roots: [root], query: 'factures' });
  assert.deepEqual(r1.results.map((r) => r.name), ['Facture_2024.pdf']);
  const r2 = await search({ roots: [root], query: 'presentation ete' });
  assert.deepEqual(r2.results.map((r) => r.name), ['Présentation été.pptx']);
});

test('tous les mots doivent correspondre', async () => {
  const { root, w } = fixture();
  w('rapport annuel.pdf'); w('rapport mensuel.pdf');
  const r = await search({ roots: [root], query: 'rapport annuel' });
  assert.equal(r.results.length, 1);
});

test('filtre par type et trie du plus récent au plus ancien', async () => {
  const { root, w } = fixture();
  const now = Date.now();
  w('a.pdf', now - 5 * 86400000); w('b.pdf', now - 1 * 86400000); w('c.docx', now);
  const r = await search({ roots: [root], kind: 'pdf', sort: 'recent' });
  assert.deepEqual(r.results.map((x) => x.name), ['b.pdf', 'a.pdf']);
});

test('filtre par date de modification', async () => {
  const { root, w } = fixture();
  const now = Date.now();
  w('vieux.pdf', now - 30 * 86400000); w('recent.pdf', now - 86400000);
  const r = await search({ roots: [root], kind: 'pdf', after: now - 7 * 86400000 });
  assert.deepEqual(r.results.map((x) => x.name), ['recent.pdf']);
});

test('ignore les fichiers cachés, les liens symboliques et les dossiers exclus', async () => {
  const { root, w } = fixture();
  w('.secret/note.txt'); w('node_modules/pkg/note.txt'); w('visible/note.txt');
  fs.symlinkSync(path.join(root, 'visible'), path.join(root, 'lien'));
  const r = await search({ roots: [root], query: 'note' });
  assert.equal(r.results.length, 1);
  assert.ok(r.results[0].path.includes(path.join('visible', 'note.txt')));
});

test('signale les dossiers inaccessibles au lieu de les ignorer en silence', async (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('exécuté en root : les permissions sont ignorées');
  const { root, w } = fixture();
  w('ok/note.txt'); w('ferme/note.txt');
  fs.chmodSync(path.join(root, 'ferme'), 0);
  const r = await search({ roots: [root], query: 'note' });
  fs.chmodSync(path.join(root, 'ferme'), 0o700);
  assert.equal(r.results.length, 1);
  assert.equal(r.unreadableCount, 1);
});

test('une recherche annulée le dit', async () => {
  const { root, w } = fixture();
  w('a.txt');
  const ac = new AbortController(); ac.abort();
  const r = await search({ roots: [root], query: 'a', signal: ac.signal });
  assert.equal(r.cancelled, true);
});
