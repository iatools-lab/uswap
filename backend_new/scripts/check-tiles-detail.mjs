/**
 * Compare OSM standard et OSM France sur Douala à fort zoom.
 * Critère : poids de la tuile (un fond riche pèse 20-40 ko, un fond vide < 5 ko)
 * et absence d'erreur.
 */
const ZONES = [
  { name: 'Bonanjo', lat: 4.0483, lng: 9.6927 },
  { name: 'Bonaberi', lat: 4.0777, lng: 9.6627 },
  { name: 'Bonamoussadi', lat: 4.0985, lng: 9.7415 },
  { name: 'Akwa', lat: 4.0522, lng: 9.7072 },
];

const tileFor = (lat, lng, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
  return { x, y };
};

const PROVIDERS = [
  { name: 'OSM standard', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  { name: 'OSM France', url: (z, x, y) => `https://a.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png` },
];

for (const zoom of [16, 17, 18]) {
  console.log(`\nzoom ${zoom}`);
  for (const p of PROVIDERS) {
    const parts = [];
    let ok = 0;
    for (const zone of ZONES) {
      const { x, y } = tileFor(zone.lat, zone.lng, zoom);
      try {
        const r = await fetch(p.url(zoom, x, y), {
          headers: { 'User-Agent': 'uSwap/1.0 (gestion de stations)' },
        });
        const buf = await r.arrayBuffer();
        if (r.ok) ok++;
        parts.push(`${zone.name}:${r.status}/${(buf.byteLength / 1024).toFixed(0)}ko`);
      } catch {
        parts.push(`${zone.name}:ECHEC`);
      }
    }
    console.log(`  ${p.name.padEnd(14)} ${ok}/${ZONES.length} | ${parts.join(' ')}`);
  }
}
