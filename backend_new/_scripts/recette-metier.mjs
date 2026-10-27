/**
 * Recette metier : demarrage de serveur, connexion, conges, signalement
 * d'absence, incident, rapports et pointage.
 *
 *   cd backend_new && node _scripts/metier-flow.mjs
 */
const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD ?? '';

const results = [];
const log = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};

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

/** Attend que l'API reponde (le demarrage Nest prend une dizaine de secondes). */
async function waitForApi(attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${BASE}/docs`);
      if (response.status < 500) return true;
    } catch {
      // pas encore pret
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

const login = async (email) =>
  call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });

async function main() {
  const ready = await waitForApi();
  if (!ready) throw new Error(`API injoignable sur ${BASE}.`);
  log('API disponible', true, BASE);

  /* 1. Connexion ------------------------------------------------------ */
  const admin = await login('superadmin@gmail.com');
  log('Connexion SUPER_ADMIN', admin.status === 200, `HTTP ${admin.status}`);
  const adminToken = admin.data?.accessToken;

  const swapper = await login('jean.dupont@upowa.org');
  log('Connexion agent (jean.dupont)', swapper.status === 200, `HTTP ${swapper.status}`);
  const swapperToken = swapper.data?.accessToken;

  const supervisor = await login('superviseur@upowa.org');
  log('Connexion superviseur', supervisor.status === 200, `HTTP ${supervisor.status}`);
  const supervisorToken = supervisor.data?.accessToken;

  /* 2. CongÃ©s --------------------------------------------------------- */
  // Les demandes de recette precedentes sont annulees : une seule demande en
  // attente est autorisee par agent, et la recette doit rester rejouable.
  const existingLeaves = await call('/leaves/workspace', { token: swapperToken });
  for (const row of existingLeaves.data?.requests ?? []) {
    if (row.status === 'PENDING' || row.status === 'DRAFT') {
      await call(`/leaves/${row.id}/cancel`, { method: 'PATCH', token: swapperToken });
    }
  }

  // PÃ©riode libre : on saute apres les congÃ©s deja (approuves ou en attente)
  // pour ne jamais tomber sur un chevauchement legitime (regle metier).
  let offsetDays = 14;
  const busyUntil = (existingLeaves.data?.requests ?? []).reduce(
    (latest, row) => Math.max(latest, Date.parse(row.endTime) || 0),
    0,
  );
  if (busyUntil) {
    offsetDays = Math.max(
      offsetDays,
      Math.ceil((busyUntil - Date.now()) / 86_400_000) + 3,
    );
  }
  const start = new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const end = new Date(Date.now() + (offsetDays + 2) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const leave = await call('/leaves', {
    method: 'POST',
    token: swapperToken,
    body: {
      startDate: start,
      endDate: end,
      type: 'ANNUAL',
      reason: 'Recette automatique des congÃ©s',
    },
  });
  log(
    'Demande de congÃ© crÃ©Ã©e',
    leave.status === 201 && Boolean(leave.data?.id),
    `HTTP ${leave.status} ${JSON.stringify(leave.data?.status ?? leave.data?.message ?? '')}`,
  );

  if (leave.data?.id) {
    const workspace = await call('/leaves/workspace', { token: swapperToken });
    log(
      'La demande apparaÃ®t dans lâ€™espace agent',
      workspace.status === 200 &&
        (workspace.data?.requests ?? []).some((row) => row.id === leave.data.id),
      `HTTP ${workspace.status} Â· ${(workspace.data?.requests ?? []).length} demande(s)`,
    );

    const decision = await call(`/leaves/${leave.data.id}/decision`, {
      method: 'PATCH',
      token: supervisorToken,
      body: { decision: 'APPROVED', reason: 'Validation de recette' },
    });
    log(
      'Approbation par le superviseur',
      decision.status === 200,
      `HTTP ${decision.status} ${JSON.stringify(decision.data?.status ?? decision.data?.message ?? '')}`,
    );

    const balance = await call('/leaves/balance', { token: swapperToken });
    log(
      'Solde de congÃ©s mis Ã  jour',
      balance.status === 200,
      `HTTP ${balance.status} ${JSON.stringify(balance.data ?? '').slice(0, 140)}`,
    );
  }

  /* 3. Signalement d'absence ------------------------------------------ */
  const workspace = await call('/workspace', { token: swapperToken });
  const shifts = workspace.data?.shifts ?? [];
  const now = Date.now();
  const declared = shifts.find(
    (shift) =>
      Date.parse(shift.startTime) - 10 * 60_000 <= now && now <= Date.parse(shift.endTime),
  );
  log(
    'Un service est disponible pour le signalement',
    Boolean(declared),
    declared ? declared.label : `${shifts.length} service(s)`,
  );

  if (declared) {
    const absence = await call('/operations/absences', {
      method: 'POST',
      token: swapperToken,
      body: {
        shiftId: declared.id,
        reason: 'Signalement de recette automatique',
        clientRef: `recette-${Date.now()}`,
      },
    });
    // 409 Â« deja declare Â» apres une recette precedente : l'endpoint a bien
    // refuse le doublon, ce n'est pas une panne.
    const duplicateDeclared = absence.data?.code === 'ABSENCE_ALREADY_DECLARED';
    log(
      'Signalement dâ€™absence enregistrÃ©',
      [200, 201].includes(absence.status) || duplicateDeclared,
      `HTTP ${absence.status} ${JSON.stringify(absence.data ?? '').slice(0, 160)}`,
    );

    if (!duplicateDeclared) {
      const duplicate = await call('/operations/absences', {
        method: 'POST',
        token: swapperToken,
        body: {
          shiftId: declared.id,
          reason: 'Double signalement de recette',
          clientRef: `recette-dup-${Date.now()}`,
        },
      });
      log(
        'Double signalement refusÃ© proprement',
        duplicate.status === 409,
        `HTTP ${duplicate.status} ${duplicate.data?.code ?? ''}`,
      );
    }
  }

  /* 4. Incident ------------------------------------------------------- */
  const stations = await call('/stations', { token: adminToken });
  const stationList = stations.data ?? [];
  const douala = stationList.find((row) => row.name.includes('Bonab')) ?? stationList[0];
  const stationId = douala?.id;
  // L'agent signale un incident sur SA station : on reprend son compte.
  const affectedId = swapper.data?.user?.id;

  const incident = await call('/incidents', {
    method: 'POST',
    token: supervisorToken,
    body: {
      stationId,
      affectedSwapperId: affectedId,
      category: 'SECURITY',
      severity: 'MEDIUM',
      title: 'Incident de recette',
      description: 'Signalement crÃ©Ã© par la recette automatique.',
    },
  });
  log(
    'Incident signalÃ©',
    [200, 201].includes(incident.status),
    `HTTP ${incident.status} ${JSON.stringify(incident.data ?? '').slice(0, 180)}`,
  );

  log(
    'Incident liÃ© Ã  la bonne station',
    incident.data?.stationId === stationId,
    `station=${incident.data?.stationId}`,
  );

  const list = await call('/incidents', { token: supervisorToken });
  log(
    'Lâ€™incident apparaÃ®t dans le centre dâ€™incidents',
    list.status === 200 &&
      (list.data?.items ?? list.data?.incidents ?? []).some(
        (row) => row.id === incident.data?.id,
      ),
    `HTTP ${list.status} Â· ${(list.data?.items ?? list.data?.incidents ?? []).length} incident(s)`,
  );

  /* 5. Rapports -------------------------------------------------------- */
  const report = await call('/reports/export?format=XLSX', { token: adminToken });
  log(
    'Rapport XLSX gÃ©nÃ©rÃ© pour lâ€™administrateur',
    report.status === 200,
    `HTTP ${report.status}`,
  );

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrÃ´les rÃ©ussis`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('ERREUR', error);
  process.exitCode = 1;
});
