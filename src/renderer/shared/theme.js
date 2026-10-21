/** Applique les réglages d'apparence partagés (identiques dans les deux fenêtres). */
export function applyTheme(settings) {
  const a = (settings && settings.appearance) || {};
  const root = document.documentElement;
  root.dataset.accent = a.accent || 'sage';
  root.dataset.size = a.textSize || 'medium';
  root.dataset.grain = a.grain === false ? 'off' : 'on';
  root.dataset.motion = a.reduceMotion ? 'reduced' : 'normal';
}
