'use strict';
/**
 * Magasin de données de PaperPilot AI (processus principal uniquement).
 * Les deux fenêtres ne lisent et n'écrivent jamais directement : elles passent par l'IPC,
 * ce qui garantit qu'elles partagent les mêmes paramètres, fournisseurs et historiques.
 *
 * Ce module n'importe pas Electron : le chiffrement des clés est injecté (`cipher`), ce qui le rend testable.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./util/jsonfile');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEFAULTS = {
  schema: 1,
  onboarded: false,
  shortcut: 'Alt+Space',
  autostart: false,
  runInBackground: true,
  defaultProviderId: null,
  allowedFolders: [],
  foldersInitialized: false,
  allowedApps: [],
  appsInitialized: false,
  customInstructions: '',
  quick: { closeOnBlur: true, position: 'top' },
  privacy: { confirmOpenActions: false, confirmDocumentReads: true, shareResultsWithModel: true, retentionDays: 0 },
  appearance: { accent: 'sage', textSize: 'medium', grain: true, reduceMotion: false },
};

const ENUMS = {
  'appearance.accent': ['sage', 'eucalyptus', 'olive'],
  'appearance.textSize': ['small', 'medium', 'large'],
  'quick.position': ['top', 'center'],
  'privacy.retentionDays': [0, 30, 90, 365],
};

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Fusionne `patch` dans `base` en ne gardant que les clés connues et correctement typées. */
function mergeKnown(defaults, base, patch, prefix = '') {
  const out = { ...base };
  if (!isPlain(patch)) return out;
  for (const key of Object.keys(defaults)) {
    if (!(key in patch)) continue;
    const full = prefix + key;
    const def = defaults[key];
    const val = patch[key];
    if (isPlain(def)) out[key] = mergeKnown(def, base[key] || def, val, full + '.');
    else if (Array.isArray(def)) {
      if (Array.isArray(val) && val.every((x) => typeof x === 'string' && x.length < 1024)) out[key] = val.slice(0, 500);
    } else if (def === null) {
      if (val === null || typeof val === 'string') out[key] = val;
    } else if (typeof val === typeof def) {
      if (ENUMS[full] && !ENUMS[full].includes(val)) continue;
      if (typeof val === 'string' && val.length > 4000) continue;
      out[key] = val;
    }
  }
  return out;
}

function createStore({ dir, cipher }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files = {
    settings: path.join(dir, 'settings.json'),
    secrets: path.join(dir, 'secrets.json'),
    actions: path.join(dir, 'actions.json'),
    convDir: path.join(dir, 'conversations'),
  };
  const listeners = new Set();
  const emit = (scope) => listeners.forEach((fn) => fn(scope));

  // ---------------------------------------------------------------- Paramètres + fournisseurs
  let state = readJson(files.settings, {});
  state = { ...mergeKnown(DEFAULTS, structuredClone(DEFAULTS), state), providers: Array.isArray(state.providers) ? state.providers : [] };
  const saveSettings = () => writeJson(files.settings, state);

  const settings = {
    get: () => structuredClone({ ...state, providers: undefined }),
    update(patch) {
      const { providers, defaultProviderId, ...rest } = patch || {};
      state = { ...mergeKnown(DEFAULTS, state, rest), providers: state.providers };
      saveSettings();
      emit('settings');
      return settings.get();
    },
  };

  // ---------------------------------------------------------------- Secrets (clés API)
  let secrets = readJson(files.secrets, {});
  const secretsApi = {
    /** Description honnête du niveau de protection réel. */
    status() {
      const available = !!cipher && cipher.available();
      const backend = available ? cipher.backend() : 'none';
      return { encrypted: available && backend !== 'basic_text', backend, weak: !available || backend === 'basic_text' };
    },
    set(id, key) {
      let stored;
      if (cipher && cipher.available()) stored = 'enc:' + cipher.encrypt(key).toString('base64');
      else stored = 'plain:' + Buffer.from(key, 'utf8').toString('base64');
      secrets[id] = stored;
      writeJson(files.secrets, secrets);
    },
    has: (id) => typeof secrets[id] === 'string',
    get(id) {
      const raw = secrets[id];
      if (typeof raw !== 'string') return null;
      try {
        if (raw.startsWith('enc:')) return cipher.decrypt(Buffer.from(raw.slice(4), 'base64'));
        if (raw.startsWith('plain:')) return Buffer.from(raw.slice(6), 'base64').toString('utf8');
      } catch { /* clé illisible (trousseau verrouillé ou changé) */ }
      return null;
    },
    remove(id) {
      if (id in secrets) { delete secrets[id]; writeJson(files.secrets, secrets); }
    },
  };

  const publicProvider = (p) => ({ ...p, hasKey: secretsApi.has(p.id), keyReadable: !secretsApi.has(p.id) || secretsApi.get(p.id) !== null });
  const KINDS = ['openai-compat', 'anthropic', 'ollama'];

  const providers = {
    list: () => state.providers.map(publicProvider),
    get: (id) => state.providers.find((p) => p.id === id) || null,
    getKey: (id) => secretsApi.get(id),
    save(input, apiKey) {
      if (!input || !KINDS.includes(input.kind)) throw new Error('Type de fournisseur inconnu.');
      const name = String(input.name || '').trim().slice(0, 60);
      if (!name) throw new Error('Donnez un nom à ce fournisseur.');
      let baseUrl = String(input.baseUrl || '').trim().replace(/\/+$/, '');
      try {
        const u = new URL(baseUrl);
        if (!/^https?:$/.test(u.protocol)) throw new Error('protocole');
      } catch { throw new Error('L’URL de base doit être une adresse complète commençant par http:// ou https://.'); }
      const num = (v, min, max) => (v === null || v === '' || v === undefined || Number.isNaN(Number(v)) ? null : Math.min(max, Math.max(min, Number(v))));
      const rec = {
        id: input.id && state.providers.some((p) => p.id === input.id) ? input.id : crypto.randomUUID(),
        preset: String(input.preset || 'custom').slice(0, 30),
        kind: input.kind,
        name,
        baseUrl,
        model: String(input.model || '').trim().slice(0, 200),
        params: { temperature: num(input.params && input.params.temperature, 0, 2), maxTokens: num(input.params && input.params.maxTokens, 1, 1000000) },
        keyHint: null,
        verified: null,
      };
      const prev = providers.get(rec.id);
      rec.keyHint = prev ? prev.keyHint : null;
      rec.verified = prev ? prev.verified : null;
      let changed = !prev || prev.baseUrl !== rec.baseUrl || prev.model !== rec.model || prev.kind !== rec.kind;
      if (typeof apiKey === 'string' && apiKey.trim()) {
        const key = apiKey.trim();
        secretsApi.set(rec.id, key);
        rec.keyHint = key.length > 8 ? '…' + key.slice(-4) : '…';
        changed = true;
      } else if (input.clearKey) {
        secretsApi.remove(rec.id);
        rec.keyHint = null;
        changed = true;
      }
      if (changed) rec.verified = null;
      state.providers = prev ? state.providers.map((p) => (p.id === rec.id ? rec : p)) : [...state.providers, rec];
      if (!state.defaultProviderId || !providers.get(state.defaultProviderId)) state.defaultProviderId = rec.id;
      saveSettings();
      emit('providers');
      return publicProvider(rec);
    },
    remove(id) {
      state.providers = state.providers.filter((p) => p.id !== id);
      secretsApi.remove(id);
      if (state.defaultProviderId === id) state.defaultProviderId = state.providers[0] ? state.providers[0].id : null;
      saveSettings();
      emit('providers');
    },
    setDefault(id) {
      if (!providers.get(id)) throw new Error('Fournisseur introuvable.');
      state.defaultProviderId = id;
      saveSettings();
      emit('providers');
    },
    defaultId: () => state.defaultProviderId,
    setVerified(id, result) {
      const p = providers.get(id);
      if (!p) return;
      p.verified = { ok: !!result.ok, at: Date.now(), message: String(result.message || '').slice(0, 400), code: result.code || null };
      saveSettings();
      emit('providers');
    },
  };

  // ---------------------------------------------------------------- Conversations (un fichier par conversation)
  const convFile = (id) => {
    if (!UUID.test(id)) throw new Error('Identifiant de conversation invalide.');
    return path.join(files.convDir, id + '.json');
  };
  const convIndex = new Map();
  const meta = (c) => {
    const visible = c.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const last = visible[visible.length - 1];
    return {
      id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: visible.length,
      preview: last ? String(last.content || '').replace(/```paperpilot-action[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) : '',
    };
  };
  if (fs.existsSync(files.convDir)) {
    for (const f of fs.readdirSync(files.convDir)) {
      if (!f.endsWith('.json')) continue;
      const c = readJson(path.join(files.convDir, f), null);
      if (c && UUID.test(c.id || '') && Array.isArray(c.messages)) convIndex.set(c.id, meta(c));
    }
  }

  const conversations = {
    list: () => [...convIndex.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    get: (id) => (convIndex.has(id) ? readJson(convFile(id), null) : null),
    create() {
      const now = Date.now();
      const c = { id: crypto.randomUUID(), title: 'Nouvelle conversation', createdAt: now, updatedAt: now, messages: [] };
      conversations.save(c, { silent: true });
      return c;
    },
    save(c, { silent } = {}) {
      c.updatedAt = Date.now();
      writeJson(convFile(c.id), c);
      convIndex.set(c.id, meta(c));
      if (!silent) emit('conversations');
    },
    rename(id, title) {
      const c = conversations.get(id);
      if (!c) return;
      c.title = String(title || '').trim().slice(0, 120) || c.title;
      conversations.save(c);
    },
    delete(id) {
      if (!convIndex.has(id)) return;
      fs.rmSync(convFile(id), { force: true });
      convIndex.delete(id);
      emit('conversations');
    },
    clear() {
      for (const id of [...convIndex.keys()]) fs.rmSync(convFile(id), { force: true });
      convIndex.clear();
      emit('conversations');
    },
    /** Recherche plein texte simple (titre et messages). */
    search(query) {
      const q = String(query || '').toLowerCase().trim();
      if (!q) return conversations.list();
      return conversations.list().filter((m) => {
        if (m.title.toLowerCase().includes(q)) return true;
        const c = conversations.get(m.id);
        return !!c && c.messages.some((x) => (x.role === 'user' || x.role === 'assistant') && String(x.content).toLowerCase().includes(q));
      });
    },
    prune(days) {
      if (!days) return 0;
      const limit = Date.now() - days * 86400000;
      let n = 0;
      for (const m of conversations.list()) if (m.updatedAt < limit) { conversations.delete(m.id); n++; }
      return n;
    },
    exists: (id) => convIndex.has(id),
  };

  // ---------------------------------------------------------------- Historique des actions
  let actionList = readJson(files.actions, []);
  if (!Array.isArray(actionList)) actionList = [];
  const saveActions = () => writeJson(files.actions, actionList);
  const actions = {
    list: (limit = 300) => actionList.slice(-limit).reverse(),
    get: (id) => actionList.find((a) => a.id === id) || null,
    byIds: (ids) => ids.map((id) => actionList.find((a) => a.id === id)).filter(Boolean),
    add(rec) {
      actionList.push(rec);
      if (actionList.length > 2000) actionList = actionList.slice(-2000);
      saveActions();
      emit('actions');
      return rec;
    },
    update(id, patch) {
      const rec = actions.get(id);
      if (!rec) return null;
      Object.assign(rec, patch);
      saveActions();
      emit('actions');
      return rec;
    },
    /** Au démarrage : les confirmations restées en attente n'ont plus de processus pour les traiter. */
    settleOrphans() {
      let touched = false;
      for (const a of actionList) if (a.status === 'awaiting' || a.status === 'running') { a.status = 'cancelled'; a.error = 'Interrompue par la fermeture de l’application.'; touched = true; }
      if (touched) saveActions();
    },
    clear() { actionList = []; saveActions(); emit('actions'); },
    prune(days) {
      if (!days) return;
      const limit = Date.now() - days * 86400000;
      actionList = actionList.filter((a) => a.ts >= limit);
      saveActions();
    },
  };

  function eraseAll() {
    conversations.clear();
    actions.clear();
    for (const p of [...state.providers]) providers.remove(p.id);
    state = { ...structuredClone(DEFAULTS), providers: [] };
    saveSettings();
    emit('settings');
  }

  return {
    dir, settings, providers, secrets: secretsApi, conversations, actions, eraseAll,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

module.exports = { createStore, DEFAULTS };
