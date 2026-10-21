import { h } from '../shared/dom.js';
import { actionCard } from '../shared/action-card.js';
import { sheet, seg, emptyState, confirmButton } from './ui.js';
import { toast } from '../shared/toast.js';

const pp = window.pp;

export async function mount() {
  let filter = 'all';
  const clear = confirmButton({ label: 'Effacer l’historique', confirmLabel: 'Confirmer l’effacement', ic: 'trash-2', onConfirm: async () => { await pp.privacy.clearActions(); toast('Historique des actions effacé.'); paint(); } });
  const view = sheet('Actions', 'Tout ce que PaperPilot a fait ou proposé de faire sur votre ordinateur, avec le résultat réel de chaque opération.', clear);
  const filters = seg([{ value: 'all', label: 'Toutes' }, { value: 'waiting', label: 'À confirmer' }, { value: 'done', label: 'Effectuées' }, { value: 'problem', label: 'Échecs et refus' }], filter, (v) => { filter = v; paint(); }, 'Filtrer');
  const list = h('div', { class: 'actlist', style: 'margin-top:1.1rem' });
  view.body.append(filters, list);

  async function paint() {
    const all = await pp.actions.list();
    const rows = all.filter((a) => filter === 'all' || (filter === 'waiting' && a.status === 'awaiting') || (filter === 'done' && a.status === 'done') || (filter === 'problem' && ['failed', 'denied', 'cancelled'].includes(a.status)));
    list.replaceChildren(...(rows.length ? rows.map((a) => actionCard(a, { showTime: true })) : [emptyState(all.length ? 'Rien dans cette vue' : 'Aucune action pour le moment', all.length ? 'Changez de filtre pour voir les autres opérations.' : 'Quand PaperPilot ouvrira un fichier, lancera une application ou rangera un dossier, l’opération sera consignée ici.')]));
  }
  await paint();
  const off = pp.on.state((s) => { if (s.scope === 'actions') paint(); });
  return { el: view.el, destroy: off };
}
