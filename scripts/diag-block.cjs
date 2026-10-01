require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  const station = await prisma.station.findFirst({
    where: { name: 'Bonabéri' },
    select: { id: true, minRestHours: true, weeklyHoursLimit: true },
  });
  const swappers = await prisma.user.findMany({
    where: { role: 'SWAPPER', isActive: true, stationId: station.id },
    select: { id: true, email: true },
  });

  console.log('=== STATION ===');
  console.log('  ' + JSON.stringify(station));
  console.log('=== SWAPPERS (order returned) ===');
  swappers.forEach((s, i) => console.log('  [' + i + '] ' + s.email));

  // What does the audit's target day look like for swappers[0]?
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + 200);
  base.setUTCHours(6, 0, 0, 0);
  const day = (o, h) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + o);
    d.setUTCHours(h, 0, 0, 0);
    return d;
  };

  const s0 = swappers[0];
  console.log('\n=== swappers[0] = ' + s0.email + ' ===');
  const start = day(3, 6);
  const end = day(3, 14);
  console.log(
    '  proposed: ' + start.toISOString() + ' -> ' + end.toISOString(),
  );

  // Any shift in the SAME BUSINESS DAY (Douala) blocks it.
  const sameDay = await prisma.shift.findMany({
    where: { swapperId: s0.id },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });
  console.log('  existing shifts for this swapper: ' + sameDay.length);
  sameDay.forEach((sh) =>
    console.log(
      '    ' + sh.startTime.toISOString() + ' -> ' + sh.endTime.toISOString(),
    ),
  );

  // The one-shift-per-day check compares business dates.
  const businessDate = (d) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Douala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

  const proposedDate = businessDate(start);
  console.log('  proposed business date: ' + proposedDate);
  const clash = sameDay.find(
    (sh) => businessDate(sh.startTime) === proposedDate,
  );
  console.log(
    '  clash on the same business date: ' +
      (clash ? clash.startTime.toISOString() : 'none'),
  );

  // Weekly hours for the proposed week.
  const dow = start.getUTCDay();
  const weekStart = new Date(start);
  weekStart.setUTCDate(weekStart.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  console.log('  proposed week: ' + weekStart.toISOString().slice(0, 10));

  const inWeek = sameDay.filter(
    (sh) => sh.startTime >= weekStart && sh.startTime < weekEnd,
  );
  const hours = inWeek.reduce(
    (t, sh) => t + (sh.endTime - sh.startTime) / 3600000,
    0,
  );
  console.log('  hours already in that week: ' + hours);
  console.log(
    '  + 8h = ' + (hours + 8) + ' vs limit ' + station.weeklyHoursLimit,
  );
  console.log('  WOULD EXCEED: ' + (hours + 8 > station.weeklyHoursLimit));

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
