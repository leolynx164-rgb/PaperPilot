import { h, icon, debounce } from '../shared/dom.js';
import { fileRow } from '../shared/action-card.js';
import { plural } from '../shared/format.js';
import { sheet, seg, emptyState, status } from './ui.js';

const pp = window.pp;
const KINDS = [['', 'Tous les types'], ['document', 'Documents'], ['pdf', 'PDF'], ['word', 'Word et texte enrichi'], ['spreadsheet', 'Tableurs'], ['presentation', 'Présentations'], ['image', 'Images'], ['audio', 'Audio'], ['video', 'Vidéos'], ['archive', 'Archives'], ['code', 'Code']];

export async function mount(app) {
  const settings = await pp.settings.get();
  const view = sheet('Fichiers', 'Recherche par nom dans les dossiers que vous avez autorisés.');
  const input = h('input', { type: 'search', placeholder: 'Nom du fichier, par exemple : facture mars', 'aria-label': 'Nom du fichier' });
  const kind = h('select', { class: 'select', style: 'width:auto', 'aria-label': 'Type de fichier' }, KINDS.map(([v, l]) => h('option', { value: v }, l)));
  let sort = 'relevance';
  const sortSeg = seg([{ value: 'relevance', label: 'Pertinence' }, { value: 'recent', label: 'Plus récents' }, { value: 'name', label: 'Nom' }, { value: 'size', label: 'Taille' }], sort, (v) => { sort = v; run(); }, 'Trier par');
  const scope = new Set();
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Dossiers explorés' });
  const info = h('div');
  const results = h('div');
  view.body.append(h('div', { class: 'searchline' }, icon('search'), input), h('div', { class: 'filters' }, kind, sortSeg), chips, info, results);

  const folders = settings.allowedFolders;
  const paintChips = () => {
    chips.replaceChildren(h('span', { class: 'hint' }, 'Dossiers explorés :'), ...folders.map((f) => {
      const b = h('button', { class: 'chip', type: 'button', title: f, 'aria-pressed': String(scope.has(f)), onclick: () => { scope.has(f) ? scope.delete(f) : scope.add(f); paintChips(); run(); } }, icon('folder'), f.split('/').filter(Boolean).pop());
      return b;
    }), h('button', { class: 'btn btn-text btn-sm', type: 'button', onclick: () => app.navigate('privacy') }, scope.size ? 'Gérer les dossiers' : 'Tous (gérer les dossiers)'));
  };
  paintChips();

  let searchId = 0, current = null;
  const offProgress = pp.on.searchProgress((p) => {
    if (p.searchId !== current) return;
    info.replaceChildren(h('div', { class: 'results-info' }, h('span', { class: 'spin' }), `Exploration en cours, ${p.scanned.toLocaleString('fr-FR')} fichiers parcourus`));
  });

  async function run() {
    const q = input.value.trim();
    if (current) pp.files.cancelSearch(current);
    if (!q && !kind.value) { current = null; info.replaceChildren(); results.replaceChildren(emptyState('Que cherchez-vous ?', 'Saisissez une partie du nom, ou choisissez un type de fichier pour voir les plus récents.')); return; }
    if (!folders.length) { results.replaceChildren(emptyState('Aucun dossier autorisé', 'Autorisez au moins un dossier pour lancer une recherche.', h('button', { class: 'btn btn-primary', type: 'button', onclick: () => app.navigate('privacy') }, 'Choisir des dossiers'))); return; }
    const id = 's' + ++searchId + '-' + Date.now();
    current = id;
    info.replaceChildren(h('div', { class: 'results-info' }, h('span', { class: 'spin' }), 'Recherche en cours'));
    try {
      const r = await pp.files.search({ searchId: id, query: q, kind: kind.value || undefined, sort: q ? sort : (sort === 'relevance' ? 'recent' : sort), folders: [...scope] });
      if (current !== id) return;
      current = null;
      const notes = [];
      if (r.truncated) notes.push('Exploration incomplète : le délai a été dépassé.');
      if (r.unreadableCount) notes.push(`${plural(r.unreadableCount, 'élément inaccessible ignoré', 'éléments inaccessibles ignorés')}.`);
      info.replaceChildren(h('div', { class: 'results-info' }, r.cancelled ? 'Recherche annulée.' : `${plural(r.total, 'fichier trouvé', 'fichiers trouvés')}${r.total > r.results.length ? `, ${r.results.length} affichés` : ''} sur ${r.scanned.toLocaleString('fr-FR')} parcourus.`));
      if (notes.length) info.append(status('', notes.join(' ')));
      results.replaceChildren(r.results.length ? h('div', { class: 'results' }, h('div', { class: 'frows', role: 'list' }, r.results.map(fileRow))) : emptyState('Aucun fichier trouvé', 'Essayez moins de mots, une autre orthographe, ou élargissez les dossiers explorés.'));
    } catch (e) {
      if (current !== id) return;
      current = null;
      info.replaceChildren(status('bad', e.message));
    }
  }
  const debounced = debounce(run, 260);
  input.addEventListener('input', debounced);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  kind.addEventListener('change', run);
  run();
  return { el: view.el, destroy: () => { offProgress(); if (current) pp.files.cancelSearch(current); }, focus: () => input.focus() };
}
