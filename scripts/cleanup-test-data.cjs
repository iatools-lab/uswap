require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

/**
 * Removes leftovers created by the e2e harness: empty DRAFT plannings and
 * unattached shifts. Only touches records with no dependents.
 */
(async () => {
  const prisma = new PrismaClient();

  const emptyDrafts = await prisma.planning.findMany({
    where: {
      status: 'DRAFT',
      shifts: { none: {} },
    },
    select: { id: true, startDate: true },
  });

  if (emptyDrafts.length) {
    const removed = await prisma.planning.deleteMany({
      where: { id: { in: emptyDrafts.map((p) => p.id) } },
    });
    console.log('removed ' + removed.count + ' empty DRAFT planning(s)');
  } else {
    console.log('no empty DRAFT planning to remove');
  }

  const orphans = await prisma.shift.findMany({
    where: {
      planningId: null,
      attendances: { none: {} },
      replacementRequests: { none: {} },
      shiftChanges: { none: {} },
    },
    select: { id: true },
  });

  if (orphans.length) {
    const removed = await prisma.shift.deleteMany({
      where: { id: { in: orphans.map((s) => s.id) } },
    });
    console.log('removed ' + removed.count + ' orphaned shift(s)');
  } else {
    console.log('no orphaned shift to remove');
  }

  console.log('\n=== FINAL STATE ===');
  const plannings = await prisma.planning.count();
  const published = await prisma.planning.count({
    where: { status: 'PUBLISHED' },
  });
  const shifts = await prisma.shift.count();
  const attendances = await prisma.attendance.count();
  const users = await prisma.user.count();
  const stations = await prisma.station.count();

  console.log('  users:       ' + users);
  console.log('  stations:    ' + stations);
  console.log('  plannings:   ' + plannings + ' (' + published + ' published)');
  console.log('  shifts:      ' + shifts);
  console.log('  attendances: ' + attendances);

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
