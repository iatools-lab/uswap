/**
 * Contrôle de routage sur un serveur DÉMARRÉ (une seule fois, à la fin).
 *
 *   node src/common/routing/routes-replica.mjs <url-api>
 *
 * Vérifie, sans toucher aux données :
 *   - les anciens chemins répondent toujours (pas de 404) ;
 *   - les nouveaux chemins par espace de travail existent ;
 *   - un espace refuse un rôle qui n'y a pas droit (401/403, jamais 200).
 *
 * Sortie : code 1 si un chemin attendu renvoie 404.
 */
const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

/** Chemins qui doivent EXISTER (réponse différente de 404). */
const MUST_EXIST = [
  // authentification (hors espaces)
  '/auth/session',
  '/auth/me',
  // anciens chemins (compatibilité)
  '/users',
  '/pilot/admin/settings',
  // espaces de travail
  '/pilot/users',
  '/supervision/leaves/management',
  '/agent/attendance/workspace',
  '/superadmin/cleanup',
  // Routes réellement appelées par le super administrateur : le frontend
  // préfixe chaque chemin métier par son espace (`api/role-routes.ts`).
  // Elles répondaient 404 le 2026-10-31 (contrôleur déclaré dans
  // `CONTROLLER_SPACES.superadmin` mais sans `@SuperAdminRoute`).
  '/superadmin/users/page',
  '/superadmin/stations',
  '/superadmin/plannings',
  '/superadmin/reports/dashboard',
  '/superadmin/dashboard/stats',
  '/superadmin/leaves/management',
  '/superadmin/leaves/pending',
  '/superadmin/admin/settings',
  '/superadmin/admin/audit',
  '/superadmin/incidents',
];

/**
 * Espaces : un appel anonyme doit répondre 401, jamais 200.
 *
 * On interroge une ROUTE de chaque espace, pas le préfixe nu : aucun
 * contrôleur n'est monté sur `/pilot` (son espace commence à `/pilot/users`),
 * donc `/pilot` répond 404 et ne prouve rien sur les gardes.
 */
const PRIVATE = [
  '/pilot/users',
  '/supervision/users',
  '/agent/users',
  '/superadmin/users',
];

async function status(path) {
  try {
    const response = await fetch(base + path, { redirect: 'manual' });
    return response.status;
  } catch (error) {
    return `ERR ${error?.message ?? error}`;
  }
}

let failures = 0;

for (const path of MUST_EXIST) {
  const code = await status(path);
  const ok = typeof code === 'number' && code !== 404;
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${path} -> ${code}`);
  if (!ok) failures += 1;
}

for (const path of PRIVATE) {
  const code = await status(path);
  const ok = code === 401 || code === 403;
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${path} (anonyme) -> ${code}`);
  if (!ok) failures += 1;
}

console.log(
  failures === 0
    ? '\nroutage : tous les chemins attendus existent.'
    : `\nroutage : ${failures} chemin(s) en échec.`,
);
process.exit(failures === 0 ? 0 : 1);
