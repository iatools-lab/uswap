require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

(async () => {
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      password: true,
      station: { select: { name: true } },
    },
  });

  console.log('=== ACCOUNTS IN DATABASE ===');
  for (const u of users) {
    const looksHashed =
      u.password.startsWith('$2b$') || u.password.startsWith('$2a$');
    const matchesSeed = await bcrypt
      .compare(process.env.ADMIN_SEED_PASSWORD || '', u.password)
      .catch(() => false);
    console.log(
      '  ' +
        u.role.padEnd(12) +
        ' active=' +
        String(u.isActive).padEnd(5) +
        ' hashed=' +
        String(looksHashed).padEnd(5) +
        ' pwd==ADMIN_SEED_PASSWORD=' +
        String(matchesSeed).padEnd(5) +
        ' len=' +
        String(u.password.length).padEnd(4) +
        ' ' +
        u.email,
    );
  }

  console.log('=== LOGIN ATTEMPTS (last 10) ===');
  const attempts = await prisma.loginAttempt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (!attempts.length) console.log('  (none recorded)');
  attempts.forEach((a) =>
    console.log(
      '  ' +
        a.createdAt.toISOString() +
        '  success=' +
        a.success +
        '  ' +
        a.email,
    ),
  );

  console.log('=== ADMIN_SEED_PASSWORD in .env ===');
  console.log('  set: ' + !!process.env.ADMIN_SEED_PASSWORD);
  console.log('  length: ' + (process.env.ADMIN_SEED_PASSWORD || '').length);

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
