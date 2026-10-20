/**
 * Vue de conversation unique, utilisée telle quelle par la fenêtre principale (mode « main »)
 * et la fenêtre flottante (mode « quick ») : même rendu, mêmes événements, même état côté processus principal.
 */
import { h, icon, logo, clear } from './dom.js';
import { md } from './markdown.js';
import { actionCard } from './action-card.js';
import { toast } from './toast.js';

const pp = window.pp;
const { stripForDisplay } = window.PPProtocol;
const needsKey = (p) => p.kind !== 'ollama' && p.preset !== 'custom';
const KEY_ERRORS = new Set(['missing_key', 'no_provider', 'invalid_key', 'missing_model', 'forbidden']);

export function createChatView({ mode, hooks = {} }) {
  const S = { conv: null, actions: new Map(), running: false, streaming: null, providers: [], defaultId: null, stick: true, lastUser: '' };
  const turnEls = new Map(); // id du message -> { el, prose, acts }
  let raf = 0;
  let pop = null;

  // ------------------------------------------------------------------ Structure
  const inner = h('div', { class: 'thread-inner' });
  const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' }, inner);
  const noticeHost = h('div');
  const ta = h('textarea', { rows: 1, 'aria-label': 'Votre message', spellcheck: 'false', placeholder: mode === 'quick' ? 'Que souhaitez-vous faire ?' : 'Écrivez une demande, par exemple : retrouve mon dernier PDF de facturation' });
  const sendBtn = h('button', { class: 'send', type: 'button' });
  const modelBtn = h('button', { class: 'model-btn', type: 'button', title: 'Changer de modèle' });
  const hint = h('span', {}, mode === 'quick' ? 'Entrée pour envoyer' : 'Entrée pour envoyer, Maj+Entrée pour passer à la ligne');
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'composer-inner' },
      h('div', { class: 'composer-line' }, ta, sendBtn),
      h('div', { class: 'composer-meta' }, modelBtn, hint)));
  const root = h('section', { class: `chat chat-${mode}`, style: 'position:relative' }, thread, noticeHost, composer);

  // ------------------------------------------------------------------ Rendu des tours de parole
  const visible = () => (S.conv ? S.conv.messages.filter((m) => m.role !== 'tool') : []);
  const maybeScroll = (force) => { if (force || S.stick) thread.scrollTo({ top: thread.scrollHeight, behavior: 'auto' }); };
  thread.addEventListener('scroll', () => { S.stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 110; }, { passive: true });
  inner.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a) return;
    e.preventDefault();
    pp.system.openLink(a.dataset.link).catch((err) => toast(err.message, { kind: 'error' }));
  });

  const marginUser = () => h('div', { class: 'margin' }, mode === 'quick' ? h('span', { class: 'dot', title: 'Vous' }) : 'Vous');
  const marginAssistant = () => h('div', { class: 'margin' }, logo(17, 'plane'));

  function userTurn(msg, enter) {
    return h('article', { class: 'turn turn-user' + (enter ? ' enter' : ''), dataset: { id: msg.id } }, marginUser(), h('div', { class: 'body' }, h('div', { class: 'text' }, msg.content)));
  }

  function assistantTurn(msg, { enter, writing } = {}) {
    const prose = h('div', { class: 'prose', html: msg ? md(stripForDisplay(msg.content)) : '' });
    const acts = h('div', { class: 'acts' });
    const body = h('div', { class: 'body' }, prose, acts);
    const el = h('article', { class: 'turn turn-assistant' + (enter ? ' enter' : '') + (writing ? ' writing' : ''), dataset: { id: msg ? msg.id : '' } }, marginAssistant(), body);
    const refs = { el, prose, acts, body };
    if (msg) { for (const id of msg.actionIds || []) { const rec = S.actions.get(id); if (rec) acts.append(actionCard(rec)); } finishTurn(refs, msg); }
    return refs;
  }

  function finishTurn(refs, msg) {
    refs.body.querySelectorAll('.turn-tools, .interrupted').forEach((n) => n.remove());
    if (msg.interrupted) refs.body.append(h('div', { class: 'interrupted' }, 'Réponse interrompue.'));
    const copy = h('button', { class: 'icon-btn', type: 'button', title: 'Copier la réponse', 'aria-label': 'Copier la réponse' }, icon('copy'));
    copy.addEventListener('click', async () => { await pp.system.copy(stripForDisplay(msg.content)); toast('Réponse copiée.'); });
    const tools = h('div', { class: 'turn-tools' }, copy);
    const last = visible().at(-1);
    if (last && last.id === msg.id && !S.running) {
      const again = h('button', { class: 'icon-btn regen', type: 'button', title: 'Relancer cette réponse', 'aria-label': 'Relancer cette réponse' }, icon('rotate-cw'));
      again.addEventListener('click', () => retry());
      tools.append(again);
    }
    refs.body.append(tools);
  }

  function errorTurn(msg, enter, isLast) {
    const kids = [h('div', { class: 'prose' }, msg.content)];
    if (msg.detail) kids.push(h('details', { class: 'hint', style: 'margin-top:.4rem' }, h('summary', {}, 'Détail technique'), msg.detail));
    const row = h('div', { class: 'act-buttons retry' });
    if (isLast) {
      const again = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('rotate-cw'), 'Réessayer');
      again.addEventListener('click', () => retry());
      row.append(again);
    }
    if (KEY_ERRORS.has(msg.code)) row.append(h('button', { class: 'btn btn-text btn-sm', type: 'button', onclick: () => hooks.onOpenProviders && hooks.onOpenProviders() }, 'Ouvrir les fournisseurs'));
    if (row.childNodes.length) kids.push(row);
    return h('article', { class: 'turn turn-error' + (enter ? ' enter' : ''), dataset: { id: msg.id } }, h('div', { class: 'margin' }, icon('circle-alert')), h('div', { class: 'body' }, kids));
  }

  function appendTurn(msg, enter) {
    const isLast = true;
    if (msg.role === 'user') { S.lastUser = msg.content; inner.append(userTurn(msg, enter)); return; }
    if (msg.role === 'assistant') { const refs = assistantTurn(msg, { enter }); turnEls.set(msg.id, refs); inner.append(refs.el); return; }
    if (msg.role === 'error') inner.append(errorTurn(msg, enter, isLast));
  }

  function renderAll() {
    turnEls.clear();
    clear(inner);
    const msgs = visible();
    inner.classList.toggle('has-turns', msgs.length > 0);
    if (!msgs.length) { inner.append(greeting()); return; }
    msgs.forEach((m, i) => {
      if (m.role === 'error') inner.append(errorTurn(m, false, i === msgs.length - 1));
      else appendTurn(m, false);
    });
    for (const rec of [...S.actions.values()]) if (rec.status === 'awaiting' && !turnEls.has(rec.messageId)) { /* carte sans tour : ignorée */ }
    const user = [...msgs].reverse().find((m) => m.role === 'user');
    S.lastUser = user ? user.content : '';
  }

  function leaveEmpty() {
    if (inner.querySelector('.greeting')) { clear(inner); }
    inner.classList.add('has-turns');
    inner.querySelectorAll('.turn-error .retry button').forEach((b) => { if (b.textContent.includes('Réessayer')) b.remove(); });
    inner.querySelectorAll('.regen').forEach((b) => b.remove());
  }

  // ------------------------------------------------------------------ Accueil vide
  function greeting() {
    const items = [
      { ic: 'search', t: 'Rechercher un fichier', d: 'Par exemple : mon dernier PDF sur la facturation', run: () => prefill('Retrouve mon dernier document PDF sur la facturation') },
      { ic: 'wand-sparkles', t: 'Organiser mes fichiers', d: 'Ranger un dossier, avec aperçu et annulation possible', run: () => prefill('Aide-moi à organiser les fichiers de mon dossier Téléchargements') },
      { ic: 'message-square', t: 'Poser une question', d: 'Une explication, un texte à rédiger, une idée', run: () => { ta.focus(); } },
    ];
    const list = h('ul', { class: 'suggest' }, items.map((it) => h('li', {}, h('button', { type: 'button', onclick: it.run }, icon(it.ic), h('span', {}, h('span', { class: 't' }, it.t), h('span', { class: 'd' }, it.d))))));
    pp.conversations.list().then((all) => {
      const last = all.find((c) => c.messageCount > 0);
      if (!last || !list.isConnected) return;
      list.append(h('li', {}, h('button', { type: 'button', onclick: () => load(last.id) }, icon('history'), h('span', {}, h('span', { class: 't' }, 'Reprendre ma dernière conversation'), h('span', { class: 'd' }, last.title)))));
    }).catch(() => {});
    return h('div', { class: 'greeting' },
      h('h2', {}, mode === 'quick' ? 'Que puis-je faire ?' : 'Bonjour. Que puis-je faire pour vous ?'),
      mode === 'quick' ? null : h('p', { class: 'lede' }, 'Posez une question, retrouvez un fichier ou demandez-moi d’ouvrir quelque chose. Je vous demande toujours avant de modifier vos fichiers.'),
      list);
  }

  // ------------------------------------------------------------------ Flux de génération
  function startStreaming(id) {
    leaveEmpty();
    const refs = assistantTurn(null, { enter: true, writing: true });
    refs.el.dataset.id = id;
    turnEls.set(id, refs);
    inner.append(refs.el);
    S.streaming = { id, text: '', refs };
    maybeScroll();
  }
  function renderStreaming() {
    raf = 0;
    if (!S.streaming) return;
    S.streaming.refs.prose.innerHTML = md(stripForDisplay(S.streaming.text));
    maybeScroll();
  }
  function endStreaming(msg) {
    let refs = S.streaming && S.streaming.id === msg.id ? S.streaming.refs : turnEls.get(msg.id);
    if (!refs) { leaveEmpty(); refs = assistantTurn(null, { enter: true }); turnEls.set(msg.id, refs); inner.append(refs.el); }
    S.streaming = null;
    if (!S.conv.messages.some((m) => m.id === msg.id)) S.conv.messages.push(msg);
    refs.el.classList.remove('writing');
    refs.el.dataset.id = msg.id;
    refs.prose.innerHTML = md(stripForDisplay(msg.content));
    finishTurn(refs, msg);
    maybeScroll();
  }
  function discardStreaming(id) {
    const refs = turnEls.get(id);
    if (refs) refs.el.remove();
    turnEls.delete(id);
    if (S.streaming && S.streaming.id === id) S.streaming = null;
    if (!visible().length && !inner.children.length) renderAll();
  }
  function upsertAction(rec) {
    S.actions.set(rec.id, rec);
    const refs = turnEls.get(rec.messageId);
    if (!refs) return;
    const card = actionCard(rec);
    const old = refs.acts.querySelector(`[data-id="${rec.id}"]`);
    if (old) old.replaceWith(card); else refs.acts.append(card);
    maybeScroll();
  }

  function onEvent(e) {
    if (!S.conv || e.conversationId !== S.conv.id) return;
    hooks.onActivity && hooks.onActivity();
    switch (e.type) {
      case 'run-start': S.running = true; updateComposer(); break;
      case 'run-end':
        S.running = false;
        if (S.streaming) { S.streaming.refs.el.classList.remove('writing'); S.streaming = null; }
        updateComposer();
        break;
      case 'message':
        if (S.conv.messages.some((m) => m.id === e.message.id)) break;
        S.conv.messages.push(e.message);
        if (e.title) S.conv.title = e.title;
        leaveEmpty();
        appendTurn(e.message, true);
        maybeScroll(e.message.role === 'user');
        hooks.onConversation && hooks.onConversation(S.conv);
        break;
      case 'assistant-start': startStreaming(e.messageId); break;
      case 'delta':
        if (!S.streaming || S.streaming.id !== e.messageId) startStreaming(e.messageId);
        S.streaming.text += e.text;
        if (!raf) raf = requestAnimationFrame(renderStreaming);
        break;
      case 'assistant-end': endStreaming(e.message); break;
      case 'assistant-discard': discardStreaming(e.messageId); break;
      case 'action': upsertAction(e.action); break;
      case 'conversation-reset': load(S.conv.id); break;
      default: break;
    }
  }
  const offChat = pp.on.chat(onEvent);

  // ------------------------------------------------------------------ Saisie
  const defaultProvider = () => S.providers.find((p) => p.id === S.defaultId) || S.providers[0] || null;
  const usable = () => { const p = defaultProvider(); return !!(p && p.model && (p.hasKey || !needsKey(p))); };

  function updateComposer() {
    const has = ta.value.trim().length > 0;
    sendBtn.classList.toggle('stop', S.running);
    sendBtn.replaceChildren(icon(S.running ? 'square' : 'arrow-up'));
    sendBtn.setAttribute('aria-label', S.running ? 'Arrêter la génération' : 'Envoyer');
    sendBtn.title = S.running ? 'Arrêter (Échap)' : 'Envoyer (Entrée)';
    sendBtn.disabled = S.running ? false : !has || !usable();
  }

  function renderModel() {
    const p = defaultProvider();
    modelBtn.replaceChildren(h('span', {}, p ? `${mode === 'quick' ? '' : 'Modèle : '}${p.model || 'à choisir'} (${p.name})` : 'Aucun fournisseur'), icon('chevron-down'));
  }

  function renderNotice() {
    clear(noticeHost);
    const p = defaultProvider();
    let text = null, label = 'Configurer';
    if (!p) text = 'Aucun fournisseur IA n’est configuré.';
    else if (!p.model) { text = `Choisissez un modèle pour « ${p.name} ».`; label = 'Choisir le modèle'; }
    else if (needsKey(p) && !p.hasKey) { text = `La clé API de « ${p.name} » est manquante.`; label = 'Ajouter la clé'; }
    if (!text) return;
    noticeHost.append(h('div', { class: 'notice' }, h('span', {}, text), h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => hooks.onOpenProviders && hooks.onOpenProviders() }, label)));
  }

  async function refreshProviders() {
    try {
      const r = await pp.providers.list();
      S.providers = r.providers; S.defaultId = r.defaultId;
    } catch { /* conservé tel quel */ }
    renderModel(); renderNotice(); updateComposer();
  }
  pp.on.state((s) => { if (s.scope === 'providers') refreshProviders(); });

  function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 152) + 'px'; }

  async function submit() {
    const text = ta.value.trim();
    if (!text || S.running) return;
    if (!usable()) { renderNotice(); toast('Configurez d’abord un fournisseur IA avec un modèle et une clé.', { kind: 'error' }); return; }
    try {
      if (!S.conv) {
        const c = await pp.conversations.create();
        S.conv = c; S.actions = new Map();
        hooks.onConversation && hooks.onConversation(c);
      }
      ta.value = ''; autosize(); updateComposer();
      S.stick = true;
      hooks.onActivity && hooks.onActivity();
      await pp.chat.send({ conversationId: S.conv.id, text, surface: mode });
    } catch (e) {
      ta.value = text; autosize(); updateComposer();
      toast(e.message, { kind: 'error' });
    }
  }

  async function retry() {
    if (!S.conv || S.running) return;
    try { await pp.chat.retry({ conversationId: S.conv.id, surface: mode }); } catch (e) { toast(e.message, { kind: 'error' }); }
  }

  function prefill(text) { ta.value = text; autosize(); updateComposer(); ta.focus(); ta.setSelectionRange(text.length, text.length); }

  ta.addEventListener('input', () => { autosize(); updateComposer(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === 'ArrowUp' && !ta.value && S.lastUser) { e.preventDefault(); prefill(S.lastUser); }
    else if (e.key === 'Escape' && hooks.onEscape) { e.preventDefault(); hooks.onEscape(e); }
  });
  sendBtn.addEventListener('click', () => { if (S.running) cancel(); else submit(); });

  // ------------------------------------------------------------------ Menu du modèle
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', outside, true); } }
  function outside(e) { if (pop && !pop.contains(e.target) && !modelBtn.contains(e.target)) closePop(); }
  modelBtn.addEventListener('click', () => {
    if (pop) { closePop(); return; }
    const r = modelBtn.getBoundingClientRect(), rr = root.getBoundingClientRect();
    pop = h('div', { class: 'pop', role: 'menu' },
      ...S.providers.map((p) => h('button', { type: 'button', role: 'menuitem', onclick: async () => { closePop(); try { await pp.providers.setDefault(p.id); } catch (e) { toast(e.message, { kind: 'error' }); } } },
        h('span', {}, p.name, h('small', {}, p.model || 'modèle non défini')), p.id === S.defaultId ? icon('check') : h('span'))),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { closePop(); hooks.onOpenProviders && hooks.onOpenProviders(); } }, h('span', {}, 'Gérer les fournisseurs'), icon('chevron-right')));
    pop.style.left = Math.max(8, r.left - rr.left) + 'px';
    pop.style.bottom = rr.bottom - r.top + 6 + 'px';
    root.append(pop);
    document.addEventListener('mousedown', outside, true);
  });

  // ------------------------------------------------------------------ API
  async function load(id) {
    closePop();
    S.streaming = null; S.stick = true;
    if (!id) { S.conv = null; S.actions = new Map(); S.running = false; renderAll(); updateComposer(); hooks.onConversation && hooks.onConversation(null); return; }
    const r = await pp.conversations.get(id);
    if (!r) { S.conv = null; S.actions = new Map(); S.running = false; renderAll(); updateComposer(); return; }
    S.conv = r.conversation; S.actions = new Map(r.actions.map((a) => [a.id, a])); S.running = r.running;
    renderAll(); updateComposer(); maybeScroll(true);
    hooks.onConversation && hooks.onConversation(S.conv);
  }

  function cancel() {
    if (!S.conv || !S.running) return false;
    pp.chat.cancel(S.conv.id);
    return true;
  }

  renderAll(); renderModel(); updateComposer(); refreshProviders();

  return {
    el: root,
    load, cancel, prefill, retry, refreshProviders,
    newConversation: () => load(null),
    focus: () => ta.focus(),
    currentId: () => (S.conv ? S.conv.id : null),
    current: () => S.conv,
    isRunning: () => S.running,
    hasMessages: () => visible().length > 0,
    destroy: () => { offChat(); closePop(); },
  };
}
