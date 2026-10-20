'use strict';
/** Canaux IPC. Chaque appel vérifie que l'expéditeur est une page de l'application, puis renvoie { v } ou { __error }. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, dialog, clipboard, shell, BrowserWindow, app } = require('electron');
const { PRESETS, adapterFor, needsKey, testConnection } = require('./providers');
const { search, KINDS } = require('./files/search');
const apps = require('./apps');

function registerIpc({ store, agent, actions, windows, shortcuts, rendererRoot, system }) {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const url = (event.senderFrame && event.senderFrame.url) || '';
        if (!url.startsWith(rendererRoot)) throw new Error('Appel refusé : origine inconnue.');
        return { v: await fn(event, ...args) };
      } catch (e) {
        return { __error: e && e.message ? e.message : String(e) };
      }
    });
  };

  // ---------------------------------------------------------------- Paramètres
  handle('settings:get', () => store.settings.get());
  handle('settings:update', (_e, patch) => store.settings.update(patch));

  // ---------------------------------------------------------------- Fournisseurs
  /** Fournisseur à tester ou interroger : brouillon de l'interface, complété par la clé déjà enregistrée. */
  function resolveDraft(draft, apiKey) {
    const saved = draft && draft.id ? store.providers.get(draft.id) : null;
    const provider = { id: draft.id || null, preset: draft.preset || 'custom', kind: draft.kind, name: draft.name || 'Fournisseur', baseUrl: String(draft.baseUrl || '').trim().replace(/\/+$/, ''), model: String(draft.model || '').trim(), params: { temperature: null, maxTokens: null } };
    const p = draft.params || {};
    if (p.temperature !== '' && p.temperature != null && !Number.isNaN(Number(p.temperature))) provider.params.temperature = Number(p.temperature);
    if (p.maxTokens !== '' && p.maxTokens != null && !Number.isNaN(Number(p.maxTokens))) provider.params.maxTokens = Number(p.maxTokens);
    const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : saved ? store.providers.getKey(saved.id) : null;
    adapterFor(provider);
    return { provider, key };
  }
  handle('providers:presets', () => PRESETS);
  handle('providers:list', () => ({ providers: store.providers.list(), defaultId: store.providers.defaultId(), secrets: store.secrets.status() }));
  handle('providers:save', (_e, provider, apiKey) => store.providers.save(provider, apiKey));
  handle('providers:remove', (_e, id) => store.providers.remove(id));
  handle('providers:setDefault', (_e, id) => store.providers.setDefault(id));
  handle('providers:test', async (_e, draft, apiKey) => {
    const { provider, key } = resolveDraft(draft, apiKey);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const result = await testConnection(provider, key, ac.signal);
      // Le résultat n'est mémorisé que pour une configuration enregistrée et inchangée.
      if (draft.id && store.providers.get(draft.id)) {
        const saved = store.providers.get(draft.id);
        if (saved.baseUrl === provider.baseUrl && saved.model === provider.model && saved.kind === provider.kind) store.providers.setVerified(draft.id, result);
      }
      return result;
    } finally { clearTimeout(timer); }
  });
  handle('providers:models', async (_e, draft, apiKey) => {
    const { provider, key } = resolveDraft(draft, apiKey);
    if (needsKey(provider) && !key) throw new Error('Saisissez d’abord une clé API pour charger la liste des modèles.');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try { return await adapterFor(provider).listModels({ provider, apiKey: key, signal: ac.signal }); }
    catch (e) { throw new Error(e.userMessage || e.message); }
    finally { clearTimeout(timer); }
  });

  // ---------------------------------------------------------------- Conversations et chat
  handle('conversations:list', (_e, query) => store.conversations.search(query));
  handle('conversations:get', (_e, id) => {
    const conversation = store.conversations.get(id);
    if (!conversation) return null;
    const ids = conversation.messages.flatMap((m) => m.actionIds || []);
    return { conversation, actions: store.actions.byIds(ids), running: agent.isRunning(id) };
  });
  handle('conversations:create', () => store.conversations.create());
  handle('conversations:remove', (_e, id) => { agent.cancel(id); store.conversations.delete(id); });
  handle('conversations:rename', (_e, id, title) => store.conversations.rename(id, title));
  handle('chat:send', (_e, payload) => agent.send(payload || {}));
  handle('chat:cancel', (_e, id) => agent.cancel(id));
  handle('chat:retry', (_e, payload) => agent.retry(payload || {}));
  handle('chat:running', () => agent.runningIds());

  // ---------------------------------------------------------------- Actions
  handle('actions:list', () => store.actions.list(300));
  handle('actions:confirm', (_e, id, approve) => agent.confirm(id, !!approve));
  handle('actions:undo', (_e, id) => agent.undo(id));

  // ---------------------------------------------------------------- Fichiers
  const searches = new Map();
  handle('files:search', async (event, opts = {}) => {
    const id = String(opts.searchId || crypto.randomUUID());
    const ac = new AbortController();
    searches.set(id, ac);
    try {
      let roots = await actions.paths.allowedRoots();
      if (Array.isArray(opts.folders) && opts.folders.length) {
        const wanted = new Set(await Promise.all(opts.folders.map((f) => actions.paths.assertAllowed(f, { mustExist: true }))));
        roots = roots.filter((r) => wanted.has(r));
      }
      if (!roots.length) return { results: [], total: 0, scanned: 0, noFolders: true, unreadableCount: 0, unreadable: [], truncated: false };
      const kind = KINDS.includes(opts.kind) ? opts.kind : undefined;
      const sort = ['relevance', 'recent', 'name', 'size'].includes(opts.sort) ? opts.sort : undefined;
      return await search({
        roots, query: String(opts.query || '').slice(0, 200), kind, sort, limit: 200, signal: ac.signal,
        onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('files:progress', { searchId: id, ...p }); },
      });
    } finally { searches.delete(id); }
  });
  handle('files:cancelSearch', (_e, id) => { const ac = searches.get(id); if (ac) ac.abort(); });
  handle('files:open', async (_e, p) => (await actions.defs.open_file.run({ path: String(p) }, {})).summary);
  handle('files:reveal', async (_e, p) => (await actions.revealFile(String(p))).summary);

  handle('folders:add', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { title: 'Autoriser des dossiers', properties: ['openDirectory', 'multiSelections'] });
    if (res.canceled) return store.settings.get().allowedFolders;
    const current = store.settings.get().allowedFolders;
    const next = [...new Set([...current, ...res.filePaths.map((p) => fs.realpathSync(p))])];
    return store.settings.update({ allowedFolders: next }).allowedFolders;
  });
  handle('folders:remove', (_e, p) => store.settings.update({ allowedFolders: store.settings.get().allowedFolders.filter((f) => f !== p) }).allowedFolders);

  handle('apps:list', () => {
    const allowed = new Set(store.settings.get().allowedApps);
    return apps.listApps({ fresh: true }).map((a) => ({ id: a.id, name: a.name, comment: a.comment, allowed: allowed.has(a.id) }));
  });
  handle('apps:setAllowed', (_e, id, allowed) => {
    if (!apps.listApps().some((a) => a.id === id)) throw new Error('Application inconnue.');
    const set = new Set(store.settings.get().allowedApps);
    if (allowed) set.add(id); else set.delete(id);
    store.settings.update({ allowedApps: [...set] });
  });

  // ---------------------------------------------------------------- Fenêtres, raccourci, système
  handle('shortcut:status', () => shortcuts.status());
  handle('shortcut:set', (_e, accelerator) => shortcuts.set(String(accelerator)));
  handle('windows:openMain', (_e, section, conversationId) => windows.showMain(section, conversationId));
  handle('windows:hideQuick', () => windows.hideQuick());
  handle('windows:toggleQuick', () => windows.toggleQuick());
  handle('windows:setPinned', (_e, pinned) => windows.setPinned(!!pinned));
  handle('windows:isPinned', () => windows.isPinned());

  handle('system:info', () => system.info());
  handle('system:copy', (_e, text) => { clipboard.writeText(String(text).slice(0, 200000)); });
  handle('system:openLink', async (_e, url) => {
    let u;
    try { u = new URL(String(url)); } catch { throw new Error('Adresse invalide.'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Seules les adresses http et https peuvent être ouvertes.');
    await shell.openExternal(u.href);
  });
  handle('system:setAutostart', (_e, enabled) => system.setAutostart(!!enabled));
  handle('system:quit', () => app.quit());

  // ---------------------------------------------------------------- Confidentialité
  handle('privacy:clearConversations', () => { for (const id of agent.runningIds()) agent.cancel(id); store.conversations.clear(); });
  handle('privacy:clearActions', () => store.actions.clear());
  handle('privacy:eraseAll', () => { for (const id of agent.runningIds()) agent.cancel(id); store.eraseAll(); });
  handle('privacy:exportData', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, { title: 'Exporter mes données', defaultPath: path.join(app.getPath('documents'), 'paperpilot-export.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    const data = {
      exportedAt: new Date().toISOString(),
      note: 'Les clés API ne sont jamais incluses dans cet export.',
      settings: store.settings.get(),
      providers: store.providers.list().map(({ keyHint, hasKey, keyReadable, ...p }) => p),
      conversations: store.conversations.list().map((m) => store.conversations.get(m.id)),
      actions: store.actions.list(2000),
    };
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    return { ok: true, path: res.filePath };
  });
}

module.exports = { registerIpc };
