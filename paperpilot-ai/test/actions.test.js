'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createActions } = require('../src/main/actions');
const apps = require('../src/main/apps');
const { search } = require('../src/main/files/search');
const { readDocument } = require('../src/main/files/documents');

function setup(extra = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-act-')));
  const allowed = path.join(base, 'Documents');
  const outside = path.join(base, 'Secret');
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  const settings = { allowedFolders: [allowed], allowedApps: [], privacy: { confirmOpenActions: false, confirmDocumentReads: true, shareResultsWithModel: true }, ...extra };
  const opened = [];
  const trashed = [];
  const shell = {
    openPath: async (p) => { opened.push(p); return ''; },
    openExternal: async (u) => { opened.push(u); },
    trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true }); },
  };
  const api = createActions({ shell, apps, search, readDocument, getSettings: () => settings, getPath: (n) => ({ documents: allowed, downloads: path.join(base, 'Downloads') }[n] || base), homedir: base });
  return { base, allowed, outside, api, opened, trashed, settings };
}
const ctx = (o = {}) => ({ tainted: false, providerIsLocal: false, ...o });
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };

test('refuse tout chemin hors des dossiers autorisés', async () => {
  const { api, outside } = setup();
  const f = w(path.join(outside, 'mdp.txt'));
  const prep = await api.prepare('open_file', { path: f }, ctx());
  await assert.rejects(api.execute('open_file', prep.args, ctx()), { code: 'not_allowed' });
});

test('un lien symbolique ne permet pas de s’échapper du dossier autorisé', async () => {
  const { api, outside, allowed, opened } = setup();
  const target = w(path.join(outside, 'mdp.txt'));
  const link = path.join(allowed, 'raccourci.txt');
  fs.symlinkSync(target, link);
  await assert.rejects(api.execute('open_file', { path: link }, ctx()), { code: 'not_allowed' });
  assert.equal(opened.length, 0);
});

test('les chemins relatifs et les « .. » sont refusés ou ramenés au dossier autorisé', async () => {
  const { api, allowed, outside } = setup();
  await assert.rejects(api.execute('open_file', { path: 'relatif/fichier.txt' }, ctx()), { code: 'bad_path' });
  w(path.join(outside, 'x.txt'));
  await assert.rejects(api.execute('open_file', { path: path.join(allowed, '..', 'Secret', 'x.txt') }, ctx()), { code: 'not_allowed' });
});

test('n’ouvre pas les scripts ni les exécutables', async () => {
  const { api, allowed, opened } = setup();
  const f = w(path.join(allowed, 'install.sh'), '#!/bin/sh\n');
  await assert.rejects(api.execute('open_file', { path: f }, ctx()), { code: 'blocked' });
  assert.equal(opened.length, 0);
});

test('open_url accepte http(s) uniquement', async () => {
  const { api } = setup();
  await assert.rejects(api.prepare('open_url', { url: 'file:///etc/passwd' }, ctx()), { code: 'bad_args' });
  await assert.rejects(api.prepare('open_url', { url: 'javascript:alert(1)' }, ctx()), { code: 'bad_args' });
  const p = await api.prepare('open_url', { url: 'https://example.org/a' }, ctx());
  assert.equal(p.confirmReason, null);
});

test('après une lecture de fichiers (contenu non fiable), ouvrir une URL exige une confirmation', async () => {
  const { api } = setup();
  const p = await api.prepare('open_url', { url: 'https://example.org' }, ctx({ tainted: true }));
  assert.ok(p.confirmReason);
});

test('une action inconnue ou une commande déguisée est rejetée', async () => {
  const { api } = setup();
  await assert.rejects(api.prepare('run_command', { cmd: 'rm -rf /' }, ctx()), { code: 'unknown' });
  await assert.rejects(api.prepare('open_app', { app: 123 }, ctx()), { code: 'bad_args' });
});

test('open_app : application non autorisée → refus explicite', async () => {
  const { api } = setup();
  await assert.rejects(api.execute('open_app', { app: 'zzz-introuvable' }, ctx()), { code: 'not_found' });
});

test('search_files respecte les dossiers autorisés et renvoie les vrais fichiers', async () => {
  const { api, allowed, outside } = setup();
  w(path.join(allowed, 'Facture mars.pdf')); w(path.join(outside, 'Facture secrète.pdf'));
  const prep = await api.prepare('search_files', { query: 'facture', kind: 'pdf' }, ctx());
  const res = await api.execute('search_files', prep.args, ctx());
  assert.equal(res.data.results.length, 1);
  assert.ok(res.data.results[0].path.startsWith(allowed));
  const bad = await api.prepare('search_files', { query: 'facture', folders: [outside] }, ctx());
  await assert.rejects(api.execute('search_files', bad.args, ctx()), { code: 'not_allowed' });
});

test('organize_files : confirmation obligatoire, aperçu fidèle, exécution puis annulation', async () => {
  const { api, allowed } = setup();
  w(path.join(allowed, 'a.jpg')); w(path.join(allowed, 'b.png')); w(path.join(allowed, 'c.pdf')); w(path.join(allowed, 'inconnu.xyz'));
  const prep = await api.prepare('organize_files', { folder: allowed, strategy: 'by_type' }, ctx());
  assert.ok(prep.confirmReason, 'doit demander confirmation');
  assert.equal(prep.plan.moves.length, 3);
  assert.deepEqual(prep.preview.groups.map((g) => `${g.label}:${g.count}`).sort(), ['Documents:1', 'Images:2']);
  assert.ok(fs.existsSync(path.join(allowed, 'a.jpg')), 'rien n’est déplacé avant confirmation');
  const res = await api.execute('organize_files', prep.args, ctx(), prep.plan);
  assert.equal(res.data.done, 3);
  assert.ok(fs.existsSync(path.join(allowed, 'Images', 'a.jpg')));
  assert.ok(fs.existsSync(path.join(allowed, 'inconnu.xyz')), 'type inconnu laissé en place');
  const undo = await api.undo({ undo: res.undo });
  assert.equal(undo.data.restored, 3);
  assert.ok(fs.existsSync(path.join(allowed, 'a.jpg')));
  assert.ok(!fs.existsSync(path.join(allowed, 'Images')), 'dossier créé par l’action retiré');
});

test('le rangement n’écrase jamais un fichier existant', async () => {
  const { api, allowed } = setup();
  w(path.join(allowed, 'Images', 'a.jpg'), 'ancien'); w(path.join(allowed, 'a.jpg'), 'nouveau');
  const prep = await api.prepare('organize_files', { folder: allowed }, ctx());
  await api.execute('organize_files', prep.args, ctx(), prep.plan);
  assert.equal(fs.readFileSync(path.join(allowed, 'Images', 'a.jpg'), 'utf8'), 'ancien');
  assert.equal(fs.readFileSync(path.join(allowed, 'Images', 'a (1).jpg'), 'utf8'), 'nouveau');
});

test('rename_file : refuse les séparateurs et les noms existants', async () => {
  const { api, allowed } = setup();
  const f = w(path.join(allowed, 'a.txt')); w(path.join(allowed, 'b.txt'));
  await assert.rejects(api.prepare('rename_file', { path: f, newName: '../evade.txt' }, ctx()), { code: 'bad_args' });
  await assert.rejects(api.prepare('rename_file', { path: f, newName: 'b.txt' }, ctx()), { code: 'exists' });
  const prep = await api.prepare('rename_file', { path: f, newName: 'c.txt' }, ctx());
  assert.ok(prep.confirmReason);
  await api.execute('rename_file', prep.args, ctx(), prep.plan);
  assert.ok(fs.existsSync(path.join(allowed, 'c.txt')));
});

test('trash_files : confirmation, vérification réelle, dossier autorisé protégé', async () => {
  const { api, allowed, trashed } = setup();
  const f = w(path.join(allowed, 'x.txt'));
  const prep = await api.prepare('trash_files', { paths: [f] }, ctx());
  assert.ok(prep.confirmReason);
  const res = await api.execute('trash_files', prep.args, ctx());
  assert.equal(trashed.length, 1);
  assert.match(res.summary, /corbeille/);
  await assert.rejects(api.prepare('trash_files', { paths: [allowed] }, ctx()), { code: 'too_broad' });
});

test('read_document : confirmation avec un fournisseur distant, pas avec un fournisseur local', async () => {
  const { api, allowed } = setup();
  const f = w(path.join(allowed, 'note.txt'), 'Bonjour le monde');
  assert.ok((await api.prepare('read_document', { path: f }, ctx())).confirmReason);
  assert.equal((await api.prepare('read_document', { path: f }, ctx({ providerIsLocal: true }))).confirmReason, null);
  const res = await api.execute('read_document', { path: f, maxChars: 1000 }, ctx());
  assert.equal(res.data.text, 'Bonjour le monde');
});

test('le réglage « toujours confirmer les ouvertures » est respecté', async () => {
  const { api, allowed } = setup({ privacy: { confirmOpenActions: true, confirmDocumentReads: true, shareResultsWithModel: true } });
  const f = w(path.join(allowed, 'a.pdf'));
  assert.ok((await api.prepare('open_file', { path: f }, ctx())).confirmReason);
});

test('le résultat transmis au modèle reflète la réalité (échec, refus)', () => {
  const { api } = setup();
  const failed = api.resultForModel({ type: 'open_file', status: 'failed', error: 'Introuvable' }, 1, { shareResults: true });
  assert.match(failed, /ÉCHEC/);
  assert.match(api.resultForModel({ type: 'trash_files', status: 'denied' }, 2, { shareResults: true }), /refusée/);
});
