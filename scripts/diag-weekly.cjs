require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// Is the weekly limit actually enforced? Build the exact scenario the engine
// evaluates, without going through HTTP.
const {
  getWeekStart,
  getDurationInHours,
} = require('../dist/scheduling/scheduling.utils');

(async () => {
  const prisma = new PrismaClient();

  const station = await prisma.station.findFirst({
    where: { name: 'Bonabéri' },
    select: { id: true, weeklyHoursLimit: true, minRestHours: true },
  });
  console.log('=== STATION ===');
  console.log('  ' + JSON.stringify(station));

  const swappers = await prisma.user.findMany({
    where: { role: 'SWAPPER', isActive: true, stationId: station.id },
    select: { id: true, email: true },
  });
  console.log('  swappers on this station: ' + swappers.length);
  swappers.forEach((s) => console.log('    ' + s.email));

  const s = swappers[swappers.length - 1];
  console.log('\n=== TESTING SWAPPER ' + s.email + ' ===');

  const existing = await prisma.shift.findMany({
    where: { swapperId: s.id },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });
  console.log('  existing shifts: ' + existing.length);

  // Group by week and show the totals the engine would compute.
  const byWeek = new Map();
  for (const sh of existing) {
    const key = getWeekStart(sh.startTime).toISOString().slice(0, 10);
    byWeek.set(
      key,
      (byWeek.get(key) || 0) + getDurationInHours(sh.startTime, sh.endTime),
    );
  }
  console.log('  hours per week:');
  for (const [week, hours] of [...byWeek.entries()].sort()) {
    const over = hours > station.weeklyHoursLimit;
    console.log(
      '    week ' +
        week +
        ': ' +
        hours +
        'h' +
        (over ? '  <-- EXCEEDS ' + station.weeklyHoursLimit + 'h' : ''),
    );
  }

  console.log('\n=== THE RULE AS IMPLEMENTED ===');
  console.log('  checkWeeklyHours counts shifts whose startTime falls in the');
  console.log('  week, adds the proposed duration, and refuses when the total');
  console.log('  EXCEEDS the limit.');
  console.log('  one-shift-per-day caps a swapper at 7 shifts/week = 56h.');
  console.log('  With weeklyHoursLimit=48, the 7th shift takes it to 56h.');
  console.log('  Expected: the 7th must be REFUSED.');
  console.log('  Observed: 7 accepted.');

  const total = [...byWeek.values()].reduce((a, b) => a + b, 0);
  console.log('\n  total hours currently on this swapper: ' + total);

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
