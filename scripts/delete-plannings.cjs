/**
 * Supprime les plannings demandés (et tout ce qui en dépend) de la base.
 *
 * Les shifts d'un planning entraînent `Attendance`, `ShiftChange` et
 * `ReplacementRequest`. On supprime donc explicitement ces dépendances avant
 * les shifts, puis le planning lui-même.
 *
 * Usage :
 *   node scripts/delete-plannings.cjs <id> [<id> ...]   # supprime les ids listés
 *   node scripts/delete-plannings.cjs --all             # supprime TOUS les plannings
 *   node scripts/delete-plannings.cjs --all --dry-run   # affiche sans supprimer
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv/config');

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const ids = args.filter((value) => !value.startsWith('--'));

  let targets;
  if (all) {
    targets = await prisma.planning.findMany({
      select: { id: true, startDate: true, endDate: true, status: true },
      orderBy: { startDate: 'asc' },
    });
  } else {
    if (!ids.length) {
      console.error('Indiquez au moins un identifiant de planning, ou --all.');
      process.exitCode = 1;
      return;
    }
    targets = await prisma.planning.findMany({
      where: { id: { in: ids } },
      select: { id: true, startDate: true, endDate: true, status: true },
    });
    if (targets.length !== ids.length) {
      console.warn(
        `Attention : ${ids.length - targets.length} identifiant(s) introuvable(s).`,
      );
    }
  }

  if (!targets.length) {
    console.log('Aucun planning à supprimer.');
    return;
  }

  const planningIds = targets.map((row) => row.id);
  const shifts = await prisma.shift.findMany({
    where: { planningId: { in: planningIds } },
    select: { id: true },
  });
  const shiftIds = shifts.map((row) => row.id);

  console.log(`${targets.length} planning(s), ${shiftIds.length} shift(s) à traiter.`);
  for (const row of targets) {
    console.log(
      `  ${row.id} | ${row.status} | ${row.startDate.toISOString().slice(0, 10)} → ${row.endDate
        .toISOString()
        .slice(0, 10)}`,
    );
  }

  if (dryRun) {
    console.log('--dry-run : rien n’a été supprimé.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (shiftIds.length) {
      await tx.replacementRequest.deleteMany({ where: { shiftId: { in: shiftIds } } });
      await tx.shiftChange.deleteMany({ where: { shiftId: { in: shiftIds } } });
      await tx.attendance.deleteMany({ where: { shiftId: { in: shiftIds } } });
      await tx.shift.deleteMany({ where: { id: { in: shiftIds } } });
    }
    // Avis et notifications rattachés au planning.
    await tx.notification.deleteMany({
      where: { entityId: { in: planningIds }, kind: 'SHIFT_CHANGED' },
    });
    await tx.planningStation.deleteMany({ where: { planningId: { in: planningIds } } });
    await tx.planning.deleteMany({ where: { id: { in: planningIds } } });
  });

  console.log('Suppression terminée.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
