'use strict';
/**
 * Registre des fournisseurs.
 *
 * Pour ajouter un fournisseur :
 *  - s'il parle l'un des formats existants (OpenAI, Anthropic, Ollama) : ajouter une entrée à PRESETS ;
 *  - sinon : créer un adaptateur (stream + listModels), l'enregistrer dans ADAPTERS, puis ajouter un preset.
 */
const openaiCompat = require('./openai-compat');
const anthropic = require('./anthropic');
const ollama = require('./ollama');
const { ProviderError } = require('./errors');

const ADAPTERS = { 'openai-compat': openaiCompat, anthropic, ollama };

/** Catalogue présenté dans l'interface. Aucun nom de modèle n'est imposé : l'utilisateur saisit le nom exact. */
const PRESETS = [
  { id: 'openai', name: 'OpenAI', kind: 'openai-compat', baseUrl: 'https://api.openai.com/v1', needsKey: true, help: 'Clé à créer sur platform.openai.com.' },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, help: 'Clé à créer sur console.anthropic.com.' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, help: 'Un seul compte pour de nombreux modèles. Noms de la forme « fournisseur/modèle ».' },
  { id: 'mistral', name: 'Mistral', kind: 'openai-compat', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, help: 'Clé à créer sur console.mistral.ai.' },
  { id: 'groq', name: 'Groq', kind: 'openai-compat', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, help: 'Clé à créer sur console.groq.com.' },
  { id: 'ollama', name: 'Ollama (local)', kind: 'ollama', baseUrl: 'http://localhost:11434', needsKey: false, help: 'Modèles exécutés sur votre ordinateur. Aucune clé requise.' },
  { id: 'custom', name: 'Personnalisé (compatible OpenAI)', kind: 'openai-compat', baseUrl: 'http://localhost:1234/v1', needsKey: false, help: 'LM Studio, vLLM, LiteLLM, Together, Fireworks… tout serveur au format OpenAI.' },
];

const adapterFor = (provider) => {
  const a = ADAPTERS[provider.kind];
  if (!a) throw new ProviderError('unsupported', `Le type de fournisseur « ${provider.kind} » n’est pas pris en charge.`);
  return a;
};

const needsKey = (provider) => provider.kind !== 'ollama' && provider.preset !== 'custom';

/** Vrai si le fournisseur tourne sur cette machine (les données ne quittent pas l'ordinateur). */
function isLocal(provider) {
  try {
    const h = new URL(provider.baseUrl).hostname;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h);
  } catch { return false; }
}

/** Vérifie réellement la configuration : liste des modèles (clé), puis génération minimale (modèle). Jamais simulé. */
async function testConnection(provider, apiKey, signal) {
  const t0 = Date.now();
  const adapter = adapterFor(provider);
  if (!provider.baseUrl) return { ok: false, code: 'missing_url', message: 'Indiquez l’URL de base du fournisseur.' };
  if (needsKey(provider) && !apiKey) return { ok: false, code: 'missing_key', message: 'Aucune clé API enregistrée pour ce fournisseur.' };
  if (!provider.model) return { ok: false, code: 'missing_model', message: 'Indiquez le nom exact du modèle à utiliser.' };

  let models = null;
  try {
    models = await adapter.listModels({ provider, apiKey, signal });
  } catch (err) {
    if (err instanceof ProviderError && ['invalid_key', 'forbidden', 'network', 'timeout', 'aborted', 'quota', 'rate_limited'].includes(err.code)) {
      return { ok: false, code: err.code, message: err.userMessage };
    }
    // Liste non disponible (404, format inattendu…) : on vérifie directement par une génération.
  }
  try {
    await adapter.stream({
      provider, apiKey, signal, system: 'Réponds uniquement par le mot : ok.',
      messages: [{ role: 'user', content: 'Test de connexion.' }], params: { maxTokens: 16, temperature: null },
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      let message = err.userMessage;
      if (err.code === 'not_found' && models && models.length && !models.includes(provider.model)) {
        message = `Le modèle « ${provider.model} » n’existe pas chez ${provider.name}. Utilisez « Charger la liste » pour choisir un nom exact.`;
      }
      return { ok: false, code: err.code, message };
    }
    return { ok: false, code: 'unknown', message: 'Le test a échoué : ' + (err && err.message) };
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
  return { ok: true, code: 'ok', message: `Connexion vérifiée : « ${provider.model} » a répondu en ${secs} s.`, models: models ? models.length : null };
}

module.exports = { ADAPTERS, PRESETS, adapterFor, needsKey, isLocal, testConnection, ProviderError };
