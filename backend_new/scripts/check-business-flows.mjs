/**
 * Vérifications métier par l'API réelle.
 *   1. changement de mot de passe (et retour arrière)
 *   2. création / modification d'un shift
 *   3. affectation d'un swappeur
 *   4. notifications (liste + préférences)
 *   5. lien d'activation (vérification de jeton)
 */
const BASE = 'http://127.0.0.1:3000';
const ADMIN = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.DEMO_PASSWORD,
};
const SWAPPER = {
  email: process.env.SWAPPER_EMAIL,
  password: process.env.DEMO_PASSWORD,
};

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name} — ${detail}`);
};

async function login({ email, password }) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, token: body.accessToken, body };
}

const call = (token, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

// ---------------------------------------------------------------- 1. mot de passe
async function testPassword() {
  const session = await login(SWAPPER);
  if (!session.token)
    return log(
      'Changement de mot de passe',
      false,
      `connexion ${session.status}`,
    );

  const tmp = 'Temp!Passw0rd2026';
  const change = await call(session.token, '/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: SWAPPER.password,
      newPassword: tmp,
    }),
  });
  if (change.status !== 200) {
    return log('Changement de mot de passe', false, `statut ${change.status}`);
  }

  // Doit fonctionner avec le nouveau mot de passe
  const relogin = await login({ email: SWAPPER.email, password: tmp });

  // Mauvais mot de passe actuel -> doit être refusé
  const wrong = await call(relogin.token, '/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: 'faux',
      newPassword: 'Autre!Passw0rd2026',
    }),
  });

  // Retour à l'ancien mot de passe
  const restore = await call(relogin.token, '/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: tmp,
      newPassword: SWAPPER.password,
    }),
  });

  log(
    'Changement de mot de passe',
    relogin.status === 200 && wrong.status >= 400 && restore.status === 200,
    `nouveau=${relogin.status}, ancien refusé=${wrong.status}, restauration=${restore.status}`,
  );
}

// ---------------------------------------------------------------- 2. shift + affectation
async function testShift() {
  const session = await login(ADMIN);
  if (!session.token)
    return log('Shift / affectation', false, `connexion ${session.status}`);

  const stations = await call(session.token, '/pilot/stations').then((r) =>
    r.json(),
  );
  const list = Array.isArray(stations) ? stations : (stations.items ?? []);
  const stationId = list[0]?.id;
  if (!stationId) return log('Shift / affectation', false, 'aucune station');

  const users = await call(
    session.token,
    '/pilot/users?role=SWAPPER&limit=5',
  ).then((r) => r.json());
  const swapper = (users.items ?? users)[0];

  // Création
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 8 * 3600 * 1000);
  const create = await call(session.token, '/pilot/plannings', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Vérification QA shift',
      stationIds: [stationId],
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    }),
  });
  const created = await create.json().catch(() => ({}));

  log(
    'Création de planning',
    create.status < 300,
    `statut ${create.status}${created.id ? ` id=${created.id}` : ''}`,
  );

  if (swapper) {
    log(
      'Swappeur disponible pour affectation',
      true,
      `${swapper.fullName ?? swapper.email} (${swapper.id})`,
    );
  } else {
    log('Swappeur disponible pour affectation', false, 'aucun swappeur');
  }

  // Modification d'un SHIFT : route réelle `PATCH :id/occurrences/:occurrenceId`
  // (il n'existe pas de PATCH global sur une planification).
  if (created.id) {
    const detail = await call(session.token, `/pilot/plannings/${created.id}`).then((r) =>
      r.json(),
    );
    let occ = (detail.occurrences ?? [])[0];

    // Un planning neuf n'a pas encore de shifts : on le GÉNÈRE (route réelle
    // `POST :id/generate`) — c'est le parcours du pilotage dans l'interface.
    if (!occ) {
      const make = await call(session.token, `/pilot/plannings/${created.id}/generate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      log('Génération des shifts', make.status < 300, `statut ${make.status}`);
      const after = await call(session.token, `/pilot/plannings/${created.id}`).then((r) =>
        r.json(),
      );
      occ = (after.occurrences ?? [])[0] ?? null;
    }

    if (!occ) {
      log('Modification de shift', false, 'aucun shift créé');
    } else {
      const patch = await call(
        session.token,
        `/pilot/plannings/${created.id}/occurrences/${occ.id}`,
        { method: 'PATCH', body: JSON.stringify({ startTime: occ.startTime }) },
      );
      log('Modification de shift', patch.status < 300, `statut ${patch.status}`);

      if (swapper) {
        const assign = await call(
          session.token,
          `/pilot/plannings/${created.id}/occurrences/${occ.id}/assignments`,
          { method: 'PATCH', body: JSON.stringify({ swapperIds: [swapper.id] }) },
        );
        log('Affectation d’un swappeur', assign.status < 300, `statut ${assign.status}`);
      }
    }
  }
}

// ---------------------------------------------------------------- 3. notifications
async function testNotifications() {
  const session = await login(SWAPPER);
  if (!session.token)
    return log('Notifications', false, `connexion ${session.status}`);

  const list = await call(session.token, '/notifications');
  log('Liste des notifications', list.status === 200, `statut ${list.status}`);

  const prefs = await call(session.token, '/notifications/preferences');
  const prefBody = prefs.status === 200 ? await prefs.json() : {};
  log(
    'Préférences de notification',
    prefs.status === 200,
    `statut ${prefs.status} ` +
      (prefs.status === 200
        ? `(inApp=${prefBody.inApp}, email=${prefBody.email}, push=${prefBody.push})`
        : ''),
  );
}

// ---------------------------------------------------------------- 4. activation
async function testActivation() {
  const verify = await call(null, '/auth/verify-reset-token', {
    method: 'POST',
    body: JSON.stringify({ token: 'a'.repeat(64) }),
  });
  log(
    'Lien d’activation / réinitialisation vérifié',
    verify.status >= 400 && verify.status < 500,
    `jeton invalide -> ${verify.status} (attendu 4xx, jamais 500)`,
  );
}

await testPassword();
await testShift();
await testNotifications();
await testActivation();
