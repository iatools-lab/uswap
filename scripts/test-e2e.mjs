/**
 * Suite de tests fonctionnels uSwap 5.2 — connexion frontend sprint 5 <-> backend.
 *
 * Les appels passent par le proxy Vite (http://127.0.0.1:5173/api), c'est-a-dire
 * exactement le chemin utilise par le navigateur, cookies de session compris.
 *
 * Usage : node scripts/test-e2e.mjs
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:5173/api';
const PASSWORD = 'Uswap2026!Demo';

let ok = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    ok += 1;
    console.log(`  OK    ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** Session HTTP : conserve le cookie de refresh, comme un navigateur. */
class Session {
  constructor() {
    this.cookie = '';
    this.token = '';
  }

  async call(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    let payload = null;
    const text = await res.text();
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text.slice(0, 200);
    }
    return { status: res.status, payload, headers: res.headers };
  }

  async login(email) {
    const res = await this.call('/auth/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });
    if (res.payload?.accessToken) this.token = res.payload.accessToken;
    return res;
  }
}

const isArr = Array.isArray;
const okStatus = (s) => s >= 200 && s < 300;

async function main() {
  console.log('=== uSwap 5.2 — tests fonctionnels de bout en bout ===');
  console.log(`Base : ${BASE}\n`);

  // ---------------------------------------------------------------
  section('1. AUTHENTIFICATION ET SESSION');
  // ---------------------------------------------------------------
  const admin = new Session();
  const login = await admin.login('admin@upowa.org');
  check('POST /auth/login', login.status === 200 && !!login.payload.accessToken, `status ${login.status}`);
  check('login renvoie user avec stationName', login.payload.user && 'stationName' in login.payload.user);
  check('login renvoie sessionExpiresAt', typeof login.payload.sessionExpiresAt === 'string', login.payload.sessionExpiresAt);
  check('login renvoie absoluteExpiresAt', typeof login.payload.absoluteExpiresAt === 'string');
  check('login pose un cookie HttpOnly', admin.cookie.startsWith('uswap_refresh='));

  const me = await admin.call('/auth/me');
  check('GET /auth/me', me.status === 200 && !!me.payload.user, `status ${me.status}`);

  // Le navigateur poste {} : le backend doit lire le cookie.
  const refresh = await admin.call('/auth/refresh', { method: 'POST', body: {} });
  check('POST /auth/refresh (corps vide + cookie)', refresh.status === 200, `status ${refresh.status}`);
  check('refresh renvoie le user', !!refresh.payload?.user);
  check('refresh fait tourner le cookie', admin.cookie.startsWith('uswap_refresh='));

  const session = await admin.call('/auth/session');
  check('GET /auth/session', session.status === 200, `status ${session.status}`);

  // ---------------------------------------------------------------
  section('2. ROUTES SPRINT 5 — ADMIN');
  // ---------------------------------------------------------------
  const adminRoutes = [
    ['GET /admin/settings', '/admin/settings'],
    ['GET /admin/reports/schedules', '/admin/reports/schedules'],
    ['GET /admin/integrations/leaves', '/admin/integrations/leaves'],
    ['GET /reports/dashboard', '/reports/dashboard'],
    ['GET /incidents', '/incidents'],
    ['GET /users/export', '/users/export'],
    ['GET /notifications/preferences', '/notifications/preferences'],
    ['GET /dashboard/stats', '/dashboard/stats'],
    ['GET /operations/changes', '/operations/changes'],
    ['GET /operations/replacements/pending', '/operations/replacements/pending'],
  ];
  for (const [name, path] of adminRoutes) {
    const res = await admin.call(path);
    check(name, okStatus(res.status), `status ${res.status}`);
  }

  const settings = await admin.call('/admin/settings');
  check('settings expose settings + history',
    !!settings.payload?.settings && isArr(settings.payload?.history));

  const exportRes = await admin.call('/users/export');
  check('export expose rows + filename',
    isArr(exportRes.payload?.rows) && typeof exportRes.payload?.filename === 'string',
    `${exportRes.payload?.rows?.length} lignes`);

  const prefs = await admin.call('/notifications/preferences');
  check('preferences expose inApp/email/retentionDays',
    typeof prefs.payload?.inApp === 'boolean' && typeof prefs.payload?.retentionDays === 'number');

  // ---------------------------------------------------------------
  section('3. ECRITURE — REGLAGES ET PREFERENCES');
  // ---------------------------------------------------------------
  const patchSettings = await admin.call('/admin/settings', {
    method: 'PATCH',
    body: {
      sessionMinutes: 60,
      invitationValidityHours: 72,
      maxAttachmentMb: 10,
      notificationRetentionDays: 30,
      supportEmail: 'support@uswap.app',
    },
  });
  check('PATCH /admin/settings', patchSettings.status === 200, `status ${patchSettings.status}`);
  check('PATCH /admin/settings incremente la revision',
    patchSettings.payload?.settings?.revision > settings.payload?.settings?.revision,
    `rev ${settings.payload?.settings?.revision} -> ${patchSettings.payload?.settings?.revision}`);

  const patchPrefs = await admin.call('/notifications/preferences', {
    method: 'PATCH',
    body: { inApp: true, email: true, push: false, digest: true, retentionDays: 30 },
  });
  check('PATCH /notifications/preferences', patchPrefs.status === 200, `status ${patchPrefs.status}`);

  // ---------------------------------------------------------------
  section('4. LECTURE PAR ROLE');
  // ---------------------------------------------------------------
  const supervisor = new Session();
  const supLogin = await supervisor.login('superviseur@upowa.org');
  check('login SUPERVISOR', supLogin.status === 200, supLogin.payload?.user?.fullName);

  const chief = new Session();
  const chiefLogin = await chief.login('chef@upowa.org');
  check('login STATION_CHIEF', chiefLogin.status === 200, chiefLogin.payload?.user?.stationName);

  // Le seed varie : on choisit un swapper reellement actif plutot qu'un email
  // en dur (les emails du mock frontend n'existent pas en base).
  const swapperPool = (await admin.call('/users?role=SWAPPER')).payload ?? [];
  const swapperUser = isArr(swapperPool)
    ? (swapperPool.find((u) => u.isActive) ?? swapperPool[0])
    : null;
  const swapper = new Session();
  const swapLogin = await swapper.login(swapperUser?.email ?? 'awa.nkolo@upowa.org');
  check(
    'login SWAPPER',
    swapLogin.status === 200,
    swapLogin.payload?.user?.fullName ??
      swapLogin.payload?.message ??
      `status ${swapLogin.status}`,
  );

  const roleRoutes = [
    [supervisor, 'GET /incidents [SUPERVISOR]', '/incidents'],
    [supervisor, 'GET /reports/dashboard [SUPERVISOR]', '/reports/dashboard'],
    [supervisor, 'GET /attendance/monitor [SUPERVISOR]', '/attendance/monitor'],
    [chief, 'GET /incidents [STATION_CHIEF]', '/incidents'],
    [chief, 'GET /attendance/monitor [STATION_CHIEF]', '/attendance/monitor'],
    [swapper, 'GET /leaves/workspace [SWAPPER]', '/leaves/workspace'],
    [swapper, 'GET /attendance/history [SWAPPER]', '/attendance/history'],
    [swapper, 'GET /workspace [SWAPPER]', '/workspace'],
  ];
  for (const [session, name, path] of roleRoutes) {
    const res = await session.call(path);
    check(name, okStatus(res.status), `status ${res.status}`);
  }

  // ---------------------------------------------------------------
  section('5. CONGES (SWAPPER)');
  // ---------------------------------------------------------------
  const ws = await swapper.call('/leaves/workspace');
  check('workspace expose balance + requests + integration',
    !!ws.payload?.balance && isArr(ws.payload?.requests) && !!ws.payload?.integration,
    `solde ${ws.payload?.balance?.entitledDays}j`);

  const key = `test-e2e-${Date.now()}`;
  const created = await swapper.call('/leaves', {
    method: 'POST',
    body: {
      startDate: new Date(Date.now() + 200 * 86400000).toISOString(),
      endDate: new Date(Date.now() + 202 * 86400000).toISOString(),
      type: 'ANNUAL',
      reason: 'Test automatise de bout en bout',
      idempotencyKey: key,
    },
  });
  check('POST /leaves', created.status === 201, `status ${created.status}`);
  check('leave expose editable/cancellable/syncStatus',
    created.payload?.editable === true && created.payload?.cancellable === true && !!created.payload?.syncStatus);

  const replay = await swapper.call('/leaves', {
    method: 'POST',
    body: {
      startDate: new Date(Date.now() + 200 * 86400000).toISOString(),
      endDate: new Date(Date.now() + 202 * 86400000).toISOString(),
      type: 'ANNUAL',
      reason: 'Test automatise de bout en bout',
      idempotencyKey: key,
    },
  });
  check('POST /leaves idempotent (meme cle = meme demande)',
    replay.payload?.id === created.payload?.id, `id ${replay.payload?.id}`);

  if (created.payload?.id) {
    const cancelled = await swapper.call(`/leaves/${created.payload.id}/cancel`, {
      method: 'POST',
      body: { idempotencyKey: `${key}-cancel` },
    });
    check('POST /leaves/:id/cancel', cancelled.status === 201 && cancelled.payload?.status === 'CANCELLED', `status ${cancelled.payload?.status}`);
  }

  // ---------------------------------------------------------------
  section('6. INCIDENT — FLUX COMPLET');
  // ---------------------------------------------------------------
  const chiefMe = await chief.call('/auth/me');
  const stationId = chiefMe.payload?.user?.stationId;
  const allSwappers = (await supervisor.call('/users?role=SWAPPER')).payload ?? [];
  check('GET /users?role=SWAPPER renvoie un tableau', isArr(allSwappers), `${allSwappers.length} swappers`);

  const target = Array.isArray(allSwappers)
    ? allSwappers.find((s) => s.stationId === stationId && s.isActive)
    : null;
  check('swapper actif trouve dans la station du chef', !!target, target?.fullName);

  if (target) {
    const incident = await chief.call('/incidents', {
      method: 'POST',
      body: {
        affectedSwapperId: target.id,
        title: 'Test e2e sprint 5.2',
        description: 'Incident cree par la suite de tests de bout en bout.',
        severity: 'MEDIUM',
        category: 'OTHER',
      },
    });
    check('POST /incidents [CHEF]', okStatus(incident.status), `status ${incident.status}`);
    check('incident expose stationName/reporterName/affectedSwapperName',
      !!incident.payload?.stationName && !!incident.payload?.reporterName && !!incident.payload?.affectedSwapperName);

    if (incident.payload?.id) {
      const ack = await supervisor.call(`/incidents/${incident.payload.id}`, {
        method: 'PATCH',
        body: { status: 'ACKNOWLEDGED', comment: 'Prise en charge par le superviseur.' },
      });
      check('PATCH /incidents/:id [SUPERVISEUR]', ack.status === 200 && ack.payload?.status === 'ACKNOWLEDGED', `status ${ack.payload?.status}`);

      const bad = await supervisor.call(`/incidents/${incident.payload.id}`, {
        method: 'PATCH',
        body: { status: 'CLOSED', comment: 'Transition invalide depuis ACKNOWLEDGED.' },
      });
      check('transition invalide rejetee (409)', bad.status === 409, `status ${bad.status}`);
    }
  }

  const board = await supervisor.call('/incidents');
  check('board expose incidents + metrics + stations + swappers',
    isArr(board.payload?.incidents) && !!board.payload?.metrics && isArr(board.payload?.stations),
    `${board.payload?.metrics?.total} incident(s)`);

  // ---------------------------------------------------------------
  section('7. PLANNER — FLUX COMPLET');
  // ---------------------------------------------------------------
  const start = new Date(Date.now() + 40 * 86400000);
  const end = new Date(Date.now() + 44 * 86400000);

  const planning = await supervisor.call('/plannings', {
    method: 'POST',
    body: { startDate: start.toISOString(), endDate: end.toISOString() },
  });
  check('POST /plannings', planning.status === 201, `status ${planning.status}`);
  const planningId = planning.payload?.id;

  const stations = (await supervisor.call('/stations')).payload ?? [];
  const station = stations.find((s) => s.isActive);
  check('GET /stations renvoie un tableau', isArr(stations), `${stations.length} stations`);

  const preview = await supervisor.call(`/plannings/${planningId}/preview`, {
    method: 'POST',
    body: { stationId: station.id, templateIds: [], weekdays: [1, 2, 3, 4, 5] },
  });
  check('POST /plannings/:id/preview', okStatus(preview.status), `status ${preview.status}`);
  check('preview renvoie occurrences + previewHash',
    isArr(preview.payload?.occurrences) && typeof preview.payload?.previewHash === 'string',
    `${preview.payload?.occurrences?.length} occurrence(s)`);
  check('preview occurrence expose timezone + durationHours',
    !!preview.payload?.occurrences?.[0]?.timezone && typeof preview.payload?.occurrences?.[0]?.durationHours === 'number');

  const generated = await supervisor.call(`/plannings/${planningId}/generate`, {
    method: 'POST',
    body: {
      stationId: station.id,
      templateIds: [],
      weekdays: [1, 2, 3, 4, 5],
      previewHash: preview.payload?.previewHash,
    },
  });
  check('POST /plannings/:id/generate', okStatus(generated.status), `status ${generated.status}`);

  const detail = await supervisor.call(`/plannings/${planningId}`);
  const occurrences = detail.payload?.occurrences ?? [];
  check('GET /plannings/:id expose occurrences', occurrences.length > 0, `${occurrences.length} occurrence(s)`);
  check('GET /plannings/:id expose revision', Number.isFinite(detail.payload?.revision));

  if (occurrences.length) {
    const o = occurrences[0];
    check('occurrence expose station/templateVersion/swapper',
      !!o.station && !!o.templateVersion && 'swapper' in o);

    const candidate = allSwappers.find((s) => s.stationId === o.stationId && s.isActive);
    if (candidate) {
      const valid = await supervisor.call(`/plannings/${planningId}/occurrences/${o.id}/validate`, {
        method: 'POST',
        body: { swapperId: candidate.id, revision: detail.payload?.revision },
      });
      check('POST /plannings/:id/occurrences/:oid/validate',
        okStatus(valid.status) && typeof valid.payload?.valid === 'boolean', `valid=${valid.payload?.valid}`);

      const patched = await supervisor.call(`/plannings/${planningId}/occurrences/${o.id}`, {
        method: 'PATCH',
        body: { swapperId: candidate.id, revision: detail.payload?.revision },
      });
      check('PATCH /plannings/:id/occurrences/:oid', okStatus(patched.status), `status ${patched.status}`);
    }

    const dup = await supervisor.call(`/plannings/${planningId}/occurrences/${o.id}/duplicate`, { method: 'POST' });
    check('POST /plannings/:id/occurrences/:oid/duplicate', okStatus(dup.status), `status ${dup.status}`);
  }

  const validation = await supervisor.call(`/plannings/${planningId}/validate`, { method: 'PATCH' });
  check('PATCH /plannings/:id/validate',
    validation.status === 200 && isArr(validation.payload?.errors) && isArr(validation.payload?.warnings));

  const autoAssign = await supervisor.call(`/plannings/${planningId}/auto-assign`, { method: 'POST' });
  check('POST /plannings/:id/auto-assign', okStatus(autoAssign.status), `status ${autoAssign.status}`);

  const fresh = await supervisor.call(`/plannings/${planningId}`);
  const published = await supervisor.call(`/plannings/${planningId}/publish`, {
    method: 'PATCH',
    body: { revision: fresh.payload?.revision },
  });
  check('PATCH /plannings/:id/publish', published.status === 200, `status ${published.payload?.status}`);

  // ---------------------------------------------------------------
  section('8. STATIONS ET TEMPLATES');
  // ---------------------------------------------------------------
  const templates = await supervisor.call(`/stations/${station.id}/shift-templates`);
  check('GET /stations/:id/shift-templates', okStatus(templates.status), `${templates.payload?.length ?? 0} modele(s)`);

  const toggled = await admin.call(`/stations/${station.id}/deactivate`, { method: 'PATCH' });
  check('PATCH /stations/:id/deactivate', okStatus(toggled.status), `status ${toggled.status}`);
  const reactivated = await admin.call(`/stations/${station.id}/activate`, { method: 'PATCH' });
  check('PATCH /stations/:id/activate', okStatus(reactivated.status), `status ${reactivated.status}`);

  // ---------------------------------------------------------------
  section('9. SECURITE — ACCES REFUSE');
  // ---------------------------------------------------------------
  const forbidden = await swapper.call('/admin/settings');
  check('/admin/settings refuse au SWAPPER (403)', forbidden.status === 403, `status ${forbidden.status}`);

  const noAuth = await fetch(`${BASE}/users?role=SWAPPER`);
  check('/users sans jeton refuse (401)', noAuth.status === 401, `status ${noAuth.status}`);

  // ---------------------------------------------------------------
  section('10. DECONNEXION');
  // ---------------------------------------------------------------
  const logout = await admin.call('/auth/logout', { method: 'POST', body: {} });
  check('POST /auth/logout', okStatus(logout.status), `status ${logout.status}`);

  // ---------------------------------------------------------------
  console.log(`\n========================================`);
  console.log(`  RESULTAT : ${ok}/${ok + failed} verifications reussies`);
  if (failed) {
    console.log(`  ECHECS (${failed}) :`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  console.log(`========================================\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('ERREUR FATALE :', error);
  process.exit(1);
});
