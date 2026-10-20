import { h, icon } from '../shared/dom.js';
import { fmtDateTime } from '../shared/format.js';
import { toast } from '../shared/toast.js';
import { sheet, status, confirmButton, emptyState } from './ui.js';

const pp = window.pp;
const needsKey = (p) => p.kind !== 'ollama' && p.preset !== 'custom';
const BACKENDS = { kwallet: 'KWallet', kwallet5: 'KWallet', kwallet6: 'KWallet', gnome_libsecret: 'le trousseau GNOME', gnome_keyring: 'le trousseau GNOME' };

function stateOf(p) {
  if (needsKey(p) && !p.hasKey) return { t: 'Clé manquante', c: 'bad' };
  if (p.hasKey && !p.keyReadable) return { t: 'Clé illisible, à ressaisir', c: 'bad' };
  if (!p.model) return { t: 'Modèle à choisir', c: 'bad' };
  if (p.verified) return p.verified.ok ? { t: 'Connexion vérifiée', c: 'ok' } : { t: 'Dernier test échoué', c: 'bad' };
  return { t: 'Non vérifié', c: '' };
}

export async function mount(app) {
  const addBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, icon('plus'), 'Ajouter un fournisseur');
  const view = sheet('Fournisseurs IA', 'Utilisez vos propres comptes. Chaque configuration est vérifiée par un vrai échange avec le fournisseur : rien n’est supposé fonctionner.', addBtn);
  const listEl = h('div', { class: 'plist' });
  const detail = h('div', { style: 'min-width:0' });
  const noteEl = h('div', { class: 'storage-note' });
  view.body.append(h('div', { class: 'split' }, listEl, detail), noteEl);

  let presets = await pp.providers.presets();
  let data = await pp.providers.list();
  let selected = data.providers.length ? (data.defaultId || data.providers[0].id) : null; // id | 'new' | null
  let draft = null;           // formulaire en cours
  let typedKey = '';
  let testState = null;       // { busy } | { ok, message }
  let models = [];
  let statusHost = null;

  const saved = () => data.providers.find((p) => p.id === selected) || null;
  const payload = () => ({ id: draft.id, preset: draft.preset, kind: draft.kind, name: draft.name, baseUrl: draft.baseUrl, model: draft.model, params: { temperature: draft.temperature, maxTokens: draft.maxTokens } });
  const fromSaved = (p) => ({ id: p.id, preset: p.preset, kind: p.kind, name: p.name, baseUrl: p.baseUrl, model: p.model, temperature: p.params.temperature ?? '', maxTokens: p.params.maxTokens ?? '' });
  const dirty = () => { const s = saved(); return !s || typedKey !== '' || JSON.stringify(fromSaved(s)) !== JSON.stringify({ ...draft }); };

  function paintList() {
    listEl.replaceChildren(...data.providers.map((p) => {
      const st = stateOf(p);
      return h('button', { class: 'pitem', type: 'button', 'aria-current': String(selected === p.id), onclick: () => select(p.id) },
        h('span', { class: 'n' }, h('span', {}, p.name), p.id === data.defaultId ? h('span', { class: 'hint', style: 'font-weight:400' }, 'Par défaut') : null),
        h('span', { class: 'm' }, p.model || 'Aucun modèle choisi'),
        h('span', { class: 's ' + st.c }, st.t));
    }));
    if (!data.providers.length) listEl.replaceChildren(h('div', { class: 'hint', style: 'padding:.4rem .6rem' }, 'Aucun fournisseur pour le moment.'));
  }

  function paintNote() {
    const s = data.secrets;
    const name = BACKENDS[s.backend];
    noteEl.replaceChildren(
      h('div', { class: 'label' }, 'Stockage des clés API'),
      s.weak
        ? status('bad', s.backend === 'none' ? 'Aucun chiffrement système disponible : les clés sont enregistrées dans un fichier privé non chiffré. Installez et déverrouillez KWallet (ou gnome-keyring) pour les protéger.' : 'Aucun trousseau détecté (KWallet, libsecret) : le chiffrement est minimal. Installez et déverrouillez KWallet pour une vraie protection.')
        : status('ok', `Les clés sont chiffrées par ${name || 'le trousseau du système'} et ne sont jamais réaffichées en entier.`));
  }

  function select(id) {
    selected = id; typedKey = ''; testState = null; models = [];
    const s = saved();
    draft = s ? fromSaved(s) : null;
    paintList(); paintDetail();
  }

  function startNew(preset) {
    draft = { id: null, preset: preset.id, kind: preset.kind, name: preset.name, baseUrl: preset.baseUrl, model: '', temperature: '', maxTokens: '' };
    selected = 'new'; typedKey = ''; testState = null; models = [];
    paintList(); paintDetail();
  }

  function presetChooser(title) {
    return h('div', {},
      h('h3', { style: 'font-size:1.5rem' }, title),
      h('p', { class: 'hint', style: 'margin-top:.4rem;max-width:52ch' }, 'Choisissez un fournisseur. Vous aurez besoin de sa clé API (sauf pour Ollama, qui tourne sur votre ordinateur).'),
      h('div', { class: 'presets' }, presets.map((p) => h('button', { type: 'button', onclick: () => startNew(p) }, h('span', { class: 'n' }, p.name), h('span', { class: 'd' }, p.help)))));
  }

  function paintStatus() {
    if (!statusHost) return;
    const s = saved();
    statusHost.replaceChildren();
    if (testState && testState.busy) statusHost.append(h('div', { class: 'status-line' }, h('span', { class: 'spin' }), 'Vérification en cours…'));
    else if (testState) statusHost.append(status(testState.ok ? 'ok' : 'bad', testState.message));
    else if (s) {
      const st = stateOf(s);
      statusHost.append(status(st.c, s.verified ? `${st.t} le ${fmtDateTime(s.verified.at)}. ${s.verified.message}` : st.t === 'Non vérifié' ? 'Configuration non vérifiée. Utilisez « Tester la connexion ».' : st.t));
    }
  }

  function paintDetail() {
    statusHost = null;
    if (selected === null && !data.providers.length) { detail.replaceChildren(presetChooser('Ajoutez votre premier fournisseur')); return; }
    if (selected === 'new' && !draft) { detail.replaceChildren(presetChooser('Nouveau fournisseur')); return; }
    if (!draft) { detail.replaceChildren(emptyState('Sélectionnez un fournisseur', 'Choisissez-en un dans la liste ou ajoutez-en un nouveau.')); return; }
    const preset = presets.find((p) => p.id === draft.preset);
    const s = saved();
    const hasKey = !!(s && s.hasKey);
    const req = needsKey(draft);

    const f = (k) => (e) => { draft[k] = e.target.value; refreshButtons(); };
    const nameIn = h('input', { class: 'input', value: draft.name, oninput: f('name'), 'aria-label': 'Nom' });
    const urlIn = h('input', { class: 'input', value: draft.baseUrl, oninput: f('baseUrl'), spellcheck: 'false', 'aria-label': 'URL de base' });
    const keyIn = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Clé API',
      placeholder: hasKey ? `Clé enregistrée (${s.keyHint}). Saisissez-en une autre pour la remplacer.` : req ? 'Collez votre clé API' : 'Facultative pour ce fournisseur',
      oninput: (e) => { typedKey = e.target.value; refreshButtons(); } });
    const eye = h('button', { class: 'icon-btn', type: 'button', title: 'Afficher ou masquer la saisie', 'aria-label': 'Afficher ou masquer la saisie', onclick: () => { keyIn.type = keyIn.type === 'password' ? 'text' : 'password'; } }, icon('eye'));
    const list = h('datalist', { id: 'models-list' }, models.map((m) => h('option', { value: m })));
    const modelIn = h('input', { class: 'input', value: draft.model, list: 'models-list', spellcheck: 'false', placeholder: 'Nom exact du modèle', oninput: f('model'), 'aria-label': 'Nom du modèle' });
    const loadBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Charger la liste');
    const tempIn = h('input', { class: 'input', type: 'number', step: '0.1', min: '0', max: '2', value: draft.temperature, oninput: f('temperature'), 'aria-label': 'Température' });
    const maxIn = h('input', { class: 'input', type: 'number', min: '1', step: '1', value: draft.maxTokens, oninput: f('maxTokens'), 'aria-label': 'Nombre maximal de jetons' });

    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Enregistrer');
    const testBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Tester la connexion');
    const defBtn = h('button', { class: 'btn btn-text', type: 'button' }, 'Utiliser par défaut');
    const delBtn = s ? confirmButton({ label: 'Supprimer', confirmLabel: 'Confirmer la suppression', ic: 'trash-2', onConfirm: async () => { await pp.providers.remove(s.id); toast('Fournisseur supprimé.'); data = await pp.providers.list(); selected = data.providers[0] ? data.providers[0].id : null; select(selected); } }) : null;
    const delKey = hasKey ? confirmButton({ label: 'Supprimer la clé', confirmLabel: 'Confirmer', cls: 'btn btn-text btn-sm', onConfirm: async () => { await pp.providers.save({ ...payload(), clearKey: true }, ''); await reload(); toast('Clé supprimée.'); } }) : null;

    function refreshButtons() {
      saveBtn.disabled = !dirty() || !draft.name.trim() || !draft.baseUrl.trim();
      defBtn.hidden = !s || s.id === data.defaultId;
    }
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const p = await pp.providers.save({ ...payload(), temperature: undefined }, typedKey);
        selected = p.id; typedKey = ''; testState = null;
        await reload(); toast('Fournisseur enregistré.');
      } catch (e) { toast(e.message, { kind: 'error' }); refreshButtons(); }
    });
    testBtn.addEventListener('click', async () => {
      testState = { busy: true }; paintStatus(); testBtn.disabled = true;
      try {
        const r = await pp.providers.test(payload(), typedKey);
        testState = { ok: r.ok, message: r.message + (dirty() && s ? ' (test effectué sur la configuration non enregistrée)' : '') + (r.ok && !s ? ' Pensez à enregistrer.' : '') };
      } catch (e) { testState = { ok: false, message: e.message }; }
      testBtn.disabled = false; paintStatus();
    });
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true; loadBtn.textContent = 'Chargement…';
      try {
        models = await pp.providers.models(payload(), typedKey);
        list.replaceChildren(...models.map((m) => h('option', { value: m })));
        toast(`${models.length} modèle${models.length > 1 ? 's' : ''} disponible${models.length > 1 ? 's' : ''}. Cliquez dans le champ pour choisir.`);
        testState = null; paintStatus();
      } catch (e) { testState = { ok: false, message: e.message }; paintStatus(); }
      loadBtn.disabled = false; loadBtn.textContent = 'Charger la liste';
    });
    defBtn.addEventListener('click', async () => { await pp.providers.setDefault(s.id); await reload(); toast(`${s.name} est maintenant utilisé par défaut.`); });

    statusHost = h('div');
    detail.replaceChildren(h('div', { class: 'form view-enter' },
      h('div', {}, h('h3', { style: 'font-size:1.6rem' }, s ? s.name : 'Nouveau : ' + (preset ? preset.name : 'fournisseur')), preset ? h('p', { class: 'hint', style: 'margin-top:.3rem' }, preset.help) : null),
      h('div', { class: 'field' }, h('label', {}, 'Nom affiché'), nameIn),
      h('div', { class: 'field' }, h('label', {}, 'URL de base de l’API'), urlIn, h('span', { class: 'hint' }, draft.kind === 'ollama' ? 'Adresse du serveur Ollama, en général http://localhost:11434.' : 'À modifier seulement pour un serveur compatible ou un proxy.')),
      h('div', { class: 'field' }, h('label', {}, req ? 'Clé API' : 'Clé API (facultative)'), h('div', { class: 'keyrow' }, keyIn, eye), delKey ? h('div', {}, delKey) : null,
        h('span', { class: 'hint' }, 'Chiffrée sur cet ordinateur. Elle n’est jamais réaffichée en entier.')),
      h('div', { class: 'field' }, h('label', {}, 'Modèle'), h('div', { class: 'keyrow' }, modelIn, loadBtn), list, h('span', { class: 'hint' }, 'Le nom exact, tel que l’indique le fournisseur.')),
      h('details', { class: 'adv' }, h('summary', {}, 'Réglages avancés'), h('div', { class: 'form' },
        h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', {}, 'Température'), tempIn), h('div', { class: 'field' }, h('label', {}, 'Jetons de sortie maximum'), maxIn)),
        h('span', { class: 'hint' }, 'Laissez vide pour les valeurs du fournisseur. Certains modèles refusent ces réglages : en cas d’erreur, videz-les.'))),
      h('div', { class: 'form-actions' }, saveBtn, testBtn, defBtn, delBtn),
      statusHost));
    refreshButtons(); paintStatus();
  }

  async function reload() {
    data = await pp.providers.list();
    if (selected && selected !== 'new' && !saved()) selected = data.providers[0] ? data.providers[0].id : null;
    const s = saved();
    draft = s ? fromSaved(s) : selected === 'new' ? draft : null;
    paintList(); paintNote(); paintDetail();
  }

  addBtn.addEventListener('click', () => { selected = 'new'; draft = null; typedKey = ''; paintList(); paintDetail(); });
  const off = pp.on.state(async (st) => {
    if (st.scope !== 'providers') return;
    data = await pp.providers.list();
    paintList(); paintNote(); paintStatus();
  });

  select(selected);
  paintNote();
  return { el: view.el, destroy: off };
}
