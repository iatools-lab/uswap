/**
 * Compare les fournisseurs de tuiles sur une zone RÉELLE (coordonnées
 * converties correctement en tuiles XYZ).
 *
 * Objectif : choisir celui qui affiche rues, carrefours, bâtiments et points
 * d'intérêt au niveau de zoom utile (17-19), et vérifier qu'il répond vite.
 */
const ZONES = [
  { name: 'Douala Bonaberi', lat: 4.0777, lng: 9.6627 },
  { name: 'Douala Bonamoussadi', lat: 4.0985, lng: 9.7415 },
  { name: 'Yaounde Centre', lat: 3.848, lng: 11.5021 },
];

/** Conversion latitude/longitude -> tuile XYZ (projection Web Mercator). */
function tileFor(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

const PROVIDERS = [
  {
    name: 'Esri WorldStreetMap (actuel)',
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  },
  {
    name: 'OpenStreetMap standard',
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  {
    name: 'CARTO Voyager',
    url: (z, x, y) =>
      `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
  },
];

const ZOOM = 17;

for (const p of PROVIDERS) {
  const results = [];
  for (const zone of ZONES) {
    const { x, y } = tileFor(zone.lat, zone.lng, ZOOM);
    try {
      const started = Date.now();
      const r = await fetch(p.url(ZOOM, x, y), {
        headers: { 'User-Agent': 'uSwap/1.0 (gestion de stations)' },
      });
      const buf = await r.arrayBuffer();
      results.push(
        `${zone.name.split(' ')[1] ?? zone.name}: ${r.status} ${(buf.byteLength / 1024).toFixed(1)}ko ${Date.now() - started}ms`,
      );
    } catch {
      results.push(`${zone.name}: ECHEC`);
    }
  }
  console.log(`\n${p.name}`);
  for (const r of results) console.log('  ' + r);
}
