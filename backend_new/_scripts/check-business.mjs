/**
 * Contrôle métier — Étape 3.
 *
 * Pilote l'API vivante et vérifie, famille par famille, que les règles du
 * cahier des charges sont appliquées. Chaque test indique ce qui est attendu.
 *
 * Usage :  cd backend_new && node _scripts/check-business.mjs
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
  const admin = await login('admin@upowa.org');
  const supervisor = await login('superviseur@upowa.org');
  const swapper = await login('awa.nkolo@upowa.org');
  if (!admin || !supervisor || !swapper) {
    console.error('Connexions de test impossibles.');
    process.exit(1);
  }

  console.log('=== STATIONS ===');
  const stations = await api('/stations', admin);
  const station = stations.body?.[0];
  check('liste des stations', Array.isArray(stations.body) && stations.body.length > 0);
  check('règles opérationnelles présentes',
    ['latenessToleranceMinutes', 'geofenceRadiusMeters', 'minRestHours', 'weeklyHoursLimit']
      .every((k) => station && k in station));

  const templates = await api(`/stations/${station.id}/shift-templates`, admin);
  check('modèles de shift listés', Array.isArray(templates.body));
  const template = templates.body?.[0];
  check('modèle: startTime/endTime/breakMinutes',
    template && 'startTime' in template && 'endTime' in template && 'breakMinutes' in template);

  console.log('\n=== PLANNING: création, génération, publication ===');
  const startDate = new Date(Date.now() + 21 * 86_400_000);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + 3 * 86_400_000);
  const created = await api('/plannings', supervisor, {
    method: 'POST',
    body: JSON.stringify({
      name: `Test métier ${Date.now()}`,
      stationIds: [station.id],
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    }),
  });
  check('création planning (201)', created.status === 201, `status=${created.status} ${JSON.stringify(created.body)}`);
  const planId = created.body?.id;

  if (planId) {
    const preview = await api(`/plannings/${planId}/preview`, supervisor, {
      method: 'POST',
      body: JSON.stringify({ stationId: station.id, templateIds: templates.body.slice(0, 1).map((t) => t.id) }),
    });
    check('aperçu renvoie des postes', Array.isArray(preview.body?.occurrences) && preview.body.occurrences.length > 0,
      JSON.stringify(preview.body).slice(0, 200));

    const generated = await api(`/plannings/${planId}/generate`, supervisor, {
      method: 'POST',
      body: JSON.stringify({ stationId: station.id, templateIds: templates.body.slice(0, 1).map((t) => t.id) }),
    });
    check('génération (201)', generated.status === 201, `status=${generated.status}`);
    check('postes créés dans le détail',
      Array.isArray(generated.body?.occurrences) && generated.body.occurrences.length > 0,
      `count=${generated.body?.occurrences?.length}`);

    const validation = await api(`/plannings/${planId}/validate`, supervisor, { method: 'POST' });
    check('validation renvoie valid (booléen)', typeof validation.body?.valid === 'boolean',
      JSON.stringify(validation.body));

    // Un planning non affecté ne doit PAS pouvoir être publié : c'est la règle
    // qui protège d'une publication de postes vacants.
    const blocked = await api(`/plannings/${planId}/publish`, supervisor, { method: 'POST' });
    check('publication bloquée si postes vacants', blocked.status === 409,
      `status=${blocked.status} ${JSON.stringify(blocked.body).slice(0, 120)}`);

    // Affectation automatique puis publication : le flux réel du superviseur.
    const auto = await api(`/plannings/${planId}/auto-assign`, supervisor, { method: 'POST' });
    check('affectation automatique exécutée', typeof auto.body?.assigned === 'number',
      JSON.stringify(auto.body).slice(0, 120));

    const publish = await api(`/plannings/${planId}/publish`, supervisor, { method: 'POST' });
    check('publication -> PUBLISHED', publish.body?.status === 'PUBLISHED', JSON.stringify(publish.body).slice(0, 160));
  }

  console.log('\n=== AFFECTATION + RÈGLES ===');
  const swappers = (await api('/users?role=SWAPPER', admin)).body ?? [];
  check('swappers présents', swappers.length >= 3, `count=${swappers.length}`);
  const candidate = swappers[0];
  const validate = await api('/shifts/validate', supervisor, {
    method: 'POST',
    body: JSON.stringify({
      stationId: station.id,
      swapperId: candidate.id,
      startTime: '2026-11-02T06:00:00.000Z',
      endTime: '2026-11-02T14:00:00.000Z',
    }),
  });
  check('contrôle de créneau renvoie valid', typeof validate.body?.valid === 'boolean');
  check('rapport expose errors/warnings/weeks',
    Array.isArray(validate.body?.errors) && Array.isArray(validate.body?.warnings) && Array.isArray(validate.body?.weeks));

  console.log('\n=== RÈGLES FINES (heures, limites, chevauchement) ===');
  // Un créneau de 8 h pile doit être accepté.
  const eight = await api('/shifts/validate', supervisor, {
    method: 'POST',
    body: JSON.stringify({
      stationId: station.id,
      swapperId: candidate.id,
      startTime: '2026-12-07T06:00:00.000Z',
      endTime: '2026-12-07T14:00:00.000Z',
    }),
  });
  check('créneau de 8 h -> durationHours=8', eight.body?.durationHours === 8, `duration=${eight.body?.durationHours}`);
  check('rapport expose la limite hebdo de la station',
    typeof eight.body?.weeks?.[0]?.limitHours === 'number');

  // Fin avant début : le moteur doit refuser (error INVALID_WINDOW).
  const inverted = await api('/shifts/validate', supervisor, {
    method: 'POST',
    body: JSON.stringify({
      stationId: station.id,
      swapperId: candidate.id,
      startTime: '2026-12-08T14:00:00.000Z',
      endTime: '2026-12-08T06:00:00.000Z',
    }),
  });
  check('fin avant début -> invalide', inverted.body?.valid === false,
    JSON.stringify(inverted.body?.errors ?? []).slice(0, 120));

  // Agent inconnu : refusé.
  const unknown = await api('/shifts/validate', supervisor, {
    method: 'POST',
    body: JSON.stringify({
      stationId: station.id,
      swapperId: '00000000-0000-0000-0000-000000000000',
      startTime: '2026-12-09T06:00:00.000Z',
      endTime: '2026-12-09T14:00:00.000Z',
    }),
  });
  check('agent inconnu -> invalide', unknown.body?.valid === false,
    JSON.stringify(unknown.body?.errors ?? []).slice(0, 120));

  console.log('\n=== CONGÉS ===');
  const leavesWorkspace = await api('/leaves/workspace', swapper);
  check('espace congés accessible', leavesWorkspace.status === 200, `status=${leavesWorkspace.status}`);

  console.log('\n=== RÉGLAGES GLOBAUX ===');
  const settings = await api('/admin/settings', admin);
  const settingsView = settings.body?.settings ?? settings.body;
  check('réglages lisibles', settings.status === 200 && settingsView, `status=${settings.status}`);
  check('réglages: sessionMinutes + revision',
    typeof settingsView?.sessionMinutes === 'number' && typeof settingsView?.revision === 'number');

  console.log('\n=== RAPPORTS & CALCUL DES HEURES ===');
  const report = await api('/reports/dashboard', admin);
  check('rapport consolidé accessible', report.status === 200 && report.body, `status=${report.status}`);

  console.log('\n=== POINTAGE ===');
  const monitor = await api('/attendance/monitor', supervisor);
  check('suivi du jour accessible', monitor.status === 200, `status=${monitor.status}`);

  console.log('');
  console.log(`${pass} OK / ${fail} ECHEC`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
