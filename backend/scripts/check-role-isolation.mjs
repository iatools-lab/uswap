/**
 * Cloisonnement des rôles — vérification DIRECTE par l'API.
 *
 * Pour chaque compte : on ouvre une session comme le fait l'application, puis
 * on appelle les 4 espaces. Le sien doit répondre 2xx, les autres 403/404.
 * Aucun navigateur : le test est déterministe et rapide.
 *
 *   cd backend
 *   $env:SUPERADMIN_EMAIL="..."; $env:SWAPPER_EMAIL="..."; $env:DEMO_PASSWORD="..."
 *   node scripts/check-role-isolation.mjs
 */
const BASE = process.env.API ?? 'http://127.0.0.1:3000';

const ACCOUNTS = [
  {
    role: 'SUPER_ADMIN',
    email: process.env.SUPERADMIN_EMAIL,
    password: process.env.DEMO_PASSWORD,
  },
  {
    role: 'SWAPPER',
    email: process.env.SWAPPER_EMAIL,
    password: process.env.DEMO_PASSWORD,
  },
].filter((a) => a.email);

const PROBES = {
  superadmin: '/superadmin/users/page?page=1',
  pilot: '/pilot/users/page?page=1',
  supervision: '/supervision/users/page?page=1',
  agent: '/agent/leaves/workspace',
};

const HOME = {
  SUPER_ADMIN: 'superadmin',
  ADMIN: 'pilot',
  SUPERVISOR: 'supervision',
  SWAPPER: 'agent',
};

/**
 * Espaces accessibles à chaque rôle, par conception.
 *
 * Source : `SPACE_ALLOWED_ROLES` (src/common/routing/role-route.ts). Le super
 * administrateur couvre VOLONTAIREMENT les quatre espaces — il doit pouvoir
 * intervenir partout ; ce n'est pas une fuite de cloisonnement. La règle
 * réellement testée est donc : chaque rôle obtient exactement les espaces
 * auxquels il a droit, et RIEN de plus.
 */
const ALLOWED_SPACES = {
  SUPER_ADMIN: ['superadmin', 'pilot', 'supervision', 'agent'],
  ADMIN: ['pilot', 'supervision', 'agent'],
  SUPERVISOR: ['supervision', 'agent'],
  SWAPPER: ['agent'],
};

const SEGMENT = {
  SUPER_ADMIN: 'superadmin',
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  SWAPPER: 'swapper',
};

if (ACCOUNTS.length === 0) {
  console.error('Aucun compte : definir SUPERADMIN_EMAIL / SWAPPER_EMAIL.');
  process.exit(2);
}

let failures = 0;

for (const acct of ACCOUNTS) {
  const login = await fetch(`${BASE}/auth/login/${SEGMENT[acct.role]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: acct.email, password: acct.password }),
  });

  if (login.status !== 200) {
    console.log(`[FAIL] ${acct.role}: connexion ${login.status}`);
    failures++;
    continue;
  }

  const { accessToken } = await login.json();
  const own = HOME[acct.role];
  const allowed = ALLOWED_SPACES[acct.role] ?? [own];

  console.log(`\n${acct.role} (espace d'accueil : ${own})`);

  for (const [space, path] of Object.entries(PROBES)) {
    const r = await fetch(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const shouldAllow = allowed.includes(space);
    const ok = shouldAllow
      ? r.status >= 200 && r.status < 300
      : r.status === 403 || r.status === 404;
    if (!ok) failures++;
    console.log(
      `  ${ok ? '[OK]  ' : '[FAIL]'} ${space.padEnd(11)} -> ${r.status}` +
        `  (${shouldAllow ? 'autorisé' : 'doit être refusé'})`,
    );
  }
}

console.log(
  failures === 0 ? '\ncloisonnement : OK' : `\ncloisonnement : ${failures} échec(s)`,
);
process.exit(failures === 0 ? 0 : 1);
