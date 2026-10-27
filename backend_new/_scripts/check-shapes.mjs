/**
 * VÃ©rification des FORMES de rÃ©ponse (pas seulement des routes).
 *
 * Pour chaque Ã©cran clÃ©, on vÃ©rifie que les champs rÃ©ellement lus par le
 * frontend existent dans la rÃ©ponse du backend. Un champ renommÃ© (ex.
 * `checkInAt` -> `checkedInAt`) casse l'Ã©cran sans changer le code HTTP.
 *
 * Usage :  cd backend_new && node _scripts/check-shapes.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.SHAPE_EMAIL ?? 'admin@upowa.org';
const PASSWORD = process.env.SHAPE_PASSWORD ?? process.env.DEMO_PASSWORD ?? '';

let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK      ' : 'ECHEC   '} ${label}${ok ? '' : ' -> ' + detail}`);
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

async function main() {
  console.log('Connexionâ€¦');
  const login = await api('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status !== 200 && login.status !== 201) {
    console.error('Connexion impossible:', login.status, login.body);
    process.exit(1);
  }
  const token = login.body.accessToken;

  console.log('\n=== /auth/me ===');
  const me = await api('/auth/me', token);
  check('user prÃ©sent', me.body?.user, JSON.stringify(me.body));
  check('user.role', me.body?.user?.role, '');
  check('user.stationId (clÃ© prÃ©sente)', 'stationId' in (me.body?.user ?? {}));

  console.log('\n=== /stations ===');
  const stations = await api('/stations', token);
  const station = Array.isArray(stations.body) ? stations.body[0] : null;
  check('liste non vide', Array.isArray(stations.body) && stations.body.length > 0);
  check('station.id', station?.id, '');
  check('station.name', station?.name, '');
  check('station.weeklyHoursLimit', typeof station?.weeklyHoursLimit === 'number');
  check('station.minRestHours', typeof station?.minRestHours === 'number');
  check('station.latenessToleranceMinutes', typeof station?.latenessToleranceMinutes === 'number');

  console.log('\n=== /users ===');
  const users = await api('/users', token);
  const user = Array.isArray(users.body) ? users.body[0] : null;
  check('liste non vide', Array.isArray(users.body) && users.body.length > 0);
  check('user.fullName', user?.fullName, '');
  check('user.isActive (clÃ© prÃ©sente)', 'isActive' in (user ?? {}));

  console.log('\n=== /dashboard/stats ===');
  const stats = await api('/dashboard/stats', token);
  const s = stats.body;
  check('generatedAt', s?.generatedAt, '');
  check('businessDate', s?.businessDate, '');
  check('scope.unrestricted', typeof s?.scope?.unrestricted === 'boolean');
  check('today.total', typeof s?.today?.total === 'number');
  check('today.expected/present/late/absent/completed',
    ['expected', 'present', 'late', 'absent', 'completed'].every((k) => typeof s?.today?.[k] === 'number'));
  check('hours.weekly/weeklyLimit/remaining',
    ['weekly', 'weeklyLimit', 'remaining'].every((k) => typeof s?.hours?.[k] === 'number'));
  check('workforce (objet ou null)', s?.workforce === null || typeof s?.workforce === 'object');
  check('timeline (tableau)', Array.isArray(s?.timeline));

  console.log('\n=== /plannings ===');
  const plannings = await api('/plannings', token);
  const planning = Array.isArray(plannings.body) ? plannings.body[0] : null;
  check('liste non vide', Array.isArray(plannings.body) && plannings.body.length > 0);
  check('planning.id', planning?.id, '');
  check('planning.startDate', planning?.startDate, '');
  check('planning.endDate', planning?.endDate, '');
  check('planning.status', planning?.status, '');
  check('planning.revision', typeof planning?.revision === 'number');

  console.log('\n=== /plannings/:id (dÃ©tail) ===');
  if (planning?.id) {
    const detail = await api(`/plannings/${planning.id}`, token);
    check('detail.id', detail.body?.id, '');
    check('detail.occurrences ou _count', detail.body?.occurrences !== undefined || detail.body?._count !== undefined,
      JSON.stringify(Object.keys(detail.body ?? {})));
  }

  console.log('\n=== /plannings/notices ===');
  const notices = await api('/plannings/notices', token);
  check('tableau', Array.isArray(notices.body));

  console.log('\n=== /leaves/workspace (swappeur) ===');
  const swapperLogin = await api('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email: 'awa.nkolo@upowa.org', password: PASSWORD }),
  });
  if (swapperLogin.status === 200 || swapperLogin.status === 201) {
    const swToken = swapperLogin.body.accessToken;
    const lw = await api('/leaves/workspace', swToken);
    check('balance prÃ©sent', lw.body?.balance !== undefined || lw.body?.remainingDays !== undefined,
      JSON.stringify(Object.keys(lw.body ?? {})));
    const ws = await api('/workspace', swToken);
    check('workspace.shifts tableau', Array.isArray(ws.body?.shifts));
  } else {
    check('connexion swappeur', false, `status=${swapperLogin.status}`);
  }

  console.log('');
  console.log(failures === 0 ? 'TOUTES LES FORMES SONT CONFORMES' : `${failures} Ã©cart(s) de forme`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
