/**
 * Remise a zero des donnees d'exploitation (avant mise en service).
 *
 * Usage (depuis backend_new/) :
 *   npm run db:reset              -> simule et affiche les volumes
 *   npm run db:reset -- --confirm -> supprime reellement
 *
 * Ce que le script NE supprime PAS :
 *  - les comptes `@gmail.com` (comptes reels : super administrateur compris) ;
 *  - les stations, modeles de shift et reglages globaux (referentiel).
 *
 * Il supprime en revanche TOUT ce qui a ete produit par les tests :
 * plannings, services, affectations, pointages, absences, conges, incidents,
 * notifications et leurs journaux, rapports programmes, sessions, jetons,
 * journaux d'audit et comptes de recette (`@upowa.org`, `@uswap.test`,
 * `@uswap.local`, `@example.*`).
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();
const confirm = process.argv.includes('--confirm');

/** Domaines des comptes de demonstration/recette a supprimer. */
const DEMO_DOMAINS = [
  '@upowa.org',
  '@uswap.test',
  '@uswap.local',
  '@example.com',
  '@example.org',
];

const isDemoAccount = (email: string) =>
  DEMO_DOMAINS.some((domain) => email.toLowerCase().endsWith(domain));

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const demoUsers = users.filter((user) => isDemoAccount(user.email));
  const keptUsers = users.filter((user) => !isDemoAccount(user.email));

  const volumes = {
    pointages: await prisma.attendance.count(),
    absences: await prisma.absence.count(),
    conges: await prisma.leave.count(),
    incidents: await prisma.incident.count(),
    services: await prisma.occurrence.count(),
    plannings: await prisma.planning.count(),
    notifications: await prisma.notification.count(),
    emailsJournalises: await prisma.emailLog.count(),
    rapportsProgrammes: await prisma.scheduledReport.count(),
    sessions: await prisma.refreshToken.count(),
    comptesSupprimes: demoUsers.length,
    comptesConserves: keptUsers.length,
  };

  console.log('Volumes concernes :');
  for (const [label, value] of Object.entries(volumes)) {
    console.log(`  ${label.padEnd(22)} ${value}`);
  }
  console.log('\nComptes conserves (reels) :');
  for (const user of keptUsers) console.log(`  ${user.email}`);
  console.log('\nComptes de test supprimes :');
  for (const user of demoUsers) console.log(`  ${user.email}`);

  if (!confirm) {
    console.log(
      '\nSimulation uniquement. Relancez avec --confirm pour supprimer reellement.',
    );
    return;
  }

  const demoIds = demoUsers.map((user) => user.id);

  // Ordre impose par les cles etrangeres : du plus profond au plus haut.
  await prisma.$transaction([
    prisma.attendanceCorrection.deleteMany({}),
    prisma.automatedAbsence.deleteMany({}),
    prisma.absence.deleteMany({}),
    prisma.attendance.deleteMany({}),
    prisma.incidentAction.deleteMany({}),
    prisma.incident.deleteMany({}),
    prisma.leave.deleteMany({}),
    prisma.leaveSyncOperation.deleteMany({}),
    prisma.shiftChange.deleteMany({}),
    prisma.planningVacancy.deleteMany({}),
    prisma.occurrenceAssignment.deleteMany({}),
    prisma.occurrence.deleteMany({}),
    prisma.planningRevision.deleteMany({}),
    prisma.planning.deleteMany({}),
    prisma.reportRun.deleteMany({}),
    prisma.scheduledReport.deleteMany({}),
    prisma.notificationDelivery.deleteMany({}),
    prisma.notification.deleteMany({}),
    prisma.pushSubscription.deleteMany({}),
    prisma.emailLog.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.idempotencyKey.deleteMany({}),
    prisma.loginAttempt.deleteMany({}),
    prisma.invitationToken.deleteMany({}),
    prisma.refreshToken.deleteMany({}),
  ]);

  // Comptes de test : leurs donnees personnelles partent avec eux.
  if (demoIds.length) {
    await prisma.accountAudit.deleteMany({ where: { userId: { in: demoIds } } });
    await prisma.notificationPreference.deleteMany({
      where: { userId: { in: demoIds } },
    });
    await prisma.leaveBalance.deleteMany({ where: { swapperId: { in: demoIds } } });
    await prisma.user.deleteMany({ where: { id: { in: demoIds } } });
  }

  console.log('\nPurge terminee.');
}

main()
  .catch((error) => {
    console.error('Purge impossible :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
