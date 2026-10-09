/**
 * Inventaire de la base uSwap : plannings, shifts, modèles et pauses.
 * Usage : node scripts/_db-inventory.cjs
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv/config');

const prisma = new PrismaClient();

async function main() {
  const plannings = await prisma.planning.findMany({
    orderBy: { startDate: 'asc' },
    include: { _count: { select: { shifts: true } } },
  });
  console.log('=== PLANNINGS ===', plannings.length);
  for (const p of plannings) {
    console.log(
      `${p.id} | ${p.status} | ${p.startDate.toISOString().slice(0, 10)} → ${p.endDate
        .toISOString()
        .slice(0, 10)} | shifts=${p._count.shifts}`,
    );
  }

  const shifts = await prisma.shift.groupBy({
    by: ['planningId'],
    _count: { _all: true },
  });
  console.log('\n=== SHIFTS par planningId ===');
  for (const s of shifts) console.log(s.planningId, s._count._all);

  const templates = await prisma.shiftTemplate.findMany({
    include: { station: { select: { name: true } } },
    orderBy: [{ stationId: 'asc' }, { startTime: 'asc' }],
  });
  console.log('\n=== MODELES DE SHIFT ===', templates.length);
  for (const t of templates) {
    console.log(
      `${t.station?.name} | ${t.label} | ${t.startTime}-${t.endTime} | pause=${t.breakStart ?? '-'}→${t.breakEnd ?? '-'} (${t.breakMinutes}min) | active=${t.isActive}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
