const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${nf.format(n / 1024)} Ko`;
  if (n < 1024 ** 3) return `${nf.format(n / 1024 ** 2)} Mo`;
  return `${nf.format(n / 1024 ** 3)} Go`;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « Aujourd’hui 14:32 », « Hier 09:10 », « 12 oct. », « 3 mars 2025 ». */
export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `Aujourd’hui ${time}`;
  if (days === 1) return `Hier ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('fr-FR', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Regroupement de l'historique. */
export function dayGroup(ms) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ms))) / 86400000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  if (days < 7) return 'Cette semaine';
  if (days < 31) return 'Ce mois-ci';
  return 'Plus ancien';
}

export const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

const KIND_ICON = { pdf: 'file-text', word: 'file-text', text: 'file-text', spreadsheet: 'file-spreadsheet', presentation: 'presentation', image: 'file-image', audio: 'file-audio', video: 'file-video', archive: 'file-archive', code: 'file-code', other: 'file' };
export const kindIcon = (kind) => KIND_ICON[kind] || 'file';

/** Raccourci Electron → affichage lisible : « Alt+Space » devient « Alt + Espace ». */
export function prettyAccel(acc) {
  const map = { Space: 'Espace', Super: 'Super', Control: 'Ctrl', Return: 'Entrée', Escape: 'Échap', Up: '↑', Down: '↓', Left: '←', Right: '→' };
  return String(acc || '').split('+').map((p) => map[p] || p).join(' + ');
}
