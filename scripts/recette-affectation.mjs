// Recette « Ajouter des swappeurs » — les contrôles ne doivent pas être rejetés.
//
//   node scripts/recette-affectation.mjs
//
// Reproduit exactement les appels de l'écran d'affectation (avec `revision`
// dans le corps), sur un créneau réel, pour un swappeur réel.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../backend_new/node_modules/@prisma/client');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = 'Recette-SuperAdmin-2026!';
const prisma = new PrismaClient();
const results = [];
const log = (name, ok, detail = '') => results.push({ name, ok, detail });

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function main() {
  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: 'recette.superadmin@uswap.test', password: PASSWORD },
  });
  const token = login.data?.accessToken;

  // Un planning de recette avec un créneau, et un agent actif de la même station.
  const planning = await prisma.planning.findFirst({
    where: { name: { startsWith: 'Recette fuseau' } },
    orderBy: { createdAt: 'desc' },
  });
  const occurrence = planning
    ? await prisma.occurrence.findFirst({ where: { planningId: planning.id } })
    : null;
  log('Créneau de recette disponible', Boolean(occurrence), occurrence?.id ?? 'absent');
  if (!occurrence) return;

  const swapper = await prisma.user.findFirst({
    where: { role: 'SWAPPER', isActive: true, disabledAt: null },
    orderBy: { createdAt: 'asc' },
  });
  log('Agent actif disponible', Boolean(swapper), swapper?.email ?? 'absent');
  if (!swapper) return;

  const body = { swapperId: swapper.id, revision: planning.revision };

  // C'est l'appel que fait l'écran pour chaque candidat.
  const report = await call(
    `/plannings/${planning.id}/occurrences/${occurrence.id}/validate`,
    { method: 'POST', body, token },
  );
  log(
    'Contrôle d’un candidat accepté (avec revision)',
    report.status === 201 || report.status === 200,
    `HTTP ${report.status} ${JSON.stringify(report.data?.message ?? '').slice(0, 160)}`,
  );
  log(
    'Le contrôle renvoie un rapport exploitable',
    typeof report.data?.valid === 'boolean' && Array.isArray(report.data?.weeks),
    JSON.stringify({
      valid: report.data?.valid,
      weeks: report.data?.weeks?.length,
      errors: report.data?.errors?.length,
    }),
  );

  // Même route en PATCH (alias utilisé par certains écrans).
  const patchReport = await call(
    `/plannings/${planning.id}/occurrences/${occurrence.id}/validate`,
    { method: 'PATCH', body, token },
  );
  log('Alias PATCH accepté', [200, 201].includes(patchReport.status), `HTTP ${patchReport.status}`);

  // Validation de planning et publication avec corps (revision).
  const validate = await call(`/plannings/${planning.id}/validate`, {
    method: 'POST',
    body: { revision: planning.revision },
    token,
  });
  log('POST /validate accepte { revision }', [200, 201].includes(validate.status), `HTTP ${validate.status}`);
  log('POST /validate renvoie `valid`', typeof validate.data?.valid === 'boolean', JSON.stringify(validate.data?.valid));

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
  for (const row of failed) console.log(` - ÉCHEC ${row.name} :: ${row.detail}`);
}

main()
  .catch((error) => {
    console.error('ERREUR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
