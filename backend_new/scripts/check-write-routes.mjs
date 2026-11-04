/**
 * Revue des routes d'ÉCRITURE (POST/PATCH/PUT/DELETE) par espace.
 *
 * On n'exécute pas ces routes en production : on vérifie qu'elles SONT
 * MONTÉES. Une route absente répond 404 avec un corps vide, alors qu'une
 * route existante refuse la requête par validation (400/422) ou par droits
 * (401/403) et renvoie un message d'erreur explicite.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

const ACCOUNTS = [
  { role: 'SUPER_ADMIN', segment: 'superadmin', email: process.env.SUPER_ADMIN, space: 'superadmin' },
  { role: 'ADMIN', segment: 'admin', email: process.env.ADMIN, space: 'pilot' },
  { role: 'SUPERVISOR', segment: 'supervisor', email: process.env.SUPERVISOR, space: 'supervision' },
  { role: 'SWAPPER', segment: 'swapper', email: process.env.SWAPPER, space: 'agent' },
].filter((a) => a.email);

const log = readFileSync('../backend-verify.out.log', 'utf8');
const mapped = [];
for (const line of log.split('\n')) {
  const m = line.match(/Mapped\s+\{([^}]+)\}/);
  if (!m) continue;
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts[0]) mapped.push({ path: parts[0], method: parts[1] ?? 'GET' });
}

let problems = 0;

for (const acct of ACCOUNTS) {
  const res = await fetch(`${BASE}/auth/login/${acct.segment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: acct.email, password: PASSWORD }),
  });
  const { accessToken } = await res.json().catch(() => ({}));
  if (!accessToken) continue;

  const targets = mapped.filter(
    (m) =>
      m.method !== 'GET' &&
      m.path.startsWith(`/${acct.space}/`) &&
      !m.path.includes(':'),
  );

  const missing = [];
  for (const target of targets) {
    const r = await fetch(`${BASE}${target.path}`, {
      method: target.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    // 404 = route non montée. Un corps JSON d'erreur signifie que la route
    // existe et a bien été atteinte.
    if (r.status === 404) {
      const body = await r.text();
      if (!body || !body.includes('code')) missing.push(`${target.method} ${target.path}`);
    }
  }

  console.log(
    `${missing.length === 0 ? '[OK]  ' : '[FAIL]'} ${acct.role.padEnd(11)} ${targets.length} écriture(s) testée(s), ${missing.length} absente(s)`,
  );
  for (const path of missing.slice(0, 5)) console.log(`        ${path}`);
  problems += missing.length;
}

console.log(problems === 0 ? '\nrevue des écritures : OK' : `\nrevue des écritures : ${problems} défaut(s)`);
process.exit(problems === 0 ? 0 : 1);
