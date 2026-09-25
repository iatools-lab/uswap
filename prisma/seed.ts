import { PrismaClient, Role, PlanningStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const TIMEZONE = 'Africa/Douala';

/**
 * Demo seed.
 *
 * Safe to run multiple times: records are matched on a natural key and nothing
 * is ever deleted, so accounts you created in the UI stay intact.
 *
 * All demo accounts use the same password (DEMO_PASSWORD, default below).
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Uswap2026!Demo';

type StationKey = 'douala' | 'yaounde';

type DemoUser = {
  email: string;
  fullName: string;
  role: Role;
  stationKey?: StationKey;
};

const STATIONS: {
  key: StationKey;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  minRestHours: number;
  weeklyHoursLimit: number;
}[] = [
  {
    key: 'douala',
    name: 'Bonabéri',
    location: 'Douala, Cameroun',
    latitude: 4.0777,
    longitude: 9.6627,
    minRestHours: 8,
    weeklyHoursLimit: 48,
  },
  {
    key: 'yaounde',
    name: 'Yaoundé Centre',
    location: 'Yaoundé, Cameroun',
    latitude: 3.848,
    longitude: 11.5021,
    minRestHours: 8,
    weeklyHoursLimit: 72,
  },
];

const USERS: DemoUser[] = [
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
  },
  {
    email: 'chef@upowa.org',
    fullName: 'Chef de station Bonabéri',
    role: Role.STATION_CHIEF,
    stationKey: 'douala',
  },
  {
    email: 'awa.nkolo@upowa.org',
    fullName: 'Awa Nkolo',
    role: Role.SWAPPER,
    stationKey: 'douala',
  },
  {
    email: 'jean.dupont@upowa.org',
    fullName: 'Jean Dupont',
    role: Role.SWAPPER,
    stationKey: 'douala',
  },
  {
    email: 'paul.mbarga@upowa.org',
    fullName: 'Paul Mbarga',
    role: Role.SWAPPER,
    stationKey: 'douala',
  },
  {
    email: 'sylvie.eyenga@upowa.org',
    fullName: 'Sylvie Eyenga',
    role: Role.SWAPPER,
    stationKey: 'yaounde',
  },
];

/** Monday 00:00 UTC of the week containing `date`. */
function getWeekStart(date: Date): Date {
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

/** A Douala-local hour expressed as UTC (Douala is UTC+1, no DST). */
function localTime(day: Date, hour: number): Date {
  const result = new Date(day);
  result.setUTCHours(hour - 1, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function seedStations() {
  const byKey = new Map<StationKey, { id: string; name: string }>();

  for (const station of STATIONS) {
    const record = await prisma.station.upsert({
      where: { name: station.name },
      update: {
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        timezone: TIMEZONE,
        minRestHours: station.minRestHours,
        weeklyHoursLimit: station.weeklyHoursLimit,
        isActive: true,
      },
      create: {
        name: station.name,
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        timezone: TIMEZONE,
        minRestHours: station.minRestHours,
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
  // One hash reused for every demo account: same password, one bcrypt call.
  const password = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
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
        password,
        invitationTokenHash: null,
        invitationTokenExpires: null,
        ...(stationId ? { stationId } : {}),
      },
      create: {
        email: user.email,
        password,
        fullName: user.fullName,
        role: user.role,
        isActive: true,
        stationId,
      },
      select: { id: true, fullName: true },
    });

    byEmail.set(user.email, record);
    console.log(`  user      ${user.role.padEnd(13)} ${user.email}`);
  }

  return byEmail;
}

async function seedStationScopes(
  stations: Map<StationKey, { id: string; name: string }>,
  users: Map<string, { id: string; fullName: string }>,
) {
  const supervisor = users.get('superviseur@upowa.org');
  const yaounde = stations.get('yaounde');

  if (!supervisor || !yaounde) return;

  await prisma.userStationScope.upsert({
    where: {
      userId_stationId: {
        userId: supervisor.id,
        stationId: yaounde.id,
      },
    },
    update: {},
    create: {
      userId: supervisor.id,
      stationId: yaounde.id,
    },
  });

  console.log('  scope     superviseur -> Yaoundé Centre');
}

async function seedPlanning(
  stations: Map<StationKey, { id: string; name: string }>,
  users: Map<string, { id: string; fullName: string }>,
) {
  // Start from NEXT week so the demo always has shifts ahead of it, whatever
  // weekday it is run on. A planning on the current week is useless by Friday.
  const nextMonday = addDays(getWeekStart(new Date()), 7);
  const sunday = addDays(nextMonday, 6);

  const startDate = localTime(nextMonday, 0);
  const endDate = localTime(addDays(sunday, 1), 0);

  const existing = await prisma.planning.findFirst({
    where: { startDate, endDate },
    select: { id: true },
  });

  const planning = existing
    ? await prisma.planning.update({
        where: { id: existing.id },
        data: { status: PlanningStatus.PUBLISHED },
        select: { id: true, status: true },
      })
    : await prisma.planning.create({
        data: {
          startDate,
          endDate,
          status: PlanningStatus.PUBLISHED,
          createdBy: users.get('admin@upowa.org')?.fullName ?? 'Seed',
        },
        select: { id: true, status: true },
      });

  console.log(
    `  planning  ${startDate.toISOString()} -> ${sunday
      .toISOString()
      .slice(0, 10)} (${planning.status})`,
  );

  for (const station of stations.values()) {
    await prisma.planningStation.upsert({
      where: {
        planningId_stationId: {
          planningId: planning.id,
          stationId: station.id,
        },
      },
      update: {},
      create: {
        planningId: planning.id,
        stationId: station.id,
      },
    });
  }

  return { planning, monday: nextMonday };
}

/**
 * The scheduling rules allow one shift per day, so each swapper gets a single
 * 8h slot, rotating between 06:00-14:00 and 14:00-22:00.
 */
async function seedShifts(
  stations: Map<StationKey, { id: string; name: string }>,
  users: Map<string, { id: string; fullName: string }>,
  planningId: string,
  monday: Date,
) {
  const douala = stations.get('douala');
  if (!douala) return;

  const swappers = USERS.filter(
    (u) => u.role === Role.SWAPPER && u.stationKey === 'douala',
  )
    .map((u) => users.get(u.email))
    .filter((u): u is { id: string; fullName: string } => Boolean(u));

  if (!swappers.length) return;

  const slots = [
    { startHour: 6, endHour: 14 },
    { startHour: 14, endHour: 22 },
  ];

  let created = 0;
  let skipped = 0;

  for (let day = 0; day < 7; day++) {
    const date = addDays(monday, day);

    for (let index = 0; index < swappers.length; index++) {
      const swapper = swappers[index];
      const slot = slots[(day + index) % slots.length];

      const startTime = localTime(date, slot.startHour);
      const endTime = localTime(date, slot.endHour);

      const existing = await prisma.shift.findFirst({
        where: {
          swapperId: swapper.id,
          stationId: douala.id,
          startTime,
        },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const shift = await prisma.shift.create({
        data: {
          stationId: douala.id,
          swapperId: swapper.id,
          startTime,
          endTime,
          planningId,
        },
        select: { id: true },
      });

      // Every shift needs an attendance row or check-in finds nothing.
      await prisma.attendance.create({
        data: {
          shiftId: shift.id,
          swapperId: swapper.id,
          stationId: douala.id,
          status: 'EXPECTED',
        },
      });

      created++;
    }
  }

  console.log(`  shifts    ${created} created, ${skipped} already present`);
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  Uswap — demo seed');
  console.log('========================================');

  console.log('\nStations');
  const stations = await seedStations();

  console.log('\nAccounts');
  const users = await seedUsers(stations);

  console.log('\nScopes');
  await seedStationScopes(stations, users);

  console.log('\nPlanning');
  const { planning, monday } = await seedPlanning(stations, users);

  console.log('\nShifts + attendance');
  await seedShifts(stations, users, planning.id, monday);

  console.log('\n========================================');
  console.log(`  Demo accounts (password: ${DEMO_PASSWORD})`);
  console.log('========================================');
  console.log('  ADMIN          admin@upowa.org');
  console.log('  SUPERVISOR     superviseur@upowa.org');
  console.log('  STATION_CHIEF  chef@upowa.org');
  console.log('  SWAPPER        awa.nkolo@upowa.org');
  console.log('  SWAPPER        jean.dupont@upowa.org');
  console.log('  SWAPPER        paul.mbarga@upowa.org');
  console.log('  SWAPPER        sylvie.eyenga@upowa.org');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
