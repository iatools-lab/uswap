/**
 * Vérifie le composant de recherche d'adresse SANS navigateur.
 *
 * On reproduit l'appel exact du composant (même URL, mêmes en-têtes) et on
 * regarde ce que Nominatim renvoie pour des adresses camerounaises réelles.
 * But : savoir si le service répond, ou si le blocage vient du composant.
 */
const QUERIES = [
  'Bonaberi Douala',
  'Tradex Bonamoussadi, Douala',
  'Avenue Kennedy Yaoundé',
  'Akwa Douala',
];

for (const q of QUERIES) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2' +
    `&q=${encodeURIComponent(q)}` +
    '&limit=8&addressdetails=1&accept-language=fr';

  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'uSwap/1.0 (gestion de stations)',
      },
    });
    const data = await r.json();
    const n = Array.isArray(data) ? data.length : -1;
    const first = n > 0 ? String(data[0].display_name).slice(0, 60) : '—';
    console.log(`${r.status} | ${n} résultat(s) | ${q.padEnd(32)} -> ${first}`);
  } catch (e) {
    console.log(`ERREUR | ${q} :: ${String(e).slice(0, 80)}`);
  }
}
