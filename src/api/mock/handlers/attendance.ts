import { attendanceStatus, constraintReport } from "../constraints";
import { isoFromMs } from "../seed";
import {
  durationHours,
  notifyStaff,
  occurrenceOf,
  publishedShiftsOfDay,
  requireRole,
  requireUser,
  scopeStationId,
  stationOf,
} from "../shared";
import { MockHttpError, type MockCtx, type MockQr, type MockRoute } from "../types";

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const pruneTokens = (ctx: MockCtx) => {
  ctx.db.qrTokens = ctx.db.qrTokens.filter(
    (item) => Date.parse(item.expiresAt) > ctx.now - 3600000,
  );
};

/** Pointage enregistré d'une affectation, s'il existe. */
const recordOf = (ctx: MockCtx, shiftId: string) =>
  ctx.db.attendance.find((item) => item.shiftId === shiftId) ?? null;

const publishedPlanningIds = (ctx: MockCtx) =>
  new Set(ctx.db.plannings.filter((item) => item.status === "PUBLISHED").map((item) => item.id));

export const attendanceRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: /^\/workspace$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      const limit = 50;
      const published = publishedPlanningIds(ctx);
      const windowStart = ctx.now - 2 * 86400000;

      if (user.role === "SWAPPER") {
        const shifts = ctx.db.occurrences
          .filter((item) => item.swapperId === user.id && published.has(item.planningId))
          .filter((item) => Date.parse(item.endTime) > windowStart)
          .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
          .slice(0, limit)
          .map((item) => {
            const record = recordOf(ctx, item.id);
            const station = stationOf(ctx.db, item.stationId);
            return {
              id: item.id,
              startTime: item.startTime,
              endTime: item.endTime,
              publishedAt:
                ctx.db.plannings.find((pl) => pl.id === item.planningId)?.publishedAt ?? null,
              station: { id: station.id, name: station.name, timezone: station.timezone },
              swapper: { fullName: user.fullName },
              attendance: record?.checkedInAt
                ? {
                    checkedInAt: record.checkedInAt,
                    checkedOutAt: record.checkedOutAt,
                    isLate: record.isLate,
                  }
                : null,
            };
          });
        return { station: null, limit, shifts };
      }

      const stationScope = scopeStationId(user);
      const station = stationScope ? stationOf(ctx.db, stationScope) : null;
      const shifts = ctx.db.occurrences
        .filter((item) => (stationScope ? item.stationId === stationScope : true))
        .filter((item) => published.has(item.planningId))
        .filter((item) => Date.parse(item.endTime) > windowStart)
        .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
        .slice(0, limit)
        .map((item) => {
          const target = stationOf(ctx.db, item.stationId);
          const swapper = item.swapperId
            ? ctx.db.users.find((entry) => entry.id === item.swapperId) ?? null
            : null;
          const record = recordOf(ctx, item.id);
          return {
            id: item.id,
            startTime: item.startTime,
            endTime: item.endTime,
            publishedAt:
              ctx.db.plannings.find((pl) => pl.id === item.planningId)?.publishedAt ?? null,
            station: { id: target.id, name: target.name, timezone: target.timezone },
            swapper: { fullName: swapper?.fullName ?? "Poste vacant" },
            attendance: record?.checkedInAt
              ? {
                  checkedInAt: record.checkedInAt,
                  checkedOutAt: record.checkedOutAt,
                  isLate: record.isLate,
                }
              : null,
          };
        });
      return {
        station: station
          ? {
              id: station.id,
              name: station.name,
              location: station.location,
              timezone: station.timezone,
            }
          : null,
        limit,
        shifts,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/shifts\/validate$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      requireRole(user, ["ADMIN", "SUPERVISOR", "STATION_CHIEF"]);
      const startTime = asText(ctx.body.startTime);
      const endTime = asText(ctx.body.endTime);
      const stationId = asText(ctx.body.stationId);
      const swapperId = asText(ctx.body.swapperId);
      if (!startTime || !endTime || !stationId || !swapperId)
        throw new MockHttpError(400, "Contrôle incomplet : station, swappeur et créneau requis.");
      return constraintReport(ctx.db, {
        stationId,
        swapperId,
        startTime,
        endTime,
        hours:
          Math.round(((Date.parse(endTime) - Date.parse(startTime)) / 3600000) * 100) / 100,
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/attendance\/qr$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), ["STATION_CHIEF"]);
      const occurrence = occurrenceOf(ctx.db, asText(ctx.body.shiftId));
      const requestedStationId = asText(ctx.body.stationId);
      const kind = asText(ctx.body.kind).toUpperCase() === "CHECKOUT" ? "CHECKOUT" : "CHECKIN";
      const planning = ctx.db.plannings.find((item) => item.id === occurrence.planningId);
      if (planning?.status !== "PUBLISHED")
        throw new MockHttpError(409, "Ce shift n'est pas publié : aucun QR possible.");
      if (requestedStationId && requestedStationId !== occurrence.stationId)
        throw new MockHttpError(409, "La station sélectionnée ne correspond pas à ce shift.");
      if (!occurrence.swapperId)
        throw new MockHttpError(409, "Ce poste est vacant : aucun pointage ne peut être généré.");
      if (occurrence.stationId !== user.stationId)
        throw new MockHttpError(403, "Ce shift n'appartient pas à votre station.");
      const station = stationOf(ctx.db, occurrence.stationId);
      const ttl = (kind === "CHECKIN" ? station.checkinQrTtl : station.checkoutQrTtl) * 1000;
      const start = Date.parse(occurrence.startTime);
      const end = Date.parse(occurrence.endTime);
      if (kind === "CHECKIN" && (ctx.now < start || ctx.now > end))
        throw new MockHttpError(
          409,
          "Le QR de prise de service n’est disponible que pendant le créneau du shift.",
        );
      if (kind === "CHECKOUT" && (ctx.now < start || ctx.now > end + ttl))
        throw new MockHttpError(
          409,
          "Le QR de fin n’est pas disponible en dehors de la fenêtre du shift.",
        );
      if (kind === "CHECKIN" && ctx.now > end)
        throw new MockHttpError(
          409,
          "La fenêtre de prise de service est terminée pour ce shift.",
        );
      if (kind === "CHECKOUT" && ctx.now > start + 86400000)
        throw new MockHttpError(409, "Ce shift est trop ancien pour une fin de service.");
      pruneTokens(ctx);
      const active = ctx.db.qrTokens.find(
        (item) =>
          item.shiftId === occurrence.id &&
          item.kind === kind &&
          Date.parse(item.expiresAt) > ctx.now,
      );
      if (active)
        return {
          token: active.token,
          kind: active.kind,
          shiftId: active.shiftId,
          stationName: station.name,
          createdAt: active.createdAt,
          expiresAt: active.expiresAt,
          ttlSeconds: Math.max(
            0,
            Math.round((Date.parse(active.expiresAt) - ctx.now) / 1000),
          ),
          timezone: station.timezone,
        };
      // Fenêtres distinctes : le QR de fin reste utilisable après la fin prévue,
      // dans la limite de validité configurée sur la station.
      const limit =
        kind === "CHECKIN"
          ? Math.min(end, ctx.now + ttl)
          : Math.min(end + ttl, ctx.now + ttl);
      const created: MockQr = {
        token: randomToken(),
        kind,
        stationId: station.id,
        shiftId: occurrence.id,
        createdBy: user.id,
        createdAt: isoFromMs(ctx.now),
        expiresAt: isoFromMs(limit),
        consumedBy: [],
      };
      if (limit <= ctx.now)
        throw new MockHttpError(
          409,
          "La fenêtre de validité est déjà écoulée : aucun QR ne peut être généré.",
        );
      ctx.db.qrTokens.push(created);
      return {
        token: created.token,
        kind: created.kind,
        shiftId: created.shiftId,
        stationName: station.name,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
        ttlSeconds: Math.round((limit - ctx.now) / 1000),
        timezone: station.timezone,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/attendance$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), ["SWAPPER"]);
      const raw = asText(ctx.body.token);
      const askedShiftId = asText(ctx.body.shiftId);
      if (!TOKEN_PATTERN.test(raw))
        throw new MockHttpError(400, "QR invalide : le jeton est illisible.");
      const token = ctx.db.qrTokens.find((item) => item.token === raw);
      if (!token)
        throw new MockHttpError(
          400,
          "Ce QR est inconnu. Demandez un nouveau code au chef de station.",
        );
      if (Date.parse(token.expiresAt) < ctx.now)
        throw new MockHttpError(410, "Ce QR a expiré. Demandez-en un nouveau.");
      const occurrence = occurrenceOf(ctx.db, token.shiftId);
      if (askedShiftId && askedShiftId !== occurrence.id)
        throw new MockHttpError(
          409,
          "Ce QR correspond à une autre affectation que celle sélectionnée.",
        );
      if (occurrence.swapperId !== user.id)
        throw new MockHttpError(403, "Ce shift ne vous est pas affecté.");
      if (token.consumedBy.includes(user.id))
        throw new MockHttpError(409, "Ce QR a déjà été utilisé pour ce service.");
      const station = stationOf(ctx.db, occurrence.stationId);
      const tolerance = station.latenessToleranceMinutes;
      const record = recordOf(ctx, occurrence.id);
      const start = Date.parse(occurrence.startTime);
      const end = Date.parse(occurrence.endTime);

      if (ctx.now < start || ctx.now > end)
        throw new MockHttpError(
          409,
          "Ce QR est valide, mais ce shift n’est pas dans sa fenêtre de pointage.",
        );

      if (token.kind === "CHECKIN") {
        if (record?.checkedInAt)
          throw new MockHttpError(
            409,
            "La prise de service est déjà enregistrée pour ce service.",
          );
        const late = ctx.now > Date.parse(occurrence.startTime) + tolerance * 60000;
        const created = {
          shiftId: occurrence.id,
          swapperId: user.id,
          status: late ? ("LATE" as const) : ("PRESENT" as const),
          checkedInAt: isoFromMs(ctx.now),
          checkedOutAt: null,
          isLate: late,
          justified: false,
          correction: null,
        };
        ctx.db.attendance.push(created);
        token.consumedBy.push(user.id);
        // Un pointage lève l'absence automatique encore ouverte.
        ctx.db.absences = ctx.db.absences.filter(
          (item) =>
            !(
              item.shiftId === occurrence.id &&
              item.origin === "AUTOMATIC_ABSENCE" &&
              item.status === "OPEN"
            ),
        );
        notifyStaff(
          ctx.db,
          occurrence.stationId,
          "CHECKIN",
          "Prise de service enregistrée",
          `${user.fullName} · ${occurrence.label} (${late ? "en retard" : "à l'heure"}).`,
          [user.id],
        );
        return {
          kind: "CHECKIN",
          status: created.status,
          checkedInAt: created.checkedInAt,
          toleranceMinutes: tolerance,
          timezone: station.timezone,
        };
      }

      if (!record?.checkedInAt)
        throw new MockHttpError(
          409,
          "Aucune prise de service n'est enregistrée : la fin de service est refusée.",
        );
      if (record.checkedOutAt)
        throw new MockHttpError(409, "La fin de service est déjà enregistrée.");
      record.checkedOutAt = isoFromMs(ctx.now);
      record.status = "CLOSED";
      token.consumedBy.push(user.id);
      notifyStaff(
        ctx.db,
        occurrence.stationId,
        "CHECKOUT",
        "Fin de service enregistrée",
        `${user.fullName} · ${occurrence.label}.`,
        [user.id],
      );
      return {
        kind: "CHECKOUT",
        status: "CLOSED",
        checkedInAt: record.checkedInAt,
        checkedOutAt: record.checkedOutAt,
        toleranceMinutes: tolerance,
        timezone: station.timezone,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/attendance\/monitor$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      requireRole(user, ["SUPERVISOR", "STATION_CHIEF"]);
      const stationScope = scopeStationId(user);
      const rows = publishedShiftsOfDay(ctx.db, ctx.now, stationScope)
        .filter((item) => item.swapperId)
        .map((item) => {
          const station = stationOf(ctx.db, item.stationId);
          const swapper = ctx.db.users.find((entry) => entry.id === item.swapperId)!;
          const record = recordOf(ctx, item.id);
          const status = attendanceStatus(ctx.db, item);
          return {
            shiftId: item.id,
            station: { id: station.id, name: station.name, timezone: station.timezone },
            swapper: { id: swapper.id, fullName: swapper.fullName },
            template: item.label,
            startTime: item.startTime,
            endTime: item.endTime,
            status,
            checkedInAt: record?.checkedInAt ?? null,
            checkedOutAt: record?.checkedOutAt ?? null,
            isLate: record?.isLate ?? false,
            justified: status === "JUSTIFIED",
            toleranceMinutes: station.latenessToleranceMinutes,
          };
        });
      const summary = { expected: 0, present: 0, late: 0, absent: 0, closed: 0, justified: 0 };
      for (const row of rows) {
        if (row.status === "EXPECTED") summary.expected += 1;
        else if (row.status === "PRESENT") summary.present += 1;
        else if (row.status === "LATE") summary.late += 1;
        else if (row.status === "ABSENT") summary.absent += 1;
        else if (row.status === "CLOSED") summary.closed += 1;
        else if (row.status === "JUSTIFIED") summary.justified += 1;
      }
      return {
        generatedAt: isoFromMs(ctx.now),
        stationId: stationScope,
        summary,
        rows,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/attendance\/history$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), ["SWAPPER"]);
      const fromValue = asText(ctx.query.get("from"));
      const toValue = asText(ctx.query.get("to"));
      const from = fromValue ? Date.parse(fromValue) : ctx.now - 30 * 86400000;
      const to = toValue ? Date.parse(toValue) : ctx.now + 7 * 86400000;
      const stationScope = scopeStationId(user);
      // US 2040 : un swappeur ne consulte que ses propres pointages.
      const swapperFilter = user.id;
      const published = publishedPlanningIds(ctx);
      return ctx.db.occurrences
        .filter((item) => published.has(item.planningId))
        .filter((item) => (swapperFilter ? item.swapperId === swapperFilter : true))
        .filter((item) => (stationScope ? item.stationId === stationScope : true))
        .filter(
          (item) => Date.parse(item.startTime) >= from && Date.parse(item.startTime) <= to,
        )
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
        .map((item) => {
          const station = stationOf(ctx.db, item.stationId);
          const record = recordOf(ctx, item.id);
          const status = attendanceStatus(ctx.db, item);
          return {
            shiftId: item.id,
            station: { id: station.id, name: station.name, timezone: station.timezone },
            template: item.label,
            plannedStart: item.startTime,
            plannedEnd: item.endTime,
            plannedHours: durationHours(ctx.db, item),
            checkedInAt: record?.checkedInAt ?? null,
            checkedOutAt: record?.checkedOutAt ?? null,
            isLate: record?.isLate ?? false,
            isAbsent: status === "ABSENT",
            isJustified: status === "JUSTIFIED",
            corrected: Boolean(record?.correction),
            correctedAt: record?.correction?.at ?? null,
            correctionReason: null,
          };
        });
    },
  },
];
