import { h, icon } from './dom.js';
import { fmtSize, fmtDate, kindIcon, plural } from './format.js';
import { toast } from './toast.js';

const pp = window.pp;
const STATUS = { awaiting: 'En attente de votre accord', running: 'En cours', done: 'Terminé', failed: 'Échec', denied: 'Refusé', cancelled: 'Annulé' };
const fail = (e) => toast(e.message || String(e), { kind: 'error' });

/** Une ligne de résultat de fichier : ouvrir, afficher dans le dossier, navigation au clavier. */
export function fileRow(f) {
  const openBtn = h('button', { class: 'btn btn-text btn-sm', type: 'button', title: 'Ouvrir avec l’application par défaut (Entrée)' }, 'Ouvrir');
  const revealBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Afficher dans le dossier (Ctrl+Entrée)', 'aria-label': 'Afficher dans le dossier' }, icon('folder-open'));
  const open = async () => {
    try { await pp.files.open(f.path); openBtn.textContent = 'Ouvert'; setTimeout(() => { openBtn.textContent = 'Ouvrir'; }, 1600); } catch (e) { fail(e); }
  };
  const reveal = async () => { try { await pp.files.reveal(f.path); } catch (e) { fail(e); } };
  openBtn.addEventListener('click', open);
  revealBtn.addEventListener('click', reveal);
  const row = h('div', {
    class: 'frow', tabindex: 0, role: 'listitem', title: f.path,
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey) reveal(); else open(); }
      else if (e.key === 'ArrowDown' && row.nextElementSibling) { e.preventDefault(); row.nextElementSibling.focus(); }
      else if (e.key === 'ArrowUp' && row.previousElementSibling) { e.preventDefault(); row.previousElementSibling.focus(); }
    },
    ondblclick: open,
  },
  icon(kindIcon(f.kind), { cls: 'fi' }),
  h('div', { style: 'min-width:0' }, h('div', { class: 'nm' }, f.name), h('div', { class: 'pth' }, h('bdi', {}, f.dir))),
  h('div', { class: 'meta' }, [fmtSize(f.size), fmtDate(f.mtime)].filter(Boolean).join(', ')),
  h('div', { class: 'btns' }, openBtn, revealBtn));
  return row;
}

function previewEl(p) {
  if (!p) return null;
  return h('div', { class: 'preview' },
    p.title && h('div', { style: 'font-weight:600' }, p.title),
    p.groups && p.groups.length ? h('div', { class: 'groups' }, p.groups.map((g) => h('span', {}, h('b', {}, g.count), ' vers ', g.label))) : null,
    ...(p.samples || []).map((s) => h('div', { class: 'ps' }, s.to ? `${s.from}  vers  ${s.to}` : s.from)),
    ...(p.notes || []).map((n) => h('div', { class: 'note' }, n)));
}

function resultBody(rec) {
  const d = rec.result && rec.result.data;
  const kids = [h('div', {}, rec.result.summary)];
  if (rec.type === 'search_files' && d && d.results.length) {
    const list = h('div', { class: 'frows', role: 'list' });
    const SHOWN = 6;
    const fill = (all) => {
      list.replaceChildren(...(all ? d.results : d.results.slice(0, SHOWN)).map(fileRow));
    };
    fill(false);
    kids.push(list);
    if (d.results.length > SHOWN) {
      const more = h('div', { class: 'more-row' });
      const btn = h('button', { class: 'btn btn-text btn-sm', type: 'button' }, `Afficher les ${d.results.length - SHOWN} autres`);
      let all = false;
      btn.addEventListener('click', () => { all = !all; fill(all); btn.textContent = all ? 'Réduire la liste' : `Afficher les ${d.results.length - SHOWN} autres`; });
      more.append(btn);
      kids.push(more);
    }
  } else if (rec.type === 'list_directory' && d && d.entries.length) {
    kids.push(h('div', { class: 'hint' }, d.entries.slice(0, 14).map((e) => e.name + (e.type === 'dossier' ? '/' : '')).join(', ') + (d.total > 14 ? '…' : '')));
  }
  if (rec.undone) kids.push(h('div', { class: 'hint' }, rec.undoSummary || 'Opération annulée.'));
  else if (rec.undoable) {
    const btn = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('undo-2'), 'Annuler l’opération');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await pp.actions.undo(rec.id);
        if (r.ok) toast(r.summary); else { toast(r.error, { kind: 'error' }); btn.disabled = false; }
      } catch (e) { fail(e); btn.disabled = false; }
    });
    kids.push(h('div', { class: 'act-buttons' }, btn));
  }
  return kids;
}

/** Carte d'action : confirmation, progression, résultat réel ou échec. */
export function actionCard(rec, { showTime = false } = {}) {
  const status = rec.undone ? 'Annulé, remis en place' : STATUS[rec.status] || rec.status;
  const head = h('div', { class: 'act-head' },
    icon(rec.icon || 'wand-sparkles', { cls: 'ic' }),
    h('span', { class: 'name' }, rec.label),
    h('span', { class: 'args' }, rec.argsSummary || ''),
    showTime ? h('span', { class: 'when' }, fmtDate(rec.ts)) : null,
    h('span', { class: 'act-status' }, rec.status === 'running' ? h('span', { class: 'spin' }) : rec.status === 'done' && !rec.undone ? icon('check') : null, status));
  const body = h('div', { class: 'act-body' });

  if (rec.status === 'awaiting') {
    const ok = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Autoriser');
    const no = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Refuser');
    const decide = async (approve) => {
      ok.disabled = no.disabled = true;
      try { const r = await pp.actions.confirm(rec.id, approve); if (!r.ok) toast(r.error, { kind: 'error' }); } catch (e) { fail(e); ok.disabled = no.disabled = false; }
    };
    ok.addEventListener('click', () => decide(true));
    no.addEventListener('click', () => decide(false));
    body.append(h('div', {}, rec.description), rec.confirmReason ? h('div', { class: 'hint' }, rec.confirmReason) : null, previewEl(rec.preview), h('div', { class: 'act-buttons' }, ok, no));
  } else if (rec.status === 'done' && rec.result) {
    body.append(...resultBody(rec));
  } else if (rec.status === 'failed') {
    body.append(h('div', { class: 'err' }, rec.error || 'L’action a échoué.'));
  } else if (rec.status === 'denied' || rec.status === 'cancelled') {
    body.append(h('div', { class: 'hint' }, rec.error || STATUS[rec.status] + '.'));
  }
  return h('div', { class: `act act-${rec.status}`, dataset: { id: rec.id } }, head, body.childNodes.length ? body : null);
}

export { plural };
