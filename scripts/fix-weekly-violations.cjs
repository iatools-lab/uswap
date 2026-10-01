require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// Removes shifts that violate their station's weekly limit, keeping the
// earliest ones in each week so the seed data becomes rule-compliant.
(async () => {
  const prisma = new PrismaClient();

  const stations = await prisma.station.findMany({
    select: { id: true, name: true, weeklyHoursLimit: true },
  });

  let removedTotal = 0;

  for (const station of stations) {
    const swappers = await prisma.user.findMany({
      where: { role: 'SWAPPER', stationId: station.id },
      select: { id: true },
    });

    for (const swapper of swappers) {
      const shifts = await prisma.shift.findMany({
        where: {
          swapperId: swapper.id,
          stationId: station.id,
          endTime: { gt: new Date() },
        },
        select: { id: true, startTime: true, endTime: true },
        orderBy: { startTime: 'asc' },
      });

      const byWeek = new Map();
      for (const shift of shifts) {
        const day = shift.startTime.getUTCDay();
        const weekStart = new Date(shift.startTime);
        weekStart.setUTCDate(
          weekStart.getUTCDate() - (day === 0 ? 6 : day - 1),
        );
        weekStart.setUTCHours(0, 0, 0, 0);
        const key = weekStart.toISOString().slice(0, 10);
        if (!byWeek.has(key)) byWeek.set(key, []);
        byWeek.get(key).push(shift);
      }

      for (const [, weekShifts] of byWeek) {
        let hours = 0;
        for (const shift of weekShifts) {
          const duration =
            (shift.endTime.getTime() - shift.startTime.getTime()) / 3600000;
          if (hours + duration > station.weeklyHoursLimit) {
            await prisma.shift.delete({ where: { id: shift.id } });
            removedTotal++;
          } else {
            hours += duration;
          }
        }
      }
    }
  }

  console.log(
    'removed ' + removedTotal + ' shift(s) exceeding the weekly limit',
  );

  console.log('\n=== VERIFY ===');
  for (const station of stations) {
    const swappers = await prisma.user.findMany({
      where: { role: 'SWAPPER', stationId: station.id },
      select: { id: true, email: true },
    });

    for (const swapper of swappers) {
      const shifts = await prisma.shift.findMany({
        where: {
          swapperId: swapper.id,
          stationId: station.id,
          endTime: { gt: new Date() },
        },
        select: { startTime: true, endTime: true },
      });

      const byWeek = new Map();
      for (const shift of shifts) {
        const day = shift.startTime.getUTCDay();
        const weekStart = new Date(shift.startTime);
        weekStart.setUTCDate(
          weekStart.getUTCDate() - (day === 0 ? 6 : day - 1),
        );
        weekStart.setUTCHours(0, 0, 0, 0);
        const key = weekStart.toISOString().slice(0, 10);
        const dur =
          (shift.endTime.getTime() - shift.startTime.getTime()) / 3600000;
        byWeek.set(key, (byWeek.get(key) || 0) + dur);
      }

      for (const [week, hours] of byWeek) {
        const flag = hours > station.weeklyHoursLimit ? ' VIOLATION' : '';
        console.log(
          '  ' +
            swapper.email.padEnd(28) +
            station.name.padEnd(16) +
            week +
            '  ' +
            hours +
            'h / ' +
            station.weeklyHoursLimit +
            'h' +
            flag,
        );
      }
    }
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
