const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const user = await prisma.user.findUnique({
    where: { email: 'admin@upowa.org' },
    select: { email: true, password: true, isActive: true },
  });

  console.log('email:', user.email, 'active:', user.isActive);

  for (const candidate of [
    'Uswap2026!Demo',
    'Demo1234!',
    'uswap2026!Demo',
    'Uswap2026!',
  ]) {
    const ok = await bcrypt.compare(candidate, user.password);
    console.log(`  ${candidate} -> ${ok}`);
  }

  await prisma.$disconnect();
})();
