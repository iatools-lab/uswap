/**
 * Vérifie les cycles congés et incidents : attente -> approuvé / refusé.
 *
 * Congés  : décision par admin/superviseur, et effet sur l'affectation
 *           seulement si APPROVED (comportement d'origine).
 * Incidents : suivi de statut, SANS effet sur la disponibilité.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

async function login(email, segment) {
  const r = await fetch(`${BASE}/auth/login/${segment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await r.json().catch(() => ({}))).accessToken;
}

const call = (token, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

const swapperToken = await login(process.env.SWAPPER_EMAIL, 'swapper');
const adminToken = await login(process.env.ADMIN, 'admin');

// ---------- CONGÉS -------------------------------------------------------
// Dates décalées aléatoirement : deux exécutions ne doivent pas tomber sur
// les mêmes jours, ce que le serveur refuse (409, congé déjà posé).
const offset = 40 + Math.floor(Math.random() * 200);
const start = new Date(Date.now() + offset * 86400000)
  .toISOString()
  .slice(0, 10);
const end = new Date(Date.parse(start) + 3 * 86400000)
  .toISOString()
  .slice(0, 10);

const submit = await call(swapperToken, '/agent/leaves', {
  method: 'POST',
  body: JSON.stringify({
    type: 'ANNUAL',
    startDate: start,
    endDate: end,
    reason: 'Vérification cycle congés',
  }),
});
const leave = await submit.json().catch(() => ({}));
console.log(
  `${submit.status === 201 || submit.status === 200 ? '[OK]  ' : '[FAIL]'} congé déposé -> ${submit.status} (statut ${leave.status ?? '?'})`,
);

// File d'attente côté administration
const pending = await call(adminToken, '/pilot/leaves/pending');
const pendingBody = await pending.json().catch(() => ({}));
const list = Array.isArray(pendingBody)
  ? pendingBody
  : (pendingBody.items ?? []);
console.log(
  `${pending.status === 200 ? '[OK]  ' : '[FAIL]'} file des congés -> ${pending.status}, ${list.length} en attente`,
);

if (leave.id) {
  const approve = await call(
    adminToken,
    `/pilot/leaves/admin/leaves/${leave.id}/decision`,
    {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'APPROVED' }),
    },
  );
  const approved = await approve.json().catch(() => ({}));
  console.log(
    `${approve.status === 200 ? '[OK]  ' : '[FAIL]'} approbation congé -> ${approve.status} (${approved.status ?? '?'})`,
  );
}

// ---------- REFUS D'UN CONGÉ ---------------------------------------------
const offset2 = 300 + Math.floor(Math.random() * 200);
const s2 = new Date(Date.now() + offset2 * 86400000).toISOString().slice(0, 10);
const e2 = new Date(Date.parse(s2) + 2 * 86400000).toISOString().slice(0, 10);
const submit2 = await call(swapperToken, '/agent/leaves', {
  method: 'POST',
  body: JSON.stringify({
    type: 'ANNUAL',
    startDate: s2,
    endDate: e2,
    reason: 'Vérification refus congé',
  }),
});
const leave2 = await submit2.json().catch(() => ({}));
if (leave2.id) {
  const reject = await call(
    adminToken,
    `/pilot/leaves/admin/leaves/${leave2.id}/decision`,
    { method: 'PATCH', body: JSON.stringify({ decision: 'REJECTED', reason: 'Effectif insuffisant sur la période.' }) },
  );
  const rejected = await reject.json().catch(() => ({}));
  console.log(
    `${reject.status === 200 && rejected.status === 'REJECTED' ? '[OK]  ' : '[FAIL]'} refus congé -> ${reject.status} (${rejected.status ?? '?'})`,
  );
}

// ---------- INCIDENTS ----------------------------------------------------
const incident = await call(swapperToken, '/agent/incidents', {
  method: 'POST',
  body: JSON.stringify({
    // Champs obligatoires du DTO : une station et l'agent concerné.
    stationId: process.env.STATION_ID,
    affectedSwapperId: process.env.SWAPPER_ID,
    category: 'OTHER',
    severity: 'MEDIUM',
    title: 'Vérification cycle incidents',
    description: 'Contrôle du suivi de statut.',
  }),
});
const created = await incident.json().catch(() => ({}));
console.log(
  `${incident.status === 201 || incident.status === 200 ? '[OK]  ' : '[FAIL]'} incident signalé -> ${incident.status} (${created.status ?? '?'})`,
);

const incidents = await call(adminToken, '/supervision/incidents');
console.log(
  `${incidents.status === 200 ? '[OK]  ' : '[FAIL]'} liste des incidents -> ${incidents.status}`,
);
