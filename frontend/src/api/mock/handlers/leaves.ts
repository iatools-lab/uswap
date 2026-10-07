import type {
  LeaveRequestView,
  LeaveWorkspaceView,
} from "../../../domain/sprint4";
import { requireRole, requireUser } from "../shared";
import {
  MockHttpError,
  type MockDb,
  type MockLeave,
  type MockRoute,
} from "../types";
import { nextId, notifyUser } from "../shared";

const asText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const LEAVE_TYPES = ["ANNUAL", "SICK", "FAMILY", "UNPAID", "OTHER"] as const;
const ACTIVE_STATUSES = new Set(["PENDING", "APPROVED"]);

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isValidDay(value: string) {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

function dayCount(startTime: string, endTime: string) {
  return (
    Math.floor(
      (dayNumber(endTime.slice(0, 10)) - dayNumber(startTime.slice(0, 10))) /
        86_400_000,
    ) + 1
  );
}

function requestPeriod(body: Record<string, unknown>, now: number) {
  const startDate = asText(body.startDate);
  const endDate = asText(body.endDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  )
    throw new MockHttpError(
      400,
      "Choisissez une date de début et de fin valides.",
    );
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  const validDates = isValidDay(startDate) && isValidDay(endDate);
  const today = dayNumber(new Date(now).toISOString().slice(0, 10));
  if (
    !validDates ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < today ||
    end < start
  )
    throw new MockHttpError(
      400,
      "La période doit être future et sa fin ne peut pas précéder son début.",
    );
  return {
    startTime: `${startDate}T00:00:00.000Z`,
    endTime: `${endDate}T23:59:59.999Z`,
  };
}

function validateOverlap(
  db: MockDb,
  swapperId: string,
  startTime: string,
  endTime: string,
  exceptId?: string,
) {
  const overlap = db.leaves.some(
    (leave) =>
      leave.swapperId === swapperId &&
      leave.id !== exceptId &&
      ACTIVE_STATUSES.has(leave.status) &&
      Date.parse(leave.startTime) <= Date.parse(endTime) &&
      Date.parse(leave.endTime) >= Date.parse(startTime),
  );
  if (overlap)
    throw new MockHttpError(
      409,
      "Une demande ou un congé approuvé chevauche déjà cette période.",
    );
}

function latestOperation(db: MockDb, leaveId: string) {
  return (
    db.leaveSyncOperations
      .filter((item) => item.leaveId === leaveId)
      .sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt))[0] ??
    null
  );
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
    syncStatus:
      latestOperation(db, leave.id)?.status ??
      (leave.status === "APPROVED" ? "SYNCED" : null),
    decisionReason: leave.decisionReason,
    updatedAt: leave.updatedAt,
  };
}

function workspace(db: MockDb, swapperId: string): LeaveWorkspaceView {
  const balance = db.leaveBalances.find((item) => item.swapperId === swapperId);
  if (!balance) throw new MockHttpError(404, "Solde de congés introuvable.");
  const operations = db.leaveSyncOperations.filter(
    (item) => item.userId === swapperId,
  );
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

function supervisorStationId(userId: string) {
  if (userId === "us-chief-bastos") return "st-bastos";
  if (userId === "us-chief-obobogo") return "st-obobogo";
  return null;
}

function managementRows(
  db: MockDb,
  userId: string,
  role: "ADMIN" | "SUPERVISOR",
) {
  const stationId = role === "SUPERVISOR" ? supervisorStationId(userId) : null;
  return db.leaves
    .filter((leave) => {
      if (!stationId) return true;
      return (
        db.users.find((item) => item.id === leave.swapperId)?.stationId ===
        stationId
      );
    })
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
    .map((leave) => {
      const swapper = db.users.find((item) => item.id === leave.swapperId);
      const station = db.stations.find(
        (item) => item.id === swapper?.stationId,
      );
      return {
        ...view(db, leave),
        swapperId: leave.swapperId,
        swapperName: swapper?.fullName ?? "Compte inconnu",
        stationId: swapper?.stationId ?? null,
        stationName: station?.name ?? "Station non affectée",
        createdAt: leave.createdAt,
      };
    });
}

function canManageLeave(
  db: MockDb,
  userId: string,
  role: "ADMIN" | "SUPERVISOR",
  leave: MockLeave,
) {
  if (role === "ADMIN") return true;
  const stationId = supervisorStationId(userId);
  if (!stationId) return true;
  return (
    db.users.find((item) => item.id === leave.swapperId)?.stationId ===
    stationId
  );
}

function decideLeave(
  db: MockDb,
  actor: MockDb["users"][number],
  leave: MockLeave,
  body: Record<string, unknown>,
  now: number,
) {
  const decision = asText(body.decision);
  const reason = asText(body.reason);
  if (leave.status !== "PENDING")
    throw new MockHttpError(409, "Cette demande n’est plus en attente.");
  if (decision !== "APPROVED" && decision !== "REJECTED")
    throw new MockHttpError(400, "Choisissez une décision valide.");
  if (decision === "REJECTED" && reason.length < 5)
    throw new MockHttpError(
      400,
      "Indiquez le motif du refus (5 caractères minimum).",
    );
  const balance = db.leaveBalances.find(
    (item) => item.swapperId === leave.swapperId,
  );
  if (balance)
    balance.pendingDays = Math.max(
      0,
      balance.pendingDays - dayCount(leave.startTime, leave.endTime),
    );
  Object.assign(leave, {
    status: decision,
    decisionReason: decision === "REJECTED" ? reason : "Demande approuvée.",
    decidedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    cancellable: false,
    editable: false,
  });
  const dayTotal = dayCount(leave.startTime, leave.endTime);
  const swapper = db.users.find((item) => item.id === leave.swapperId);
  if (swapper)
    notifyUser(
      db,
      swapper.id,
      decision === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      decision === "APPROVED" ? "Congé approuvé" : "Demande de congé refusée",
      decision === "APPROVED"
        ? `Votre demande de ${dayTotal} jour${dayTotal > 1 ? "s" : ""} a été approuvée.`
        : `Votre demande de congé a été refusée : ${reason}`,
      leave.id,
    );
  return { ...view(db, leave), decidedBy: actor.fullName };
}

export const leaveRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: /^\/leaves\/workspace$/,
    handler: ({ db, user }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      return workspace(db, actor.id);
    },
  },
  {
    method: "POST",
    pattern: /^\/leaves$/,
    handler: ({ db, user, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      const type = asText(body.type);
      const reason = asText(body.reason);
      if (!LEAVE_TYPES.includes(type as (typeof LEAVE_TYPES)[number]))
        throw new MockHttpError(400, "Choisissez un type de congé valide.");
      if (reason.length < 8)
        throw new MockHttpError(
          400,
          "Précisez le motif de votre demande (8 caractères minimum).",
        );
      const period = requestPeriod(body, now);
      validateOverlap(db, actor.id, period.startTime, period.endTime);
      const balance = db.leaveBalances.find(
        (item) => item.swapperId === actor.id,
      );
      if (!balance)
        throw new MockHttpError(404, "Solde de congés introuvable.");
      const days = dayCount(period.startTime, period.endTime);
      if (days > balance.remainingDays - balance.pendingDays)
        throw new MockHttpError(
          409,
          "Cette demande dépasse votre solde disponible après prise en compte des demandes en attente.",
        );

      const created: MockLeave = {
        id: nextId("leave"),
        swapperId: actor.id,
        ...period,
        type: type as MockLeave["type"],
        status: "PENDING",
        reason,
        attachmentId: null,
        externalId: null,
        clientRef: nextId("request"),
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        submittedAt: new Date(now).toISOString(),
        decidedAt: null,
        decisionReason: null,
        cancellable: true,
        editable: true,
      };
      db.leaves.unshift(created);
      balance.pendingDays += days;
      for (const admin of db.users.filter(
        (item) => item.role === "ADMIN" && item.isActive,
      ))
        notifyUser(
          db,
          admin.id,
          "LEAVE_SUBMITTED",
          "Nouvelle demande de congé",
          `${actor.fullName} · ${days} jour${days > 1 ? "s" : ""} demandé${days > 1 ? "s" : ""}.`,
          created.id,
        );
      return view(db, created);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/leaves\/([^/]+)$/,
    handler: ({ db, user, params, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      const leave = db.leaves.find((item) => item.id === params[0]);
      if (!leave || leave.swapperId !== actor.id)
        throw new MockHttpError(404, "Demande de congé introuvable.");
      if (leave.status !== "PENDING" || !leave.editable)
        throw new MockHttpError(409, "Cette demande n’est plus modifiable.");
      const type = asText(body.type);
      const reason = asText(body.reason);
      if (!LEAVE_TYPES.includes(type as (typeof LEAVE_TYPES)[number]))
        throw new MockHttpError(400, "Choisissez un type de congé valide.");
      if (reason.length < 8)
        throw new MockHttpError(
          400,
          "Précisez le motif de votre demande (8 caractères minimum).",
        );
      const period = requestPeriod(body, now);
      validateOverlap(db, actor.id, period.startTime, period.endTime, leave.id);
      const balance = db.leaveBalances.find(
        (item) => item.swapperId === actor.id,
      );
      if (!balance)
        throw new MockHttpError(404, "Solde de congés introuvable.");
      const previousDays = dayCount(leave.startTime, leave.endTime);
      const nextDays = dayCount(period.startTime, period.endTime);
      if (nextDays > balance.remainingDays - balance.pendingDays + previousDays)
        throw new MockHttpError(
          409,
          "Cette demande dépasse votre solde disponible après prise en compte des demandes en attente.",
        );
      Object.assign(leave, period, {
        type: type as MockLeave["type"],
        reason,
        updatedAt: new Date(now).toISOString(),
      });
      balance.pendingDays = Math.max(
        0,
        balance.pendingDays - previousDays + nextDays,
      );
      return view(db, leave);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/leaves\/([^/]+)\/cancel$/,
    handler: ({ db, user, params, now }) => {
      const actor = requireRole(requireUser(db, user), ["SWAPPER"]);
      const leave = db.leaves.find((item) => item.id === params[0]);
      if (!leave || leave.swapperId !== actor.id)
        throw new MockHttpError(404, "Demande de congé introuvable.");
      if (leave.status !== "PENDING" || !leave.cancellable)
        throw new MockHttpError(
          409,
          "Cette demande ne peut plus être annulée.",
        );
      const balance = db.leaveBalances.find(
        (item) => item.swapperId === actor.id,
      );
      if (balance)
        balance.pendingDays = Math.max(
          0,
          balance.pendingDays - dayCount(leave.startTime, leave.endTime),
        );
      Object.assign(leave, {
        status: "CANCELLED" as const,
        cancellable: false,
        editable: false,
        updatedAt: new Date(now).toISOString(),
      });
      return view(db, leave);
    },
  },
  {
    method: "GET",
    pattern: /^\/admin\/leaves\/pending$/,
    handler: ({ db, user }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      return db.leaves
        .filter((leave) => leave.status === "PENDING")
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map((leave) => ({
          ...view(db, leave),
          swapperId: leave.swapperId,
          swapperName:
            db.users.find((item) => item.id === leave.swapperId)?.fullName ??
            "Compte inconnu",
        }));
    },
  },
  {
    method: "GET",
    pattern: /^\/leaves\/management$/,
    handler: ({ db, user }) => {
      const actor = requireRole(requireUser(db, user), ["ADMIN", "SUPERVISOR"]);
      return managementRows(db, actor.id, actor.role as "ADMIN" | "SUPERVISOR");
    },
  },
  {
    method: "PATCH",
    pattern: /^\/leaves\/([^/]+)\/decision$/,
    handler: ({ db, user, params, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["ADMIN", "SUPERVISOR"]);
      const leave = db.leaves.find((item) => item.id === params[0]);
      if (
        !leave ||
        !canManageLeave(
          db,
          actor.id,
          actor.role as "ADMIN" | "SUPERVISOR",
          leave,
        )
      )
        throw new MockHttpError(
          404,
          "Cette demande n’est pas accessible dans votre périmètre.",
        );
      return decideLeave(db, actor, leave, body, now);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/admin\/leaves\/([^/]+)\/decision$/,
    handler: ({ db, user, params, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["ADMIN"]);
      const leave = db.leaves.find((item) => item.id === params[0]);
      const decision = asText(body.decision);
      const reason = asText(body.reason);
      if (!leave || leave.status !== "PENDING")
        throw new MockHttpError(404, "Cette demande n’est plus en attente.");
      if (decision !== "APPROVED" && decision !== "REJECTED")
        throw new MockHttpError(400, "Choisissez une décision valide.");
      if (decision === "REJECTED" && reason.length < 5)
        throw new MockHttpError(
          400,
          "Indiquez le motif du refus (5 caractères minimum).",
        );
      const balance = db.leaveBalances.find(
        (item) => item.swapperId === leave.swapperId,
      );
      if (balance)
        balance.pendingDays = Math.max(
          0,
          balance.pendingDays - dayCount(leave.startTime, leave.endTime),
        );
      Object.assign(leave, {
        status: decision,
        decisionReason: decision === "REJECTED" ? reason : "Demande approuvée.",
        decidedAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        cancellable: false,
        editable: false,
      });
      const dayTotal = dayCount(leave.startTime, leave.endTime);
      const swapper = db.users.find((item) => item.id === leave.swapperId);
      if (swapper)
        notifyUser(
          db,
          swapper.id,
          decision === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
          decision === "APPROVED"
            ? "Congé approuvé"
            : "Demande de congé refusée",
          decision === "APPROVED"
            ? `Votre demande de ${dayTotal} jour${dayTotal > 1 ? "s" : ""} a été approuvée.`
            : `Votre demande de congé a été refusée : ${reason}`,
          leave.id,
        );
      return { ...view(db, leave), decidedBy: actor.fullName };
    },
  },
  {
    method: "GET",
    pattern: /^\/admin\/integrations\/leaves$/,
    handler: ({ db, user }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      const failed = db.leaveSyncOperations.filter(
        (item) => item.status === "FAILED",
      );
      return {
        status: failed.length ? "DEGRADED" : "OPERATIONAL",
        lastSyncAt:
          db.leaveBalances
            .map((item) => item.syncedAt)
            .sort()
            .at(-1) ?? null,
        pending: db.leaveSyncOperations.filter((item) =>
          ["QUEUED", "PROCESSING"].includes(item.status),
        ).length,
        failed: failed.length,
        successRate: db.leaveSyncOperations.length
          ? Math.round(
              (db.leaveSyncOperations.filter((item) => item.status === "SYNCED")
                .length /
                db.leaveSyncOperations.length) *
                100,
            )
          : 100,
        operations: db.leaveSyncOperations.slice(0, 8).map((item) => ({
          ...item,
          userName:
            db.users.find((u) => u.id === item.userId)?.fullName ??
            "Compte inconnu",
        })),
      };
    },
  },
];
