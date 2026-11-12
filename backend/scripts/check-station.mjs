/**
 * Création d'une station : cas signalé (« lorsque je crée une station... »).
 * On exerce le parcours complet : création, lecture, modification, suppression.
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
  name: `Station QA ${Date.now().toString(36)}`,
  address: 'Rue de test 12',
  city: 'Douala',
  location: 'Douala, Cameroun',
  latitude: 4.05,
  longitude: 9.7,
  timezone: 'Africa/Douala',
  weeklyHoursLimit: 48,
  geofenceRadiusMeters: 150,
};

const create = await call('/superadmin/stations', {
  method: 'POST',
  body: JSON.stringify(payload),
});
const created = await create.json().catch(() => ({}));
console.log(
  `${create.status < 300 ? '[OK]  ' : '[FAIL]'} création -> ${create.status}` +
    (create.status >= 400
      ? ` :: ${JSON.stringify(created).slice(0, 220)}`
      : ` (id ${created.id ?? '?'})`),
);

if (!created.id) process.exit(1);

const update = await call(`/superadmin/stations/${created.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ ...payload, weeklyHoursLimit: 40 }),
});
console.log(
  `${update.status < 300 ? '[OK]  ' : '[FAIL]'} modification -> ${update.status}`,
);

const list = await call('/superadmin/stations');
const body = await list.json().catch(() => []);
const arr = Array.isArray(body) ? body : (body.items ?? []);
console.log(
  `${arr.some((s) => s.id === created.id) ? '[OK]  ' : '[FAIL]'} lecture -> ${list.status}, ${arr.length} station(s)`,
);

/*
 * Il n'y a PAS de suppression de station, et c'est voulu : une station porte
 * l'historique des shifts et des pointages. On la DÉSACTIVE à la place — ce
 * que l'interface expose comme « Désactiver ».
 */
const disable = await call(`/superadmin/stations/${created.id}/deactivate`, {
  method: 'PATCH',
  body: JSON.stringify({}),
});
console.log(
  `${disable.status < 300 ? '[OK]  ' : '[FAIL]'} désactivation -> ${disable.status}`,
);
