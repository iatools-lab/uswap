/**
 * Crée le solde de congé manquant pour les swappeurs actifs.
 *
 * L'écran de congé calcule les jours disponibles à partir de ce solde : sans
 * ligne, le bouton « Envoyer la demande » restait désactivé.
 *
 * Usage : node scripts/ensure-leave-balances.cjs
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv/config');

const prisma = new PrismaClient();

async function main() {
  const year = new Date().getUTCFullYear();
  const swappers = await prisma.user.findMany({
    where: { role: 'SWAPPER', isActive: true },
    select: { id: true, email: true },
  });

  const existing = await prisma.leaveBalance.findMany({
    select: { swapperId: true, year: true, entitledDays: true },
  });
  const bySwapper = new Map(existing.map((row) => [row.swapperId, row]));

  let created = 0;
  let realigned = 0;
  let fixed = 0;

  for (const swapper of swappers) {
    const balance = bySwapper.get(swapper.id);
    if (!balance) {
      await prisma.leaveBalance.create({
        data: { swapperId: swapper.id, year, entitledDays: 30 },
      });
      created += 1;
      console.log(`créé   : ${swapper.email}`);
      continue;
    }

    if (balance.year !== year) {
      await prisma.leaveBalance.update({
        where: { swapperId: swapper.id },
        data: { year, usedDays: 0, pendingDays: 0, entitledDays: balance.entitledDays > 0 ? balance.entitledDays : 30 },
      });
      realigned += 1;
      console.log(`année  : ${swapper.email} (aligné sur ${year})`);
      continue;
    }

    if (balance.entitledDays <= 0) {
      await prisma.leaveBalance.update({
        where: { swapperId: swapper.id },
        data: { entitledDays: 30 },
      });
      fixed += 1;
      console.log(`droit  : ${swapper.email} (droit porté à 30 jours)`);
    }
  }

  console.log(
    `\n${created} solde(s) créé(s), ${realigned} réaligné(s), ${fixed} droit(s) corrigé(s) sur ${swappers.length} swappeurs actifs.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
