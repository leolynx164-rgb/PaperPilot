'use strict';
const { request, readSse } = require('./http');
const { ProviderError } = require('./errors');

const API_VERSION = '2023-06-01';
const root = (p) => p.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
const headers = (apiKey) => ({ 'Content-Type': 'application/json', 'x-api-key': apiKey || '', 'anthropic-version': API_VERSION });

/** Fusionne les messages consécutifs de même rôle (l'API attend une alternance stricte user/assistant). */
function normalize(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

module.exports = {
  kind: 'anthropic',

  async stream({ provider: p, apiKey, system, messages, signal, onText, params = {} }) {
    const ctx = { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model };
    const body = {
      model: p.model,
      max_tokens: params.maxTokens ?? p.params.maxTokens ?? 4096,
      system,
      messages: normalize(messages),
      stream: true,
    };
    const temperature = params.temperature ?? p.params.temperature;
    if (typeof temperature === 'number') body.temperature = temperature;

    const res = await request(root(p) + '/v1/messages', { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) }, { signal, ctx });
    let text = '';
    let finish = null;
    for await (const evt of readSse(res, { signal, ctx })) {
      if (evt.type === 'error') throw new ProviderError('bad_response', `${p.name} a signalé une erreur : ${(evt.error && evt.error.message) || 'inconnue'}`);
      if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta' && evt.delta.text) { text += evt.delta.text; onText && onText(evt.delta.text); }
      if (evt.type === 'message_delta' && evt.delta && evt.delta.stop_reason) finish = evt.delta.stop_reason;
    }
    return { text, finishReason: finish };
  },

  async listModels({ provider: p, apiKey, signal }) {
    const ctx = { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model };
    const res = await request(root(p) + '/v1/models?limit=100', { headers: headers(apiKey) }, { signal, ctx, connectTimeoutMs: 15000 });
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.data)) throw new ProviderError('bad_response', `${p.name} n’a pas renvoyé de liste de modèles exploitable.`);
    return json.data.map((m) => m.id).filter(Boolean).sort();
  },
};
