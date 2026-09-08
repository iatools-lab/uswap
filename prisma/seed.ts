import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_SEED_EMAIL ?? 'admin@upowa.org').trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error('ADMIN_SEED_PASSWORD doit être défini et contenir au moins 12 caractères.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Le compte admin existe déjà, rien à faire.');
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      fullName: 'Administrateur Uswap',
      email,
      password: hashedPassword,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log(`Compte administrateur créé : ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
