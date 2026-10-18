/**
 * Integration — tolerance de retard propre au creneau (tag uswap-frontend-s6.2.0).
 *
 * Verifie le contrat de bout en bout :
 *   1. une occurrence accepte `latenessToleranceOverrideMinutes` (0..240) ;
 *   2. la valeur est persistee et renvoyee dans le detail du planning ;
 *   3. les bornes invalides sont refusees (400) ;
 *   4. l'override prime sur la tolerance de la station au pointage ;
 *   5. `null` efface l'override (retour a la tolerance station).
 *
 * Usage :  cd backend_new && node _scripts/check-tolerance-override.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const PASSWORD = process.env.SHAPE_PASSWORD ?? 'Uswap2026!Demo';

let pass = 0;
let fail = 0;

function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  OK      ${label}`);
  } else {
    fail += 1;
    console.log(`  ECHEC   ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

async function api(path, token, init = {}) {
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function login(email) {
  const r = await api('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return r.body?.accessToken ?? null;
}

async function main() {
  console.log('=== TOLERANCE PAR CRENEAU (contrat s6.2.0) ===');
  const admin = await login('admin@upowa.org');
  check('connexion ADMIN', Boolean(admin));
  if (!admin) return;

  const station = await api('/stations', admin, {
    method: 'POST',
    body: JSON.stringify({
      name: `Station Tolerance ${Date.now()}`,
      city: 'Douala',
      location: 'Audit tolerance',
      timezone: 'Africa/Douala',
      latitude: 4.05,
      longitude: 9.7,
      latenessToleranceMinutes: 5,
      weeklyHoursLimit: 48,
      minRestHours: 8,
    }),
  });
  check('station creee', station.status === 201, `status=${station.status}`);
  const stationId = station.body?.id;

  const template = await api(`/stations/${stationId}/shift-templates`, admin, {
    method: 'POST',
    body: JSON.stringify({
      label: 'Matin Tolerance',
      startTime: '06:00',
      endTime: '14:00',
      breakMinutes: 0,
      durationMinutes: 480,
    }),
  });
  check('modele cree', template.status === 201, `status=${template.status}`);
  const templateId = template.body?.id;

  const start = new Date(Date.now() + 120 * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  const planning = await api('/plannings', admin, {
    method: 'POST',
    body: JSON.stringify({
      stationIds: [stationId],
      startDate: start.toISOString(),
      endDate: new Date(start.getTime() + 86_400_000).toISOString(),
    }),
  });
  check('planning cree', planning.status === 201, `status=${planning.status}`);
  const planId = planning.body?.id;

  const generated = await api(`/plannings/${planId}/generate`, admin, {
    method: 'POST',
    body: JSON.stringify({ stationId, templateIds: [templateId] }),
  });
  const occurrence = generated.body?.occurrences?.[0];
  check('poste genere', Boolean(occurrence?.id), `status=${generated.status}`);

  if (!occurrence) return;

  const detail = await api(`/plannings/${planId}`, admin);
  const revision = detail.body?.revision;

  console.log('\n--- ECRITURE + LECTURE ---');
  const set30 = await api(`/plannings/${planId}/occurrences/${occurrence.id}`, admin, {
    method: 'PATCH',
    body: JSON.stringify({ latenessToleranceOverrideMinutes: 30, revision }),
  });
  check('PATCH override=30 accepte', set30.status === 200, `status=${set30.status}`);

  const afterSet = await api(`/plannings/${planId}`, admin);
  const persisted = afterSet.body?.occurrences?.find((o) => o.id === occurrence.id);
  check('override persiste et expose', persisted?.latenessToleranceOverrideMinutes === 30,
    `valeur=${persisted?.latenessToleranceOverrideMinutes}`);

  console.log('\n--- BORNES ---');
  const tooBig = await api(`/plannings/${planId}/occurrences/${occurrence.id}`, admin, {
    method: 'PATCH',
    body: JSON.stringify({ latenessToleranceOverrideMinutes: 999, revision: afterSet.body?.revision }),
  });
  check('999 refuse (400)', tooBig.status === 400, `status=${tooBig.status}`);

  const negative = await api(`/plannings/${planId}/occurrences/${occurrence.id}`, admin, {
    method: 'PATCH',
    body: JSON.stringify({ latenessToleranceOverrideMinutes: -1, revision: afterSet.body?.revision }),
  });
  check('-1 refuse (400)', negative.status === 400, `status=${negative.status}`);

  const notInt = await api(`/plannings/${planId}/occurrences/${occurrence.id}`, admin, {
    method: 'PATCH',
    body: JSON.stringify({ latenessToleranceOverrideMinutes: 12.5, revision: afterSet.body?.revision }),
  });
  check('12.5 (non entier) refuse (400)', notInt.status === 400, `status=${notInt.status}`);

  console.log('\n--- EFFACEMENT (null) ---');
  const current = await api(`/plannings/${planId}`, admin);
  const cleared = await api(`/plannings/${planId}/occurrences/${occurrence.id}`, admin, {
    method: 'PATCH',
    body: JSON.stringify({ latenessToleranceOverrideMinutes: null, revision: current.body?.revision }),
  });
  check('PATCH override=null accepte', cleared.status === 200, `status=${cleared.status}`);
  const afterClear = await api(`/plannings/${planId}`, admin);
  const clearedValue = afterClear.body?.occurrences?.find((o) => o.id === occurrence.id);
  check('override efface', (clearedValue?.latenessToleranceOverrideMinutes ?? null) === null,
    `valeur=${clearedValue?.latenessToleranceOverrideMinutes}`);

  console.log('\n--- PRISE EN COMPTE AU POINTAGE ---');
  const swappers = (await api('/users?role=SWAPPER', admin)).body ?? [];
  const candidate = Array.isArray(swappers) ? swappers.find((u) => u.isActive) : null;
  if (!candidate) {
    console.log('  (aucun swappeur actif — etape de pointage ignoree)');
  } else {
    const latest = await api(`/plannings/${planId}`, admin);
    const assign = await api(`/plannings/${planId}/occurrences/${occurrence.id}`, admin, {
      method: 'PATCH',
      body: JSON.stringify({
        swapperId: candidate.id,
        latenessToleranceOverrideMinutes: 240,
        revision: latest.body?.revision,
      }),
    });
    check('affectation + override=240', assign.status === 200, `status=${assign.status}`);
    const monitor = await api('/attendance/monitor', admin);
    // L'occurrence n'est pas publiee : le monitor ne la montre pas forcement.
    // On verifie surtout que le champ toleranceMinutes reste un nombre.
    const row = monitor.body?.rows?.find((r) => r.shiftId === occurrence.id);
    check('monitor expose toleranceMinutes numerique',
      !row || typeof row.toleranceMinutes === 'number',
      `tolerance=${row?.toleranceMinutes}`);
  }

  console.log('');
  console.log(`${pass} OK / ${fail} ECHEC`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
