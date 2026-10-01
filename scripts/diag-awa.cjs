require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  const now = new Date();

  const swapper = await prisma.user.findUnique({
    where: { email: 'awa.nkolo@upowa.org' },
    select: { id: true, isActive: true },
  });

  console.log('awa.nkolo active: ' + swapper.isActive);
  console.log('now: ' + now.toISOString());

  const all = await prisma.shift.findMany({
    where: { swapperId: swapper.id },
    select: {
      startTime: true,
      endTime: true,
      planning: { select: { status: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log('=== ALL SHIFTS FOR awa.nkolo (' + all.length + ') ===');
  for (const s of all) {
    console.log(
      '  ' +
        s.startTime.toISOString() +
        '  end=' +
        s.endTime.toISOString() +
        '  past=' +
        (s.endTime.getTime() < now.getTime()) +
        '  planning=' +
        (s.planning ? s.planning.status : 'NULL'),
    );
  }

  const future = all.filter(
    (s) => s.endTime.getTime() > now.getTime() && s.planning && s.planning.status === 'PUBLISHED',
  );
  console.log('=== FUTURE + PUBLISHED: ' + future.length + ' ===');

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});