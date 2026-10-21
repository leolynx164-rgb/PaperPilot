'use strict';
/**
 * Pont sécurisé entre les fenêtres et le processus principal.
 * Les fenêtres n'ont aucun accès à Node.js : elles ne peuvent appeler que les fonctions listées ici.
 * Les clés API ne sont jamais renvoyées aux fenêtres.
 */
const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.__error) throw new Error(r.__error);
  return r && r.v;
}
function on(channel, fn) {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('pp', {
  settings: { get: () => invoke('settings:get'), update: (patch) => invoke('settings:update', patch) },
  providers: {
    presets: () => invoke('providers:presets'),
    list: () => invoke('providers:list'),
    save: (provider, apiKey) => invoke('providers:save', provider, apiKey),
    remove: (id) => invoke('providers:remove', id),
    setDefault: (id) => invoke('providers:setDefault', id),
    test: (provider, apiKey) => invoke('providers:test', provider, apiKey),
    models: (provider, apiKey) => invoke('providers:models', provider, apiKey),
  },
  conversations: {
    list: (query) => invoke('conversations:list', query),
    get: (id) => invoke('conversations:get', id),
    create: () => invoke('conversations:create'),
    remove: (id) => invoke('conversations:remove', id),
    rename: (id, title) => invoke('conversations:rename', id, title),
  },
  chat: {
    send: (payload) => invoke('chat:send', payload),
    cancel: (conversationId) => invoke('chat:cancel', conversationId),
    retry: (payload) => invoke('chat:retry', payload),
    running: () => invoke('chat:running'),
  },
  actions: {
    list: () => invoke('actions:list'),
    confirm: (id, approve) => invoke('actions:confirm', id, approve),
    undo: (id) => invoke('actions:undo', id),
  },
  files: {
    search: (opts) => invoke('files:search', opts),
    cancelSearch: (id) => invoke('files:cancelSearch', id),
    open: (p) => invoke('files:open', p),
    reveal: (p) => invoke('files:reveal', p),
  },
  folders: { add: () => invoke('folders:add'), remove: (p) => invoke('folders:remove', p) },
  apps: { list: () => invoke('apps:list'), setAllowed: (id, allowed) => invoke('apps:setAllowed', id, allowed) },
  shortcut: { status: () => invoke('shortcut:status'), set: (accelerator) => invoke('shortcut:set', accelerator) },
  windows: {
    openMain: (section, conversationId) => invoke('windows:openMain', section, conversationId),
    hideQuick: () => invoke('windows:hideQuick'),
    toggleQuick: () => invoke('windows:toggleQuick'),
    setPinned: (pinned) => invoke('windows:setPinned', pinned),
    isPinned: () => invoke('windows:isPinned'),
  },
  system: {
    info: () => invoke('system:info'),
    copy: (text) => invoke('system:copy', text),
    openLink: (url) => invoke('system:openLink', url),
    setAutostart: (enabled) => invoke('system:setAutostart', enabled),
    quit: () => invoke('system:quit'),
  },
  privacy: {
    clearConversations: () => invoke('privacy:clearConversations'),
    clearActions: () => invoke('privacy:clearActions'),
    exportData: () => invoke('privacy:exportData'),
    eraseAll: () => invoke('privacy:eraseAll'),
  },
  on: {
    chat: (fn) => on('chat:event', fn),
    state: (fn) => on('state:changed', fn),
    nav: (fn) => on('nav', fn),
    quickShown: (fn) => on('quick:shown', fn),
    searchProgress: (fn) => on('files:progress', fn),
  },
});
