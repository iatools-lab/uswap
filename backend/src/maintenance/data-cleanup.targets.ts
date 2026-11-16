import type { Prisma } from '@prisma/client';

/**
 * Catalogue des nettoyages proposes au super administrateur.
 *
 * Il est separe du service pour que les tests puissent verifier la definition
 * des cibles (et l'ORDRE de suppression) sans demarrer Nest ni se connecter a
 * une base.
 */

export type CleanupTarget =
  | 'PLANNINGS'
  | 'ATTENDANCE'
  | 'LEAVES'
  | 'INCIDENTS'
  | 'NOTIFICATIONS'
  | 'AUDIT'
  | 'ACCOUNTS'
  | 'STATIONS'
  | 'DEMO_ACCOUNTS';

/**
 * Client Prisma ou client transactionnel : les deux exposent les modeles.
 *
 * Toutes les ecritures passent par `$transaction` : les cibles recoivent donc
 * un `Prisma.TransactionClient`, qui n'a pas les methodes de cycle de vie
 * (`$connect`, `$disconnect`, `$transaction`) — d'ou le type restreint.
 */
export type Db = Prisma.TransactionClient;

export interface TargetDefinition {
  id: CleanupTarget;
  label: string;
  description: string;
  /** Action irreversible : toujours signalee dans l'interface. */
  destructive: boolean;
  count: (prisma: Db) => Promise<number>;
  /**
   * Supprime les enregistrements. `keepIds` contient au minimum l'acteur :
   * un super administrateur ne doit jamais pouvoir effacer son propre compte
   * et se retrouver hors de l'application.
   */
  purge: (prisma: Db, keepIds: string[]) => Promise<number>;
  /**
   * La cible supprime-t-elle des comptes ou des stations ? Une suppression
   * reelle de ces objets est signalee comme sensible dans l'ecran de
   * maintenance et exige une confirmation supplementaire.
   */
  sensitive?: boolean;
}

const EMAIL_DEMO_PATTERN = /@(uswap\.local|example\.(com|org)|upowa\.org)$/i;

/**
 * Ordre de purge, impose par les cles etrangeres.
 *
 * Les dependances sont supprimees AVANT leurs parents. L'ordre du tableau est
 * celui des cibles telles qu'exposees a l'interface et a la validation : il ne
 * doit pas etre modifie sans verifier le schema Prisma.
 */
export const CLEANUP_TARGETS: TargetDefinition[] = [
  {
    id: 'PLANNINGS',
    label: 'Plannings et créneaux',
    description:
      'Supprime les plannings, leurs créneaux, affectations, postes vacants et la file de remplacement associée.',
    destructive: true,
    count: (prisma) => prisma.planning.count(),
    purge: async (prisma) => {
      const plannings = await prisma.planning.count();
      await prisma.planningVacancy.deleteMany({});
      await prisma.shiftChange.deleteMany({});
      await prisma.occurrenceAssignment.deleteMany({});
      await prisma.attendance.deleteMany({});
      await prisma.absence.deleteMany({});
      await prisma.automatedAbsence.deleteMany({});
      await prisma.occurrence.deleteMany({});
      await prisma.planningNotice.deleteMany({});
      await prisma.planningRevision.deleteMany({});
      await prisma.planning.deleteMany({});
      return plannings;
    },
  },
  {
    id: 'ATTENDANCE',
    label: 'Pointages et absences',
    description:
      'Efface les relevés de présence, les corrections et les déclarations d’absence justifiées.',
    destructive: true,
    count: (prisma) =>
      Promise.all([
        prisma.attendance.count(),
        prisma.absence.count(),
        prisma.automatedAbsence.count(),
      ]).then(
        ([attendance, absences, automated]) =>
          attendance + absences + automated,
      ),
    purge: async (prisma) => {
      const attendance = await prisma.attendance.deleteMany({});
      const absences = await prisma.absence.deleteMany({});
      const automated = await prisma.automatedAbsence.deleteMany({});
      return attendance.count + absences.count + automated.count;
    },
  },
  {
    id: 'LEAVES',
    label: 'Congés',
    description:
      'Supprime les demandes de congé, leur file de synchronisation, les soldes annuels et leurs pièces jointes.',
    destructive: true,
    count: (prisma) =>
      Promise.all([prisma.leave.count(), prisma.leaveBalance.count()]).then(
        ([leaves, balances]) => leaves + balances,
      ),
    purge: async (prisma) => {
      const sync = await prisma.leaveSyncOperation.deleteMany({});
      const balances = await prisma.leaveBalance.deleteMany({});
      const leaves = await prisma.leave.deleteMany({});
      return sync.count + balances.count + leaves.count;
    },
  },
  {
    id: 'INCIDENTS',
    label: 'Incidents',
    description: 'Supprime les incidents et leur historique de traitement.',
    destructive: true,
    count: (prisma) => prisma.incident.count(),
    purge: async (prisma) => {
      const actions = await prisma.incidentAction.deleteMany({});
      const incidents = await prisma.incident.deleteMany({});
      return actions.count + incidents.count;
    },
  },
  {
    id: 'NOTIFICATIONS',
    label: 'Notifications',
    description:
      'Vide les boîtes de réception, le journal de livraison (e-mail, push, SMS) et les préférences.',
    destructive: true,
    count: (prisma) =>
      Promise.all([prisma.notification.count(), prisma.emailLog.count()]).then(
        ([notifications, mails]) => notifications + mails,
      ),
    purge: async (prisma) => {
      const deliveries = await prisma.notificationDelivery.deleteMany({});
      const notifications = await prisma.notification.deleteMany({});
      const mails = await prisma.emailLog.deleteMany({});
      await prisma.notificationPreference.deleteMany({});
      await prisma.pushSubscription.deleteMany({});
      return deliveries.count + notifications.count + mails.count;
    },
  },
  {
    id: 'AUDIT',
    label: 'Journal d’audit',
    description:
      'Efface les traces d’exploitation. L’action de nettoyage elle-même est réécrite juste après.',
    destructive: true,
    count: (prisma) => prisma.auditLog.count(),
    purge: async (prisma) => {
      // Tout le journal est efface : c'est le sens de la cible. La trace du
      // nettoyage lui-meme est RÉ-ÉCRITE juste apres par le service (voir
      // `DataCleanupService.run`), donc l'operation reste tracable.
      const result = await prisma.auditLog.deleteMany({});
      return result.count;
    },
  },
  {
    id: 'STATIONS',
    label: 'Stations',
    description:
      'Supprime le réseau : stations, modèles de shift et tout ce qui en dépend (plannings, pointages, incidents, rapports). Le compte suppresseur, s’il est rattaché à une station, est détaché.',
    destructive: true,
    sensitive: true,
    count: (prisma) => prisma.station.count(),
    purge: async (prisma, keepIds) => {
      // Les dependances portees par les stations sont retirees d'abord : le
      // schema cascade sur la plupart, mais `scheduled_reports` et les
      // affectations doivent etre traitees explicitement pour qu'aucune
      // contrainte ne fasse echouer la purge en cours de route.
      await prisma.planningVacancy.deleteMany({});
      await prisma.shiftChange.deleteMany({});
      await prisma.attendance.deleteMany({});
      await prisma.absence.deleteMany({});
      await prisma.automatedAbsence.deleteMany({});
      await prisma.occurrenceAssignment.deleteMany({});
      await prisma.occurrence.deleteMany({});
      await prisma.planningNotice.deleteMany({});
      await prisma.planningRevision.deleteMany({});
      await prisma.planning.deleteMany({});
      await prisma.incidentAction.deleteMany({});
      await prisma.incident.deleteMany({});
      await prisma.reportRun.deleteMany({});
      await prisma.scheduledReport.deleteMany({});
      await prisma.shiftTemplateVersion.deleteMany({});
      await prisma.shiftTemplate.deleteMany({});
      // Un utilisateur conserve son compte : il perd seulement son rattachement.
      await prisma.user.updateMany({
        where: { stationId: { not: null } },
        data: { stationId: null },
      });
      const stations = await prisma.station.deleteMany({
        where: { id: { notIn: keepIds } },
      });
      return stations.count;
    },
  },
  {
    id: 'ACCOUNTS',
    label: 'Comptes utilisateurs',
    description:
      'Supprime définitivement les comptes (swappeurs, superviseurs, administrateurs) et tout leur historique : plannings, pointages, congés, incidents, notifications, journal d’audit. Le compte du super administrateur qui lance l’opération est toujours conservé.',
    destructive: true,
    sensitive: true,
    count: (prisma) => prisma.user.count(),
    purge: async (prisma, keepIds) => {
      const users = await prisma.user.findMany({
        where: { id: { notIn: keepIds } },
        select: { id: true },
      });
      if (!users.length) return 0;
      const ids = users.map((user) => user.id);

      // Ecritures qui referencent un utilisateur SANS cascade dans le schema :
      // elles doivent partir AVANT les comptes, sinon la suppression echoue sur
      // une violation de cle etrangere (le cas typique en production, ou les
      // donnees reelles sont nombreuses).
      await prisma.importBatch.deleteMany({ where: { actorId: { in: ids } } });
      await prisma.settingsRevision.deleteMany({
        where: { actorId: { in: ids } },
      });
      await prisma.offlineOperation.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.occurrenceAssignment.deleteMany({
        where: {
          OR: [{ userId: { in: ids } }, { assignedById: { in: ids } }],
        },
      });
      await prisma.occurrence.updateMany({
        where: { swapperId: { in: ids } },
        data: { swapperId: null },
      });
      await prisma.occurrence.updateMany({
        where: { supervisorId: { in: ids } },
        data: { supervisorId: null },
      });
      await prisma.planning.updateMany({
        where: { createdById: { in: ids } },
        data: { createdById: null },
      });
      await prisma.planning.updateMany({
        where: { publishedById: { in: ids } },
        data: { publishedById: null },
      });
      await prisma.planningRevision.updateMany({
        where: { actorId: { in: ids } },
        data: { actorId: null },
      });
      await prisma.globalSettings.updateMany({
        where: { updatedById: { in: ids } },
        data: { updatedById: null },
      });
      // Un incident peut perdre son agent affecte : il est supprime avec lui
      // (l'historique n'a plus de sens sans la personne concernee).
      await prisma.incidentAction.deleteMany({
        where: { authorId: { in: ids } },
      });
      await prisma.incident.deleteMany({
        where: {
          OR: [
            { affectedSwapperId: { in: ids } },
            { reporterId: { in: ids } },
            { assigneeId: { in: ids } },
          ],
        },
      });
      await prisma.shiftChange.deleteMany({
        where: { initiatorId: { in: ids } },
      });
      await prisma.absence.deleteMany({ where: { swapperId: { in: ids } } });
      await prisma.leaveSyncOperation.deleteMany({
        where: {
          OR: [{ userId: { in: ids } }, { leave: { swapperId: { in: ids } } }],
        },
      });
      await prisma.leave.deleteMany({ where: { swapperId: { in: ids } } });
      await prisma.leaveBalance.deleteMany({
        where: { swapperId: { in: ids } },
      });
      await prisma.attendance.deleteMany({ where: { swapperId: { in: ids } } });
      await prisma.scheduledReport.deleteMany({
        where: { ownerId: { in: ids } },
      });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });

      // Le reste (comptes d'audit, jetons, sessions, notifications,
      // preferences, abonnements push, tentatives de connexion) est en
      // cascade sur `users` : Prisma les supprime avec le compte.
      const removed = await prisma.user.deleteMany({
        // Exclusion explicite de l'acteur : meme si `keepIds` etait vide par
        // erreur d'appel, un super administrateur ne peut pas supprimer son
        // propre compte et se retrouver hors de l'application.
        where: { id: { in: ids, notIn: keepIds } },
      });
      return removed.count;
    },
  },
  {
    id: 'DEMO_ACCOUNTS',
    label: 'Comptes de démonstration',
    description:
      'Désactive les comptes de démonstration (adresses @upowa.org, @example.*, @uswap.local) en conservant leur historique. Aucun compte n’est supprimé.',
    destructive: false,
    count: (prisma) =>
      prisma.user
        .findMany({ select: { email: true, isActive: true, disabledAt: true } })
        .then(
          (users) =>
            users.filter(
              (user) => EMAIL_DEMO_PATTERN.test(user.email) && !user.disabledAt,
            ).length,
        ),
    purge: async (prisma, keepIds) => {
      const users = await prisma.user.findMany({
        select: { id: true, email: true },
      });
      const demoIds = users
        .filter((user) => EMAIL_DEMO_PATTERN.test(user.email))
        .map((user) => user.id)
        .filter((id) => !keepIds.includes(id));
      if (!demoIds.length) return 0;
      await prisma.refreshToken.deleteMany({
        where: { userId: { in: demoIds } },
      });
      await prisma.user.updateMany({
        where: { id: { in: demoIds } },
        data: { isActive: false, disabledAt: new Date() },
      });
      return demoIds.length;
    },
  },
];

/**
 * Ordre d'execution impose par les dependances metier : une cible plus
 * « profonde » passe d'abord. `ACCOUNTS` avant `STATIONS` evite qu'un compte
 * supprime ne laisse une affectation orpheline sur une station deja detruite ;
 * `AUDIT` passe en dernier pour conserver la trace du nettoyage.
 */
export const PURGE_ORDER: CleanupTarget[] = [
  'PLANNINGS',
  'ATTENDANCE',
  'LEAVES',
  'INCIDENTS',
  'NOTIFICATIONS',
  'ACCOUNTS',
  'STATIONS',
  'DEMO_ACCOUNTS',
  'AUDIT',
];
