/**
 * Remet la base dans un état propre pour rejouer un cycle de test.
 * Ne supprime QUE les absences de recette (jamais les données métier réelles).
 *
 *   node scripts/reset-qa.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const before = await prisma.absence.findMany({
  select: { id: true, status: true, origin: true, reason: true },
});
console.log('absences présentes :', before.length);
for (const a of before) {
  console.log(`  ${a.status.padEnd(9)} ${a.origin.padEnd(12)} ${a.reason}`);
}

const deleted = await prisma.absence.deleteMany({
  where: {
    OR: [
      {
        reason: {
          in: [
            'maladie',
            'Test cycle validation absence',
            'Indisponibilité test QA',
          ],
        },
      },
      // Absence générée automatiquement sur un créneau de recette : elle ne
      // reflète aucune situation réelle et bloque tout nouveau test.
      { origin: 'AUTOMATIC_ABSENCE' },
    ],
  },
});
console.log('absences de recette supprimées :', deleted.count);

await prisma.$disconnect();
