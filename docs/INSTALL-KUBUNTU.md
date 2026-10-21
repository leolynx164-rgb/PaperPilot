# Installation, lancement et compilation sous Kubuntu

Construit avec Electron 44 et Node.js 22. Cibles visées : Kubuntu 22.04 et 24.04 (KDE Plasma 5.24 à 6, sessions X11 et Wayland). Le comportement sur un vrai bureau Plasma n'a pas pu être testé dans l'environnement de développement : voir « État du projet » dans le README.

## 1. Installer un paquet déjà construit

### Paquet `.deb` (recommandé)

```bash
sudo apt install ./paperpilot-ai_0.1.0_amd64.deb
```

`apt` installe aussi les dépendances, et recommande `poppler-utils` (lecture des PDF), `unzip` (Word et LibreOffice) et `libglib2.0-bin` (lancement d'applications). PaperPilot AI apparaît dans le menu des applications (catégorie Utilitaires). Sur Kubuntu 24.04, le paquet installe aussi le profil AppArmor nécessaire au bac à sable d'Electron.

### AppImage

```bash
sudo apt install libfuse2t64        # 24.04 ; sur 22.04 : libfuse2
chmod +x "PaperPilot AI-0.1.0.AppImage"
./"PaperPilot AI-0.1.0.AppImage"
```

Sur Kubuntu 24.04, l'AppImage peut échouer au démarrage à cause de la restriction des espaces de noms utilisateur par AppArmor. Dans ce cas, lancez-la avec `--no-sandbox`, ou préférez le `.deb`. Pour l'intégrer au menu, utilisez AppImageLauncher ou créez un fichier `.desktop` dans `~/.local/share/applications/`.

## 2. Lancer depuis les sources

```bash
sudo apt install nodejs npm git     # Node.js 20 ou plus ; sinon utilisez nvm
sudo apt install poppler-utils unzip libglib2.0-bin   # recommandés
cd paperpilot-ai
npm install
npm start
```

## 3. Compiler les paquets

```bash
npm install
npm run dist          # AppImage + .deb dans dist/
npm run dist:deb      # seulement le .deb
npm run dist:appimage # seulement l'AppImage
```

La première compilation télécharge Electron et l'outil `fpm`, puis il faut un accès Internet. Avant de distribuer, éditez dans `package.json` : `homepage`, `author`, `build.linux.maintainer`.

Régénérer les ressources (rarement utile, les fichiers générés sont versionnés) :

```bash
npm run prepare-assets   # polices et icônes depuis node_modules
npm run make-icons       # icônes PNG depuis build/icon.svg
```

## 4. Configurer le raccourci global

Par défaut : `Alt + Espace`. Sous KDE, **ce raccourci est déjà pris par KRunner**. Deux possibilités :

- **Choisir une autre combinaison** : Général, Raccourci global, « Modifier », puis appuyez sur la combinaison (par exemple `Ctrl + Alt + Espace`). L'application essaie réellement de l'enregistrer et vous dit si elle est déjà utilisée.
- **Libérer Alt + Espace** : Paramètres système, Raccourcis, KRunner, changez le raccourci de « Lancer la commande ».

### Session Wayland

Sous Wayland, c'est KDE qui gère les raccourcis globaux. Si le raccourci ne réagit pas, créez-le côté KDE, ce qui fonctionne dans tous les cas :

1. Paramètres système, Raccourcis, **Ajouter une commande ou un script** (Plasma 5 : Raccourcis personnalisés, Nouveau, Action globale, Commande).
2. Commande : `paperpilot-ai --toggle` (AppImage : `"/chemin/PaperPilot AI-0.1.0.AppImage" --toggle`).
3. Assignez la combinaison voulue.

PaperPilot AI affiche cette commande, avec un bouton « Copier », dans Général dès qu'il détecte Wayland. La commande `--toggle` pilote l'instance déjà en cours : elle ne lance pas une seconde application.

Le « toujours au premier plan » n'est pas garanti par Wayland pour une fenêtre ordinaire. Si la fenêtre passe sous d'autres, clic droit sur sa barre de titre dans le gestionnaire de tâches, ou règle de fenêtre KDE (Paramètres système, Gestion des fenêtres, Règles de fenêtre) : « Garder au-dessus », pour la classe `paperpilot-ai`.

## 5. Démarrage automatique

Général, « Démarrer avec la session » (disponible une fois l'application installée) : crée `~/.config/autostart/paperpilot-ai.desktop` qui lance `paperpilot-ai --background`. Gardez aussi « Rester actif quand la fenêtre se ferme » : sans processus actif, aucun raccourci global.

## 6. Clés API et trousseau

Les clés sont chiffrées avec KWallet ou libsecret, via Electron. Si aucun trousseau n'est détecté ou déverrouillé, l'application l'indique (Fournisseurs et Confidentialité) et protège les clés de façon minimale. Sous KDE : `sudo apt install kwalletmanager` puis créez un portefeuille et laissez-le se déverrouiller à l'ouverture de session.

## 7. Où sont les données ?

`~/.config/PaperPilot AI/` : `settings.json`, `secrets.json` (clés chiffrées), `conversations/`, `actions.json`. Fichiers lisibles uniquement par votre utilisateur. Variable `PAPERPILOT_DATA_DIR` pour choisir un autre dossier. Désinstaller le paquet ne les supprime pas : Confidentialité, « Tout effacer », ou supprimez ce dossier.

## 8. Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Le raccourci ne fait rien | Pris par KRunner, ou session Wayland : voir la section 4. |
| « The SUID sandbox helper binary… » | Utilisez le `.deb`, ou lancez avec `--no-sandbox` pour un essai. |
| Les PDF ne se lisent pas | `sudo apt install poppler-utils` |
| Les documents Word ne se lisent pas | `sudo apt install unzip` |
| Ollama : « impossible de joindre » | `ollama serve` ; vérifiez l'URL `http://localhost:11434`. |
| Une application ne se lance pas | Activez-la dans Confidentialité, Applications autorisées. |
| La fenêtre flottante a un fond noir | Composition KDE désactivée (Alt + Maj + F12 pour la réactiver). |
