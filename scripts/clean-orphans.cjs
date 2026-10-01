require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  // The legacy orphan: a shift with no planning, invisible everywhere in the
  // app but previously returned by /shifts/mine.
  const orphans = await prisma.shift.findMany({
    where: { planningId: null },
    select: {
      id: true,
      startTime: true,
      attendances: { select: { id: true, status: true } },
      swapper: { select: { email: true } },
    },
  });

  console.log('=== SHIFTS WITHOUT A PLANNING ===');
  if (!orphans.length) console.log('  (none)');
  for (const s of orphans) {
    console.log(
      '  ' +
        s.swapper.email +
        '  ' +
        s.startTime.toISOString() +
        '  attendances=' +
        s.attendances.length,
    );
  }

  for (const s of orphans) {
    await prisma.attendance.deleteMany({ where: { shiftId: s.id } });
    await prisma.shift.delete({ where: { id: s.id } });
    console.log('  removed shift ' + s.id);
  }

  console.log('=== REPLACEMENT REQUESTS CREATED BY EARLIER TEST RUNS ===');
  const requests = await prisma.replacementRequest.findMany({
    select: {
      id: true,
      status: true,
      source: true,
      shift: { select: { startTime: true, planningId: true } },
    },
  });
  if (!requests.length) console.log('  (none)');
  for (const r of requests) {
    console.log(
      '  ' + r.status.padEnd(9) + ' ' + (r.source || '-').padEnd(18) +
      ' planning=' + (r.shift.planningId ? 'yes' : 'NULL'),
    );
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});