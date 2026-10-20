'use strict';
/** Faux serveur IA local (formats OpenAI, Anthropic et Ollama) : permet de tester les vrais flux réseau sans clé ni Internet. */
const http = require('http');

function createMockLlm() {
  const calls = [];
  const state = {
    /** (corps de requête, numéro d'appel) → texte, ou { status, body } pour simuler une erreur */
    respond: () => 'ok',
    keys: { openai: 'sk-test', anthropic: 'ak-test' },
    delayMs: 0,
  };
  const chunks = (text, n = 7) => { const out = []; for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n)); return out; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* corps vide */ }
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

      if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
        const auth = req.headers.authorization || '';
        if (req.headers['x-api-key']) return req.headers['x-api-key'] === state.keys.anthropic ? json(200, { data: [{ id: 'claude-mock' }] }) : json(401, { type: 'error', error: { message: 'invalid x-api-key' } });
        if (auth !== 'Bearer ' + state.keys.openai) return json(401, { error: { message: 'Incorrect API key provided' } });
        return json(200, { data: [{ id: 'mock-model' }, { id: 'autre-modele' }] });
      }
      if (req.method === 'GET' && req.url === '/api/tags') return json(200, { models: [{ name: 'llama-mock:latest' }] });

      const isOpenAI = req.url === '/v1/chat/completions';
      const isAnthropic = req.url === '/v1/messages';
      const isOllama = req.url === '/api/chat';
      if (!isOpenAI && !isAnthropic && !isOllama) return json(404, { error: { message: 'not found' } });
      if (isOpenAI && (req.headers.authorization || '') !== 'Bearer ' + state.keys.openai) return json(401, { error: { message: 'Incorrect API key provided' } });
      if (isAnthropic && req.headers['x-api-key'] !== state.keys.anthropic) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });

      const out = await state.respond(body, calls.filter((c) => c.method === 'POST').length);
      if (out && typeof out === 'object' && out.status) return json(out.status, out.body || {});
      if (out && out.hang) return; // la connexion reste ouverte (test de délai)
      const text = String(out);

      if (isOpenAI) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const c of chunks(text)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`); if (state.delayMs) await sleep(state.delayMs); }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      if (isAnthropic) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
        for (const c of chunks(text)) { res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } })}\n\n`); if (state.delayMs) await sleep(state.delayMs); }
        res.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      for (const c of chunks(text)) { res.write(JSON.stringify({ message: { role: 'assistant', content: c }, done: false }) + '\n'); if (state.delayMs) await sleep(state.delayMs); }
      res.write(JSON.stringify({ done: true, done_reason: 'stop' }) + '\n');
      res.end();
    });
  });

  return {
    state, calls,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((resolve) => { server.closeAllConnections && server.closeAllConnections(); server.close(resolve); }),
  };
}

module.exports = { createMockLlm };
