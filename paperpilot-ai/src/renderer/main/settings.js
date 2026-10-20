import { h, icon } from '../shared/dom.js';
import { prettyAccel } from '../shared/format.js';
import { toast } from '../shared/toast.js';
import { sheet, group, row, toggle, seg, status } from './ui.js';

const pp = window.pp;

const KEYS = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' };

/** Convertit un appui de touches en accélérateur Electron (« Ctrl+Alt+P »). */
function toAccelerator(e) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) key = e.key;
  else if (KEYS[e.key]) key = KEYS[e.key];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return [...mods, key].join('+');
}

export async function mount(app) {
  const [s, sc, info] = await Promise.all([pp.settings.get(), pp.shortcut.status(), pp.system.info()]);
  const view = sheet('Général', 'Le raccourci global, la fenêtre flottante et le fonctionnement en arrière-plan.');
  const b = view.body;

  // ---------------- Raccourci
  const recBtn = h('button', { class: 'btn btn-quiet', type: 'button' });
  const scStatus = h('div');
  const cmdBox = h('div');
  const paintShortcut = (st) => {
    recBtn.replaceChildren(icon('keyboard'), h('kbd', {}, prettyAccel(st.accelerator)), 'Modifier');
    scStatus.replaceChildren(st.registered ? status('ok', `Actif : ${prettyAccel(st.accelerator)}`) : status('bad', st.error === 'conflict' ? `${prettyAccel(st.accelerator)} est déjà utilisé par un autre programme. Sous KDE, Alt + Espace ouvre KRunner par défaut : choisissez une autre combinaison ou libérez celle-ci.` : 'Ce raccourci n’a pas pu être enregistré. Choisissez-en un autre.'));
    cmdBox.replaceChildren();
    if (st.hint || !st.registered) {
      cmdBox.append(h('div', { class: 'hint', style: 'margin-top:.7rem;max-width:60ch' }, st.hint || 'Vous pouvez aussi créer le raccourci dans KDE : Préférences Système, Raccourcis, Ajouter une commande.'),
        h('div', { class: 'cmd' }, h('code', {}, st.command), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: async () => { await pp.system.copy(st.command); toast('Commande copiée.'); } }, icon('copy'), 'Copier')));
    }
  };
  paintShortcut(sc);
  let listening = null;
  const stopListening = () => { if (listening) { window.removeEventListener('keydown', listening, true); listening = null; } };
  recBtn.addEventListener('click', () => {
    if (listening) { stopListening(); paintShortcut(sc); return; }
    recBtn.replaceChildren(icon('keyboard'), 'Appuyez sur la combinaison… (Échap pour annuler)');
    listening = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stopListening(); paintShortcut(sc); return; }
      const acc = toAccelerator(e);
      if (!acc) return;
      stopListening();
      try {
        const r = await pp.shortcut.set(acc);
        Object.assign(sc, r.status);
        paintShortcut(r.status);
        if (r.ok) toast(`Raccourci enregistré : ${prettyAccel(acc)}`); else toast(r.error, { kind: 'error' });
      } catch (err) { toast(err.message, { kind: 'error' }); paintShortcut(sc); }
    };
    window.addEventListener('keydown', listening, true);
  });

  const closeBlur = toggle(s.quick.closeOnBlur, (v) => pp.settings.update({ quick: { closeOnBlur: v } }), 'Fermer au clic à l’extérieur');
  const position = seg([{ value: 'top', label: 'En haut' }, { value: 'center', label: 'Au centre' }], s.quick.position, (v) => pp.settings.update({ quick: { position: v } }), 'Position');
  const autostart = toggle(info.autostart, async (v) => {
    try { await pp.system.setAutostart(v); } catch (e) { toast(e.message, { kind: 'error' }); autostart.setAttribute('aria-checked', String(!v)); }
  }, 'Démarrer avec la session');
  const bg = toggle(s.runInBackground, (v) => pp.settings.update({ runInBackground: v }), 'Rester actif en arrière-plan');

  const custom = h('textarea', { class: 'textarea', placeholder: 'Par exemple : tutoie-moi, réponds toujours en trois phrases au maximum.', maxlength: 2000 }, s.customInstructions);
  custom.value = s.customInstructions;
  let lastSaved = s.customInstructions;
  const saveCustom = async () => { if (custom.value === lastSaved) return; lastSaved = custom.value; await pp.settings.update({ customInstructions: custom.value }); toast('Instructions enregistrées.'); };
  custom.addEventListener('blur', saveCustom);

  const tool = (ok, name, pkg) => h('dd', {}, ok ? `${name} : disponible` : `${name} : absent (sudo apt install ${pkg})`);

  b.append(
    group('Raccourci global'),
    row('Fenêtre flottante', 'Ouvre ou ferme le chat par-dessus vos applications, où que vous soyez.', recBtn),
    h('div', { style: 'padding:.2rem 0 1rem' }, scStatus, cmdBox),
    group('Fenêtre flottante'),
    row('Se fermer au clic à l’extérieur', 'Elle disparaît dès que vous retournez dans une autre application. L’épingle de la fenêtre l’en empêche.', closeBlur),
    row('Position à l’ouverture', 'Sur l’écran où se trouve le pointeur.', position),
    group('Démarrage'),
    row('Démarrer avec la session', info.packaged || info.autostart ? 'PaperPilot se lance sans fenêtre au démarrage de KDE, pour que le raccourci soit toujours prêt.' : 'Disponible une fois PaperPilot installé (paquet .deb ou AppImage).', autostart),
    row('Rester actif quand la fenêtre se ferme', 'Nécessaire pour que le raccourci global continue de fonctionner. L’icône de la zone de notification permet de quitter.', bg),
    group('Instructions personnalisées'),
    row('Ce que l’assistant doit savoir de vous', 'Ajouté au contexte de chaque conversation. Ne mettez rien de confidentiel : cela est envoyé au fournisseur.', custom, { stack: true }),
    group('Système'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Version'), h('dd', {}, `${info.name} ${info.version} (Electron ${info.electron})`),
      h('dt', {}, 'Session'), h('dd', {}, `${info.session === 'wayland' ? 'Wayland' : 'X11'}${info.desktop ? ', ' + info.desktop : ''}`),
      h('dt', {}, 'Lecture de documents'), h('div', {}, h('dd', {}, 'Texte, Markdown, code : intégrée'), tool(info.tools.pdftotext, 'PDF', 'poppler-utils'), tool(info.tools.unzip, 'Word et LibreOffice', 'unzip')),
      h('dt', {}, 'Lancement d’applications'), h('dd', {}, info.tools.gio ? 'gio : disponible' : 'gio absent (sudo apt install libglib2.0-bin) : repli sur la commande du fichier .desktop'),
      h('dt', {}, 'Données'), h('dd', { class: 'mono' }, info.dataDir)),
    h('div', { class: 'danger-zone' }, h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: async () => { await pp.settings.update({ onboarded: false }); await app.refresh(); app.navigate('home'); } }, 'Revoir l’écran d’accueil')));

  return { el: view.el, destroy: () => { stopListening(); saveCustom(); } };
}
