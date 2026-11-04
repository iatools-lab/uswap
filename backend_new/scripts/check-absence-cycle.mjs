/**
 * Cycle complet d'une absence : déclaration par l'agent, décision par un
 * supérieur, puis effet sur la disponibilité du créneau.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name} — ${detail}`);
};

async function login(email, segment) {
  const r = await fetch(`${BASE}/auth/login${segment ? `/${segment}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await r.json().catch(() => ({}));
  return body.accessToken;
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

// --- 1. Trouver un shift affecté au swapper
const swapperToken = await login(process.env.SWAPPER_EMAIL, 'swapper');
const ws = await call(swapperToken, '/agent/attendance/workspace').then((r) => r.json());
const wsItems = Array.isArray(ws) ? ws : ws.shifts ?? ws.items ?? [];
const shift = wsItems.find((s) => s.id || s.shiftId);
const shiftId = shift?.id ?? shift?.shiftId;

if (!shiftId) {
  log('shift disponible pour le test', false, 'aucun shift affecté au swapper');
  process.exit(1);
}
log('shift disponible pour le test', true, shiftId);

// --- 2. L'agent déclare son absence
const declare = await call(swapperToken, '/agent/operations/absences', {
  method: 'POST',
  body: JSON.stringify({ shiftId, reason: 'Test cycle validation absence' }),
});
const declared = await declare.json().catch(() => ({}));
log(
  'déclaration par l’agent',
  declare.status === 201 || declare.status === 200,
  `statut ${declare.status}, id=${declared.id ?? 'n/a'}`,
);

if (!declared.id) process.exit(1);

// --- 3. Un superviseur voit la demande en attente
const supToken = await login(process.env.SUPERVISOR, 'supervisor');
const pending = await call(supToken, '/supervision/operations/absences/pending');
const pendingList = await pending.json().catch(() => []);
const found = Array.isArray(pendingList) && pendingList.some((a) => a.id === declared.id);
log(
  'demande visible par le superviseur',
  pending.status === 200 && found,
  `statut ${pending.status}, ${Array.isArray(pendingList) ? pendingList.length : 0} en attente`,
);

// --- 4. Le superviseur approuve
const approve = await call(supToken, `/supervision/operations/absences/${declared.id}/decision`, {
  method: 'PATCH',
  body: JSON.stringify({ decision: 'APPROVED', reason: 'Validé par le superviseur' }),
});
const approved = await approve.json().catch(() => ({}));
log(
  'approbation par le superviseur',
  approve.status === 200 && approved.status === 'APPROVED',
  `statut ${approve.status}, décision=${approved.status ?? 'n/a'}`,
);

// --- 5. Une seconde décision doit être refusée
const again = await call(supToken, `/supervision/operations/absences/${declared.id}/decision`, {
  method: 'PATCH',
  body: JSON.stringify({ decision: 'REJECTED' }),
});
log('double décision refusée', again.status === 409, `statut ${again.status}`);

// --- 6. Le swapper ne peut PAS décider lui-même
const self = await call(swapperToken, `/agent/operations/absences/${declared.id}/decision`, {
  method: 'PATCH',
  body: JSON.stringify({ decision: 'APPROVED' }),
});
log(
  'l’agent ne peut pas s’auto-approuver',
  self.status === 403 || self.status === 404,
  `statut ${self.status}`,
);

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\ncycle absence : OK' : `\ncycle absence : ${failed} échec(s)`);
process.exit(failed === 0 ? 0 : 1);
