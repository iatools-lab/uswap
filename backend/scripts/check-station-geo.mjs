/**
 * Vérifie que les coordonnées GPS d'une station sont RÉELLEMENT enregistrées.
 * Ce sont elles qui servent au contrôle de périmètre lors du pointage : si
 * elles sont perdues, le pointage devient impossible (ou accepté partout).
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

const payload = {
  name: `Station GPS ${Date.now().toString(36)}`,
  address: 'Avenue de test',
  city: 'Yaoundé',
  location: 'Yaoundé, Cameroun',
  latitude: 3.848,
  longitude: 11.5021,
  timezone: 'Africa/Douala',
  weeklyHoursLimit: 48,
  geofenceRadiusMeters: 200,
};

const created = await call('/superadmin/stations', {
  method: 'POST',
  body: JSON.stringify(payload),
}).then((r) => r.json());

const list = await call('/superadmin/stations').then((r) => r.json());
const arr = Array.isArray(list) ? list : (list.items ?? []);
const stored = arr.find((s) => s.id === created.id);

const ok =
  stored &&
  Number(stored.latitude) === payload.latitude &&
  Number(stored.longitude) === payload.longitude;

console.log(
  `${ok ? '[OK]  ' : '[FAIL]'} coordonnées enregistrées : ` +
    (stored
      ? `lat=${stored.latitude}, lng=${stored.longitude}, rayon=${stored.geofenceRadiusMeters ?? '?'}`
      : 'station introuvable'),
);

// Nettoyage : désactivation de la station de test.
if (created.id) {
  await call(`/superadmin/stations/${created.id}/deactivate`, {
    method: 'PATCH',
    body: '{}',
  });
}
