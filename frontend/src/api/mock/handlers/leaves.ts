import type { LeaveRequestView, LeaveWorkspaceView } from "../../../domain/sprint4";
import { nextId, notifyUser, requireRole, requireUser } from "../shared";
import { isoFromMs } from "../seed";
import { MockHttpError, type MockDb, type MockLeave, type MockRoute } from "../types";

const DAY = 86_400_000;

function daysBetween(start: string, end: string) {
  return Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / DAY) + 1);
}

function latestOperation(db: MockDb, leaveId: string) {
  return db.leaveSyncOperations
    .filter((item) => item.leaveId === leaveId)
    .sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt))[0] ?? null;
}

function view(db: MockDb, leave: MockLeave): LeaveRequestView {
  const attachment = leave.attachmentId
    ? db.attachments.find((item) => item.id === leave.attachmentId)
    : null;
  return {
    id: leave.id,
    startTime: leave.startTime,
    endTime: leave.endTime,
    type: leave.type,
    status: leave.status,
    reason: leave.reason,
    attachmentName: attachment?.name ?? null,
    editable: leave.editable,
    cancellable: leave.cancellable,
    syncStatus: latestOperation(db, leave.id)?.status ?? null,
    updatedAt: leave.updatedAt,
  };
}

function workspace(db: MockDb, swapperId: string): LeaveWorkspaceView {
  const balance = db.leaveBalances.find((item) => item.swapperId === swapperId);
  if (!balance) throw new MockHttpError(404, "Solde de congés introuvable.");
  const operations = db.leaveSyncOperations.filter((item) => item.userId === swapperId);
  const lastSync = operations
    .filter((item) => item.completedAt)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))[0];
  return {
    balance: { ...balance },
    requests: db.leaves
      .filter((item) => item.swapperId === swapperId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((item) => view(db, item)),
    integration: {
      available: !operations.some((item) => item.status === "FAILED"),
      lastSuccessfulSyncAt: lastSync?.completedAt ?? balance.syncedAt,
      pendingOperations: operations.filter((item) =>
        ["QUEUED", "PROCESSING", "FAILED"].includes(item.status),
      ).length,
    },
  };
}

function validate(db: MockDb, swapperId: string, body: Record<string, unknown>, ignoredId?: string) {
  const startTime = String(body.startTime ?? "");
  const endTime = String(body.endTime ?? "");
  const reason = String(body.reason ?? "").trim();
  const type = String(body.type ?? "ANNUAL") as MockLeave["type"];
  if (!Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTime)))
    throw new MockHttpError(400, "Renseignez une période valide.");
  if (Date.parse(endTime) < Date.parse(startTime))
    throw new MockHttpError(400, "La fin du congé doit suivre son début.");
  if (reason.length < 8)
    throw new MockHttpError(400, "Précisez le motif en au moins 8 caractères.");
  if (!(["ANNUAL", "SICK", "FAMILY", "UNPAID", "OTHER"] as string[]).includes(type))
    throw new MockHttpError(400, "Type de congé inconnu.");
  const overlaps = db.leaves.some((item) =>
    item.swapperId === swapperId && item.id !== ignoredId &&
    !["REJECTED", "CANCELLED"].includes(item.status) &&
    Date.parse(item.startTime) <= Date.parse(endTime) && Date.parse(item.endTime) >= Date.parse(startTime));
  if (overlaps) throw new MockHttpError(409, "Une demande couvre déjà tout ou partie de cette période.");
  return { startTime, endTime, reason, type };
}

function syncOperation(db: MockDb, leave: MockLeave, action: "CREATE" | "UPDATE" | "CANCEL", key: string, now: number) {
  const existing = db.leaveSyncOperations.find((item) => item.idempotencyKey === key);
  if (existing) return existing;
  const operation = {
    id: nextId("leave-sync"), leaveId: leave.id, userId: leave.swapperId, action,
    status: "SYNCED" as const, idempotencyKey: key, attempts: 1,
    queuedAt: isoFromMs(now), lastAttemptAt: isoFromMs(now), nextAttemptAt: null,
    completedAt: isoFromMs(now), lastError: null,
  };
  db.leaveSyncOperations.unshift(operation);
  return operation;
}

export const leaveRoutes: MockRoute[] = [
  {
    method: "GET", pattern: /^\/leaves\/workspace$/,
    handler: ({ db, user }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      return workspace(db, actor.id);
    },
  },
  {
    method: "POST", pattern: /^\/leaves$/,
    handler: ({ db, user, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      const key = String(body.idempotencyKey ?? "");
      const replay = db.leaves.find((item) => item.clientRef === key);
      if (replay) return view(db, replay);
      if (!key) throw new MockHttpError(400, "Référence de synchronisation manquante.");
      const values = validate(db, actor.id, body);
      const leave: MockLeave = {
        id: nextId("leave"), swapperId: actor.id, ...values,
        status: "PENDING", attachmentId: String(body.attachmentId ?? "") || null,
        externalId: nextId("LV"), clientRef: key, createdAt: isoFromMs(now),
        updatedAt: isoFromMs(now), submittedAt: isoFromMs(now), decidedAt: null,
        decisionReason: null, cancellable: true, editable: true,
      };
      db.leaves.unshift(leave);
      syncOperation(db, leave, "CREATE", key, now);
      const balance = db.leaveBalances.find((item) => item.swapperId === actor.id);
      if (balance) balance.pendingDays += daysBetween(leave.startTime, leave.endTime);
      notifyUser(db, actor.id, "LEAVE", "Demande transmise", "Votre demande de congé est en cours d’étude.");
      return view(db, leave);
    },
  },
  {
    method: "PATCH", pattern: /^\/leaves\/([^/]+)$/,
    handler: ({ db, user, body, params, now }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      const leave = db.leaves.find((item) => item.id === params[0] && item.swapperId === actor.id);
      if (!leave) throw new MockHttpError(404, "Demande introuvable.");
      if (!leave.editable) throw new MockHttpError(409, "Cette demande ne peut plus être modifiée.");
      const values = validate(db, actor.id, body, leave.id);
      const oldDays = daysBetween(leave.startTime, leave.endTime);
      Object.assign(leave, values, { updatedAt: isoFromMs(now) });
      const balance = db.leaveBalances.find((item) => item.swapperId === actor.id);
      if (balance) balance.pendingDays = Math.max(0, balance.pendingDays - oldDays + daysBetween(leave.startTime, leave.endTime));
      syncOperation(db, leave, "UPDATE", String(body.idempotencyKey ?? nextId("idem")), now);
      return view(db, leave);
    },
  },
  {
    method: "POST", pattern: /^\/leaves\/([^/]+)\/cancel$/,
    handler: ({ db, user, body, params, now }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      const leave = db.leaves.find((item) => item.id === params[0] && item.swapperId === actor.id);
      if (!leave) throw new MockHttpError(404, "Demande introuvable.");
      if (!leave.cancellable) throw new MockHttpError(409, "Cette demande ne peut plus être annulée.");
      const balance = db.leaveBalances.find((item) => item.swapperId === actor.id);
      if (balance && ["PENDING", "QUEUED", "SYNCING", "SYNC_FAILED"].includes(leave.status))
        balance.pendingDays = Math.max(0, balance.pendingDays - daysBetween(leave.startTime, leave.endTime));
      leave.status = "CANCELLED"; leave.cancellable = false; leave.editable = false; leave.updatedAt = isoFromMs(now);
      syncOperation(db, leave, "CANCEL", String(body.idempotencyKey ?? nextId("idem")), now);
      return view(db, leave);
    },
  },
  {
    method: "POST", pattern: /^\/leaves\/sync\/([^/]+)\/retry$/,
    handler: ({ db, user, params, now }) => {
      const actor = requireUser(db, user);
      const operation = db.leaveSyncOperations.find((item) => item.id === params[0]);
      if (!operation || (actor.role === "SWAPPER" && operation.userId !== actor.id))
        throw new MockHttpError(404, "Synchronisation introuvable.");
      operation.status = "SYNCED"; operation.attempts += 1; operation.lastAttemptAt = isoFromMs(now);
      operation.completedAt = isoFromMs(now); operation.nextAttemptAt = null; operation.lastError = null;
      const leave = db.leaves.find((item) => item.id === operation.leaveId);
      if (leave?.status === "SYNC_FAILED") leave.status = "PENDING";
      return { ok: true };
    },
  },
  {
    method: "GET", pattern: /^\/admin\/integrations\/leaves$/,
    handler: ({ db, user }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      const failed = db.leaveSyncOperations.filter((item) => item.status === "FAILED");
      return {
        status: failed.length ? "DEGRADED" : "OPERATIONAL",
        lastSyncAt: db.leaveBalances.map((item) => item.syncedAt).sort().at(-1) ?? null,
        pending: db.leaveSyncOperations.filter((item) => ["QUEUED", "PROCESSING"].includes(item.status)).length,
        failed: failed.length,
        successRate: db.leaveSyncOperations.length
          ? Math.round((db.leaveSyncOperations.filter((item) => item.status === "SYNCED").length / db.leaveSyncOperations.length) * 100)
          : 100,
        operations: db.leaveSyncOperations.slice(0, 8).map((item) => ({ ...item, userName: db.users.find((u) => u.id === item.userId)?.fullName ?? "Compte inconnu" })),
      };
    },
  },
];
