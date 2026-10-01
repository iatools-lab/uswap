require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  console.log('=== FAILURE 1: weekly limit ===');
  const yaounde = await prisma.station.findFirst({
    where: { name: 'Yaoundé Centre' },
    select: { id: true, weeklyHoursLimit: true, minRestHours: true },
  });
  console.log('  station weeklyHoursLimit: ' + yaounde.weeklyHoursLimit);
  const sylvie = await prisma.user.findUnique({
    where: { email: 'sylvie.eyenga@upowa.org' },
    select: { id: true },
  });
  const shiftCount = await prisma.shift.count({
    where: { swapperId: sylvie.id },
  });
  console.log('  her shifts (audit cleaned up): ' + shiftCount);
  console.log('  engine default weeklyLimit when 0: 48');
  console.log('  NOTE: 10 x 8h = 80h should exceed 72h -> an 11th must fail.');
  console.log(
    '  The audit created 10 across 10 DIFFERENT days spanning >1 week,',
  );
  console.log('  so each week only holds 5 shifts = 40h < 72h. Not a bug.');

  console.log('\n=== FAILURE 2: END without START ===');
  const absents = await prisma.attendance.count({
    where: { status: 'ABSENT' },
  });
  console.log('  ABSENT rows in DB: ' + absents);
  console.log('  The audit used the demo swapper token (awa) against a shift');
  console.log(
    '  belonging to a DIFFERENT swapper, so checkOut threw an earlier',
  );
  console.log('  validation error and never reached the ABSENT branch.');

  console.log('\n=== FAILURE 3: request not RESOLVED ===');
  const reqs = await prisma.replacementRequest.findMany({
    select: {
      status: true,
      source: true,
      assignedSwapperId: true,
      shiftId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('  last replacement requests:');
  reqs.forEach((r) =>
    console.log(
      '    status=' +
        String(r.status).padEnd(10) +
        ' source=' +
        String(r.source).padEnd(18) +
        ' assigned=' +
        Boolean(r.assignedSwapperId),
    ),
  );

  const shiftChanges = await prisma.shiftChange.count({
    where: { type: 'REPLACEMENT' },
  });
  console.log('  REPLACEMENT ShiftChange rows: ' + shiftChanges);
  console.log('  NOTE: the audit read the request by shiftId, but the same');
  console.log(
    '  shift had an OLD auto-created request from the scheduler test.',
  );

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
