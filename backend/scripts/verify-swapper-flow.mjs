/**
 * Vérification de bout en bout du parcours swappeur, contre un VRAI backend.
 *
 * Ce que le script prouve (et qui était cassé) :
 *   1. un planning créé avec `assignedUserIds` rend le créneau VISIBLE à
 *      l'agent (`GET /agent/plannings`) ;
 *   2. l'agent retrouve ce créneau dans son espace de travail
 *      (`GET /agent/attendance/workspace`), donc comme « prochaine prise de
 *      service » ;
 *   3. le pointage (`POST /agent/attendance`) accepte le créneau — plus de
 *      « Affectation introuvable ».
 *
 * Usage : node scripts/verify-swapper-flow.mjs [baseUrl]
 *   baseUrl par défaut : http://127.0.0.1:3100
 * Prérequis : base migrée ET seedée (comptes de démonstration).
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3100').replace(/\/$/, '');

// Comptes du seed. Le mot de passe est celui du fichier `.env` du backend.
const ADMIN = {
  email: process.env.DEMO_ADMIN_EMAIL ?? 'admin@upowa.org',
  password: process.env.DEMO_PASSWORD ?? '',
};
const SWAPPER = {
  email: process.env.DEMO_SWAPPER_EMAIL ?? 'awa.nkolo@upowa.org',
  password: process.env.DEMO_PASSWORD ?? '',
};

let failures = 0;
const ok = (label, extra = '') =>
  console.log(`  OK   ${label}${extra ? ` — ${extra}` : ''}`);
const bad = (label, extra = '') => {
  failures += 1;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
};

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

async function login(path, credentials) {
  const { status, data } = await call(path, {
    method: 'POST',
    body: credentials,
  });
  if (status !== 200 || !data?.accessToken) {
    throw new Error(`Connexion ${path} : ${status} ${JSON.stringify(data)}`);
  }
  return data;
}

function main() {
  return (async () => {
    console.log(`Cible : ${BASE}`);

    // 1. Santé (la sonde lit vraiment la base).
    const health = await call('/healthz');
    if (health.status === 200 && health.data?.database === 'up') {
      ok('/healthz', `${health.data.latencyMs} ms`);
    } else {
      bad('/healthz', `${health.status} ${JSON.stringify(health.data)}`);
      return;
    }

    const admin = await login('/auth/login/admin', ADMIN);
    ok('connexion administrateur');

    const swapper = await login('/auth/login/swapper', SWAPPER);
    ok('connexion swappeur', swapper.user.email);

    // 2. Station et agent de test.
    const stations = await call('/pilot/stations', {
      token: admin.accessToken,
    });
    const station = (stations.data ?? [])[0];
    if (!station) {
      bad('station disponible', 'aucune station en base (lancer le seed)');
      return;
    }
    if (station.latitude === null || station.longitude === null) {
      bad('coordonnées de la station', 'nécessaires au géorepérage');
      return;
    }
    ok(
      'station',
      `${station.name} (${station.latitude}, ${station.longitude})`,
    );

    // 3. Planning publié avec un créneau affecté à l'agent (demain).
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const day = tomorrow.toISOString().slice(0, 10);

    const created = await call('/pilot/plannings', {
      method: 'POST',
      token: admin.accessToken,
      body: {
        name: `Vérification swappeur ${new Date().toISOString()}`,
        stationIds: [station.id],
        periodStart: `${day}T00:00:00.000Z`,
        periodEnd: `${day}T23:59:59.000Z`,
        assignments: [
          {
            stationId: station.id,
            day,
            shiftLabel: 'Vérification',
            startTime: '08:00',
            endTime: '16:00',
            requiredStaff: 1,
            assignedUserIds: [swapper.user.id],
          },
        ],
      },
    });
    if (created.status !== 201) {
      bad(
        'création du planning',
        `${created.status} ${JSON.stringify(created.data)}`,
      );
      return;
    }
    const planningId = created.data.id;
    ok('planning créé', planningId);

    const published = await call(`/pilot/plannings/${planningId}/publish`, {
      method: 'PATCH',
      token: admin.accessToken,
    });
    if (published.status === 200) ok('planning publié');
    else bad('publication du planning', `${published.status}`);

    // 4. L'agent VOIT son créneau (bug 2.1 : il en voyait 0).
    const planningList = await call('/agent/plannings', {
      token: swapper.accessToken,
    });
    const mine = (planningList.data ?? []).find(
      (item) => item.id === planningId,
    );
    const visibleOccurrences = mine?.occurrences?.length ?? 0;
    if (visibleOccurrences > 0) {
      ok('planning visible par l’agent', `${visibleOccurrences} créneau(x)`);
    } else {
      bad('planning visible par l’agent', 'aucun créneau visible');
    }

    // 5. Le créneau apparaît dans l'espace de travail (prochaine prise de service).
    const workspace = await call('/agent/attendance/workspace', {
      token: swapper.accessToken,
    });
    const shift = (workspace.data?.shifts ?? []).find(
      (item) => item.planningId === planningId,
    );
    if (shift) ok('créneau dans l’espace de travail', `${shift.startTime}`);
    else bad('créneau dans l’espace de travail', 'prochain service absent');

    // 6. Pointage accepté (bug 2.1 : « Affectation introuvable »).
    if (shift) {
      const punch = await call('/agent/attendance', {
        method: 'POST',
        token: swapper.accessToken,
        body: {
          shiftId: shift.id,
          kind: 'CHECKIN',
          latitude: station.latitude,
          longitude: station.longitude,
          accuracyMeters: 5,
        },
      });
      // 409 = créneau hors fenêtre de pointage (le créneau est demain) : la
      // requête a été ACCEPTÉE et validée jusqu'au contrôle horaire ; 404 /
      // 403 signifieraient que l'affectation n'est toujours pas reconnue.
      if (punch.status === 200) ok('pointage enregistré');
      else if (
        punch.status === 409 &&
        /créneau|fenêtre|window/i.test(JSON.stringify(punch.data))
      ) {
        ok('pointage reconnu (hors fenêtre horaire, comportement attendu)');
      } else {
        bad('pointage', `${punch.status} ${JSON.stringify(punch.data)}`);
      }
    }
  })();
}

main().then(
  () => {
    console.log(
      failures === 0 ? '\nPARCOURS SWAPPEUR : OK' : `\nÉCHECS : ${failures}`,
    );
    process.exit(failures === 0 ? 0 : 1);
  },
  (error) => {
    console.error(`Erreur fatale : ${error.message}`);
    process.exit(1);
  },
);
