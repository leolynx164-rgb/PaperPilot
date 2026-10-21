'use strict';
const { request, readSse } = require('./http');
const { ProviderError } = require('./errors');

/** Adaptateur pour toutes les API au format « chat completions » d'OpenAI (OpenAI, OpenRouter, Mistral, Groq, LM Studio, vLLM…). */
const base = (p) => p.baseUrl.replace(/\/+$/, '');

function headers(p, apiKey) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) h.Authorization = 'Bearer ' + apiKey;
  if (p.preset === 'openrouter') h['X-Title'] = 'PaperPilot AI';
  return h;
}

module.exports = {
  kind: 'openai-compat',

  async stream({ provider: p, apiKey, system, messages, signal, onText, params = {} }) {
    const ctx = { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model };
    const body = {
      model: p.model,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    };
    const temperature = params.temperature ?? p.params.temperature;
    const maxTokens = params.maxTokens ?? p.params.maxTokens;
    if (typeof temperature === 'number') body.temperature = temperature;
    if (typeof maxTokens === 'number') body[p.preset === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;

    const res = await request(base(p) + '/chat/completions', { method: 'POST', headers: headers(p, apiKey), body: JSON.stringify(body) }, { signal, ctx });
    let text = '';
    let finish = null;
    for await (const evt of readSse(res, { signal, ctx })) {
      if (evt.error) throw new ProviderError('bad_response', `${p.name} a signalé une erreur : ${evt.error.message || JSON.stringify(evt.error).slice(0, 200)}`);
      const choice = evt.choices && evt.choices[0];
      if (!choice) continue;
      const piece = choice.delta && choice.delta.content;
      if (typeof piece === 'string' && piece) { text += piece; onText && onText(piece); }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    return { text, finishReason: finish };
  },

  async listModels({ provider: p, apiKey, signal }) {
    const ctx = { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model };
    const res = await request(base(p) + '/models', { headers: headers(p, apiKey) }, { signal, ctx, connectTimeoutMs: 15000 });
    const json = await res.json().catch(() => null);
    const list = json && (json.data || json.models);
    if (!Array.isArray(list)) throw new ProviderError('bad_response', `${p.name} n’a pas renvoyé de liste de modèles exploitable.`);
    return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort();
  },
};
