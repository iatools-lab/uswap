// Recette fuseau horaire — un shift saisi à 16 h doit rester à 16 h.
//
//   node scripts/recette-fuseau.mjs
//
// Crée une station de recette et un modèle « 16:00 → 20:00 », crée un planning
// contenant ce créneau, puis relit l'heure à tous les étages (base, API,
// modification). Rejouable : les objets existants sont réutilisés.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../backend_new/node_modules/@prisma/client');
const bcrypt = require('bcrypt');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = 'Recette-SuperAdmin-2026!';
const TZ = 'Africa/Douala';
const prisma = new PrismaClient();
const results = [];
const log = (name, ok, detail = '') => results.push({ name, ok, detail });

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

/** Heure locale de station, telle que l'affiche le planning. */
const localClock = (iso, timeZone = TZ) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const superAdmin = await prisma.user.upsert({
    where: { email: 'recette.superadmin@uswap.test' },
    create: {
      fullName: 'Recette Super Admin',
      email: 'recette.superadmin@uswap.test',
      role: 'SUPER_ADMIN',
      isActive: true,
      passwordHash: hash,
      invitationStatus: 'ACTIVATED',
    },
    update: { role: 'SUPER_ADMIN', isActive: true, disabledAt: null, passwordHash: hash },
  });
  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: superAdmin.email, password: PASSWORD },
  });
  const token = login.data?.accessToken;
  log('Connexion SUPER_ADMIN', login.status === 200, `HTTP ${login.status}`);

  // Station de recette, réutilisée d'une exécution à l'autre.
  let station = await prisma.station.findFirst({ where: { name: 'Recette Fuseau' } });
  if (!station) {
    station = await prisma.station.create({
      data: {
        name: 'Recette Fuseau',
        timezone: TZ,
        latitude: 4.05,
        longitude: 9.7,
        geofenceRadiusMeters: 150,
        isActive: true,
      },
    });
  }
  log('Station de recette en Africa/Douala', station.timezone === TZ, station.timezone);

  // Modèle 16:00 → 20:00 (réutilisé s'il existe déjà).
  let template = await prisma.shiftTemplate.findFirst({
    where: { stationId: station.id, startTime: '16:00', endTime: '20:00', isActive: true },
  });
  if (!template) {
    const createdTemplate = await call(`/stations/${station.id}/shift-templates`, {
      method: 'POST',
      body: { label: 'Après-midi recette', startTime: '16:00', endTime: '20:00' },
      token,
    });
    log(
      'Modèle 16:00 → 20:00 créé',
      [200, 201].includes(createdTemplate.status),
      `HTTP ${createdTemplate.status} ${JSON.stringify(createdTemplate.data?.message ?? '')}`,
    );
    template = await prisma.shiftTemplate.findFirst({
      where: { stationId: station.id, startTime: '16:00', endTime: '20:00', isActive: true },
    });
  }
  log('Modèle 16:00 → 20:00 disponible', Boolean(template?.id), template?.id ?? 'absent');

  // Planning sur une journée future, avec le créneau de 16:00 à 20:00.
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const planning = await call('/plannings', {
    method: 'POST',
    body: {
      name: `Recette fuseau ${day}`,
      stationIds: [station.id],
      periodStart: `${day}T00:00:00.000Z`,
      periodEnd: `${day}T23:59:59.000Z`,
      assignments: [
        {
          stationId: station.id,
          day,
          startTime: '16:00',
          endTime: '20:00',
          shiftLabel: 'Après-midi recette',
          shiftTemplateId: template?.id,
          requiredStaff: 1,
          assignedUserIds: [],
        },
      ],
    },
    token,
  });
  log(
    'Planning créé',
    [200, 201].includes(planning.status),
    `HTTP ${planning.status} ${JSON.stringify(planning.data?.message ?? planning.data?.id ?? '')}`,
  );
  if (!planning.data?.id) return;

  // Relecture par l'API : c'est ce que consomme l'écran de planning.
  const detail = await call(`/plannings/${planning.data.id}`, { token });
  const shift = detail.data?.occurrences?.[0];
  log('Le planning expose son créneau', Boolean(shift), `${detail.data?.occurrences?.length ?? 0} créneau(x), HTTP ${detail.status}`);
  if (!shift) return;

  const startClock = localClock(shift.startTime);
  const endClock = localClock(shift.endTime);
  log('Heure de début affichée = 16:00', startClock.startsWith('16:'), `affiché ${startClock}`);
  log('Heure de fin affichée = 20:00', endClock.startsWith('20:'), `affiché ${endClock}`);
  log(
    'Instant stocké = 15:00 UTC (Douala = UTC+1)',
    shift.startTime.slice(11, 16) === '15:00',
    shift.startTime,
  );

  // Modification d'horaire, puis relecture (le cas qui renvoyait un 500).
  const patch = await call(`/plannings/${planning.data.id}/occurrences/${shift.id}`, {
    method: 'PATCH',
    body: { startTime: '17:00', endTime: '21:00', revision: detail.data?.revision },
    token,
  });
  log('Modification d’horaire acceptée', [200, 201].includes(patch.status), `HTTP ${patch.status} ${JSON.stringify(patch.data?.message ?? '')}`);

  const model = await prisma.occurrence.findUnique({ where: { id: shift.id } });
  log(
    'Après modification : début 17:00 / fin 21:00',
    localClock(model.startTime.toISOString()).startsWith('17:') &&
      localClock(model.endTime.toISOString()).startsWith('21:'),
    `${localClock(model.startTime.toISOString())} → ${localClock(model.endTime.toISOString())}`,
  );

  // Actualisation de l'écran : l'heure ne doit pas bouger.
  const again = await call(`/plannings/${planning.data.id}`, { token });
  const reloaded = again.data?.occurrences?.find((row) => row.id === shift.id);
  log(
    'Après actualisation : 17:00 inchangé',
    localClock(reloaded.startTime).startsWith('17:'),
    reloaded.startTime,
  );

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
