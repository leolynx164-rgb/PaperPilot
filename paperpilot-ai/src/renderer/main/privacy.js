import { h, icon, debounce } from '../shared/dom.js';
import { toast } from '../shared/toast.js';
import { sheet, group, row, toggle, seg, confirmButton, status } from './ui.js';

const pp = window.pp;

export async function mount(app) {
  let s = await pp.settings.get();
  const view = sheet('Confidentialité', 'Ce que PaperPilot peut voir, ce qu’il peut faire, et ce qui quitte votre ordinateur.');
  const b = view.body;

  // ---------------- Dossiers
  const folders = h('div', { class: 'list-edit' });
  const paintFolders = () => {
    folders.replaceChildren(...(s.allowedFolders.length ? s.allowedFolders.map((f) => h('div', { class: 'li' }, h('span', { class: 'path', title: f }, f), h('button', { class: 'btn btn-text btn-sm', type: 'button', onclick: async () => { s.allowedFolders = await pp.folders.remove(f); paintFolders(); } }, 'Retirer'))) : [h('div', { class: 'hint', style: 'padding:.6rem 0' }, 'Aucun dossier autorisé : la recherche et les actions sur fichiers sont désactivées.')]));
  };
  paintFolders();
  const addFolder = h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => { s.allowedFolders = await pp.folders.add(); paintFolders(); } }, icon('folder-plus'), 'Ajouter un dossier…');

  // ---------------- Applications
  const appsBox = h('div', { class: 'applist' });
  const filter = h('input', { class: 'input', type: 'search', placeholder: 'Filtrer les applications', 'aria-label': 'Filtrer les applications', style: 'margin-top:.6rem' });
  let apps = [];
  const paintApps = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = apps.filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
    appsBox.replaceChildren(...(rows.length ? rows.map((a) => h('div', { class: 'li' }, h('span', {}, a.name, h('small', {}, a.comment || a.id)), toggle(a.allowed, async (v) => { try { await pp.apps.setAllowed(a.id, v); a.allowed = v; } catch (e) { toast(e.message, { kind: 'error' }); } }, `Autoriser ${a.name}`))) : [h('div', { class: 'hint', style: 'padding:.8rem 0' }, 'Aucune application ne correspond.')]));
  };
  filter.addEventListener('input', debounce(paintApps, 120));
  pp.apps.list().then((l) => { apps = l; paintApps(); });

  const priv = (k) => (v) => { s.privacy[k] = v; return pp.settings.update({ privacy: { [k]: v } }); };

  // ---------------- Clés
  const { secrets } = await pp.providers.list();

  b.append(
    group('Dossiers autorisés'),
    h('p', { class: 'hint', style: 'margin-top:.2rem;max-width:62ch' }, 'La recherche et toutes les actions sur des fichiers sont limitées à ces dossiers et à leurs sous-dossiers. Les liens symboliques qui mènent ailleurs sont refusés.'),
    folders, h('div', { style: 'margin-top:.8rem' }, addFolder),
    group('Applications autorisées'),
    h('p', { class: 'hint', style: 'margin-top:.2rem;max-width:62ch' }, 'Seules les applications activées ici peuvent être lancées par l’assistant. Il désigne une application par son nom : il ne peut jamais fournir une commande.'),
    filter, appsBox,
    group('Confirmations'),
    row('Confirmer chaque ouverture', 'Demande votre accord avant d’ouvrir un fichier, un dossier, une adresse web ou une application. Les modifications de fichiers demandent toujours confirmation.', toggle(s.privacy.confirmOpenActions, priv('confirmOpenActions'), 'Confirmer chaque ouverture')),
    row('Confirmer l’envoi du contenu d’un document', 'Quand l’assistant veut lire un document pour le résumer, le texte part chez votre fournisseur. Avec Ollama en local, rien ne quitte l’ordinateur.', toggle(s.privacy.confirmDocumentReads, priv('confirmDocumentReads'), 'Confirmer la lecture de documents')),
    row('Transmettre les résultats de recherche au modèle', 'Les noms et chemins trouvés sont envoyés au fournisseur pour que l’assistant puisse y répondre. Désactivé, il ne verra que le nombre de résultats.', toggle(s.privacy.shareResultsWithModel, priv('shareResultsWithModel'), 'Transmettre les résultats de recherche')),
    group('Ce qui quitte votre ordinateur'),
    h('p', { style: 'margin-top:.5rem;max-width:64ch;color:var(--ink-2)' }, 'Vos messages sont envoyés au fournisseur IA que vous avez choisi, avec les instructions de l’assistant, la liste de vos dossiers autorisés et le nom des applications autorisées. S’y ajoutent, selon les réglages ci-dessus, les résultats de recherche et le contenu des documents que vous acceptez de lui faire lire. PaperPilot n’envoie rien d’autre : aucune statistique, aucun suivi, aucun compte.'),
    group('Clés API'),
    secrets.weak
      ? status('bad', 'Aucun trousseau système utilisable : les clés sont protégées de façon minimale. Installez et déverrouillez KWallet pour les chiffrer correctement.')
      : status('ok', 'Les clés sont chiffrées par le trousseau du système et ne sont jamais réaffichées en entier ni transmises aux fenêtres.'),
    group('Conservation de l’historique'),
    row('Supprimer automatiquement les anciennes conversations', 'Appliqué à chaque démarrage, aux conversations et à l’historique des actions.', seg([{ value: 0, label: 'Jamais' }, { value: 30, label: '30 jours' }, { value: 90, label: '90 jours' }, { value: 365, label: '1 an' }], s.privacy.retentionDays, (v) => { s.privacy.retentionDays = v; pp.settings.update({ privacy: { retentionDays: v } }); }, 'Durée de conservation')),
    group('Vos données'),
    h('div', { class: 'danger-zone' },
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => { try { const r = await pp.privacy.exportData(); if (r.ok) toast('Export enregistré : ' + r.path); } catch (e) { toast(e.message, { kind: 'error' }); } } }, icon('download'), 'Exporter mes données (sans les clés)'),
      confirmButton({ label: 'Effacer toutes les conversations', confirmLabel: 'Confirmer l’effacement', ic: 'trash-2', cls: 'btn btn-quiet', onConfirm: async () => { await pp.privacy.clearConversations(); toast('Conversations effacées.'); } }),
      confirmButton({ label: 'Effacer l’historique des actions', confirmLabel: 'Confirmer l’effacement', ic: 'trash-2', cls: 'btn btn-quiet', onConfirm: async () => { await pp.privacy.clearActions(); toast('Historique des actions effacé.'); } }),
      confirmButton({ label: 'Tout effacer et réinitialiser', confirmLabel: 'Oui, tout effacer', ic: 'trash-2', cls: 'btn btn-quiet', onConfirm: async () => { await pp.privacy.eraseAll(); await app.refresh(); toast('PaperPilot a été réinitialisé.'); app.navigate('home', { fresh: true }); } }),
      h('p', { class: 'hint', style: 'max-width:60ch' }, 'Le dernier bouton supprime aussi vos fournisseurs et vos clés API.')));
  return { el: view.el };
}
