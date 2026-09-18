import { ADMIN_PASSWORD, DB_VERSION, createSeed } from "./seed";
import type { MockDb } from "./types";

const STORAGE_KEY = `uswap.mock.db.v${DB_VERSION}`;
const PLANNING_DATA_RESET_KEY = `uswap.mock.plannings-cleared.v1`;
const ADMIN_ACCESS_REPAIR_KEY = `uswap.mock.admin-access-restored.v1`;

/** Latence simulée : rend visibles les états de chargement des écrans. */
export const MOCK_LATENCY_MS = 150;

let db: MockDb | null = null;

/**
 * Retire un planning et tout le graphe opérationnel qui en dépend.
 * Conserver ces éléments sans leurs occurrences produirait des alertes,
 * pointages et notifications impossibles à ouvrir.
 */
function clearPlanningData(current: MockDb): MockDb {
  current.plannings = [];
  current.occurrences = [];
  current.attendance = [];
  current.absences = [];
  current.changes = [];
  current.notifications = [];
  current.notices = [];
  current.qrTokens = [];
  current.automatedAbsences = [];
  current.notificationSeq = 1;
  return current;
}

/** Réactive le compte principal sans journaliser le mot de passe en clair. */
function restoreAdminAccess(current: MockDb): MockDb {
  const admin = current.users.find(
    (user) => user.id === "us-admin" || user.email.toLowerCase() === "admin@uswap.example.com",
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

/** Base courante : relue depuis le stockage local, sinon recréée. */
export function loadDb(): MockDb {
  if (db) return db;
  const localStorage = storage();
  const raw = localStorage?.getItem(STORAGE_KEY);
  const mustClearExistingPlannings =
    localStorage?.getItem(PLANNING_DATA_RESET_KEY) !== "done";
  const mustRestoreAdmin =
    localStorage?.getItem(ADMIN_ACCESS_REPAIR_KEY) !== "done";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed?.version === DB_VERSION && Array.isArray(parsed.users)) {
        db = parsed;
        if (mustClearExistingPlannings) clearPlanningData(db);
        if (mustRestoreAdmin) restoreAdminAccess(db);
        if (mustClearExistingPlannings || mustRestoreAdmin) {
          saveDb();
        }
        if (mustClearExistingPlannings)
          localStorage?.setItem(PLANNING_DATA_RESET_KEY, "done");
        if (mustRestoreAdmin)
          localStorage?.setItem(ADMIN_ACCESS_REPAIR_KEY, "done");
        return db;
      }
    } catch {
      /* donnée illisible : on repart de la graine */
    }
  }
  // Une nouvelle maquette démarre volontairement sans planning : l'utilisateur
  // crée ensuite ses propres périodes depuis l'interface.
  db = restoreAdminAccess(clearPlanningData(createSeed(Date.now())));
  saveDb();
  localStorage?.setItem(PLANNING_DATA_RESET_KEY, "done");
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

/** Réinitialise la maquette (démonstration, recette). */
export function resetDb(): MockDb {
  db = restoreAdminAccess(clearPlanningData(createSeed(Date.now())));
  saveDb();
  return db;
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (typeof window !== "undefined") {
  (window as unknown as { uswapMock?: { reset: () => MockDb } }).uswapMock = {
    reset: resetDb,
  };
}
