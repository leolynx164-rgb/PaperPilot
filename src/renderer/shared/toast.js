import { h } from './dom.js';

let host;
export function toast(message, { kind = 'info', action, ms } = {}) {
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const el = h('div', { class: 'toast ' + kind }, h('span', {}, message));
  if (action) el.append(h('button', { onclick: () => { action.run(); el.remove(); } }, action.label));
  host.append(el);
  setTimeout(() => el.remove(), ms || (kind === 'error' ? 7000 : 3800));
}
