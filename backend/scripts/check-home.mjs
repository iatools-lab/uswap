/**
 * Page d'accueil par rôle — vérification par l'API (déterministe).
 * Reproduit exactement ce que l'écran d'accueil appelle à l'ouverture.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

const ACCOUNTS = [
  {
    role: 'SUPER_ADMIN',
    segment: 'superadmin',
    email: process.env.SUPER_ADMIN,
    home: '/superadmin',
  },
  { role: 'ADMIN', segment: 'admin', email: process.env.ADMIN, home: '/pilot' },
  {
    role: 'SUPERVISOR',
    segment: 'supervisor',
    email: process.env.SUPERVISOR,
    home: '/supervision',
  },
  {
    role: 'SWAPPER',
    segment: 'swapper',
    email: process.env.SWAPPER,
    home: '/agent',
  },
].filter((a) => a.email);

/** Appels réellement faits par l'écran d'accueil de chaque rôle. */
const HOME_CALLS = {
  SUPER_ADMIN: [
    '/dashboard/stats',
    '/reports/dashboard',
    '/users/page?page=1&limit=1',
    '/notifications',
  ],
  ADMIN: [
    '/dashboard/stats',
    '/reports/dashboard',
    '/users/page?page=1&limit=1',
    '/notifications',
  ],
  SUPERVISOR: [
    '/dashboard/stats',
    '/reports/dashboard',
    '/attendance/workspace',
    '/notifications',
  ],
  SWAPPER: ['/attendance/workspace', '/leaves/workspace', '/notifications'],
};

let failures = 0;

for (const acct of ACCOUNTS) {
  const login = await fetch(`${BASE}/auth/login/${acct.segment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: acct.email, password: PASSWORD }),
  });
  const body = await login.json().catch(() => ({}));
  if (login.status !== 200) {
    console.log(`[FAIL] ${acct.role} — connexion ${login.status}`);
    failures++;
    continue;
  }

  console.log(`\n${acct.role}`);
  for (const path of HOME_CALLS[acct.role]) {
    /*
     * `/notifications` est une route COMMUNE : elle n'est jamais préfixée par
     * l'espace du rôle (voir SHARED_PREFIXES côté frontend). La préfixer
     * donnait `/superadmin/notifications`, donc un 404 qui n'existe pas en
     * usage réel.
     */
    const url = path.startsWith('/notifications')
      ? `${BASE}${path}`
      : `${BASE}${acct.home}${path}`;
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    // 200 attendu ; 4xx métier (pas de données) reste acceptable, 404 NON.
    const ok = r.status < 500 && r.status !== 404;
    if (!ok) failures++;
    console.log(
      `  ${ok ? '[OK]  ' : '[FAIL]'} ${path.padEnd(34)} -> ${r.status}`,
    );
  }
}

console.log(
  failures === 0
    ? '\naccueil (tous rôles) : OK'
    : `\naccueil : ${failures} échec(s)`,
);
process.exit(failures === 0 ? 0 : 1);
