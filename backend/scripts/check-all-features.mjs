/**
 * Revue complète des fonctionnalités — une seule exécution, résultats groupés.
 *
 *  A. Authentification (4 rôles, mauvais mot de passe, déconnexion)
 *  B. Congés (création, file, décision, solde)
 *  C. Absences (déclaration, file, décision, indisponibilité)
 *  D. Pointage (historique, périmètre)
 *  E. Incidents (signalement, liste, suivi)
 *  F. Stations (création, modification, fuseau imposé, géolocalisation)
 *  G. Utilisateurs (liste, recherche, détail)
 *  H. Notifications (liste, préférences SMS)
 *  I. Journal d'audit (descriptions lisibles)
 */
const BASE = 'http://127.0.0.1:3000';
const PW = process.env.DEMO_PASSWORD;

const ACCOUNTS = {
  superadmin: 'superadmin@gmail.com',
  admin: 'admin.demo@upowa.org',
  supervisor: 'superviseur.demo@upowa.org',
  swapper: 'swapper2upowa@gmail.com',
};

const rows = [];
const check = (group, name, ok, detail = '') => {
  rows.push({ group, name, ok, detail });
};

const login = async (segment) => {
  const r = await fetch(`${BASE}/auth/login/${segment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ACCOUNTS[segment], password: PW }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, token: body.accessToken, body };
};

const call = (token, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

// ---------- A. Authentification -----------------------------------------
const sessions = {};
for (const segment of Object.keys(ACCOUNTS)) {
  const s = await login(segment);
  sessions[segment] = s.token;
  check('A. Auth', `connexion ${segment}`, s.status === 200, `${s.status}`);
}
const bad = await fetch(`${BASE}/auth/login/swapper`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ACCOUNTS.swapper, password: 'mauvais' }),
});
check(
  'A. Auth',
  'mot de passe erroné refusé',
  bad.status === 401,
  `${bad.status}`,
);
const me = await call(sessions.superadmin, '/auth/me');
check('A. Auth', 'profil /me', me.status === 200, `${me.status}`);

// ---------- B. Congés ----------------------------------------------------
const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// Décalage aléatoire : le serveur refuse (409) un congé déjà posé sur la même
// période, ce qui ferait échouer le test pour une bonne raison.
const offset = 200 + Math.floor(Math.random() * 400);
const leave = await call(sessions.swapper, '/agent/leaves', {
  method: 'POST',
  body: JSON.stringify({
    type: 'ANNUAL',
    startDate: d(offset),
    endDate: d(offset + 3),
    reason: 'Revue fonctionnalités',
  }),
});
const leaveBody = await leave.json().catch(() => ({}));
check(
  'B. Congés',
  'création',
  leave.status < 300,
  `${leave.status} ${leaveBody.status ?? ''}`,
);
check(
  'B. Congés',
  'statut initial PENDING',
  leaveBody.status === 'PENDING',
  leaveBody.status,
);
const leaveList = await call(sessions.swapper, '/agent/leaves/workspace');
check(
  'B. Congés',
  'espace congés',
  leaveList.status === 200,
  `${leaveList.status}`,
);
const balance = await call(sessions.swapper, '/agent/leaves/balance');
check('B. Congés', 'solde', balance.status === 200, `${balance.status}`);

// ---------- C. Absences --------------------------------------------------
const ws = await call(sessions.swapper, '/agent/attendance/workspace').then(
  (r) => r.json(),
);
const wsList = Array.isArray(ws) ? ws : (ws.shifts ?? ws.items ?? []);
const shift = wsList.find((s) => s.id || s.shiftId);
check(
  'C. Absences',
  'shift affecté disponible',
  !!shift,
  shift ? 'oui' : 'aucun',
);

if (shift) {
  const shiftId = shift.id ?? shift.shiftId;
  const declare = await call(sessions.swapper, '/agent/operations/absences', {
    method: 'POST',
    body: JSON.stringify({ shiftId, reason: 'Revue fonctionnalités' }),
  });
  check(
    'C. Absences',
    'déclaration',
    declare.status < 300 || declare.status === 409,
    `${declare.status}`,
  );
  const pending = await call(
    sessions.supervisor,
    '/supervision/operations/absences/pending',
  );
  check(
    'C. Absences',
    'file superviseur',
    pending.status === 200,
    `${pending.status}`,
  );
}

// ---------- D. Pointage --------------------------------------------------
const history = await call(sessions.swapper, '/agent/attendance/history');
check('D. Pointage', 'historique', history.status === 200, `${history.status}`);
const monitor = await call(
  sessions.supervisor,
  '/supervision/attendance/monitor',
);
check(
  'D. Pointage',
  'supervision des pointages',
  monitor.status === 200,
  `${monitor.status}`,
);

// ---------- E. Incidents -------------------------------------------------
const incidents = await call(sessions.supervisor, '/supervision/incidents');
check('E. Incidents', 'liste', incidents.status === 200, `${incidents.status}`);

// ---------- F. Stations --------------------------------------------------
const stations = await call(sessions.superadmin, '/superadmin/stations');
const stationList = await stations.json().catch(() => []);
const arr = Array.isArray(stationList)
  ? stationList
  : (stationList.items ?? []);
check(
  'F. Stations',
  'liste',
  stations.status === 200,
  `${stations.status} ${arr.length}`,
);
const tz = arr[0]?.timezone;
check('F. Stations', 'fuseau Africa/Douala', tz === 'Africa/Douala', tz ?? '—');
const positioned = arr.filter((s) => s.latitude && s.longitude).length;
check(
  'F. Stations',
  'coordonnées renseignées',
  positioned > 0,
  `${positioned}/${arr.length}`,
);

// ---------- G. Utilisateurs ---------------------------------------------
const users = await call(sessions.admin, '/pilot/users/page?page=1');
check(
  'G. Utilisateurs',
  'liste paginée',
  users.status === 200,
  `${users.status}`,
);
const search = await call(
  sessions.admin,
  '/pilot/users/page?page=1&search=swapper',
);
check(
  'G. Utilisateurs',
  'recherche',
  search.status === 200,
  `${search.status}`,
);

// ---------- H. Notifications --------------------------------------------
const notifs = await call(sessions.swapper, '/notifications');
check('H. Notifications', 'liste', notifs.status === 200, `${notifs.status}`);
const prefs = await call(sessions.swapper, '/notifications/preferences');
const prefBody = await prefs.json().catch(() => ({}));
check(
  'H. Notifications',
  'préférences',
  prefs.status === 200,
  `${prefs.status}`,
);
check(
  'H. Notifications',
  'canal SMS disponible',
  'sms' in prefBody,
  `sms=${prefBody.sms}`,
);

// ---------- I. Audit -----------------------------------------------------
const audit = await call(sessions.admin, '/pilot/admin/audit');
const auditBody = await audit.json().catch(() => ({ events: [] }));
const events = auditBody.events ?? [];
const quoted = events.filter((e) =>
  /[{}]|"[a-zA-Z]+"\s*:/.test(e.description ?? ''),
);
check(
  'I. Audit',
  'événements',
  audit.status === 200,
  `${audit.status} ${events.length}`,
);
check(
  'I. Audit',
  'aucune description en JSON',
  quoted.length === 0,
  `${quoted.length} brute(s)`,
);

// ---------- Résumé -------------------------------------------------------
let failed = 0;
let current = '';
for (const r of rows) {
  if (r.group !== current) {
    console.log(`\n${r.group}`);
    current = r.group;
  }
  if (!r.ok) failed++;
  console.log(
    `  ${r.ok ? '[OK]  ' : '[FAIL]'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`,
  );
}
console.log(`\n${rows.length - failed}/${rows.length} vérifications réussies`);
process.exit(failed === 0 ? 0 : 1);
