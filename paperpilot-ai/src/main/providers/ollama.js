'use strict';
const { request, readNdjson } = require('./http');
const { ProviderError } = require('./errors');

const root = (p) => p.baseUrl.replace(/\/+$/, '').replace(/\/(v1|api)$/, '');

module.exports = {
  kind: 'ollama',

  async stream({ provider: p, system, messages, signal, onText, params = {} }) {
    const ctx = { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model };
    const options = {};
    const temperature = params.temperature ?? p.params.temperature;
    const maxTokens = params.maxTokens ?? p.params.maxTokens;
    if (typeof temperature === 'number') options.temperature = temperature;
    if (typeof maxTokens === 'number') options.num_predict = maxTokens;
    const body = { model: p.model, stream: true, messages: [{ role: 'system', content: system }, ...messages], options };

    const res = await request(root(p) + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { signal, ctx, connectTimeoutMs: 60000 });
    let text = '';
    let finish = null;
    for await (const evt of readNdjson(res, { signal, ctx })) {
      if (evt.error) throw new ProviderError('bad_response', `Ollama a signalé une erreur : ${evt.error}`);
      const piece = evt.message && evt.message.content;
      if (piece) { text += piece; onText && onText(piece); }
      if (evt.done) finish = evt.done_reason || 'stop';
    }
    return { text, finishReason: finish };
  },

  async listModels({ provider: p, signal }) {
    const ctx = { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model };
    const res = await request(root(p) + '/api/tags', {}, { signal, ctx, connectTimeoutMs: 8000 });
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.models)) throw new ProviderError('bad_response', 'Ollama n’a pas renvoyé de liste de modèles exploitable.');
    return json.models.map((m) => m.name || m.model).filter(Boolean).sort();
  },
};
