/**
 * Protocole d'actions entre le modèle et PaperPilot.
 *
 * Le modèle n'exécute jamais rien : il peut seulement proposer des actions sous la forme de blocs
 *
 *   ```paperpilot-action
 *   {"type":"search_files","args":{"query":"facture","kind":"pdf"}}
 *   ```
 *
 * Le système valide chaque bloc, demande confirmation si nécessaire, exécute, puis renvoie le résultat réel.
 * Ce module est partagé entre le processus principal (require) et les fenêtres (balise <script>).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PPProtocol = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const OPEN = '```paperpilot-action';
  const FENCE = /```paperpilot-action[ \t]*\r?\n([\s\S]*?)```/g;

  /** Extrait les blocs d'action d'une réponse du modèle. */
  function parseActionBlocks(text) {
    const blocks = [];
    const clean = String(text || '').replace(FENCE, (_, raw) => {
      const body = raw.trim();
      try {
        const value = JSON.parse(body);
        for (const item of Array.isArray(value) ? value : [value]) blocks.push({ raw: body, value: item });
      } catch (e) {
        blocks.push({ raw: body, error: 'JSON illisible : ' + e.message });
      }
      return '';
    });
    return { clean: tidy(clean), blocks };
  }

  /** Texte à afficher à l'utilisateur : retire les blocs, y compris un bloc encore en cours d'écriture. */
  function stripForDisplay(text) {
    let t = String(text || '').replace(FENCE, '');
    const i = t.indexOf(OPEN);
    if (i !== -1) t = t.slice(0, i);
    else {
      // Début de clôture partiel en fin de flux (« ```paperp »)
      for (let k = Math.min(OPEN.length - 1, t.length); k >= 4; k--) {
        if (t.endsWith(OPEN.slice(0, k))) { t = t.slice(0, t.length - k); break; }
      }
    }
    return tidy(t);
  }

  function tidy(t) {
    return t.replace(/\n{3,}/g, '\n\n').trim();
  }

  return { OPEN, parseActionBlocks, stripForDisplay };
});
