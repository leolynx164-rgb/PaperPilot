import { h } from '../shared/dom.js';
import { applyTheme } from '../shared/theme.js';
import { sheet, group, row, toggle, seg } from './ui.js';

const pp = window.pp;

export async function mount(app) {
  const s = await pp.settings.get();
  const view = sheet('Apparence', 'Une page de carnet, des tons naturels. Les changements s’appliquent aux deux fenêtres.');
  const set = async (patch) => {
    const next = { ...app.settings, appearance: { ...app.settings.appearance, ...patch } };
    app.settings = next; applyTheme(next);
    await pp.settings.update({ appearance: patch });
  };
  const accent = seg([
    { value: 'sage', label: 'Sauge', swatch: '#3E5B4A' },
    { value: 'eucalyptus', label: 'Eucalyptus', swatch: '#2F5F59' },
    { value: 'olive', label: 'Olive', swatch: '#565E3E' },
  ], s.appearance.accent, (v) => set({ accent: v }), 'Teinte d’accent');
  const size = seg([{ value: 'small', label: 'Compacte' }, { value: 'medium', label: 'Standard' }, { value: 'large', label: 'Confortable' }], s.appearance.textSize, (v) => set({ textSize: v }), 'Taille du texte');
  view.body.append(
    group('Couleur'),
    row('Teinte d’accent', 'Trois verts, pour rester dans une palette calme.', accent),
    group('Lecture'),
    row('Taille du texte', 'Agrandit ou resserre toute l’interface.', size),
    group('Matière'),
    row('Grain de papier', 'Une texture très légère sur les pages. Désactivez-la si vous préférez des aplats.', toggle(s.appearance.grain, (v) => set({ grain: v }), 'Grain de papier')),
    row('Réduire les animations', 'Supprime les transitions. Le réglage du système est déjà respecté.', toggle(s.appearance.reduceMotion, (v) => set({ reduceMotion: v }), 'Réduire les animations')),
    group('Aperçu'),
    h('div', { class: 'sample' }, h('h3', {}, 'Une page à votre image'), h('p', {}, 'Voici comment l’assistant s’exprime : un texte posé, lisible, qui laisse de la place à vos idées.')));
  return { el: view.el };
}
