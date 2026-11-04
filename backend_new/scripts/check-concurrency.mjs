/**
 * Utilisation SIMULTANÉE : plusieurs comptes en parallèle.
 * On ouvre N sessions en même temps et on vérifie que chacune garde la sienne
 * (aucune fuite de jeton ni de rôle entre requêtes concurrentes).
 */
const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

const ACCOUNTS = [
  { role: 'SUPER_ADMIN', email: process.env.ADMIN_EMAIL, probe: '/superadmin/users/page?page=1', expect: 200 },
  { role: 'SWAPPER', email: process.env.SWAPPER_EMAIL, probe: '/agent/leaves/workspace', expect: 200 },
];

const SEGMENT = { SUPER_ADMIN: 'superadmin', SWAPPER: 'swapper' };

async function session(account) {
  const r = await fetch(`${BASE}/auth/login/${SEGMENT[account.role]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: PASSWORD }),
  });
  const body = await r.json().catch(() => ({}));
  return { ...account, status: r.status, token: body.accessToken };
}

// 10 sessions concurrentes, 5 par compte (simule plusieurs onglets/utilisateurs).
const jobs = [];
for (let i = 0; i < 5; i++) {
  for (const account of ACCOUNTS) jobs.push(session(account));
}
const started = Date.now();
const sessions = await Promise.all(jobs);
const loginMs = Date.now() - started;

// Toutes les requêtes d'espace lancées EN MÊME TEMPS.
const calls = sessions.map(async (s) => {
  const r = await fetch(`${BASE}${s.probe}`, {
    headers: { authorization: `Bearer ${s.token}` },
  });
  return { role: s.role, status: r.status, ok: r.status === s.expect };
});
const results = await Promise.all(calls);

// Chaque session doit voir SON espace, et son jeton doit être distinct.
const tokens = new Set(sessions.map((s) => s.token).filter(Boolean));
const failures = results.filter((r) => !r.ok);

// Un jeton de swapper ne doit pas ouvrir l'espace d'administration.
const swapper = sessions.find((s) => s.role === 'SWAPPER' && s.token);
const cross = swapper
  ? await fetch(`${BASE}/superadmin/users/page?page=1`, {
      headers: { authorization: `Bearer ${swapper.token}` },
    })
  : null;

console.log(`sessions ouvertes     : ${sessions.filter((s) => s.token).length}/${sessions.length}`);
console.log(`jetons distincts      : ${tokens.size}`);
console.log(`connexions simultanées: ${loginMs} ms`);
console.log(`appels concurrents OK : ${results.length - failures.length}/${results.length}`);
console.log(`jeton swapper -> admin: ${cross?.status} (attendu 403)`);

const ok = failures.length === 0 && cross?.status === 403 && tokens.size === sessions.length;
console.log(ok ? '\nsimultanéité : OK' : '\nsimultanéité : ÉCHEC');
process.exit(ok ? 0 : 1);
