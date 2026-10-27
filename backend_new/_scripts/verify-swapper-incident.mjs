/**
 * VÃ©rifie qu'un SWAPPER peut dÃ©clarer un incident via POST /incidents.
 * Usage : cd backend_new && node _scripts/verify-swapper-incident.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const PASSWORD = process.env.SHAPE_PASSWORD ?? process.env.DEMO_PASSWORD ?? '';

async function api(path, token, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const login = (
  await api('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email: 'awa.nkolo@upowa.org', password: PASSWORD }),
  })
).body?.accessToken;

console.log('swapper token:', Boolean(login));

const me = await api('/auth/me', login);
const swapper = me.body?.user;
console.log('role:', swapper?.role, '| stationId:', swapper?.stationId);

const create = await api('/incidents', login, {
  method: 'POST',
  body: JSON.stringify({
    stationId: swapper?.stationId,
    affectedSwapperId: swapper?.id,
    title: 'VÃ©rification API incident',
    description: 'Signalement automatique pour valider la route connectÃ©e.',
    category: 'OTHER',
    severity: 'LOW',
    occurredAt: new Date().toISOString(),
  }),
});

console.log('\n=== POST /incidents (SWAPPER) ===');
console.log('status:', create.status);
console.log('body:', JSON.stringify(create.body).slice(0, 300));

process.exit(create.status === 201 ? 0 : 1);
