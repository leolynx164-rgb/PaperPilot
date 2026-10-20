'use strict';
/** Erreur de fournisseur avec un message déjà rédigé en langage naturel pour l'utilisateur. */
class ProviderError extends Error {
  constructor(code, userMessage, extra = {}) {
    super(userMessage);
    this.name = 'ProviderError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = extra.status || null;
    this.detail = extra.detail || null;
  }
}

/** Extrait le message d'erreur d'un corps JSON de fournisseur (OpenAI, Anthropic, Ollama…). */
function extractDetail(bodyText) {
  if (!bodyText) return '';
  try {
    const j = JSON.parse(bodyText);
    const e = j.error ?? j;
    if (typeof e === 'string') return e.slice(0, 300);
    if (e && typeof e.message === 'string') return e.message.slice(0, 300);
    if (typeof j.message === 'string') return j.message.slice(0, 300);
  } catch { /* corps non JSON */ }
  return String(bodyText).replace(/\s+/g, ' ').slice(0, 200);
}

/** Transforme une réponse HTTP en erreur compréhensible. */
function fromHttp(status, bodyText, ctx) {
  const who = ctx.name || 'Le fournisseur';
  const detail = extractDetail(bodyText);
  const opt = { status, detail };
  if (status === 401) return new ProviderError('invalid_key', `${who} a refusé la clé API. Vérifiez qu’elle est correcte, active et copiée en entier.`, opt);
  if (status === 403) return new ProviderError('forbidden', `${who} refuse l’accès. Cette clé n’a peut-être pas le droit d’utiliser ce modèle ou cette région.`, opt);
  if (status === 404) {
    if (ctx.kind === 'ollama') return new ProviderError('not_found', `Ollama ne trouve pas le modèle « ${ctx.model} ». Installez-le avec la commande « ollama pull ${ctx.model} ».`, opt);
    return new ProviderError('not_found', `${who} ne trouve pas cette adresse ou ce modèle. Vérifiez l’URL de base et le nom exact du modèle.`, opt);
  }
  if (status === 402) return new ProviderError('quota', `${who} signale un crédit insuffisant. Vérifiez votre forfait ou votre solde.`, opt);
  if (status === 429) return new ProviderError('rate_limited', `${who} limite les requêtes ou votre quota est épuisé. Patientez un moment ou vérifiez votre forfait.`, opt);
  if (status === 400 || status === 422) {
    if (/temperature|max_tokens|max_completion_tokens|top_p|unsupported (parameter|value)/i.test(detail) && /unsupported|not supported|invalid|deprecated/i.test(detail)) {
      return new ProviderError('unsupported_param', `Ce modèle n’accepte pas un des réglages envoyés (température ou nombre maximal de jetons). Videz ces champs dans les réglages du fournisseur. Détail : ${detail}`, opt);
    }
    return new ProviderError('bad_request', `${who} a refusé la requête${detail ? ' : ' + detail : '.'}`, opt);
  }
  if (status >= 500) return new ProviderError('server', `${who} rencontre un problème de son côté (code ${status}). Réessayez dans un instant.`, opt);
  return new ProviderError('http', `${who} a répondu avec le code ${status}${detail ? ' : ' + detail : '.'}`, opt);
}

/** Transforme une erreur réseau de `fetch` en erreur compréhensible. */
function fromNetwork(err, ctx) {
  const who = ctx.name || 'le fournisseur';
  const cause = err && err.cause;
  const code = (cause && (cause.code || (cause.errors && cause.errors[0] && cause.errors[0].code))) || (err && err.code) || '';
  let host = ctx.baseUrl || '';
  try { host = new URL(ctx.baseUrl).host; } catch { /* conservé tel quel */ }
  if (code === 'ECONNREFUSED') {
    if (ctx.kind === 'ollama') return new ProviderError('network', `Impossible de joindre Ollama sur ${host}. Est-il démarré ? Essayez « ollama serve » dans un terminal.`);
    return new ProviderError('network', `Connexion refusée par ${host}. Vérifiez que le service est démarré et que l’URL de base est correcte.`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new ProviderError('network', `L’adresse ${host} est introuvable. Vérifiez votre connexion Internet et l’URL de base.`);
  if (code === 'CERT_HAS_EXPIRED' || /CERT|SSL|TLS/.test(String(code))) return new ProviderError('network', `La connexion sécurisée à ${host} a échoué (certificat). Vérifiez l’URL et la date de votre ordinateur.`);
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return new ProviderError('network', `La connexion avec ${who} a été interrompue. Réessayez.`);
  return new ProviderError('network', `Impossible de contacter ${who} (${err && err.message ? err.message : 'erreur réseau'}). Vérifiez votre connexion Internet.`);
}

module.exports = { ProviderError, fromHttp, fromNetwork, extractDetail };
