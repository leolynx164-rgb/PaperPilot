import { h, icon, logo } from '../shared/dom.js';
import { applyTheme } from '../shared/theme.js';
import { createChatView } from '../shared/chat-view.js';

const pp = window.pp;
const RESUME_MS = 10 * 60 * 1000;
let lastActivity = 0;

async function boot() {
  applyTheme(await pp.settings.get());
  pp.on.state(async ({ scope }) => { if (scope === 'settings') applyTheme(await pp.settings.get()); });

  const title = h('span', { class: 'conv-title' });
  const chat = createChatView({
    mode: 'quick',
    hooks: {
      onOpenProviders: () => pp.windows.openMain('providers'),
      onEscape: () => { if (!chat.cancel()) pp.windows.hideQuick(); },
      onActivity: () => { lastActivity = Date.now(); },
      onConversation: (c) => { title.textContent = c ? c.title : ''; },
    },
  });

  const pinBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-pressed': 'false', title: 'Garder la fenêtre ouverte', 'aria-label': 'Garder la fenêtre ouverte' }, icon('pin'));
  pinBtn.addEventListener('click', async () => {
    const on = pinBtn.getAttribute('aria-pressed') !== 'true';
    await pp.windows.setPinned(on);
    pinBtn.setAttribute('aria-pressed', String(on));
    pinBtn.replaceChildren(icon(on ? 'pin-off' : 'pin'));
    pinBtn.title = on ? 'Ne plus garder la fenêtre ouverte' : 'Garder la fenêtre ouverte';
  });
  const btn = (ic, label, fn) => h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(ic));

  const panel = h('div', { class: 'panel grain' },
    h('header', { class: 'qhead' },
      h('div', { class: 'brand' }, logo(18), h('b', {}, 'PaperPilot'), title),
      h('div', { class: 'tools' },
        btn('plus', 'Nouvelle conversation (Ctrl+N)', () => { chat.newConversation(); chat.focus(); }),
        pinBtn,
        btn('maximize-2', 'Ouvrir l’application complète', () => pp.windows.openMain('home', chat.currentId() || undefined)),
        btn('sliders-horizontal', 'Paramètres', () => pp.windows.openMain('settings')),
        btn('x', 'Fermer (Échap)', () => pp.windows.hideQuick()))),
    h('div', { class: 'chat-wrap' }, chat.el));
  document.getElementById('app').append(panel);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); chat.newConversation(); chat.focus(); }
  });

  pp.on.quickShown(async () => {
    panel.classList.remove('enter');
    void panel.offsetWidth;
    panel.classList.add('enter');
    // On reprend la conversation en cours si elle est récente ; sinon page blanche.
    if (chat.currentId() && (chat.isRunning() || (chat.hasMessages() && Date.now() - lastActivity < RESUME_MS))) { await chat.load(chat.currentId()); }
    else await chat.newConversation();
    chat.focus();
  });
  chat.focus();
}
boot().catch((e) => { document.body.textContent = 'Erreur de démarrage : ' + e.message; });
