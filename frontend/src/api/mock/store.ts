import { ADMIN_PASSWORD, DB_VERSION, createSeed } from "./seed";
import type { MockDb, MockIncident, MockLeave, MockUser } from "./types";
import { assertDbInvariants } from "./invariants";

const STORAGE_KEY = `uswap.mock.db.v${DB_VERSION}`;
const LEGACY_STORAGE_KEYS = Array.from(
  { length: DB_VERSION - 1 },
  (_, index) => `uswap.mock.db.v${DB_VERSION - 1 - index}`,
);
const ADMIN_ACCESS_REPAIR_KEY = `uswap.mock.admin-access-restored.v1`;
const DAY_MS = 86_400_000;

function utcDay(iso: string | number): number {
  const date = new Date(iso);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Le solde simulé et son historique doivent toujours raconter la même chose. */
function ensureConsumedLeaveHistory(current: MockDb): MockDb {
  const now = Date.now();
  const today = utcDay(now);
  const leaves = [...current.leaves];

  current.leaveBalances.forEach((balance, index) => {
    const yearStart = Date.UTC(balance.year, 0, 1);
    const yearEnd = Date.UTC(balance.year + 1, 0, 1) - DAY_MS;
    const consumedDays = leaves
      .filter(
        (leave) =>
          leave.swapperId === balance.swapperId &&
          leave.status === "APPROVED" &&
          Date.parse(leave.endTime) < now,
      )
      .reduce((total, leave) => {
        const start = Math.max(utcDay(leave.startTime), yearStart);
        const end = Math.min(utcDay(leave.endTime), yearEnd, today);
        return end >= start ? total + (end - start) / DAY_MS + 1 : total;
      }, 0);
    const missingDays = Math.max(0, balance.usedDays - consumedDays);
    if (!missingDays) return;

    let end = today - (14 + index * 2) * DAY_MS;
    let start = end - (missingDays - 1) * DAY_MS;
    while (start >= yearStart) {
      const overlap = leaves.find((leave) => {
        if (
          leave.swapperId !== balance.swapperId ||
          leave.status !== "APPROVED"
        )
          return false;
        const leaveStart = utcDay(leave.startTime);
        const leaveEnd = utcDay(leave.endTime);
        return start <= leaveEnd && end >= leaveStart;
      });
      if (!overlap) break;
      end = utcDay(overlap.startTime) - DAY_MS;
      start = end - (missingDays - 1) * DAY_MS;
    }
    if (start < yearStart || end >= today) return;

    const periodStart = new Date(start).toISOString();
    const periodEnd = new Date(end).toISOString();
    const createdAt = new Date(start - 21 * DAY_MS).toISOString();
    leaves.push({
      id: `leave-consumed-${balance.swapperId}`,
      swapperId: balance.swapperId,
      startTime: periodStart,
      endTime: periodEnd,
      type: "ANNUAL",
      status: "APPROVED",
      reason: "Congé pris et validé par l’administration.",
      attachmentId: null,
      externalId: `LV-HIST-${balance.swapperId}`,
      clientRef: `leave-history-${balance.swapperId}`,
      createdAt,
      updatedAt: periodEnd,
      submittedAt: createdAt,
      decidedAt: new Date(start - 7 * DAY_MS).toISOString(),
      decisionReason: "Période approuvée par l’administration.",
      cancellable: false,
      editable: false,
    } satisfies MockLeave);
  });

  return { ...current, leaves };
}

/** Latence simulée : rend visibles les états de chargement des écrans. */
export const MOCK_LATENCY_MS = 150;

let db: MockDb | null = null;

/** Réactive le compte principal sans journaliser le mot de passe en clair. */
function restoreAdminAccess(current: MockDb): MockDb {
  const admin = current.users.find(
    (user) =>
      user.id === "us-admin" ||
      user.email.toLowerCase() === "admin@uswap.example.com",
  );
  if (!admin) return current;
  const now = new Date().toISOString();
  const before = { isActive: admin.isActive, disabledAt: admin.disabledAt };
  admin.isActive = true;
  admin.disabledAt = null;
  admin.password = ADMIN_PASSWORD;
  admin.invitationStatus = "ACTIVATED";
  admin.invitationExpiresAt = null;
  admin.updatedAt = now;
  admin.audit.push({
    id: `aud-admin-restored-${Date.now()}`,
    action: "ACCOUNT_REACTIVATED",
    createdAt: now,
    before,
    after: { isActive: true, disabledAt: null, passwordUpdated: true },
  });
  return current;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Un incident de démonstration n'est réutilisable que si son déclarant et le
 * swappeur concerné existent toujours. Une affectation ponctuelle dans une
 * autre station doit rester dans l'historique même après sa fin.
 */
function incidentFitsCurrentScope(
  incident: MockIncident,
  users: MockUser[],
  stationIds: Set<string>,
): boolean {
  const reporter = users.find((item) => item.id === incident.reporterId);
  const affectedSwapper = users.find(
    (item) => item.id === incident.affectedSwapperId,
  );
  return Boolean(
    stationIds.has(incident.stationId) &&
    reporter?.role === "SUPERVISOR" &&
    affectedSwapper?.role === "SWAPPER",
  );
}

/** Conserve le planning de test et l'historique publié nécessaire à la démo. */
function retainTestPlanning(current: MockDb): MockDb {
  const source =
    current.plannings.find(
      (item) => item.name?.trim().toLocaleLowerCase("fr") === "test",
    ) ??
    current.plannings.find((item) => item.id === "pl-courant") ??
    current.plannings.find((item) => item.status === "PUBLISHED") ??
    current.plannings[0];

  const history = current.plannings.find(
    (item) => item.id === "pl-historique" && item.status === "PUBLISHED",
  );

  if (!source) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const retained = {
      id: "pl-test",
      name: "Test",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: "DRAFT" as const,
      revision: 1,
      createdAt: now.toISOString(),
      publishedAt: null,
    };
    const retainedPlans = [retained, ...(history ? [history] : [])];
    const planningIds = new Set(retainedPlans.map((item) => item.id));
    const retainedOccurrences = current.occurrences.filter((item) =>
      planningIds.has(item.planningId),
    );
    const retainedShiftIds = new Set(
      retainedOccurrences.map((item) => item.id),
    );
    return {
      ...current,
      plannings: retainedPlans,
      occurrences: retainedOccurrences,
      attendance: current.attendance.filter((item) =>
        retainedShiftIds.has(item.shiftId),
      ),
      absences: current.absences.filter((item) =>
        retainedShiftIds.has(item.shiftId),
      ),
      changes: current.changes.filter((item) =>
        retainedShiftIds.has(item.shiftId),
      ),
      automatedAbsences: current.automatedAbsences.filter((id) =>
        retainedShiftIds.has(id),
      ),
      notices: current.notices.filter((item) =>
        planningIds.has(item.planningId),
      ),
      notifications: current.notifications.filter(
        (item) => !item.targetId || retainedShiftIds.has(item.targetId),
      ),
    };
  }

  const retained = { ...source, name: "Test" };
  const retainedPlans = [
    retained,
    ...(history && history.id !== retained.id ? [history] : []),
  ];
  const planningIds = new Set(retainedPlans.map((item) => item.id));
  const retainedOccurrences = current.occurrences.filter((item) =>
    planningIds.has(item.planningId),
  );
  const retainedShiftIds = new Set(retainedOccurrences.map((item) => item.id));
  const removedIds = new Set([
    ...current.plannings
      .filter((item) => !planningIds.has(item.id))
      .map((item) => item.id),
    ...current.occurrences
      .filter((item) => !planningIds.has(item.planningId))
      .map((item) => item.id),
  ]);

  return {
    ...current,
    plannings: retainedPlans,
    occurrences: retainedOccurrences,
    attendance: current.attendance.filter((item) =>
      retainedShiftIds.has(item.shiftId),
    ),
    absences: current.absences.filter((item) =>
      retainedShiftIds.has(item.shiftId),
    ),
    changes: current.changes.filter((item) =>
      retainedShiftIds.has(item.shiftId),
    ),
    automatedAbsences: current.automatedAbsences.filter((id) =>
      retainedShiftIds.has(id),
    ),
    notices: current.notices.filter((item) => planningIds.has(item.planningId)),
    notifications: current.notifications.filter(
      (item) => !item.targetId || !removedIds.has(item.targetId),
    ),
  };
}

/**
 * Met à niveau une base locale sans effacer les plannings et pointages déjà
 * créés. Les nouvelles collections du sprint 4 viennent de la graine, tandis
 * que toutes les collections existantes restent celles de l'utilisateur.
 */
function migrateDb(candidate: unknown): MockDb | null {
  if (!candidate || typeof candidate !== "object") return null;
  const previous = candidate as Partial<MockDb>;
  if (!Array.isArray(previous.users) || !Array.isArray(previous.stations))
    return null;

  const seed = createSeed(Date.now());
  const currentUsers = previous.users.map((item) =>
    (item as MockUser).role === ("STATION_CHIEF" as MockUser["role"])
      ? { ...(item as MockUser), role: "SUPERVISOR" as const, stationId: null }
      : (item as MockUser),
  );
  const currentStations = previous.stations.map((item) => ({
    ...item,
    geofenceRadiusMeters:
      Number((item as MockDb["stations"][number]).geofenceRadiusMeters) || 150,
  }));
  const activeStationIds = new Set(
    currentStations
      .filter((station) => station.isActive)
      .map((station) => station.id),
  );
  const existingUserIds = new Set(currentUsers.map((item) => item.id));
  const addedSeedSwappers = seed.users.filter(
    (item) =>
      item.role === "SWAPPER" &&
      item.isActive &&
      !existingUserIds.has(item.id) &&
      item.stationId !== null &&
      activeStationIds.has(item.stationId),
  );
  const previousLeaves = (previous.leaves ?? []).map((leave) => {
    const seedLeave = seed.leaves.find((item) => item.id === leave.id);
    return seedLeave
      ? {
          ...leave,
          startTime: seedLeave.startTime,
          endTime: seedLeave.endTime,
        }
      : leave;
  });
  const previousLeaveBalances = previous.leaveBalances ?? [];
  const previousNotificationPreferences =
    previous.notificationPreferences ?? [];
  const sprint4DemoLeaves = seed.leaves.filter(
    (item) =>
      item.id.startsWith("leave-") &&
      !previousLeaves.some((saved) => saved.id === item.id),
  );
  const previousLeaveOperations = previous.leaveSyncOperations ?? [];
  const currentStationIds = new Set(currentStations.map((item) => item.id));
  const previousIncidents = (previous.incidents ?? []).filter((incident) =>
    incidentFitsCurrentScope(incident, currentUsers, currentStationIds),
  );
  const compatibleSeedIncidents = seed.incidents.filter((incident) =>
    incidentFitsCurrentScope(incident, currentUsers, currentStationIds),
  );
  const { qrTokens: _obsoleteQrTokens, ...previousWithoutQr } =
    previous as Partial<MockDb> & { qrTokens?: unknown };
  const migrated = {
    ...seed,
    ...previousWithoutQr,
    version: DB_VERSION,
    // Garde le planning Test local tout en ajoutant une vraie période publiée
    // terminée pour que l'archive swappeur soit testable après migration.
    plannings: [
      ...(previous.plannings ?? []),
      ...seed.plannings.filter(
        (item) =>
          item.id === "pl-historique" &&
          !(previous.plannings ?? []).some((saved) => saved.id === item.id),
      ),
    ],
    occurrences: [
      ...(previous.occurrences ?? []),
      ...seed.occurrences.filter(
        (item) =>
          item.planningId === "pl-historique" &&
          !(previous.occurrences ?? []).some((saved) => saved.id === item.id),
      ),
    ],
    // Ajoute les nouveaux profils fictifs sans écraser les comptes locaux :
    // les plannings, pointages et préférences déjà enregistrés les conservent.
    users: [...currentUsers, ...addedSeedSwappers],
    leaveBalances: [
      ...previousLeaveBalances,
      ...seed.leaveBalances.filter(
        (item) =>
          !previousLeaveBalances.some(
            (saved) => saved.swapperId === item.swapperId,
          ),
      ),
    ],
    leaveSyncOperations: [
      ...previousLeaveOperations,
      ...seed.leaveSyncOperations.filter(
        (item) =>
          !previousLeaveOperations.some((saved) => saved.id === item.id),
      ),
    ],
    incidents: [
      ...previousIncidents,
      ...compatibleSeedIncidents.filter(
        (item) => !previousIncidents.some((saved) => saved.id === item.id),
      ),
    ],
    notificationPreferences: [
      ...previousNotificationPreferences,
      ...seed.notificationPreferences.filter(
        (item) =>
          !previousNotificationPreferences.some(
            (saved) => saved.userId === item.userId,
          ),
      ),
    ],
    scheduledReports: previous.scheduledReports ?? [],
    globalSettings: previous.globalSettings ?? seed.globalSettings,
    settingsHistory: previous.settingsHistory ?? [],
    offlineOperations: previous.offlineOperations ?? [],
    leaves: [...previousLeaves, ...sprint4DemoLeaves].map((leave, index) => ({
      ...leave,
      type: leave.type ?? "OTHER",
      attachmentId: leave.attachmentId ?? null,
      externalId: leave.externalId ?? null,
      clientRef: leave.clientRef ?? `leave-migrated-${leave.id ?? index}`,
      createdAt:
        leave.createdAt ??
        seed.leaves[0]?.createdAt ??
        new Date().toISOString(),
      updatedAt:
        leave.updatedAt ??
        seed.leaves[0]?.updatedAt ??
        new Date().toISOString(),
      submittedAt: leave.submittedAt ?? null,
      decidedAt: leave.decidedAt ?? null,
      decisionReason: leave.decisionReason ?? null,
      cancellable: leave.cancellable ?? leave.status === "PENDING",
      editable: leave.editable ?? leave.status === "PENDING",
    })),
  } as MockDb;

  return ensureConsumedLeaveHistory(retainTestPlanning(migrated));
}

/** Base courante : relue depuis le stockage local, sinon recréée. */
export function loadDb(): MockDb {
  if (db) return db;
  const localStorage = storage();
  const sourceKey = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].find((key) =>
    localStorage?.getItem(key),
  );
  const raw = sourceKey ? localStorage?.getItem(sourceKey) : null;
  const mustRestoreAdmin =
    localStorage?.getItem(ADMIN_ACCESS_REPAIR_KEY) !== "done";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const migrated = migrateDb(parsed);
      if (migrated) {
        if (mustRestoreAdmin) restoreAdminAccess(migrated);
        // Une donnée locale incohérente est détectée pendant la migration,
        // avant qu'une action comme la connexion ne tente de la valider.
        assertDbInvariants(migrated);
        db = migrated;
        saveDb();
        if (sourceKey && sourceKey !== STORAGE_KEY)
          localStorage?.removeItem(sourceKey);
        if (mustRestoreAdmin)
          localStorage?.setItem(ADMIN_ACCESS_REPAIR_KEY, "done");
        return db;
      }
    } catch {
      /* donnée illisible : on repart de la graine */
    }
  }
  // Le jeu initial contient un planning publié cohérent pour tester les parcours
  // pointage, absence et remplacement dès la première ouverture.
  db = ensureConsumedLeaveHistory(
    restoreAdminAccess(retainTestPlanning(createSeed(Date.now()))),
  );
  saveDb();
  localStorage?.setItem(ADMIN_ACCESS_REPAIR_KEY, "done");
  return db;
}

export function saveDb(): void {
  if (!db) return;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota dépassé ou navigation privée : la maquette reste en mémoire */
  }
}

/** Commit atomique d'une transaction simulée. */
export function replaceDb(next: MockDb): void {
  assertDbInvariants(next);
  db = next;
  saveDb();
}

/** Réinitialise la maquette (démonstration, recette). */
export function resetDb(): MockDb {
  db = ensureConsumedLeaveHistory(
    restoreAdminAccess(retainTestPlanning(createSeed(Date.now()))),
  );
  saveDb();
  return db;
}

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

if (typeof window !== "undefined") {
  (window as unknown as { uswapMock?: { reset: () => MockDb } }).uswapMock = {
    reset: resetDb,
  };
}
