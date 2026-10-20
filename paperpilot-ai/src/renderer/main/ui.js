import { h, icon } from '../shared/dom.js';

/** Page de section : titre éditorial, sous-titre, zone défilante. */
export function sheet(title, sub, ...actions) {
  const inner = h('div', { class: 'sheet-inner' });
  const scroller = h('div', { class: 'sheet-body' }, inner);
  const el = h('div', { class: 'sheet-view view-enter' },
    h('header', { class: 'sheet-head' }, h('div', {}, h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null), h('div', { class: 'head-actions' }, ...actions)),
    scroller);
  return { el, body: inner, scroller };
}

export const group = (text) => h('h2', { class: 'group' }, text);

export function row(label, desc, control, { stack = false, top = false } = {}) {
  return h('div', { class: 'row' + (stack ? ' stack' : '') + (top ? ' top' : '') },
    h('div', {}, h('div', { class: 'lab' }, label), desc ? h('div', { class: 'desc' }, desc) : null),
    control ? h('div', { class: 'ctl' }, control) : null);
}

export function toggle(checked, onChange, label) {
  const b = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label });
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

export function seg(options, value, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const paint = (v) => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(v))));
  for (const o of options) {
    const b = h('button', { type: 'button', role: 'radio', dataset: { v: String(o.value) } }, o.swatch ? h('span', { class: 'swatch', style: `background:${o.swatch}` }) : null, o.label);
    b.addEventListener('click', () => { paint(o.value); onChange(o.value); });
    wrap.append(b);
  }
  paint(value);
  return wrap;
}

/** Bouton à double validation, sans fenêtre modale : un premier clic demande confirmation. */
export function confirmButton({ label, confirmLabel, ic, onConfirm, cls = 'btn btn-quiet btn-sm' }) {
  let armed = false, timer;
  const b = h('button', { class: cls, type: 'button' });
  const paint = () => { b.replaceChildren(ic ? icon(ic) : '', armed ? confirmLabel : label); b.classList.toggle('btn-warn', armed); };
  b.addEventListener('click', async () => {
    if (!armed) { armed = true; paint(); timer = setTimeout(() => { armed = false; paint(); }, 3500); return; }
    clearTimeout(timer); armed = false; paint();
    await onConfirm();
  });
  paint();
  return b;
}

export const status = (kind, text) => h('div', { class: 'status-line ' + (kind || '') }, kind === 'ok' ? icon('check') : kind === 'bad' ? icon('circle-alert') : icon('info'), h('span', {}, text));

export function emptyState(title, text, action) {
  const sheetSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sheetSvg.setAttribute('viewBox', '0 0 54 54');
  sheetSvg.setAttribute('class', 'sheet');
  sheetSvg.innerHTML = '<path d="M12 6h22l10 10v32H12z"/><path d="M34 6v10h10"/><path d="M20 28h16M20 35h16M20 42h9"/>';
  return h('div', { class: 'empty' }, sheetSvg, h('h3', {}, title), h('p', {}, text), action || null);
}
