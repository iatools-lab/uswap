require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      stationId: true,
      station: { select: { name: true } },
      stationScopes: { select: { stationId: true } },
    },
  });

  console.log('=== USERS ===');
  users.forEach((u) =>
    console.log(
      '  ' +
        u.role.padEnd(13) +
        ' active=' +
        String(u.isActive).padEnd(5) +
        ' station=' +
        String(u.station ? u.station.name : 'null').padEnd(22) +
        ' scopes=' +
        u.stationScopes.length +
        '  ' +
        u.email,
    ),
  );

  const stations = await prisma.station.findMany({
    select: { id: true, name: true, isActive: true },
  });
  console.log('=== STATIONS ===');
  stations.forEach((s) =>
    console.log('  ' + s.name + '  active=' + s.isActive),
  );

  const shifts = await prisma.shift.findMany({
    select: {
      id: true,
      startTime: true,
      endTime: true,
      swapperId: true,
      stationId: true,
      planningId: true,
      swapper: { select: { email: true, isActive: true } },
    },
  });
  console.log('=== SHIFTS ===');
  shifts.forEach((s) =>
    console.log(
      '  start=' +
        s.startTime.toISOString() +
        ' swapper=' +
        s.swapper.email +
        ' active=' +
        s.swapper.isActive +
        ' planningId=' +
        s.planningId,
    ),
  );

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
