import { ADMIN_PASSWORD, DB_VERSION, createSeed } from "./seed";
import type { MockDb } from "./types";

const STORAGE_KEY = `uswap.mock.db.v${DB_VERSION}`;
const ADMIN_ACCESS_REPAIR_KEY = `uswap.mock.admin-access-restored.v1`;

/** Latence simulée : rend visibles les états de chargement des écrans. */
export const MOCK_LATENCY_MS = 150;

let db: MockDb | null = null;

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
  const mustRestoreAdmin =
    localStorage?.getItem(ADMIN_ACCESS_REPAIR_KEY) !== "done";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed?.version === DB_VERSION && Array.isArray(parsed.users)) {
        db = parsed;
        if (mustRestoreAdmin) restoreAdminAccess(db);
        if (mustRestoreAdmin) {
          saveDb();
        }
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

/** Réinitialise la maquette (démonstration, recette). */
export function resetDb(): MockDb {
  db = restoreAdminAccess(createSeed(Date.now()));
  saveDb();
  return db;
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (typeof window !== "undefined") {
  (window as unknown as { uswapMock?: { reset: () => MockDb } }).uswapMock = {
    reset: resetDb,
  };
}
