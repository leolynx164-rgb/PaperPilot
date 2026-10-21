# Architecture et sécurité

## Vue d'ensemble

```
┌──────────────── processus principal (Electron, Node.js) ────────────────┐
│ index.js     cycle de vie, instance unique, fenêtres, tray, raccourci   │
│ store.js     réglages, fournisseurs, clés chiffrées, conversations,     │
│              historique d'actions (fichiers JSON, écriture atomique)    │
│ agent.js     boucle de conversation, flux, actions, confirmations       │
│ providers/   openai-compat · anthropic · ollama (+ registre, test réel) │
│ actions/     catalogue fermé, validation, chemins, déplacements         │
│ files/       recherche par nom, lecture de documents                    │
│ apps.js      détection / lancement des applications (.desktop)          │
│ ipc.js       canaux IPC (origine vérifiée), preload.js : pont minimal   │
└───────────────▲──────────────────────────────────▲──────────────────────┘
                │ événements chat / état partagé    │
   ┌────────────┴─────────────┐        ┌───────────┴────────────┐
   │ fenêtre principale       │        │ fenêtre flottante      │
   │ renderer/main/*          │        │ renderer/quick/*       │
   └────────────┬─────────────┘        └───────────┬────────────┘
                └──────── renderer/shared/ ────────┘
        chat-view · action-card · markdown · paper.css (système visuel)
```

Les fenêtres n'ont **aucun accès à Node.js** (`contextIsolation`, `sandbox`, CSP stricte, navigation et ouverture de fenêtres interdites). Elles n'envoient que des commandes (`chat:send`, `actions:confirm`…) et reçoivent des événements. Comme un seul processus possède l'état, la fenêtre flottante et l'application complète sont toujours synchronisées.

## Le modèle propose, le système décide

1. Le modèle reçoit un prompt listant les dossiers et applications autorisés et le **protocole d'actions** (`src/shared/protocol.js`) : des blocs `paperpilot-action` contenant du JSON.
2. À la fin de sa réponse, l'agent extrait les blocs. Un bloc illisible ne produit **aucune** action.
3. Chaque action est validée par `actions/` (types, bornes, chemins), puis son **aperçu réel** est calculé (ex. liste des déplacements).
4. Si une confirmation est requise, la carte « En attente de votre accord » s'affiche dans les deux fenêtres ; rien n'est exécuté avant l'accord. Fermer la fenêtre ne valide rien.
5. L'exécution renvoie un résultat **produit par le système**, consigné dans l'historique. Il est transmis au modèle (recherche, lecture, échec, refus) pour qu'il réponde à partir de faits. L'interface affiche toujours le statut réel à côté du texte du modèle.

## Garanties de sécurité (toutes couvertes par des tests)

- **Pas de terminal.** Aucun shell, aucune commande fournie par le modèle. Le modèle désigne une application par son nom ; le lancement passe par `gio launch` sur son fichier `.desktop` (sinon exécution directe de la ligne `Exec`, sans shell).
- **Dossiers autorisés.** Tout chemin est résolu avec `realpath` (liens symboliques suivis) puis comparé aux dossiers autorisés. `..`, chemins relatifs et liens vers l'extérieur sont refusés. Les dossiers autorisés eux-mêmes et le dossier personnel ne peuvent pas être déplacés, renommés ou mis à la corbeille.
- **Confirmation obligatoire** pour ranger, déplacer, renommer, mettre à la corbeille ; pour lire un document avec un fournisseur distant (réglable) ; et, si le contexte contient du contenu externe (résultats, documents), pour ouvrir une URL ou une application (**défense contre l'injection de prompt**).
- **Jamais de perte.** Pas de suppression (corbeille uniquement, vérifiée après coup), pas d'écrasement (suffixe « (1) »), annulation des déplacements.
- **Fichiers exécutables.** Scripts, `.desktop`, AppImage, binaires : jamais ouverts par l'assistant.
- **URL.** `http` et `https` uniquement.
- **Honnêteté.** Les erreurs sont remontées telles quelles ; un test de connexion ne réussit que si le fournisseur a réellement répondu ; les résultats de recherche ne contiennent que des fichiers trouvés sur le disque.
- **Clés API.** Chiffrées avec `safeStorage`, stockées à part des réglages, jamais envoyées aux fenêtres, absentes des exports.
- **Minimisation.** Aucune télémétrie. Les noms de fichiers et contenus ne quittent l'ordinateur que selon les réglages de Confidentialité.

## Ajouter un fournisseur

- Format OpenAI, Anthropic ou Ollama : ajouter une entrée à `PRESETS` dans `src/main/providers/index.js` (nom, type, URL de base).
- Autre format : créer `providers/mon-format.js` exposant `stream({ provider, apiKey, system, messages, signal, onText })` et `listModels(...)`, l'enregistrer dans `ADAPTERS`, puis ajouter un preset. Les erreurs doivent être des `ProviderError` (`providers/errors.js`) avec un message en français.

## Ajouter une action

Ajouter une entrée à `defs` dans `src/main/actions/index.js` : `label`, `doc` (insérée dans le prompt), `prepare` (validation, aperçu), `confirm` (raison ou `null`), `run` (exécution réelle, lève `ActionError` en cas d'échec). Ajouter un test dans `test/actions.test.js`.

## Recherche évolutive

`files/search.js` est le moteur « par nom ». Pour la recherche dans le contenu ou sémantique, ajouter un moteur de même signature et fusionner ses résultats dans l'action `search_files`. Les types de résultats et l'interface n'ont pas à changer.

## Raccourci global, X11 et Wayland

`globalShortcut` fonctionne sous X11. Sous Wayland, l'application active le portail `GlobalShortcuts` et propose en secours la commande `paperpilot-ai --toggle` à associer dans KDE. Une seconde exécution ne lance jamais une seconde instance : elle transmet ses options à la première (`requestSingleInstanceLock`).

## Tests

- `npm test` : tests unitaires et d'intégration (Node, faux serveurs IA, systèmes de fichiers temporaires).
- `npm run test:e2e` : lance la vraie application sous Xvfb, pilote l'interface, vérifie les effets réels sur le disque et produit des captures.
