/**
 * Traite les comptes en attente :
 *  - active les comptes humains legitimes ;
 *  - supprime les comptes de test jetables (nom generique, aucun historique).
 *
 * Mode simulation par defaut. Ajouter --apply pour executer.
 *
 *   node scripts/fix-pending-accounts.cjs           (simulation)
 *   node scripts/fix-pending-accounts.cjs --apply   (execution)
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const PASSWORD = process.env.DEMO_PASSWORD || 'Uswap2026!Demo';

/** Comptes de test crees automatiquement, sans valeur fonctionnelle. */
const isDisposable = (user) =>
  /^demo\.user\.\d+@/.test(user.email) ||
  ['test@upowa.org', 'utilisateur@upowa.org', 'utilisation@upowa.org'].includes(
    user.email,
  );

async function dependenciesOf(userId) {
  const [shifts, attendances, leaves, notifications, incidents, plannings, replacements, qrs, changes] =
    await Promise.all([
      prisma.shift.count({ where: { swapperId: userId } }),
      prisma.attendance.count({ where: { swapperId: userId } }),
      prisma.leaveRequest.count({ where: { userId } }),
      prisma.notification.count({ where: { userId } }),
      prisma.incident.count({
        where: {
          OR: [
            { reporterId: userId },
            { assigneeId: userId },
            { affectedSwapperId: userId },
          ],
        },
      }),
      prisma.planning.count({ where: { createdBy: userId } }),
      prisma.replacementRequest.count({
        where: {
          OR: [
            { requestedById: userId },
            { assignedSwapperId: userId },
            { originalSwapperId: userId },
            { assignedById: userId },
          ],
        },
      }),
      prisma.attendanceQr.count({ where: { createdById: userId } }),
      prisma.shiftChange.count({ where: { changedById: userId } }),
    ]);
  return {
    shifts,
    attendances,
    leaves,
    notifications,
    incidents,
    plannings,
    replacements,
    qrs,
    changes,
  };
}

(async () => {
  console.log(`Mode : ${APPLY ? 'EXECUTION' : 'SIMULATION'}${APPLY ? '' : ' (ajouter --apply pour appliquer)'}\n`);

  const pending = await prisma.user.findMany({
    where: { isActive: false, invitationTokenHash: null },
    select: { id: true, email: true, fullName: true, role: true },
    orderBy: { email: 'asc' },
  });

  if (!pending.length) {
    console.log('Aucun compte en attente a traiter.');
    return;
  }

  const toDelete = [];
  const toActivate = [];

  for (const user of pending) {
    const deps = await dependenciesOf(user.id);
    const total = Object.values(deps).reduce((sum, n) => sum + n, 0);
    const disposable = isDisposable(user) && total === 0;
    const record = { user, deps, total };

    if (disposable) toDelete.push(record);
    else toActivate.push(record);
  }

  console.log('=== A ACTIVER ===');
  for (const { user, total } of toActivate) {
    console.log(`  ${user.role.padEnd(14)} ${user.email.padEnd(36)} ${user.fullName}  (historique: ${total})`);
  }

  console.log('\n=== A SUPPRIMER (comptes de test, aucun historique) ===');
  for (const { user } of toDelete) {
    console.log(`  ${user.role.padEnd(14)} ${user.email.padEnd(36)} ${user.fullName}`);
  }

  if (!APPLY) {
    console.log(`\nSimulation : ${toActivate.length} activation(s), ${toDelete.length} suppression(s).`);
    return;
  }

  const hash = await bcrypt.hash(PASSWORD, 12);

  for (const { user } of toActivate) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive: true,
        password: hash,
        invitationTokenHash: null,
        invitationTokenExpires: null,
      },
    });
  }

  for (const { user } of toDelete) {
    await prisma.user.delete({ where: { id: user.id } }).catch((error) => {
      console.log(`  ignoré ${user.email}: ${error.message.slice(0, 80)}`);
    });
  }

  console.log(`\nTermine : ${toActivate.length} compte(s) active(s), ${toDelete.length} supprime(s).`);
  if (toActivate.length) {
    console.log(`Mot de passe applique : ${PASSWORD}`);
  }
})()
  .catch((error) => {
    console.error('Erreur :', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
