import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const email = 'admin.demo@upowa.org';

const user = await prisma.user.findUnique({
  where: { email },
  select: { id: true, role: true, isActive: true, disabledAt: true, passwordHash: true },
});

if (!user) {
  console.log('compte absent :', email);
} else {
  const ok = await bcrypt.compare('Uswap2026!Demo', user.passwordHash);
  console.log('compte :', user.role, '| actif :', user.isActive, '| desactive :', !!user.disabledAt);
  console.log('mot de passe attendu valide :', ok);

  if (!ok || !user.isActive || user.disabledAt) {
    const hash = await bcrypt.hash('Uswap2026!Demo', 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, isActive: true, disabledAt: null },
    });
    console.log('-> compte reinitialise');
  }
}

await prisma.$disconnect();
