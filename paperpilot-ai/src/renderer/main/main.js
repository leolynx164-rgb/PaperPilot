import { h, icon, logo, clear } from '../shared/dom.js';
import { applyTheme } from '../shared/theme.js';
import { createChatView } from '../shared/chat-view.js';
import { toast } from '../shared/toast.js';
import { prettyAccel } from '../shared/format.js';

const pp = window.pp;

const NAV = [
  { id: 'home', label: 'Conversation', icon: 'message-square' },
  { id: 'history', label: 'Historique', icon: 'history' },
  { id: 'files', label: 'Fichiers', icon: 'folder-search' },
  { id: 'actions', label: 'Actions', icon: 'list-checks' },
  { group: 'Réglages' },
  { id: 'providers', label: 'Fournisseurs IA', icon: 'cpu' },
  { id: 'settings', label: 'Général', icon: 'sliders-horizontal' },
  { id: 'appearance', label: 'Apparence', icon: 'palette' },
  { id: 'privacy', label: 'Confidentialité', icon: 'shield-check' },
];
const MODULES = { history: './history.js', files: './files.js', actions: './actions.js', providers: './providers.js', settings: './settings.js', appearance: './appearance.js', privacy: './privacy.js' };

const app = { settings: null, shortcut: null, section: null, current: null, navigate: null, chat: null, refresh: null };
let pendingNav = null;
pp.on.nav((p) => { if (app.navigate) app.navigate(p.section, { conversationId: p.conversationId }); else pendingNav = p; });

const sheetHost = h('div', { class: 'sheet grain' });
const navEl = h('nav', { class: 'nav', 'aria-label': 'Sections' });
const footEl = h('div', { class: 'side-foot' });
const pendingBadge = h('span', { class: 'count', hidden: true });

function buildSide() {
  navEl.replaceChildren(...NAV.map((n, i) => {
    if (n.group) return h('div', { class: 'nav-label' }, n.group);
    const b = h('button', { type: 'button', dataset: { id: n.id }, title: `${n.label} (Ctrl+${NAV.filter((x) => x.id).findIndex((x) => x.id === n.id) + 1})` }, icon(n.icon), n.label);
    if (n.id === 'actions') b.append(pendingBadge);
    b.addEventListener('click', () => app.navigate(n.id));
    return b;
  }));
}

function paintFoot() {
  const sc = app.shortcut;
  const kids = [h('div', {}, 'Fenêtre flottante : ', h('kbd', {}, prettyAccel(sc.accelerator)))];
  if (!sc.registered) kids.push(h('div', { class: 'warn', style: 'margin-top:.3rem' }, sc.session === 'wayland' ? 'Raccourci à configurer dans KDE (voir Général).' : 'Raccourci indisponible : à changer dans Général.'));
  footEl.replaceChildren(...kids);
}

async function refreshPending() {
  try {
    const list = await pp.actions.list();
    const n = list.filter((a) => a.status === 'awaiting').length;
    pendingBadge.textContent = String(n);
    pendingBadge.hidden = n === 0;
  } catch { /* ignoré */ }
}

// ---------------------------------------------------------------- Conversation (accueil)
const chatTitle = h('div', { class: 'title' }, 'Nouvelle conversation');
const chat = createChatView({
  mode: 'main',
  hooks: {
    onOpenProviders: () => app.navigate('providers'),
    onConversation: (c) => { chatTitle.textContent = c ? c.title : 'Nouvelle conversation'; },
  },
});
app.chat = chat;
const newBtn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: 'Nouvelle conversation (Ctrl+N)', onclick: () => { chat.newConversation(); chat.focus(); } }, icon('plus'), 'Nouvelle conversation');
const homePanel = h('div', { class: 'sheet-view' }, h('div', { class: 'chat-head' }, chatTitle, newBtn), h('div', { style: 'flex:1;min-height:0' }, chat.el));

async function mountHome() {
  await app.refresh();
  if (!app.settings.onboarded) {
    const { welcome } = await import('./welcome.js');
    sheetHost.replaceChildren(welcome(app));
    return;
  }
  sheetHost.replaceChildren(homePanel);
  chat.focus();
}

// ---------------------------------------------------------------- Navigation
let cleanup = null;
app.navigate = async (id, opts = {}) => {
  if (!NAV.some((n) => n.id === id)) id = 'home';
  if (cleanup) { try { cleanup(); } catch { /* ignoré */ } cleanup = null; }
  app.section = id;
  navEl.querySelectorAll('button').forEach((b) => (b.dataset.id === id ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (id === 'home') {
    if (opts.conversationId) await chat.load(opts.conversationId);
    else if (opts.fresh) await chat.newConversation();
    await mountHome();
    return;
  }
  const mod = await import(MODULES[id]);
  const view = await mod.mount(app, opts);
  sheetHost.replaceChildren(view.el);
  cleanup = view.destroy || null;
  if (view.focus) view.focus();
};

app.refresh = async () => {
  app.settings = await pp.settings.get();
  applyTheme(app.settings);
};

// ---------------------------------------------------------------- Démarrage
async function boot() {
  [app.settings, app.shortcut] = await Promise.all([pp.settings.get(), pp.shortcut.status()]);
  applyTheme(app.settings);
  buildSide();
  paintFoot();
  document.getElementById('app').append(
    h('aside', { class: 'side grain' }, h('div', { class: 'brand' }, logo(24), h('b', {}, 'PaperPilot')), navEl, footEl),
    h('main', { class: 'stage' }, sheetHost));

  pp.on.state(async ({ scope }) => {
    if (scope === 'settings') { await app.refresh(); app.shortcut = await pp.shortcut.status(); paintFoot(); }
    if (scope === 'actions') refreshPending();
  });
  pp.on.chat((e) => { if (e.type === 'action') refreshPending(); });
  refreshPending();

  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const ids = NAV.filter((n) => n.id).map((n) => n.id);
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); app.navigate('home', { fresh: true }); }
    else if (e.key === ',') { e.preventDefault(); app.navigate('settings'); }
    else if (/^[1-8]$/.test(e.key)) { e.preventDefault(); app.navigate(ids[Number(e.key) - 1]); }
  });

  // Les conversations non vides existantes ouvrent directement la dernière ; sinon on part d'une page blanche.
  await app.navigate(pendingNav ? pendingNav.section : 'home', pendingNav ? { conversationId: pendingNav.conversationId } : {});
  pendingNav = null;
}
boot().catch((e) => { document.body.textContent = 'Erreur de démarrage : ' + e.message; });
