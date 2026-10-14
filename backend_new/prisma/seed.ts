/**
 * Seed de démonstration — backend_new (nouveau schéma Prisma).
 *
 * Reflète le jeu de données de la maquette frontend (`frontend_new/src/api/mock`),
 * afin que l'API réelle soit interchangeable avec le mode démo.
 *
 * Idempotent : les enregistrements sont appariés sur une clé naturelle
 * (email, nom de station, libellé de modèle) et rien n'est jamais supprimé.
 *
 * Usage :  npm run seed
 */
import { PrismaClient, Role, LeaveType, AttendanceStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const TIMEZONE = 'Africa/Douala';
/** Douala est à UTC+1 toute l'année (pas d'heure d'été). */
const DOUALA_OFFSET_HOURS = 1;

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Uswap2026!Demo';

type StationKey = 'douala' | 'yaounde';

const STATIONS: {
  key: StationKey;
  name: string;
  address: string;
  city: string;
  location: string;
  latitude: number;
  longitude: number;
  weeklyHoursLimit: number;
}[] = [
  {
    key: 'douala',
    name: 'Bonabéri',
    address: 'Zone industrielle de Bonabéri',
    city: 'Douala',
    location: 'Douala, Cameroun',
    latitude: 4.0777,
    longitude: 9.6627,
    weeklyHoursLimit: 48,
  },
  {
    key: 'yaounde',
    name: 'Yaoundé Centre',
    address: 'Avenue Kennedy',
    city: 'Yaoundé',
    location: 'Yaoundé, Cameroun',
    latitude: 3.848,
    longitude: 11.5021,
    weeklyHoursLimit: 72,
  },
];

const USERS: {
  email: string;
  fullName: string;
  role: Role;
  stationKey?: StationKey;
  phoneNumber?: string;
}[] = [
  {
    email: 'admin@upowa.org',
    fullName: 'Administrateur Uswap',
    role: Role.ADMIN,
  },
  {
    email: 'superviseur@upowa.org',
    fullName: 'Superviseur Douala',
    role: Role.SUPERVISOR,
    stationKey: 'douala',
    phoneNumber: '+237655000001',
  },
  {
    email: 'chef@upowa.org',
    fullName: 'Superviseur Bonabéri',
    role: Role.SUPERVISOR,
    stationKey: 'douala',
    phoneNumber: '+237655000002',
  },
  {
    email: 'awa.nkolo@upowa.org',
    fullName: 'Awa Nkolo',
    role: Role.SWAPPER,
    stationKey: 'douala',
    phoneNumber: '+237655000011',
  },
  {
    email: 'jean.dupont@upowa.org',
    fullName: 'Jean Dupont',
    role: Role.SWAPPER,
    stationKey: 'douala',
    phoneNumber: '+237655000012',
  },
  {
    email: 'paul.mbarga@upowa.org',
    fullName: 'Paul Mbarga',
    role: Role.SWAPPER,
    stationKey: 'douala',
    phoneNumber: '+237655000013',
  },
  {
    email: 'sylvie.eyenga@upowa.org',
    fullName: 'Sylvie Eyenga',
    role: Role.SWAPPER,
    stationKey: 'yaounde',
    phoneNumber: '+237655000014',
  },
];

const TEMPLATES: {
  stationKey: StationKey;
  label: string;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  breakMinutes: number;
  durationMinutes: number;
}[] = [
  // Bonabéri — trois services de 8 h.
  {
    stationKey: 'douala',
    label: 'Matin',
    startTime: '06:00',
    endTime: '14:00',
    breakStart: '10:00',
    breakEnd: '10:30',
    breakMinutes: 30,
    durationMinutes: 480,
  },
  {
    stationKey: 'douala',
    label: 'Après-midi',
    startTime: '14:00',
    endTime: '22:00',
    breakStart: '18:00',
    breakEnd: '18:30',
    breakMinutes: 30,
    durationMinutes: 480,
  },
  {
    stationKey: 'douala',
    label: 'Nuit',
    startTime: '22:00',
    endTime: '06:00',
    breakStart: '01:00',
    breakEnd: '01:30',
    breakMinutes: 30,
    durationMinutes: 480,
  },
  // Yaoundé — deux services de 8 h.
  {
    stationKey: 'yaounde',
    label: 'Matin',
    startTime: '07:00',
    endTime: '15:00',
    breakStart: '11:00',
    breakEnd: '11:30',
    breakMinutes: 30,
    durationMinutes: 480,
  },
  {
    stationKey: 'yaounde',
    label: 'Après-midi',
    startTime: '15:00',
    endTime: '23:00',
    breakStart: '19:00',
    breakEnd: '19:30',
    breakMinutes: 30,
    durationMinutes: 480,
  },
];

/** Lundi 00:00 UTC de la semaine contenant `date`. */
function weekStart(date: Date): Date {
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Construit un instant UTC depuis une date (jour UTC) et une heure locale de la
 * station. Une heure < 24 correspond au même jour ; le service « Nuit » franchit
 * minuit quand `endTime < startTime`.
 */
function atLocal(day: Date, hour: number, minute = 0): Date {
  const result = new Date(day);
  result.setUTCHours(hour - DOUALA_OFFSET_HOURS, minute, 0, 0);
  return result;
}

function parseHm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return { hour: Number(h), minute: Number(m) };
}

async function seedStations() {
  const byKey = new Map<StationKey, { id: string; name: string }>();

  for (const station of STATIONS) {
    const record = await prisma.station.upsert({
      where: { name: station.name },
      update: {
        address: station.address,
        city: station.city,
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        timezone: TIMEZONE,
        weeklyHoursLimit: station.weeklyHoursLimit,
        isActive: true,
      },
      create: {
        name: station.name,
        address: station.address,
        city: station.city,
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        timezone: TIMEZONE,
        weeklyHoursLimit: station.weeklyHoursLimit,
        isActive: true,
      },
      select: { id: true, name: true },
    });

    byKey.set(station.key, record);
    console.log(`  station   ${record.name}`);
  }

  return byKey;
}

async function seedUsers(
  stations: Map<StationKey, { id: string; name: string }>,
) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const byEmail = new Map<string, { id: string; fullName: string }>();

  for (const user of USERS) {
    const stationId = user.stationKey
      ? stations.get(user.stationKey)?.id
      : undefined;

    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        fullName: user.fullName,
        role: user.role,
        isActive: true,
        disabledAt: null,
        passwordHash,
        invitationStatus: 'ACTIVATED',
        invitationSentAt: null,
        invitationExpiresAt: null,
        ...(stationId ? { stationId } : {}),
        ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
      },
      create: {
        email: user.email,
        passwordHash,
        fullName: user.fullName,
        role: user.role,
        isActive: true,
        invitationStatus: 'ACTIVATED',
        stationId,
        phoneNumber: user.phoneNumber ?? null,
      },
      select: { id: true, fullName: true },
    });

    byEmail.set(user.email, record);
    console.log(`  user      ${user.role.padEnd(11)} ${user.email}`);
  }

  return byEmail;
}

async function seedTemplates(
  stations: Map<StationKey, { id: string; name: string }>,
) {
  const byLabel = new Map<
    string,
    { id: string; startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null; durationMinutes: number }
  >();

  for (const template of TEMPLATES) {
    const station = stations.get(template.stationKey);
    if (!station) continue;

    const record = await prisma.shiftTemplate.upsert({
      where: {
        stationId_startTime_endTime: {
          stationId: station.id,
          startTime: template.startTime,
          endTime: template.endTime,
        },
      },
      update: {
        label: template.label,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: template.breakMinutes,
        durationMinutes: template.durationMinutes,
        isActive: true,
      },
      create: {
        stationId: station.id,
        label: template.label,
        startTime: template.startTime,
        endTime: template.endTime,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: template.breakMinutes,
        durationMinutes: template.durationMinutes,
        isActive: true,
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        breakStart: true,
        breakEnd: true,
        durationMinutes: true,
      },
    });

    // Premier historique de version, utile à l'écran « modèles de shift ».
    await prisma.shiftTemplateVersion.create({
      data: {
        templateId: record.id,
        revision: 1,
        label: template.label,
        startTime: template.startTime,
        endTime: template.endTime,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: template.breakMinutes,
        durationMinutes: template.durationMinutes,
        isActive: true,
      },
    });

    byLabel.set(`${template.stationKey}:${template.label}`, record);
    console.log(`  template  ${station.name} — ${template.label}`);
  }

  return byLabel;
}

async function seedLeaveBalances(
  users: Map<string, { id: string; fullName: string }>,
) {
  const year = new Date().getUTCFullYear();
  for (const [email, user] of users) {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });
    if (!existing || existing.role !== Role.SWAPPER) continue;

    await prisma.leaveBalance.upsert({
      where: { swapperId: user.id },
      update: { year },
      create: {
        swapperId: user.id,
        year,
        entitledDays: 24,
        usedDays: 0,
        pendingDays: 0,
        remainingDays: 24,
      },
    });
  }
  console.log('  balances  soldes de congés initialisés');
}

/**
 * Génère un planning de la semaine SUIVANTE pour la station de Douala :
 * un service par jour (matin / après-midi / nuit en rotation), affecté aux
 * trois swappeurs de la station, puis publié. Deux pointages passés sont
 * simulés pour alimenter l'historique.
 */
async function seedPlanning(
  stations: Map<StationKey, { id: string; name: string }>,
  users: Map<string, { id: string; fullName: string }>,
  templates: Map<string, { id: string; startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null; durationMinutes: number }>,
) {
  const station = stations.get('douala');
  if (!station) return;

  const nextMonday = weekStart(addDays(new Date(), 7));
  const periodEnd = addDays(nextMonday, 7);

  // Idempotence : un planning de démo sur cette période existe déjà ?
  const existing = await prisma.planning.findFirst({
    where: {
      name: 'Planning démo — Bonabéri',
      periodStart: nextMonday,
    },
  });
  if (existing) {
    console.log('  planning  déjà présent (semaine suivante)');
    return;
  }

  const admin = users.get('admin@upowa.org');
  const swappers = [
    users.get('awa.nkolo@upowa.org'),
    users.get('jean.dupont@upowa.org'),
    users.get('paul.mbarga@upowa.org'),
  ].filter((u): u is { id: string; fullName: string } => Boolean(u));

  const planning = await prisma.planning.create({
    data: {
      name: 'Planning démo — Bonabéri',
      stationIds: [station.id],
      periodStart: nextMonday,
      periodEnd,
      status: 'DRAFT',
      createdById: admin?.id ?? null,
      revisions: {
        create: {
          revision: 1,
          action: 'CREATED',
          actorId: admin?.id ?? null,
          snapshot: {},
        },
      },
    },
  });

  const rotationKeys = ['douala:Matin', 'douala:Après-midi', 'douala:Nuit'];

  for (let day = 0; day < 7; day += 1) {
    const dayDate = addDays(nextMonday, day);
    const template = templates.get(rotationKeys[day % rotationKeys.length]);
    if (!template) continue;

    const start = parseHm(template.startTime);
    const end = parseHm(template.endTime);
    const overMidnight = end.hour < start.hour;
    const startAt = atLocal(dayDate, start.hour, start.minute);
    const endAt = atLocal(
      overMidnight ? addDays(dayDate, 1) : dayDate,
      end.hour,
      end.minute,
    );
    const swapper = swappers[day % swappers.length];

    const occurrence = await prisma.occurrence.create({
      data: {
        planningId: planning.id,
        stationId: station.id,
        templateId: template.id,
        shiftTemplateId: template.id,
        label: `Service ${rotationKeys[day % rotationKeys.length].split(':')[1]}`,
        shiftLabel: rotationKeys[day % rotationKeys.length].split(':')[1],
        day: dayDate.toISOString().slice(0, 10),
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: 30,
        requiredStaff: 1,
        status: 'PLANNED',
        swapperId: swapper?.id ?? null,
        startTime: startAt,
        endTime: endAt,
      },
    });

    if (swapper) {
      await prisma.occurrenceAssignment.create({
        data: {
          occurrenceId: occurrence.id,
          userId: swapper.id,
          assignedById: admin?.id ?? null,
        },
      });
      await prisma.attendance.create({
        data: {
          shiftId: occurrence.id,
          swapperId: swapper.id,
          status: AttendanceStatus.EXPECTED,
        },
      });
    }
  }

  await prisma.planning.update({
    where: { id: planning.id },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      publishedById: admin?.id ?? null,
    },
  });
  await prisma.planningRevision.create({
    data: {
      planningId: planning.id,
      revision: 2,
      action: 'PUBLISHED',
      actorId: admin?.id ?? null,
      snapshot: {},
    },
  });

  console.log(
    `  planning  ${planning.name} publié (${nextMonday.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)})`,
  );
}

async function seedGlobalSettings() {
  await prisma.globalSettings.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      sessionMinutes: 60,
      invitationValidityHours: 48,
      maxAttachmentMb: 5,
      notificationRetentionDays: 90,
      supportEmail: process.env.SUPPORT_EMAIL ?? 'support@uswap.local',
    },
  });
  console.log('  settings  réglages globaux prêts');
}

async function main() {
  console.log('Seed uSwap (backend_new) — jeu de démonstration\n');

  const stations = await seedStations();
  const users = await seedUsers(stations);
  const templates = await seedTemplates(stations);
  await seedLeaveBalances(users);
  await seedGlobalSettings();
  await seedPlanning(stations, users, templates);

  console.log('\nSeed terminé.');
  console.log(`Mot de passe commun : ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed échoué :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
