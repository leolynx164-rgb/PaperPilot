// Test de bout en bout : lance la vraie application (Electron) avec un faux serveur IA local,
// pilote l'interface, vérifie le comportement réel et enregistre des captures d'écran.
//   xvfb-run -a npx electron scripts/e2e.js --no-sandbox [dossier-captures]
const fs = require('fs');
const os = require('os');
const path = require('path');

const shots = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || path.join(os.tmpdir(), 'pp-shots');
fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-'));
process.env.PAPERPILOT_E2E = '1';
process.env.PAPERPILOT_DATA_DIR = path.join(tmp, 'data');

const { ctx } = require('../src/main/index.js');
const { createMockLlm } = require('../test/helpers/mock-llm');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'ECHEC'} ${name}${extra ? ' : ' + extra : ''}`); };
const errors = [];

async function main() {
  await ctx.ready;
  const mock = createMockLlm();
  const base = await mock.listen();
  const docs = path.join(tmp, 'Documents'), dl = path.join(tmp, 'Téléchargements');
  const w = (p, c = 'contenu') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  const day = 86400000;
  const touch = (p, ago) => { const t = (Date.now() - ago) / 1000; fs.utimesSync(p, t, t); };
  w(path.join(docs, 'Factures', 'Facture EDF octobre.pdf')); touch(path.join(docs, 'Factures', 'Facture EDF octobre.pdf'), 2 * day);
  w(path.join(docs, 'Factures', 'Facture Free septembre.pdf')); touch(path.join(docs, 'Factures', 'Facture Free septembre.pdf'), 40 * day);
  w(path.join(docs, 'Présentation Q3.pptx')); w(path.join(docs, 'Notes de réunion.docx'));
  for (const f of ['photo-vacances.jpg', 'scan.png', 'rapport.pdf', 'budget.xlsx', 'musique.mp3', 'archive.zip', 'inconnu.xyz']) w(path.join(dl, f));

  ctx.store.settings.update({ allowedFolders: [docs, dl] });
  mock.state.respond = (body) => {
    const last = String(body.messages.at(-1).content);
    if (last.startsWith('[Résultat système]')) {
      if (last.includes('search_files')) return 'J’ai trouvé deux factures PDF. La plus récente est **Facture EDF octobre.pdf**, modifiée il y a deux jours. Vous pouvez l’ouvrir depuis la liste ci-dessus.';
      if (last.includes('organize_files')) return 'Le rangement est terminé : vos fichiers sont répartis par type.';
      return 'D’accord.';
    }
    if (/facture/i.test(last)) return 'Je cherche vos factures au format PDF.\n```paperpilot-action\n' + JSON.stringify({ type: 'search_files', args: { query: 'facture', kind: 'pdf', sort: 'recent', limit: 5 } }) + '\n```';
    if (/range/i.test(last)) return 'Je vous propose de ranger votre dossier Téléchargements par type de fichier.\n```paperpilot-action\n' + JSON.stringify({ type: 'organize_files', args: { folder: dl, strategy: 'by_type' } }) + '\n```';
    return 'Bien sûr. Voici trois idées pour **organiser** votre semaine :\n\n- Bloquer une heure le matin pour les tâches de fond\n- Regrouper les réunions dans l’après-midi\n- Garder le vendredi pour faire le point\n\nSouhaitez-vous que j’en détaille une ?';
  };

  const main = ctx.windows.createMain();
  const watch = (win, label) => win.webContents.on('console-message', (e) => { const lvl = e.level ?? e.severity; if (lvl === 'error' || lvl === 3) errors.push(`[${label}] ${e.message}`); });
  watch(main, 'main'); watch(ctx.windows.quick, 'quick');
  main.webContents.on('render-process-gone', (_e, d) => errors.push('render-process-gone ' + d.reason));
  main.setSize(1180, 800); main.show();
  const exec = (win, code) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (win, expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await exec(win, `Boolean(${expr})`)) return true; } catch { /* page en chargement */ } await sleep(60); } return false; };
  const shot = async (win, name) => { await sleep(350); fs.writeFileSync(path.join(shots, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const nav = async (id) => { await exec(main, `document.querySelector('.nav button[data-id="${id}"]').click()`); await sleep(450); };
  const typeSend = (win, text) => exec(win, `(() => { const ta = document.querySelector('.composer textarea'); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);

  // ---- 1. Premier lancement
  check('la fenêtre principale se charge', await waitFor(main, "document.querySelector('.welcome h1')"));
  await shot(main, '01-bienvenue');

  // ---- 2. Configuration d'un fournisseur par l'interface réelle
  await exec(main, "document.querySelector('.steps li .btn').click()");
  check('la section Fournisseurs s’ouvre', await waitFor(main, "document.querySelector('.presets')"));
  await shot(main, '02-fournisseurs-choix');
  await exec(main, "[...document.querySelectorAll('.presets button')].find(b => b.textContent.includes('Personnalisé')).click()");
  await waitFor(main, "document.querySelector('.form input[aria-label=\"Nom affiché\"], .form input')");
  await exec(main, `(() => { const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('input[aria-label="Nom"]', 'Serveur de test'); set('input[aria-label="URL de base"]', ${JSON.stringify(base + '/v1')}); set('input[aria-label="Clé API"]', 'sk-test'); set('input[aria-label="Nom du modèle"]', 'mock-model'); })()`);
  await exec(main, "[...document.querySelectorAll('.form-actions button')].find(b => b.textContent.includes('Tester')).click()");
  check('le test de connexion réussit réellement', await waitFor(main, "document.querySelector('.status-line.ok')", 15000));
  const okMsg = await exec(main, "document.querySelector('.status-line.ok').textContent");
  check('le message de test est explicite', /vérifiée/.test(okMsg), okMsg);
  await shot(main, '03-fournisseur-teste');
  await exec(main, "[...document.querySelectorAll('.form-actions button')].find(b => b.textContent.includes('Enregistrer')).click()");
  await waitFor(main, "document.querySelector('.pitem')");
  const provs = ctx.store.providers.list();
  check('le fournisseur est enregistré avec sa clé (jamais exposée)', provs.length === 1 && provs[0].hasKey && !JSON.stringify(provs).includes('sk-test'));
  const wrongKey = await (async () => { mock.state.keys.openai = 'autre-cle'; const r = await require('../src/main/providers').testConnection({ ...provs[0], params: {} }, 'sk-test'); mock.state.keys.openai = 'sk-test'; return r; })();
  check('une clé refusée est signalée honnêtement', wrongKey.ok === false && wrongKey.code === 'invalid_key', wrongKey.message);

  // ---- 3. Conversation avec recherche réelle
  ctx.store.settings.update({ onboarded: true });
  await exec(main, "document.querySelector('.nav button[data-id=\"home\"]').click()");
  check('l’accueil de conversation s’affiche', await waitFor(main, "document.querySelector('.greeting h2')"));
  await shot(main, '04-conversation-vide');
  await typeSend(main, 'Retrouve mon dernier document PDF sur la facturation (facture)');
  check('une carte de résultats de fichiers apparaît', await waitFor(main, "document.querySelector('.act-done .frow')", 12000));
  check('la réponse finale du modèle arrive', await waitFor(main, "document.querySelectorAll('.turn-assistant').length >= 2 && !document.querySelector('.writing')", 12000));
  const names = await exec(main, "[...document.querySelectorAll('.act-done .frow .nm')].map(n => n.textContent)");
  check('seuls de vrais fichiers sont listés', names.length === 2 && names[0] === 'Facture EDF octobre.pdf', JSON.stringify(names));
  await shot(main, '05-conversation-recherche');

  // ---- 4. Action sensible : confirmation, exécution, annulation
  await typeSend(main, 'Peux-tu ranger mon dossier Téléchargements ?');
  check('une demande de confirmation s’affiche', await waitFor(main, "document.querySelector('.act-awaiting .btn-primary')", 12000));
  check('rien n’est déplacé avant confirmation', fs.existsSync(path.join(dl, 'photo-vacances.jpg')));
  await shot(main, '06-confirmation');
  await exec(main, "document.querySelector('.act-awaiting .btn-primary').click()");
  check('après autorisation, les fichiers sont réellement rangés', await waitFor(main, "document.querySelector('.act-done .btn-quiet')", 12000) && fs.existsSync(path.join(dl, 'Images', 'photo-vacances.jpg')) && fs.existsSync(path.join(dl, 'inconnu.xyz')));
  await waitFor(main, "!document.querySelector('.writing') && document.querySelectorAll('.turn-assistant').length >= 4", 12000);
  await shot(main, '07-rangement-termine');
  await exec(main, "[...document.querySelectorAll('.act-done .btn-quiet')].find(b => b.textContent.includes('Annuler')).click()");
  check('l’annulation remet les fichiers en place', await waitFor(main, "document.querySelector('.act-done .hint')") && fs.existsSync(path.join(dl, 'photo-vacances.jpg')) && !fs.existsSync(path.join(dl, 'Images')));

  // ---- 5. Une question simple et le rendu Markdown
  await exec(main, "document.querySelector('.chat-head .btn').click()");
  await typeSend(main, 'Bonjour ! Aide-moi à organiser ma semaine');
  await waitFor(main, "document.querySelector('.prose ul') && !document.querySelector('.writing')", 12000);
  check('le Markdown est rendu (liste)', await exec(main, "document.querySelectorAll('.prose li').length === 3"));
  await shot(main, '08-conversation-markdown');

  // ---- 6. Les autres sections
  await nav('history'); await shot(main, '09-historique');
  await nav('files');
  await exec(main, "(() => { const i = document.querySelector('.searchline input'); i.value = 'facture'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  check('la recherche de fichiers fonctionne', await waitFor(main, "document.querySelectorAll('.results .frow').length === 2", 10000));
  await shot(main, '10-fichiers');
  await nav('actions'); await shot(main, '11-actions');
  await nav('providers'); await shot(main, '12-fournisseurs');
  await nav('settings'); await shot(main, '13-general');
  await nav('appearance'); await shot(main, '14-apparence');
  await nav('privacy'); await shot(main, '15-confidentialite');

  // ---- 7. Fenêtre flottante
  main.hide();
  ctx.windows.showQuick();
  const q = ctx.windows.quick;
  check('la fenêtre flottante est visible, au premier plan et sans cadre', q.isVisible() && q.isAlwaysOnTop());
  await waitFor(q, "document.querySelector('.greeting h2')");
  await shot(q, '16-flottante-vide');
  await typeSend(q, 'Trouve mes factures');
  check('la fenêtre flottante affiche les résultats', await waitFor(q, "document.querySelector('.act-done .frow')", 12000));
  await waitFor(q, "!document.querySelector('.writing') && document.querySelectorAll('.turn-assistant').length >= 2", 12000);
  await shot(q, '17-flottante-resultats');
  check('l’historique est partagé entre les deux fenêtres', ctx.store.conversations.list().some((c) => c.title.startsWith('Trouve mes factures')));
  await exec(q, "document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(300);
  check('Échap ferme la fenêtre flottante', !q.isVisible());

  check('aucune erreur dans les consoles des fenêtres', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies. Captures : ${shots}`);
  await mock.close();
  process.exitCode = failed.length ? 1 : 0;
  require('electron').app.exit(process.exitCode);
}
main().catch((e) => { console.error('ECHEC e2e', e); require('electron').app.exit(2); });
