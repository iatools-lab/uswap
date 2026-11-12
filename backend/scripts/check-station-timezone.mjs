/**
 * Vérifie que le fuseau horaire est IMPOSÉ côté serveur :
 * même si un client envoie une valeur erronée, Africa/Douala est enregistré.
 */
const BASE = 'http://127.0.0.1:3000';

const login = await fetch(`${BASE}/auth/login/superadmin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'superadmin@gmail.com',
    password: process.env.DEMO_PASSWORD,
  }),
});
const { accessToken } = await login.json();
const call = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

// Le client tente volontairement une valeur invalide.
const created = await call('/superadmin/stations', {
  method: 'POST',
  body: JSON.stringify({
    name: `Station TZ ${Date.now().toString(36)}`,
    address: 'Rue test',
    city: 'Douala',
    location: 'Douala, Cameroun',
    latitude: 4.05,
    longitude: 9.7,
    timezone: 'Europe/Paris',
    weeklyHoursLimit: 48,
    geofenceRadiusMeters: 150,
  }),
}).then((r) => r.json());

const list = await call('/superadmin/stations').then((r) => r.json());
const arr = Array.isArray(list) ? list : (list.items ?? []);
const stored = arr.find((s) => s.id === created.id);

const ok = stored?.timezone === 'Africa/Douala';
console.log(
  `${ok ? '[OK]  ' : '[FAIL]'} fuseau imposé : demandé "Europe/Paris", enregistré "${stored?.timezone ?? '?'}"`,
);

if (created.id) {
  await call(`/superadmin/stations/${created.id}/deactivate`, {
    method: 'PATCH',
    body: '{}',
  });
}
process.exit(ok ? 0 : 1);
