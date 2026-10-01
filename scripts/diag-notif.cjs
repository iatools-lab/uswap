require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  const candidates = await prisma.user.findMany({
    where: { role: 'SWAPPER' },
    select: {
      email: true,
      fullName: true,
      isActive: true,
      password: true,
    },
    orderBy: { email: 'asc' },
  });

  console.log('=== SWAPPERS ===');
  for (const u of candidates) {
    const hashed =
      u.password.startsWith('$2b$') || u.password.startsWith('$2a$');
    console.log(
      '  active=' +
        String(u.isActive).padEnd(5) +
        ' hashed=' +
        String(hashed).padEnd(5) +
        ' ' +
        u.email,
    );
  }

  console.log('=== NOTIFICATIONS BY KIND ===');
  const grouped = await prisma.notification.groupBy({
    by: ['kind'],
    _count: { _all: true },
  });
  grouped.forEach((g) => console.log('  ' + g.kind + ': ' + g._count._all));

  console.log('=== LAST 6 NOTIFICATIONS ===');
  const recent = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      kind: true,
      title: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });
  recent.forEach((n) =>
    console.log(
      '  ' + n.kind.padEnd(24) + ' ' + n.user.email.padEnd(30) + ' ' + n.title,
    ),
  );

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
