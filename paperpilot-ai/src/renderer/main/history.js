import { h, icon } from '../shared/dom.js';
import { fmtDate, dayGroup } from '../shared/format.js';
import { debounce } from '../shared/dom.js';
import { sheet, emptyState, confirmButton } from './ui.js';
import { toast } from '../shared/toast.js';

const pp = window.pp;

export async function mount(app) {
  const view = sheet('Historique', 'Vos discussions, de la plus récente à la plus ancienne. Elles sont enregistrées sur cet ordinateur uniquement.');
  const input = h('input', { type: 'search', placeholder: 'Rechercher dans les titres et les messages', 'aria-label': 'Rechercher dans l’historique' });
  const list = h('div');
  view.body.append(h('div', { class: 'searchline' }, icon('search'), input), list);

  async function paint() {
    const q = input.value.trim();
    const all = (await pp.conversations.list(q)).filter((c) => c.messageCount > 0);
    list.replaceChildren();
    if (!all.length) {
      list.append(q ? emptyState('Aucun résultat', `Aucune conversation ne contient « ${q} ».`) : emptyState('Pas encore de conversation', 'Vos discussions apparaîtront ici dès votre premier message.'));
      return;
    }
    let last = '';
    for (const c of all) {
      const g = dayGroup(c.updatedAt);
      if (g !== last) { list.append(h('div', { class: 'group-label' }, g)); last = g; }
      const open = () => app.navigate('home', { conversationId: c.id });
      const del = confirmButton({ label: '', confirmLabel: 'Supprimer ?', ic: 'trash-2', cls: 'icon-btn del', onConfirm: async () => { await pp.conversations.remove(c.id); toast('Conversation supprimée.'); paint(); } });
      del.setAttribute('aria-label', 'Supprimer la conversation');
      del.title = 'Supprimer';
      list.append(h('div', { class: 'conv-wrap' },
        h('div', { class: 'conv', role: 'button', tabindex: 0, onclick: (e) => { if (!e.target.closest('.del')) open(); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
          h('div', { style: 'min-width:0' }, h('div', { class: 't' }, c.title), h('div', { class: 'p' }, c.preview)),
          h('div', { class: 'w' }, fmtDate(c.updatedAt)), del)));
    }
  }
  input.addEventListener('input', debounce(paint, 160));
  await paint();
  const off = pp.on.state((s) => { if (s.scope === 'conversations') paint(); });
  return { el: view.el, destroy: off, focus: () => input.focus() };
}
