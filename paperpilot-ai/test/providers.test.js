'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockLlm } = require('./helpers/mock-llm');
const net = require('net');
const { adapterFor, testConnection, isLocal } = require('../src/main/providers');

const mk = (base, over = {}) => ({ id: 'p', preset: 'custom', kind: 'openai-compat', name: 'Mock', baseUrl: base + '/v1', model: 'mock-model', params: { temperature: null, maxTokens: null }, ...over });

test('OpenAI : flux SSE reconstitué, clé envoyée, paramètres optionnels', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  mock.state.respond = () => 'Bonjour, voici une réponse en plusieurs morceaux.';
  const pieces = [];
  const r = await adapterFor(mk(base)).stream({ provider: mk(base, { params: { temperature: 0.3, maxTokens: 50 } }), apiKey: 'sk-test', system: 'sys', messages: [{ role: 'user', content: 'salut' }], onText: (x) => pieces.push(x) });
  assert.equal(r.text, 'Bonjour, voici une réponse en plusieurs morceaux.');
  assert.ok(pieces.length > 2, 'doit arriver en flux');
  const body = mock.calls.at(-1).body;
  assert.equal(body.temperature, 0.3);
  assert.equal(body.max_tokens, 50);
  assert.equal(body.messages[0].role, 'system');
});

test('OpenAI officiel : max_completion_tokens ; température absente si non définie', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  mock.state.respond = () => 'ok';
  const p = mk(base, { preset: 'openai', params: { temperature: null, maxTokens: 20 } });
  await adapterFor(p).stream({ provider: p, apiKey: 'sk-test', system: 's', messages: [{ role: 'user', content: 'x' }] });
  const body = mock.calls.at(-1).body;
  assert.equal(body.max_completion_tokens, 20);
  assert.ok(!('temperature' in body));
  assert.ok(!('max_tokens' in body));
});

test('Anthropic : en-têtes, flux et fusion des messages consécutifs', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  mock.state.respond = () => 'Réponse Claude';
  const p = mk(base, { kind: 'anthropic', baseUrl: base });
  const r = await adapterFor(p).stream({ provider: p, apiKey: 'ak-test', system: 'sys', messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] });
  assert.equal(r.text, 'Réponse Claude');
  const c = mock.calls.at(-1);
  assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.body.system, 'sys');
  assert.equal(c.body.messages.length, 1);
  assert.equal(c.body.max_tokens, 4096);
});

test('Ollama : flux NDJSON et liste des modèles locaux', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  mock.state.respond = () => 'Salut depuis Ollama';
  const p = mk(base, { kind: 'ollama', baseUrl: base, model: 'llama-mock' });
  const r = await adapterFor(p).stream({ provider: p, system: 's', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.text, 'Salut depuis Ollama');
  assert.deepEqual(await adapterFor(p).listModels({ provider: p }), ['llama-mock:latest']);
  assert.equal(isLocal(p), true);
  assert.equal(isLocal(mk('https://api.openai.com')), false);
});

test('erreurs HTTP expliquées en français', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  const p = mk(base);
  const run = () => adapterFor(p).stream({ provider: p, apiKey: 'sk-test', system: 's', messages: [{ role: 'user', content: 'x' }] });
  mock.state.respond = () => ({ status: 429, body: { error: { message: 'quota' } } });
  await assert.rejects(run(), (e) => e.code === 'rate_limited' && /quota|requêtes/.test(e.userMessage));
  mock.state.respond = () => ({ status: 404, body: { error: { message: 'model not found' } } });
  await assert.rejects(run(), (e) => e.code === 'not_found' && /nom exact du modèle/.test(e.userMessage));
  mock.state.respond = () => ({ status: 400, body: { error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } } });
  await assert.rejects(run(), (e) => e.code === 'unsupported_param');
  mock.state.respond = () => ({ status: 503, body: {} });
  await assert.rejects(run(), (e) => e.code === 'server');
  await assert.rejects(adapterFor(p).stream({ provider: p, apiKey: 'mauvaise', system: 's', messages: [] }), (e) => e.code === 'invalid_key');
});

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

test('serveur injoignable : message clair', async () => {
  const dead = 'http://127.0.0.1:' + (await freePort());
  const p = mk(dead);
  await assert.rejects(adapterFor(p).stream({ provider: p, apiKey: 'k', system: 's', messages: [] }), (e) => e.code === 'network' && /refusée|Connexion/.test(e.userMessage));
  const o = mk(dead, { kind: 'ollama', name: 'Ollama' });
  await assert.rejects(adapterFor(o).stream({ provider: o, system: 's', messages: [] }), (e) => /ollama serve/.test(e.userMessage));
});

test('annulation : interrompt le flux en cours', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  mock.state.respond = () => 'x'.repeat(2000); mock.state.delayMs = 5;
  const ac = new AbortController();
  const p = mk(base);
  const run = adapterFor(p).stream({ provider: p, apiKey: 'sk-test', system: 's', messages: [{ role: 'user', content: 'x' }], signal: ac.signal, onText: () => ac.abort() });
  await assert.rejects(run, (e) => e.code === 'aborted');
});

test('testConnection : vérifie réellement (succès, clé invalide, modèle inconnu, clé absente)', async (t) => {
  const mock = createMockLlm(); const base = await mock.listen(); t.after(mock.close);
  mock.state.respond = () => 'ok';
  const okp = mk(base, { preset: 'openai' });
  const ok = await testConnection(okp, 'sk-test');
  assert.equal(ok.ok, true);
  assert.match(ok.message, /vérifiée/);
  const badKey = await testConnection(okp, 'sk-faux');
  assert.equal(badKey.ok, false); assert.equal(badKey.code, 'invalid_key');
  const noKey = await testConnection(okp, '');
  assert.equal(noKey.code, 'missing_key');
  mock.state.respond = () => ({ status: 404, body: { error: { message: 'no model' } } });
  const noModel = await testConnection(mk(base, { preset: 'openai', model: 'inexistant' }), 'sk-test');
  assert.equal(noModel.ok, false);
  assert.match(noModel.message, /inexistant/);
  assert.equal((await testConnection(mk(base, { preset: 'openai', model: '' }), 'sk-test')).code, 'missing_model');
});

test('testConnection ne simule jamais un succès quand le serveur est absent', async () => {
  const r = await testConnection(mk('http://127.0.0.1:' + (await freePort()), { preset: 'openai' }), 'sk');
  assert.equal(r.ok, false);
});
