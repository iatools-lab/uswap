/**
 * Revue exhaustive des routes d'espace.
 *
 * Pour chaque rôle, on appelle TOUTES les routes GET de son espace avec un
 * jeton valide. Une route qui répond 404 est un défaut : la fonctionnalité
 * existe dans le code mais n'est pas montée là où le frontend l'appelle.
 * On tolère 400/422 (paramètre obligatoire manquant) et 403 (règle métier).
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

const ACCOUNTS = [
  {
    role: 'SUPER_ADMIN',
    segment: 'superadmin',
    email: process.env.SUPER_ADMIN,
    space: 'superadmin',
  },
  { role: 'ADMIN', segment: 'admin', email: process.env.ADMIN, space: 'pilot' },
  {
    role: 'SUPERVISOR',
    segment: 'supervisor',
    email: process.env.SUPERVISOR,
    space: 'supervision',
  },
  {
    role: 'SWAPPER',
    segment: 'swapper',
    email: process.env.SWAPPER,
    space: 'agent',
  },
].filter((a) => a.email);

// Routes extraites du journal de démarrage du backend.
const log = readFileSync('../backend-verify.out.log', 'utf8');
const mapped = [];
for (const line of log.split('\n')) {
  const m = line.match(/Mapped\s+\{([^}]+)\}/);
  if (!m) continue;
  const parts = m[1].split(',').map((p) => p.trim());
  const path = parts[0];
  const method = parts[1] ?? 'GET';
  if (path) mapped.push({ path, method });
}

console.log(`routes enregistrées : ${mapped.length}`);

let problems = 0;

for (const acct of ACCOUNTS) {
  const res = await fetch(`${BASE}/auth/login/${acct.segment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: acct.email, password: PASSWORD }),
  });
  const { accessToken } = await res.json().catch(() => ({}));
  if (!accessToken) {
    console.log(`[FAIL] ${acct.role}: connexion ${res.status}`);
    problems++;
    continue;
  }

  // Uniquement les GET de SON espace : les autres sont censés être refusés.
  const targets = mapped.filter(
    (m) =>
      m.method === 'GET' &&
      m.path.startsWith(`/${acct.space}/`) &&
      !m.path.includes(':'),
  );

  const missing = [];
  for (const target of targets) {
    const r = await fetch(`${BASE}${target.path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (r.status === 404) missing.push(target.path);
  }

  console.log(
    `${missing.length === 0 ? '[OK]  ' : '[FAIL]'} ${acct.role.padEnd(11)} ${targets.length} route(s) GET testée(s), ${missing.length} en 404`,
  );
  for (const path of missing) console.log(`        404 : ${path}`);
  problems += missing.length;
}

console.log(
  problems === 0
    ? '\nrevue des routes : OK'
    : `\nrevue des routes : ${problems} défaut(s)`,
);
process.exit(problems === 0 ? 0 : 1);
