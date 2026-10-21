import { h, icon, logo } from '../shared/dom.js';
import { prettyAccel } from '../shared/format.js';
import { toast } from '../shared/toast.js';

const pp = window.pp;

/** Premier lancement : trois étapes réelles, chacune reflète l'état véritable de la configuration. */
export function welcome(app) {
  const el = h('div', { class: 'welcome view-enter' });
  const paint = async () => {
    const [{ providers }, settings, shortcut] = await Promise.all([pp.providers.list(), pp.settings.get(), pp.shortcut.status()]);
    const verified = providers.find((p) => p.verified && p.verified.ok);
    const first = providers[0];
    el.replaceChildren(h('div', { class: 'welcome-inner' },
      h('div', { style: 'color:var(--sage)' }, logo(34)),
      h('h1', { style: 'margin-top:1rem' }, 'Bienvenue dans PaperPilot.'),
      h('p', { class: 'lede' }, 'Un assistant personnel pour votre bureau : il répond, retrouve vos fichiers et lance des actions, toujours avec votre accord.'),
      h('ol', { class: 'steps' },
        h('li', {},
          h('div', {}, h('div', { class: 't' }, 'Reliez un fournisseur d’IA'),
            h('div', { class: 'd' }, 'Ajoutez la clé API d’OpenAI, d’Anthropic, de Mistral… ou utilisez Ollama sur votre ordinateur.'),
            verified ? h('div', { class: 'st' }, icon('check'), `Connexion vérifiée avec ${verified.name}`) : first ? h('div', { class: 'st bad' }, icon('circle-alert'), `${first.name} est enregistré mais pas encore vérifié`) : null),
          h('button', { class: 'btn ' + (verified ? 'btn-quiet' : 'btn-primary'), type: 'button', onclick: () => app.navigate('providers') }, first ? 'Ouvrir les fournisseurs' : 'Ajouter un fournisseur')),
        h('li', {},
          h('div', {}, h('div', { class: 't' }, 'Choisissez les dossiers accessibles'),
            h('div', { class: 'd' }, 'PaperPilot ne voit que les dossiers autorisés : Documents, Téléchargements, Bureau, Images, Musique et Vidéos par défaut.'),
            h('div', { class: 'st' }, icon('check'), `${settings.allowedFolders.length} dossier${settings.allowedFolders.length > 1 ? 's' : ''} autorisé${settings.allowedFolders.length > 1 ? 's' : ''}`)),
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => app.navigate('privacy') }, 'Gérer les dossiers')),
        h('li', {},
          h('div', {}, h('div', { class: 't' }, 'Appelez-moi depuis n’importe quelle application'),
            h('div', { class: 'd' }, 'Le raccourci ', h('kbd', {}, prettyAccel(shortcut.accelerator)), ' ouvre la fenêtre flottante par-dessus ce que vous faites.'),
            shortcut.registered ? h('div', { class: 'st' }, icon('check'), 'Raccourci actif') : h('div', { class: 'st bad' }, icon('circle-alert'), shortcut.session === 'wayland' ? 'Sous Wayland, ajoutez-le dans les raccourcis de KDE (réglages Général).' : 'Raccourci indisponible : choisissez-en un autre dans les réglages Général.')),
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => pp.windows.toggleQuick() }, 'Essayer maintenant'))),
      h('div', { class: 'go' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { await pp.settings.update({ onboarded: true }); await app.refresh(); app.navigate('home'); } catch (e) { toast(e.message, { kind: 'error' }); }
      } }, 'Commencer'))));
  };
  paint();
  const off = pp.on.state((s) => { if (s.scope === 'providers' || s.scope === 'settings') paint(); });
  const obs = new MutationObserver(() => { if (!el.isConnected) { off(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
  return el;
}
