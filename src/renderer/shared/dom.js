import { ICONS } from './icons-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Création d'éléments : h('div', { class: 'x', onclick }, 'texte', autreNoeud). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // uniquement du contenu déjà échappé (markdown.js)
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => { el.replaceChildren(); return el; };

/** Icône fine (Lucide) en SVG intégré. */
export function icon(name, { size, cls } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  if (size) { svg.style.width = svg.style.height = size + 'px'; }
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/** Marque PaperPilot : un avion en papier plié. */
export function logo(size = 20, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.width = svg.style.height = size + 'px';
  svg.innerHTML = '<path d="M3 14 29 4 14 19Z" fill="currentColor"/><path d="M14 19 29 4 21 28Z" fill="currentColor" opacity=".72"/><path d="M14 19 21 28 15.5 25.5Z" fill="currentColor" opacity=".45"/>';
  return svg;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
