import { constraintReport } from "../constraints";
import { isoFromMs } from "../seed";
import {
  durationHours,
  nextId,
  notifyStaff,
  requireRole,
  requireUser,
  occurrenceOf,
  scopeStationId,
  stationOf,
} from "../shared";
import { MockHttpError, type MockCtx, type MockRoute } from "../types";

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const recordOf = (ctx: MockCtx, shiftId: string) =>
  ctx.db.attendance.find((item) => item.shiftId === shiftId) ?? null;

/** Urgence d'une absence selon l'heure de début (US 2047). */
const urgencyOf = (startTime: string, now: number) => {
  const hours = (Date.parse(startTime) - now) / 3600000;
  if (hours <= 4) return "CRITICAL" as const;
  if (hours <= 24) return "HIGH" as const;
  return "NORMAL" as const;
};

/** Absences sans remplaçant, congés approuvés inclus lorsque fournis (US 2047). */
const pendingReplacements = (ctx: MockCtx, stationId: string | null) => {
  const published = new Set(
    ctx.db.plannings.filter((item) => item.status === "PUBLISHED").map((item) => item.id),
  );
  const absenceRows = ctx.db.absences
    .filter((item) => item.status === "OPEN")
    .map((absence) => ({ absence, occurrence: occurrenceOf(ctx.db, absence.shiftId) }))
    .filter(({ occurrence }) => published.has(occurrence.planningId))
    .filter(({ occurrence }) => Date.parse(occurrence.endTime) > ctx.now - 2 * 3600000)
    .filter(({ occurrence }) => (stationId ? occurrence.stationId === stationId : true))
    .map(({ absence, occurrence }) => {
      const station = stationOf(ctx.db, occurrence.stationId);
      const swapper = ctx.db.users.find((item) => item.id === absence.swapperId);
      return {
        shiftId: occurrence.id,
        station: { id: station.id, name: station.name, timezone: station.timezone },
        swapper: {
          id: swapper?.id ?? absence.swapperId,
          fullName: swapper?.fullName ?? "—",
        },
        template: occurrence.label,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        urgency: urgencyOf(occurrence.startTime, ctx.now),
        hoursUntilStart:
          Math.round(((Date.parse(occurrence.startTime) - ctx.now) / 3600000) * 10) / 10,
        origin: absence.origin,
        reason: absence.reason,
        reportedAt: absence.reportedAt,
      };
    });

  const absenceShiftIds = new Set(absenceRows.map((row) => row.shiftId));
  const leaveRows = ctx.db.leaves
    .filter((leave) => leave.status === "APPROVED")
    .flatMap((leave) =>
      ctx.db.occurrences
        .filter((occurrence) => published.has(occurrence.planningId))
        .filter((occurrence) => occurrence.swapperId === leave.swapperId)
        .filter(
          (occurrence) =>
            Date.parse(occurrence.startTime) < Date.parse(leave.endTime) &&
            Date.parse(occurrence.endTime) > Date.parse(leave.startTime),
        )
        .filter((occurrence) => Date.parse(occurrence.endTime) > ctx.now - 2 * 3600000)
        .filter((occurrence) => (stationId ? occurrence.stationId === stationId : true))
        .filter((occurrence) => !absenceShiftIds.has(occurrence.id))
        .map((occurrence) => {
          const station = stationOf(ctx.db, occurrence.stationId);
          const swapper = ctx.db.users.find((item) => item.id === leave.swapperId);
          return {
            shiftId: occurrence.id,
            station: { id: station.id, name: station.name, timezone: station.timezone },
            swapper: {
              id: swapper?.id ?? leave.swapperId,
              fullName: swapper?.fullName ?? "—",
            },
            template: occurrence.label,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            urgency: urgencyOf(occurrence.startTime, ctx.now),
            hoursUntilStart:
              Math.round(((Date.parse(occurrence.startTime) - ctx.now) / 3600000) * 10) / 10,
            origin: "APPROVED_LEAVE" as const,
            reason: leave.reason,
            reportedAt: null,
          };
        }),
    );

  return [...absenceRows, ...leaveRows]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
};

export const coverageRoutes: MockRoute[] = [
  {
    method: "POST",
    pattern: /^\/operations\/absences\/attachments$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["SWAPPER"]);
      if (!ctx.file) throw new MockHttpError(400, "Aucune pièce justificative reçue.");
      if (ctx.file.size > 5 * 1024 * 1024)
        throw new MockHttpError(413, "Le justificatif dépasse 5 Mo.");
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(ctx.file.type))
        throw new MockHttpError(400, "Utilisez un fichier PDF, JPG, PNG ou WebP.");
      const created = {
        id: nextId("att"),
        name: ctx.file.name,
        size: ctx.file.size,
        type: ctx.file.type,
        createdAt: isoFromMs(ctx.now),
      };
      ctx.db.attachments.push(created);
      return { id: created.id };
    },
  },
  {
    method: "POST",
    pattern: /^\/operations\/absences$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), ["SWAPPER"]);
      const occurrence = occurrenceOf(ctx.db, asText(ctx.body.shiftId));
      const reason = asText(ctx.body.reason);
      const attachmentId = asText(ctx.body.attachmentId);
      const clientRef = asText(ctx.body.clientRef) || null;
      if (reason.length < 3)
        throw new MockHttpError(400, "Précisez un motif d'absence (3 caractères minimum).");
      if (!ctx.db.attachments.some((item) => item.id === attachmentId))
        throw new MockHttpError(400, "Une pièce justificative valide est obligatoire.");
      if (occurrence.swapperId !== user.id)
        throw new MockHttpError(403, "Ce shift ne vous est pas affecté.");
      if (Date.parse(occurrence.endTime) < ctx.now)
        throw new MockHttpError(409, "Ce service est déjà terminé.");
      if (clientRef) {
        const replayed = ctx.db.absences.find((item) => item.clientRef === clientRef);
        if (replayed) return { id: replayed.id, replayed: true };
      }
      if (
        ctx.db.absences.some(
          (item) => item.shiftId === occurrence.id && item.status === "OPEN",
        )
      )
        throw new MockHttpError(409, "Une absence est déjà déclarée pour ce shift.");
      const created = {
        id: nextId("abs"),
        shiftId: occurrence.id,
        swapperId: user.id,
        reason,
        attachmentId,
        clientRef,
        reportedAt: isoFromMs(ctx.now),
        origin: "DECLARATION" as const,
        status: "OPEN" as const,
        coveredBy: null,
      };
      ctx.db.absences.push(created);
      notifyStaff(
        ctx.db,
        occurrence.stationId,
        "ABSENCE_DECLARED",
        "Absence déclarée",
        `${user.fullName} · ${occurrence.label} : ${reason}`,
        [user.id],
      );
      return { id: created.id, replayed: false };
    },
  },
  {
    method: "GET",
    pattern: /^\/operations\/replacements\/pending$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      requireRole(user, ["SUPERVISOR"]);
      return pendingReplacements(ctx, scopeStationId(user));
    },
  },
  {
    method: "GET",
    pattern: /^\/operations\/shifts\/([^/]+)\/candidates$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["SUPERVISOR"]);
      const occurrence = occurrenceOf(ctx.db, ctx.params[0]);
      const candidates = ctx.db.users
        .filter(
          (item) =>
            item.role === "SWAPPER" &&
            item.isActive &&
            item.stationId === occurrence.stationId,
        )
        .map((item) => {
          if (item.id === occurrence.swapperId)
            return {
              id: item.id,
              fullName: item.fullName,
              email: item.email,
              eligible: true,
              issues: [] as { code: string; message: string }[],
            };
          const report = constraintReport(ctx.db, {
            stationId: occurrence.stationId,
            swapperId: item.id,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            hours: durationHours(ctx.db, occurrence),
            ignoreOccurrenceId: occurrence.id,
          });
          return {
            id: item.id,
            fullName: item.fullName,
            email: item.email,
            eligible: report.valid,
            issues: [...report.errors, ...report.warnings].map((issue) => ({
              code: issue.code,
              message: issue.message,
            })),
          };
        })
        .sort(
          (a, b) =>
            Number(b.eligible) - Number(a.eligible) ||
            a.fullName.localeCompare(b.fullName, "fr"),
        );
      return { candidates };
    },
  },
  {
    method: "POST",
    pattern: /^\/operations\/shifts\/([^/]+)\/replacement$/,
    handler: (ctx) => {
      const actor = requireRole(requireUser(ctx.db, ctx.user), ["SUPERVISOR"]);
      const occurrence = occurrenceOf(ctx.db, ctx.params[0]);
      const swapperId = asText(ctx.body.swapperId);
      const swapper = ctx.db.users.find((item) => item.id === swapperId);
      if (
        !swapper ||
        swapper.role !== "SWAPPER" ||
        !swapper.isActive ||
        swapper.stationId !== occurrence.stationId
      )
        throw new MockHttpError(
          400,
          "Sélectionnez un swappeur actif rattaché à cette station.",
        );
      const report = constraintReport(ctx.db, {
        stationId: occurrence.stationId,
        swapperId,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        hours: durationHours(ctx.db, occurrence),
        ignoreOccurrenceId: occurrence.id,
      });
      if (!report.valid)
        throw new MockHttpError(409, report.errors[0]?.message ?? "Remplacement impossible.");
      const planning = ctx.db.plannings.find((item) => item.id === occurrence.planningId);
      const previous = occurrence.swapperId
        ? ctx.db.users.find((item) => item.id === occurrence.swapperId) ?? null
        : null;
      occurrence.swapperId = swapperId;
      if (planning) planning.revision += 1;
      // La file se vide : l'absence du shift est couverte (US 2047 #3).
      for (const absence of ctx.db.absences) {
        if (absence.shiftId === occurrence.id && absence.status === "OPEN") {
          absence.status = "COVERED";
          absence.coveredBy = swapperId;
        }
      }
      const station = stationOf(ctx.db, occurrence.stationId);
      ctx.db.changes.unshift({
        id: nextId("chg"),
        shiftId: occurrence.id,
        type: "REPLACEMENT",
        initiatorId: actor.id,
        initiator: actor.fullName,
        stationId: station.id,
        station: station.name,
        outSwapper: previous?.fullName ?? null,
        inSwapper: swapper.fullName,
        outSwapperId: previous?.id ?? null,
        inSwapperId: swapper.id,
        before: { swapper: previous?.fullName ?? null },
        after: { swapper: swapper.fullName },
        reason: asText(ctx.body.reason) || "Remplacement décidé par le superviseur",
        createdAt: isoFromMs(ctx.now),
      });
      notifyStaff(
        ctx.db,
        station.id,
        "REPLACEMENT",
        "Remplacement confirmé",
        `${swapper.fullName} couvre ${occurrence.label} à ${station.name}.`,
        [swapper.id, previous?.id ?? ""].filter(Boolean),
      );
      return {
        ok: true,
        shiftId: occurrence.id,
        swapperId,
        revision: planning?.revision ?? 0,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/operations\/changes$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), ["SUPERVISOR"]);
      const fromValue = asText(ctx.query.get("from"));
      const toValue = asText(ctx.query.get("to"));
      const from = fromValue ? Date.parse(fromValue) : ctx.now - 30 * 86400000;
      const to = toValue ? Date.parse(toValue) : ctx.now;
      const type = asText(ctx.query.get("type")).toUpperCase();
      const stationFilter = asText(ctx.query.get("stationId")) || scopeStationId(user);
      const swapperFilter = asText(ctx.query.get("swapperId"));
      return ctx.db.changes
        .filter((item) => {
          const at = Date.parse(item.createdAt);
          return at >= from && at <= to;
        })
        .filter((item) => (type ? item.type === type : true))
        .filter((item) => (stationFilter ? item.stationId === stationFilter : true))
        .filter((item) =>
          swapperFilter
            ? item.outSwapperId === swapperFilter || item.inSwapperId === swapperFilter
            : true,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
  },
  {
    method: "POST",
    pattern: /^\/corrections\/attachments$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["SUPERVISOR"]);
      if (!ctx.file) throw new MockHttpError(400, "Aucune pièce justificative reçue.");
      if (ctx.file.size > 5 * 1024 * 1024)
        throw new MockHttpError(413, "Le justificatif dépasse 5 Mo.");
      const created = {
        id: nextId("att"),
        name: ctx.file.name,
        size: ctx.file.size,
        type: ctx.file.type || "application/octet-stream",
        createdAt: isoFromMs(ctx.now),
      };
      ctx.db.attachments.push(created);
      return { id: created.id };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/corrections\/shifts\/([^/]+)$/,
    handler: (ctx) => {
      const actor = requireRole(requireUser(ctx.db, ctx.user), ["SUPERVISOR"]);
      const occurrence = occurrenceOf(ctx.db, ctx.params[0]);
      const reason = asText(ctx.body.reason);
      const attachmentId = asText(ctx.body.attachmentId);
      if (reason.length < 5)
        throw new MockHttpError(
          400,
          "Le motif de correction est obligatoire (5 caractères minimum).",
        );
      const attachment = ctx.db.attachments.find((item) => item.id === attachmentId);
      if (!attachment)
        throw new MockHttpError(400, "Une pièce justificative valide est obligatoire.");
      if (!occurrence.swapperId)
        throw new MockHttpError(409, "Ce poste n'a pas de swappeur à corriger.");

      // US 2045 : le statut « justifié » est distinct de l'absence constatée.
      const justified = ctx.body.isJustified === true;
      const absent = justified || ctx.body.isAbsent === true;
      const plannedMissed = asText(ctx.body.checkedInAt);
      const checkedInAt = absent ? null : plannedMissed || null;
      const checkedOutAt = absent ? null : asText(ctx.body.checkedOutAt) || null;
      if (checkedInAt && checkedOutAt && Date.parse(checkedOutAt) <= Date.parse(checkedInAt))
        throw new MockHttpError(400, "La fin de service doit suivre la prise de service.");
      if (!absent && !checkedInAt)
        throw new MockHttpError(400, "Indiquez l'heure de prise de service ou un statut d'absence.");

      const existing = recordOf(ctx, occurrence.id);
      const status = justified
        ? ("JUSTIFIED" as const)
        : absent
          ? ("ABSENT" as const)
          : checkedOutAt
            ? ("CLOSED" as const)
            : ctx.body.isLate === true
              ? ("LATE" as const)
              : ("PRESENT" as const);
      const before = existing
        ? {
            status: existing.status,
            checkedInAt: existing.checkedInAt,
            checkedOutAt: existing.checkedOutAt,
            isLate: existing.isLate,
          }
        : { status: "ABSENT", checkedInAt: null, checkedOutAt: null, isLate: false };
      const after = { status, checkedInAt, checkedOutAt, isLate: !absent && ctx.body.isLate === true };
      const correction = {
        reason,
        attachmentId,
        authorId: actor.id,
        authorName: actor.fullName,
        at: isoFromMs(ctx.now),
        before,
        after,
      };
      if (existing) {
        existing.status = status;
        existing.checkedInAt = checkedInAt;
        existing.checkedOutAt = checkedOutAt;
        existing.isLate = after.isLate;
        existing.justified = justified;
        existing.correction = correction;
      } else {
        ctx.db.attendance.push({
          shiftId: occurrence.id,
          swapperId: occurrence.swapperId,
          status,
          checkedInAt,
          checkedOutAt,
          isLate: after.isLate,
          justified,
          correction,
        });
      }
      if (justified)
        for (const item of ctx.db.absences) {
          if (item.shiftId === occurrence.id && item.status === "OPEN") {
            item.status = "COVERED";
            item.coveredBy = null;
          }
        }
      notifyStaff(
        ctx.db,
        occurrence.stationId,
        "CORRECTION",
        justified ? "Absence requalifiée en justifiée" : "Pointage corrigé",
        `${occurrence.label} : ${reason}`,
        [occurrence.swapperId],
      );
      return { ok: true, status, correction };
    },
  },
  {
    method: "GET",
    pattern: /^\/notifications$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      return ctx.db.notifications
        .filter((item) => item.userId === user.id)
        .slice(0, 50);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/notifications\/([^/]+)\/read$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      const target = ctx.db.notifications.find(
        (item) => item.id === ctx.params[0] && item.userId === user.id,
      );
      if (!target) throw new MockHttpError(404, "Notification introuvable.");
      target.readAt = isoFromMs(ctx.now);
      return { ok: true };
    },
  },
];
