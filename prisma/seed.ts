import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@upowa.org';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Le compte admin existe deja, rien a faire.');
    return;
  }

  const hashedPassword = await bcrypt.hash('ChangeMoiRapidement123', 10);

  await prisma.user.create({
    data: {
      fullName: 'Administrateur Uswap',
      email,
      password: hashedPassword,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Compte administrateur cree : ' + email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());