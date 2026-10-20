'use strict';
const { ProviderError, fromHttp, fromNetwork } = require('./errors');

const CONNECT_TIMEOUT_MS = 30000;
const IDLE_TIMEOUT_MS = 90000;

/**
 * fetch avec délai de connexion et annulation. Lève une ProviderError lisible en cas d'échec HTTP ou réseau.
 * `ctx` = { name, kind, baseUrl, model } pour des messages précis.
 */
async function request(url, init, { signal, ctx, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  let timedOut = false;
  const onAbort = () => ac.abort(signal.reason);
  if (signal) {
    if (signal.aborted) throw new ProviderError('aborted', 'Génération annulée.');
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, connectTimeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw fromHttp(res.status, text, ctx);
    }
    res._abort = ac;
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof ProviderError) throw err;
    if (signal && signal.aborted) throw new ProviderError('aborted', 'Génération annulée.');
    if (timedOut) throw new ProviderError('timeout', `${ctx.name || 'Le fournisseur'} met trop de temps à répondre. Vérifiez votre connexion et réessayez.`);
    throw fromNetwork(err, ctx);
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Itère sur les lignes d'une réponse en flux, avec délai d'inactivité. */
async function* readLines(res, { signal, ctx, idleTimeoutMs = IDLE_TIMEOUT_MS }) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let idle = false;
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; res._abort.abort(); }, idleTimeoutMs); };
  const onAbort = () => res._abort.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  arm();
  try {
    for await (const chunk of res.body) {
      arm();
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n')) !== -1) {
        yield buffer.slice(0, i).replace(/\r$/, '');
        buffer = buffer.slice(i + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } catch (err) {
    if (signal && signal.aborted) throw new ProviderError('aborted', 'Génération annulée.');
    if (idle) throw new ProviderError('timeout', `${ctx.name || 'Le fournisseur'} ne répond plus. La réponse a été interrompue.`);
    throw fromNetwork(err, ctx);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Itère sur les événements « data: » d'un flux SSE (fin sur [DONE]). */
async function* readSse(res, opts) {
  for await (const line of readLines(res, opts)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === '[DONE]') return;
    try { yield JSON.parse(data); } catch { /* ligne partielle ou commentaire : ignorée */ }
  }
}

/** Itère sur des lignes JSON (NDJSON, format d'Ollama). */
async function* readNdjson(res, opts) {
  for await (const line of readLines(res, opts)) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* ignorée */ }
  }
}

module.exports = { request, readSse, readNdjson };
