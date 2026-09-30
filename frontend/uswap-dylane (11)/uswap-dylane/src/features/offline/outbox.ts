import { api, ApiError } from "../../api/auth-api";
import {
  createIdempotencyKey,
  exponentialRetryDelay,
} from "../../domain/idempotency";

const DB_NAME = "uswap-outbox";
const STORE = "mutations";
const VERSION = 2;
const CHANGE_EVENT = "uswap:outbox-changed";
const changed = () => window.dispatchEvent(new CustomEvent(CHANGE_EVENT));

export type QueuedMutation = {
  id: string;
  path: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  queuedAt: string;
  idempotencyKey: string;
  status: "QUEUED" | "PROCESSING" | "FAILED";
  attempts: number;
  nextAttemptAt?: string;
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
    idempotencyKey:
      typeof body.clientRef === "string"
        ? body.clientRef
        : createIdempotencyKey(path),
    status: "QUEUED",
    attempts: 0,
  };
  await withStore("readwrite", (store) => store.put(mutation));
  changed();
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
  changed();
}

async function bump(mutation: QueuedMutation, error: string) {
  const attempts = mutation.attempts + 1;
  await withStore("readwrite", (store) =>
    store.put({
      ...mutation,
      status: "FAILED",
      attempts,
      lastError: error,
      nextAttemptAt: new Date(
        Date.now() + exponentialRetryDelay(attempts),
      ).toISOString(),
    }),
  );
  changed();
}

export async function discard(id: string): Promise<void> {
  await remove(id);
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
      if (
        mutation.nextAttemptAt &&
        Date.parse(mutation.nextAttemptAt) > Date.now()
      )
        continue;
      try {
        let body = mutation.body;
        if (
          mutation.path === "/operations/absences" &&
          mutation.body.attachment instanceof File
        ) {
          const form = new FormData();
          form.append("file", mutation.body.attachment);
          const uploaded = await api<{ id: string }>(
            "/operations/absences/attachments",
            form,
          );
          const { attachment: _attachment, ...absence } = mutation.body;
          body = { ...absence, attachmentId: uploaded.id };
        }
        await api(
          mutation.path,
          { ...body, idempotencyKey: mutation.idempotencyKey },
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

export function subscribeOutbox(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
