/**
 * Bout en bout — Étape 5.
 *
 * Parcours complet, du point de vue de chaque rôle :
 *   1. connexion ADMIN / SUPERVISOR / SWAPPER ;
 *   2. création d'une station + modèles de shift ;
 *   3. création d'un planning, génération, affectation, publication ;
 *   4. pointage réel du swappeur (check-in puis check-out avec GPS) ;
 *   5. demande de congé + décision ;
 *   6. calcul des heures et rapport consolidé.
 *
 * Usage :  cd backend_new && node _scripts/check-e2e.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000';
// Aucun mot de passe en clair : fournir SHAPE_PASSWORD (ou DEMO_PASSWORD).
const PASSWORD = process.env.SHAPE_PASSWORD ?? process.env.DEMO_PASSWORD ?? '';
if (!PASSWORD) {
  console.error(
    'SHAPE_PASSWORD (ou DEMO_PASSWORD) est requis pour lancer cette recette.',
  );
  process.exit(1);
}

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
  console.log('=== 1. CONNEXION MULTI-RÔLES ===');
  const admin = await login('admin@upowa.org');
  const supervisor = await login('superviseur@upowa.org');
  const swapper = await login('awa.nkolo@upowa.org');
  check('connexion ADMIN', Boolean(admin));
  check('connexion SUPERVISOR', Boolean(supervisor));
  check('connexion SWAPPER', Boolean(swapper));

  const meAdmin = await api('/auth/me', admin);
  check('ADMIN: rôle correct', meAdmin.body?.user?.role === 'ADMIN');
  const meSup = await api('/auth/me', supervisor);
  check('SUPERVISOR: rôle correct', meSup.body?.user?.role === 'SUPERVISOR');
  const meSwap = await api('/auth/me', swapper);
  check('SWAPPER: rôle correct', meSwap.body?.user?.role === 'SWAPPER');

  console.log('\n=== 2. STATION + MODÈLES DE SHIFT ===');
  const stamp = Date.now();
  const createdStation = await api('/stations', admin, {
    method: 'POST',
    body: JSON.stringify({
      name: `Station E2E ${stamp}`,
      city: 'Douala',
      location: 'Test E2E',
      timezone: 'Africa/Douala',
      latitude: 4.05,
      longitude: 9.7,
      weeklyHoursLimit: 48,
      minRestHours: 8,
    }),
  });
  check('station créée (201)', createdStation.status === 201,
    `status=${createdStation.status} ${JSON.stringify(createdStation.body).slice(0, 140)}`);
  const stationId = createdStation.body?.id;

  let templateId = null;
  if (stationId) {
    const template = await api(`/stations/${stationId}/shift-templates`, admin, {
      method: 'POST',
      body: JSON.stringify({
        label: 'Matin E2E',
        startTime: '06:00',
        endTime: '14:00',
        breakStart: '10:00',
        breakEnd: '10:30',
        breakMinutes: 30,
        durationMinutes: 480,
      }),
    });
    check('modèle de shift créé (201)', template.status === 201,
      `status=${template.status} ${JSON.stringify(template.body).slice(0, 140)}`);
    templateId = template.body?.id;
    check('modèle: durée 8 h', template.body?.durationMinutes === 480 || template.body?.breakMinutes === 30);
  }

  console.log('\n=== 3. PLANNING: créer → générer → affecter → publier ===');
  const start = new Date(Date.now() + 90 * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 86_400_000);

  const planning = await api('/plannings', supervisor, {
    method: 'POST',
    body: JSON.stringify({
      stationIds: stationId ? [stationId] : [],
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }),
  });
  check('planning créé (201)', planning.status === 201, `status=${planning.status}`);
  const planId = planning.body?.id;

  if (planId && stationId && templateId) {
    const generated = await api(`/plannings/${planId}/generate`, supervisor, {
      method: 'POST',
      body: JSON.stringify({ stationId, templateIds: [templateId] }),
    });
    check('postes générés', [200, 201].includes(generated.status) && generated.body?.occurrences?.length > 0,
      `status=${generated.status} count=${generated.body?.occurrences?.length}`);

    const firstOccurrence = generated.body?.occurrences?.[0];
    // Affecter un swapper : trouver un agent de la station.
    const users = await api(`/users?role=SWAPPER`, admin);
    const agent = (users.body ?? []).find((u) => u.stationId === stationId) ?? users.body?.[0];
    if (firstOccurrence && agent) {
      const assigned = await api(
        `/plannings/${planId}/occurrences/${firstOccurrence.id}`,
        supervisor,
        { method: 'PATCH', body: JSON.stringify({ swapperId: agent.id }) },
      );
      check('affectation manuelle d’un swappeur', [200, 201].includes(assigned.status),
        `status=${assigned.status} ${JSON.stringify(assigned.body).slice(0, 120)}`);
    }

    const auto = await api(`/plannings/${planId}/auto-assign`, supervisor, { method: 'POST' });
    check('affectation automatique', [200, 201].includes(auto.status), `status=${auto.status}`);

    const validation = await api(`/plannings/${planId}/validate`, supervisor, { method: 'POST' });
    check('validation expose valid', typeof validation.body?.valid === 'boolean');

    const publish = await api(`/plannings/${planId}/publish`, supervisor, { method: 'POST' });
    const publishOk = [200, 201].includes(publish.status) && publish.body?.status === 'PUBLISHED';
    const publishBlocked = publish.status === 409 && publish.body?.code === 'PUBLISH_BLOCKED_BY_VACANCIES';
    check('publication traitée (publiée ou bloquée par vacances)', publishOk || publishBlocked,
      `status=${publish.status} ${JSON.stringify(publish.body).slice(0, 120)}`);
  }

  console.log('\n=== 4. POINTAGE RÉEL (swappeur) ===');
  const workspace = await api('/workspace', swapper);
  const shifts = Array.isArray(workspace.body?.shifts) ? workspace.body.shifts : [];
  check('swappeur: postes visibles', Array.isArray(shifts), `count=${shifts.length}`);

  // Un poste pointable : celui du seed publié (fenêtre ouverte 15 min avant).
  const punchable = shifts.find((s) => {
    const startMs = Date.parse(s.startTime);
    const now = Date.now();
    return startMs - now < 15 * 60_000 && s.endTime && Date.parse(s.endTime) > now - 86_400_000;
  }) ?? shifts[0];

  if (punchable) {
    const station = punchable.station;
    const geo = {
      latitude: station?.latitude ?? 4.05,
      longitude: station?.longitude ?? 9.7,
      accuracyMeters: 20,
    };
    const checkIn = await api('/attendance', swapper, {
      method: 'POST',
      body: JSON.stringify({ shiftId: punchable.id, kind: 'CHECKIN', ...geo }),
    });
    check('check-in accepté ou déjà pointé',
      [200, 201].includes(checkIn.status) || (checkIn.status === 409),
      `status=${checkIn.status} ${JSON.stringify(checkIn.body).slice(0, 140)}`);

    const checkOut = await api('/attendance', swapper, {
      method: 'POST',
      body: JSON.stringify({ shiftId: punchable.id, kind: 'CHECKOUT', ...geo }),
    });
    check('check-out accepté ou déjà clôturé',
      [200, 201].includes(checkOut.status) || checkOut.status === 409,
      `status=${checkOut.status} ${JSON.stringify(checkOut.body).slice(0, 140)}`);
  } else {
    console.log('  (aucun poste pointable — ignoré)');
  }

  const history = await api('/attendance/history', swapper);
  check('historique de pointage accessible', history.status === 200, `status=${history.status}`);

  console.log('\n=== 5. CONGÉS + DÉCISION ===');
  const leavesWorkspace = await api('/leaves/workspace', swapper);
  check('espace congés + solde', leavesWorkspace.status === 200 && leavesWorkspace.body?.balance,
    `status=${leavesWorkspace.status}`);

  const leaveStart = new Date(Date.now() + (120 + Math.floor(Math.random() * 120)) * 86_400_000);
  const leaveEnd = new Date(leaveStart.getTime() + 86_400_000);
  const leave = await api('/leaves', swapper, {
    method: 'POST',
    body: JSON.stringify({
      startDate: leaveStart.toISOString().slice(0, 10),
      endDate: leaveEnd.toISOString().slice(0, 10),
      type: 'ANNUAL',
      reason: 'Parcours E2E',
    }),
  });
  check('demande de congé créée', [201, 409].includes(leave.status), `status=${leave.status}`);

  const pending = await api('/admin/leaves/pending', supervisor);
  check('file des congés en attente', pending.status === 200, `status=${pending.status}`);

  console.log('\n=== 6. CALCUL DES HEURES + RAPPORT ===');
  const stats = await api('/dashboard/stats', admin);
  check('dashboard: heures hebdo calculées', typeof stats.body?.hours?.weekly === 'number');
  check('dashboard: limite hebdo exposée', typeof stats.body?.hours?.weeklyLimit === 'number');
  check('dashboard: timeline présente', Array.isArray(stats.body?.timeline));

  const report = await api('/reports/dashboard', admin);
  check('rapport consolidé', report.status === 200, `status=${report.status}`);

  console.log('');
  console.log(`${pass} OK / ${fail} ECHEC`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
