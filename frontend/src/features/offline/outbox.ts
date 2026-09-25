import { api, ApiError } from "../../api/auth-api";

const DB_NAME = "uswap-outbox";
const STORE = "mutations";
const VERSION = 1;

export type QueuedMutation = {
  id: string;
  path: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function enqueue(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<string> {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mutation: QueuedMutation = {
    id,
    path,
    method,
    body,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await withStore("readwrite", (store) => store.put(mutation));
  return id;
}

export async function pending(): Promise<QueuedMutation[]> {
  const rows = await withStore<QueuedMutation[]>("readonly", (store) =>
    store.getAll(),
  );
  return rows ?? [];
}

async function remove(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

async function bump(mutation: QueuedMutation, error: string) {
  await withStore("readwrite", (store) =>
    store.put({
      ...mutation,
      attempts: mutation.attempts + 1,
      lastError: error,
    }),
  );
}

let flushing = false;

/**
 * Rejoue la file locale. Les mutations desynchronisees sont conservees en base
 * locale jusqu'a confirmation du serveur : une coupure reseau ne perd rien.
 */
export async function flush(): Promise<{ sent: number; remaining: number }> {
  if (flushing || navigator.onLine === false) {
    return { sent: 0, remaining: (await pending()).length };
  }
  flushing = true;
  let sent = 0;
  try {
    for (const mutation of await pending()) {
      try {
        await api(
          mutation.path,
          mutation.body,
          mutation.method === "PATCH" ? "PATCH" : undefined,
        );
        await remove(mutation.id);
        sent += 1;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429
        ) {
          // Rejet metier definitif : ne pas boucler indefiniment.
          await remove(mutation.id);
        } else {
          await bump(mutation, (error as Error).message);
        }
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, remaining: (await pending()).length };
}

export function startOutboxSync(onFlushed?: (sent: number) => void) {
  const run = async () => {
    const { sent } = await flush();
    if (sent && onFlushed) onFlushed(sent);
  };
  window.addEventListener("online", run);
  void run();
  const timer = setInterval(run, 60_000);
  return () => {
    window.removeEventListener("online", run);
    clearInterval(timer);
  };
}
