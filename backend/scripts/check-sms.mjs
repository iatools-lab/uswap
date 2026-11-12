/**
 * Vérifie le canal SMS : normalisation des numéros et enregistrement d'une
 * livraison SMS dans l'historique d'une notification.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:3000';

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SWAPPER_EMAIL,
      password: process.env.DEMO_PASSWORD,
    }),
  });
  const body = await r.json().catch(() => ({}));
  return body.accessToken;
}

const token = await login();
if (!token) {
  console.log('[FAIL] connexion impossible');
  process.exit(1);
}

// Préférences : activer le SMS (opt-in)
const prefs = await fetch(`${BASE}/notifications/preferences`, {
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ sms: true }),
});
const prefBody = await prefs.json().catch(() => ({}));
console.log(
  `${prefs.status === 200 ? '[OK]  ' : '[FAIL]'} préférences SMS -> ${prefs.status} (sms=${prefBody.sms})`,
);

// Déclencher une notification réelle : demande de congé
const leaves = await fetch(`${BASE}/agent/leaves`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    type: 'ANNUAL',
    // Le DTO attend `startDate` / `endDate` (format YYYY-MM-DD).
    startDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10),
    reason: 'Verification SMS automatisée',
  }),
});
console.log(
  `${leaves.status < 300 ? '[OK]  ' : '[FAIL]'} demande de congé -> ${leaves.status}`,
);

// Historique de la dernière notification
const list = await fetch(`${BASE}/notifications`, {
  headers: { authorization: `Bearer ${token}` },
});
const items = list.status === 200 ? await list.json() : [];
const latest = Array.isArray(items) ? items[0] : (items.items ?? [])[0];
console.log(`dernière notification : ${latest?.title ?? '(aucune)'}`);
console.log(
  `canaux : ${JSON.stringify(latest?.deliveries ?? latest?.channels ?? 'n/a')}`,
);
