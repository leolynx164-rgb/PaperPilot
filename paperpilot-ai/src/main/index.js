'use strict';
/**
 * PaperPilot AI : processus principal.
 *
 * Une seule instance tourne. Elle possède toutes les données (store) et les deux fenêtres :
 *   - la fenêtre principale (application complète),
 *   - la fenêtre flottante (chat rapide, raccourci global).
 * Ouvrir l'application une seconde fois (menu, ligne de commande, raccourci KDE) pilote l'instance existante :
 *   paperpilot-ai --toggle   bascule la fenêtre flottante (utile sous Wayland)
 *   paperpilot-ai --settings ouvre les paramètres
 *   paperpilot-ai --background démarre sans afficher de fenêtre
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, screen, safeStorage, session } = require('electron');

const IS_E2E = !!process.env.PAPERPILOT_E2E;
app.setName('PaperPilot AI');
if (process.env.PAPERPILOT_DATA_DIR) app.setPath('userData', path.resolve(process.env.PAPERPILOT_DATA_DIR));
if (typeof app.setDesktopName === 'function') app.setDesktopName('paperpilot-ai.desktop');

const SESSION = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11';
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
if (SESSION === 'wayland') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const RENDERER_ROOT = pathToFileURL(RENDERER).href + '/';
const ICON = path.join(ROOT, 'build', 'icon.png');

const ctx = {}; // exposé pour les tests de bout en bout
module.exports = { ctx };

function parseArgs(argv) {
  const a = argv.slice(1);
  return { toggle: a.includes('--toggle'), settings: a.includes('--settings'), background: a.includes('--background'), dev: a.includes('--dev'), main: a.includes('--show-main') };
}

const gotLock = IS_E2E ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  start();
}

function start() {
  let store, agent, actionsApi, tray = null, quitting = false;
  const flags = parseArgs(process.argv);

  const broadcast = (channel, payload) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  };

  // ------------------------------------------------------------------ Fenêtres
  const prefs = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, webSecurity: true });
  const lock = (win) => {
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  };

  const QUICK_W = 720, QUICK_H = 584;
  const windows = {
    main: null, quick: null, pinned: false, quickShownAt: 0,

    createMain() {
      const win = new BrowserWindow({
        width: 1140, height: 780, minWidth: 900, minHeight: 600, show: false, title: 'PaperPilot AI', icon: ICON,
        backgroundColor: '#F4EFE4', autoHideMenuBar: true, webPreferences: prefs(),
      });
      lock(win);
      win.loadFile(path.join(RENDERER, 'main', 'index.html'));
      win.on('close', (e) => {
        if (!quitting && !IS_E2E && store.settings.get().runInBackground) { e.preventDefault(); win.hide(); }
      });
      win.on('closed', () => { windows.main = null; });
      if (flags.dev) win.webContents.openDevTools({ mode: 'detach' });
      windows.main = win;
      return win;
    },

    showMain(section, conversationId) {
      const win = windows.main && !windows.main.isDestroyed() ? windows.main : windows.createMain();
      const reveal = () => {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (section || conversationId) win.webContents.send('nav', { section: section || 'home', conversationId });
      };
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal); else reveal();
      if (windows.quick && windows.quick.isVisible() && !windows.pinned) windows.hideQuick();
    },

    createQuick() {
      const win = new BrowserWindow({
        width: QUICK_W, height: QUICK_H, show: false, frame: false, transparent: true, resizable: false, movable: true, skipTaskbar: true,
        alwaysOnTop: true, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false, backgroundColor: '#00000000',
        title: 'PaperPilot AI, fenêtre flottante', icon: ICON, webPreferences: prefs(),
      });
      lock(win);
      win.setAlwaysOnTop(true, 'floating');
      win.loadFile(path.join(RENDERER, 'quick', 'index.html'));
      win.on('blur', () => {
        if (windows.pinned || !store.settings.get().quick.closeOnBlur || IS_E2E) return;
        if (Date.now() - windows.quickShownAt < 500) return; // certains gestionnaires de fenêtres envoient un blur à l'ouverture
        windows.hideQuick();
      });
      win.on('closed', () => { windows.quick = null; });
      windows.quick = win;
      return win;
    },

    showQuick() {
      const win = windows.quick && !windows.quick.isDestroyed() ? windows.quick : windows.createQuick();
      const point = screen.getCursorScreenPoint();
      const wa = screen.getDisplayNearestPoint(point).workArea;
      const pos = store.settings.get().quick.position;
      win.setPosition(Math.round(wa.x + (wa.width - QUICK_W) / 2), Math.round(pos === 'center' ? wa.y + (wa.height - QUICK_H) / 2 : wa.y + wa.height * 0.1));
      windows.quickShownAt = Date.now();
      const reveal = () => { win.show(); win.focus(); win.webContents.focus(); win.webContents.send('quick:shown'); };
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal); else reveal();
    },

    hideQuick() { if (windows.quick && !windows.quick.isDestroyed()) windows.quick.hide(); },

    toggleQuick() {
      const win = windows.quick;
      if (win && !win.isDestroyed() && win.isVisible()) {
        if (win.isFocused()) windows.hideQuick();
        else { win.focus(); win.webContents.send('quick:shown'); }
      } else windows.showQuick();
    },

    setPinned(p) { windows.pinned = p; },
    isPinned: () => windows.pinned,
  };

  // ------------------------------------------------------------------ Raccourci global
  let shortcutState = { accelerator: 'Alt+Space', registered: false, error: null };
  const toggleCommand = () => (process.env.APPIMAGE ? `"${process.env.APPIMAGE}" --toggle` : 'paperpilot-ai --toggle');
  const shortcuts = {
    status() {
      return {
        ...shortcutState, session: SESSION, desktop: process.env.XDG_CURRENT_DESKTOP || '', command: toggleCommand(),
        hint: SESSION === 'wayland'
          ? 'Sous Wayland, KDE contrôle les raccourcis globaux. Si le raccourci ne réagit pas, ajoutez la commande ci-dessous dans Préférences Système, Raccourcis.'
          : null,
      };
    },
    register(accel) {
      try {
        const ok = globalShortcut.register(accel, () => windows.toggleQuick());
        return ok && globalShortcut.isRegistered(accel);
      } catch { return null; }
    },
    init() {
      const accel = store.settings.get().shortcut;
      const ok = shortcuts.register(accel);
      shortcutState = { accelerator: accel, registered: ok === true, error: ok === true ? null : ok === null ? 'invalid' : 'conflict' };
    },
    set(accel) {
      if (!/^((Ctrl|Control|Alt|Shift|Super|Meta|CommandOrControl)\+)+[A-Za-z0-9]$|^((Ctrl|Control|Alt|Shift|Super|Meta|CommandOrControl)\+)+(Space|Tab|Enter|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown|Backspace|Delete|Insert|F([1-9]|1[0-9]|2[0-4])|Plus|Escape|[,.;/\\'`\-=\[\]])$/.test(accel) || !/(Ctrl|Control|Alt|Super|Meta|CommandOrControl)/.test(accel)) {
        return { ok: false, error: 'Ce raccourci n’est pas valide : utilisez au moins Ctrl, Alt ou Super avec une touche.', status: shortcuts.status() };
      }
      const previous = shortcutState.accelerator;
      globalShortcut.unregisterAll();
      const ok = shortcuts.register(accel);
      if (ok === true) {
        store.settings.update({ shortcut: accel });
        shortcutState = { accelerator: accel, registered: true, error: null };
        return { ok: true, status: shortcuts.status() };
      }
      const restored = shortcuts.register(previous);
      shortcutState = { accelerator: previous, registered: restored === true, error: restored === true ? null : 'conflict' };
      return {
        ok: false, status: shortcuts.status(),
        error: ok === null
          ? 'Ce raccourci n’est pas valide.'
          : `Le raccourci ${accel} est déjà utilisé par un autre programme (sous KDE, Alt+Espace ouvre KRunner par défaut). Choisissez-en un autre ou libérez-le dans Préférences Système.`,
      };
    },
  };

  // ------------------------------------------------------------------ Système
  const hasBinary = (name) => (process.env.PATH || '').split(path.delimiter).some((d) => { try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; } });
  const autostartFile = path.join(os.homedir(), '.config', 'autostart', 'paperpilot-ai.desktop');
  const system = {
    info: () => ({
      name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      session: SESSION, desktop: process.env.XDG_CURRENT_DESKTOP || '', packaged: app.isPackaged, dataDir: store.dir,
      secrets: store.secrets.status(), autostart: fs.existsSync(autostartFile),
      tools: { pdftotext: hasBinary('pdftotext'), unzip: hasBinary('unzip'), gio: hasBinary('gio'), dolphin: hasBinary('dolphin') },
    }),
    setAutostart(enabled) {
      if (enabled) {
        if (!app.isPackaged && !process.env.APPIMAGE) throw new Error('Le démarrage automatique n’est disponible que dans l’application installée (paquet .deb ou AppImage).');
        const exec = process.env.APPIMAGE ? `"${process.env.APPIMAGE}"` : `"${process.execPath}"`;
        fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
        fs.writeFileSync(autostartFile, `[Desktop Entry]\nType=Application\nName=PaperPilot AI\nComment=Assistant personnel\nExec=${exec} --background\nIcon=paperpilot-ai\nX-GNOME-Autostart-enabled=true\n`);
      } else fs.rmSync(autostartFile, { force: true });
      store.settings.update({ autostart: enabled });
      return { ok: true };
    },
  };

  // ------------------------------------------------------------------ Premier lancement
  function ensureDefaults() {
    const s = store.settings.get();
    const patch = {};
    if (!s.foldersInitialized) {
      const dirs = [];
      for (const n of ['documents', 'downloads', 'desktop', 'pictures', 'music', 'videos']) {
        try { const p = fs.realpathSync(app.getPath(n)); if (fs.statSync(p).isDirectory() && p !== os.homedir() && !dirs.includes(p)) dirs.push(p); } catch { /* dossier absent */ }
      }
      patch.allowedFolders = dirs;
      patch.foldersInitialized = true;
    }
    if (!s.appsInitialized) {
      const { listApps, DEFAULT_ALLOWED } = require('./apps');
      patch.allowedApps = listApps({ fresh: true }).filter((a) => DEFAULT_ALLOWED.includes(a.id)).map((a) => a.id);
      patch.appsInitialized = true;
    }
    if (Object.keys(patch).length) store.settings.update(patch);
  }

  function createTray() {
    try {
      tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 }));
      tray.setToolTip('PaperPilot AI');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Fenêtre flottante', click: () => windows.toggleQuick() },
        { label: 'Ouvrir PaperPilot AI', click: () => windows.showMain() },
        { label: 'Paramètres', click: () => windows.showMain('settings') },
        { type: 'separator' },
        { label: 'Quitter', click: () => app.quit() },
      ]));
      tray.on('click', () => windows.toggleQuick());
    } catch { tray = null; /* pas de zone de notification disponible */ }
  }

  function handleArgs(a) {
    if (a.toggle) windows.toggleQuick();
    else if (a.settings) windows.showMain('settings');
    else if (a.main || !a.background) windows.showMain();
  }

  app.on('second-instance', (_e, argv) => handleArgs(parseArgs(argv)));
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { /* l'application reste active en arrière-plan (raccourci global) */ });

  ctx.ready = app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

    const { createStore } = require('./store');
    const { createActions } = require('./actions');
    const { createAgent } = require('./agent');
    const { registerIpc } = require('./ipc');
    const apps = require('./apps');
    const { search } = require('./files/search');
    const { readDocument } = require('./files/documents');
    const { shell } = require('electron');

    const cipher = {
      available: () => safeStorage.isEncryptionAvailable(),
      backend: () => (typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'unknown'),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    };
    store = createStore({ dir: app.getPath('userData'), cipher });
    store.actions.settleOrphans();
    const days = store.settings.get().privacy.retentionDays;
    store.conversations.prune(days);
    store.actions.prune(days);
    ensureDefaults();

    actionsApi = createActions({
      shell, apps, search, readDocument,
      getSettings: () => store.settings.get(),
      getPath: (n) => app.getPath(n === 'documents' ? 'documents' : n),
      homedir: os.homedir(),
    });
    agent = createAgent({ store, actions: actionsApi, apps, emit: (evt) => broadcast('chat:event', evt), getPath: app.getPath.bind(app) });
    store.onChange((scope) => broadcast('state:changed', { scope }));

    registerIpc({ store, agent, actions: actionsApi, windows, shortcuts, rendererRoot: RENDERER_ROOT, system });
    shortcuts.init();
    createTray();
    windows.createQuick();
    Object.assign(ctx, { store, agent, actions: actionsApi, windows, shortcuts, system, app });

    if (!IS_E2E) handleArgs(flags);
    return ctx;
  });
}
