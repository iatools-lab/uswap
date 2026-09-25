import { ADMIN_PASSWORD, DB_VERSION, createSeed } from "./seed";
import type { MockDb } from "./types";
import { assertDbInvariants } from "./invariants";

const STORAGE_KEY = `uswap.mock.db.v${DB_VERSION}`;
const LEGACY_STORAGE_KEYS = Array.from(
  { length: DB_VERSION - 1 },
  (_, index) => `uswap.mock.db.v${DB_VERSION - 1 - index}`,
);
const ADMIN_ACCESS_REPAIR_KEY = `uswap.mock.admin-access-restored.v1`;

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
  const previousLeaves = previous.leaves ?? [];
  const sprint4DemoLeaves = seed.leaves.filter(
    (item) =>
      item.id.startsWith("leave-") &&
      !previousLeaves.some((saved) => saved.id === item.id),
  );
  const previousLeaveOperations = previous.leaveSyncOperations ?? [];
  const chiefStations = new Map(
    previous.users
      .filter(
        (item) => item.role === "STATION_CHIEF" && Boolean(item.stationId),
      )
      .map((item) => [item.id, item.stationId]),
  );
  const previousIncidents = (previous.incidents ?? []).filter(
    (incident) =>
      Boolean(incident.affectedSwapperId) &&
      chiefStations.get(incident.reporterId) === incident.stationId,
  );
  const migrated = {
    ...seed,
    ...previous,
    version: DB_VERSION,
    leaveBalances: previous.leaveBalances ?? seed.leaveBalances,
    leaveSyncOperations: [
      ...previousLeaveOperations,
      ...seed.leaveSyncOperations.filter(
        (item) =>
          !previousLeaveOperations.some((saved) => saved.id === item.id),
      ),
    ],
    incidents: [
      ...previousIncidents,
      ...seed.incidents.filter(
        (item) => !previousIncidents.some((saved) => saved.id === item.id),
      ),
    ],
    notificationPreferences:
      previous.notificationPreferences ?? seed.notificationPreferences,
    scheduledReports: previous.scheduledReports ?? [],
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

  return migrated;
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
        db = migrated;
        if (mustRestoreAdmin) restoreAdminAccess(db);
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
  // Le jeu initial contient un planning publié cohérent afin que les parcours
  // QR, pointage, absence et remplacement soient utilisables immédiatement.
  db = restoreAdminAccess(createSeed(Date.now()));
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
  db = restoreAdminAccess(createSeed(Date.now()));
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
