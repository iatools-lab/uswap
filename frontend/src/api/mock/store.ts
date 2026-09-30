import { DB_VERSION, createSeed } from "./seed";
import type { MockDb } from "./types";

const STORAGE_KEY = `uswap.mock.db.v${DB_VERSION}`;

/** Latence simulée : rend visibles les états de chargement des écrans. */
export const MOCK_LATENCY_MS = 150;

let db: MockDb | null = null;

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
  const raw = storage()?.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed?.version === DB_VERSION && Array.isArray(parsed.users)) {
        db = parsed;
        return db;
      }
    } catch {
      /* donnée illisible : on repart de la graine */
    }
  }
  db = createSeed(Date.now());
  saveDb();
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
  db = createSeed(Date.now());
  saveDb();
  return db;
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (typeof window !== "undefined") {
  (window as unknown as { uswapMock?: { reset: () => MockDb } }).uswapMock = {
    reset: resetDb,
  };
}
