'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/main/store');

const fakeCipher = { available: () => true, backend: () => 'kwallet6', encrypt: (s) => Buffer.from('ENC' + [...s].reverse().join('')), decrypt: (b) => [...b.toString().slice(3)].reverse().join('') };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pp-store-'));
const prov = { kind: 'openai-compat', preset: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'm' };

test('la clé API est chiffrée sur disque et jamais renvoyée en clair', () => {
  const dir = tmp();
  const store = createStore({ dir, cipher: fakeCipher });
  const saved = store.providers.save(prov, 'sk-SECRET-1234567890');
  assert.equal(saved.hasKey, true);
  assert.equal(saved.keyHint, '…7890');
  const all = JSON.stringify(store.providers.list()) + JSON.stringify(store.settings.get()) + fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!all.includes('SECRET'));
  assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('SECRET'));
  assert.equal(store.providers.getKey(saved.id), 'sk-SECRET-1234567890');
  assert.equal(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o077, 0, 'lisible par l’utilisateur seulement');
});

test('sans trousseau chiffré, le niveau de protection est annoncé honnêtement', () => {
  const store = createStore({ dir: tmp(), cipher: { ...fakeCipher, available: () => false } });
  assert.equal(store.secrets.status().weak, true);
  const p = store.providers.save(prov, 'sk-abc-def-ghi');
  assert.equal(store.providers.getKey(p.id), 'sk-abc-def-ghi');
});

test('modifier l’URL, le modèle ou la clé remet l’état « vérifié » à zéro', () => {
  const store = createStore({ dir: tmp(), cipher: fakeCipher });
  const p = store.providers.save(prov, 'sk-abc-def-ghi');
  store.providers.setVerified(p.id, { ok: true, message: 'ok' });
  assert.equal(store.providers.list()[0].verified.ok, true);
  store.providers.save({ ...prov, id: p.id, model: 'autre' });
  assert.equal(store.providers.list()[0].verified, null);
});

test('les réglages persistent, les valeurs invalides sont ignorées', () => {
  const dir = tmp();
  let store = createStore({ dir, cipher: fakeCipher });
  store.settings.update({ appearance: { accent: 'olive', textSize: 'énorme' }, shortcut: 'Ctrl+Alt+P', inconnu: 1, providers: [{ x: 1 }] });
  store = createStore({ dir, cipher: fakeCipher });
  const s = store.settings.get();
  assert.equal(s.appearance.accent, 'olive');
  assert.equal(s.appearance.textSize, 'medium');
  assert.equal(s.shortcut, 'Ctrl+Alt+P');
  assert.ok(!('inconnu' in s));
  assert.equal(store.providers.list().length, 0);
});

test('conversations : persistance, recherche, suppression, identifiants invalides refusés', () => {
  const dir = tmp();
  let store = createStore({ dir, cipher: fakeCipher });
  const c = store.conversations.create();
  c.title = 'Factures'; c.messages.push({ id: '1', role: 'user', content: 'Retrouve ma facture EDF', ts: 1 });
  store.conversations.save(c);
  store = createStore({ dir, cipher: fakeCipher });
  assert.equal(store.conversations.list()[0].title, 'Factures');
  assert.equal(store.conversations.search('edf').length, 1);
  assert.equal(store.conversations.search('zzz').length, 0);
  assert.equal(store.conversations.get('../../etc/passwd'), null);
  store.conversations.delete(c.id);
  assert.equal(store.conversations.list().length, 0);
});

test('actions en attente au démarrage suivant : marquées comme annulées', () => {
  const dir = tmp();
  let store = createStore({ dir, cipher: fakeCipher });
  store.actions.add({ id: 'a1', status: 'awaiting', ts: Date.now() });
  store = createStore({ dir, cipher: fakeCipher });
  store.actions.settleOrphans();
  assert.equal(store.actions.get('a1').status, 'cancelled');
});

test('eraseAll supprime conversations, historique, fournisseurs et clés', () => {
  const dir = tmp();
  const store = createStore({ dir, cipher: fakeCipher });
  const p = store.providers.save(prov, 'sk-abc-def-ghi');
  store.conversations.create();
  store.eraseAll();
  assert.equal(store.providers.list().length, 0);
  assert.equal(store.secrets.has(p.id), false);
  assert.equal(store.conversations.list().length, 0);
});
