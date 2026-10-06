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
import { MockHttpError, type MockCtx, type MockRoute } from "../types";

const asText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
/** Pointage enregistré d'une affectation, s'il existe. */
const recordOf = (ctx: MockCtx, shiftId: string) =>
  ctx.db.attendance.find((item) => item.shiftId === shiftId) ?? null;

const publishedPlanningIds = (ctx: MockCtx) =>
  new Set(
    ctx.db.plannings
      .filter((item) => item.status === "PUBLISHED")
      .map((item) => item.id),
  );

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
          .filter(
            (item) =>
              item.swapperId === user.id && published.has(item.planningId),
          )
          .filter((item) => Date.parse(item.endTime) > windowStart)
          .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
          .slice(0, limit)
          .map((item) => {
            const record = recordOf(ctx, item.id);
            const station = stationOf(ctx.db, item.stationId);
            return {
              id: item.id,
              planningId: item.planningId,
              templateId: item.templateId,
              label: item.label,
              startTime: item.startTime,
              endTime: item.endTime,
              publishedAt:
                ctx.db.plannings.find((pl) => pl.id === item.planningId)
                  ?.publishedAt ?? null,
              station: {
                id: station.id,
                name: station.name,
                timezone: station.timezone,
                latitude: station.latitude,
                longitude: station.longitude,
                geofenceRadiusMeters: station.geofenceRadiusMeters,
                latenessToleranceMinutes: station.latenessToleranceMinutes,
              },
              swapper: { fullName: user.fullName },
              attendance: record?.checkedInAt
                ? {
                    status: record.status,
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
        .filter((item) =>
          stationScope ? item.stationId === stationScope : true,
        )
        .filter((item) => published.has(item.planningId))
        .filter((item) => Date.parse(item.endTime) > windowStart)
        .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
        .slice(0, limit)
        .map((item) => {
          const target = stationOf(ctx.db, item.stationId);
          const swapper = item.swapperId
            ? (ctx.db.users.find((entry) => entry.id === item.swapperId) ??
              null)
            : null;
          const record = recordOf(ctx, item.id);
          return {
            id: item.id,
            planningId: item.planningId,
            templateId: item.templateId,
            label: item.label,
            startTime: item.startTime,
            endTime: item.endTime,
            publishedAt:
              ctx.db.plannings.find((pl) => pl.id === item.planningId)
                ?.publishedAt ?? null,
            station: {
              id: target.id,
              name: target.name,
              timezone: target.timezone,
              latitude: target.latitude,
              longitude: target.longitude,
              geofenceRadiusMeters: target.geofenceRadiusMeters,
              latenessToleranceMinutes: target.latenessToleranceMinutes,
            },
            swapper: { fullName: swapper?.fullName ?? "Poste vacant" },
            attendance: record?.checkedInAt
              ? {
                  status: record.status,
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
              latitude: station.latitude,
              longitude: station.longitude,
              geofenceRadiusMeters: station.geofenceRadiusMeters,
              latenessToleranceMinutes: station.latenessToleranceMinutes,
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
      requireRole(user, ["ADMIN", "SUPERVISOR"]);
      const startTime = asText(ctx.body.startTime);
      const endTime = asText(ctx.body.endTime);
      const stationId = asText(ctx.body.stationId);
      const swapperId = asText(ctx.body.swapperId);
      if (!startTime || !endTime || !stationId || !swapperId)
        throw new MockHttpError(
          400,
          "Contrôle incomplet : station, swappeur et créneau requis.",
        );
      return constraintReport(ctx.db, {
        stationId,
        swapperId,
        startTime,
        endTime,
        hours:
          Math.round(
            ((Date.parse(endTime) - Date.parse(startTime)) / 3600000) * 100,
          ) / 100,
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/attendance$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), ["SWAPPER"]);
      const shiftId = asText(ctx.body.shiftId);
      const rawKind = asText(ctx.body.kind).toUpperCase();
      if (rawKind !== "CHECKIN" && rawKind !== "CHECKOUT")
        throw new MockHttpError(
          400,
          "Choisissez une prise ou une fin de service valide.",
        );
      const kind = rawKind;
      const latitude = Number(ctx.body.latitude);
      const longitude = Number(ctx.body.longitude);
      const accuracyMeters = Number(ctx.body.accuracyMeters);
      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      )
        throw new MockHttpError(
          400,
          "La position n’a pas pu être vérifiée. Autorisez la localisation puis réessayez.",
        );

      const occurrence = occurrenceOf(ctx.db, shiftId);
      const planning = ctx.db.plannings.find(
        (item) => item.id === occurrence.planningId,
      );
      if (planning?.status !== "PUBLISHED" || occurrence.swapperId !== user.id)
        throw new MockHttpError(
          403,
          "Ce shift publié ne vous est pas affecté.",
        );
      const station = stationOf(ctx.db, occurrence.stationId);
      if (
        station.latitude === null ||
        station.longitude === null ||
        !Number.isFinite(station.latitude) ||
        station.latitude < -90 ||
        station.latitude > 90 ||
        !Number.isFinite(station.longitude) ||
        station.longitude < -180 ||
        station.longitude > 180
      )
        throw new MockHttpError(
          409,
          "La position de cette station n’est pas configurée. Contactez le superviseur.",
        );

      const radians = (degrees: number) => (degrees * Math.PI) / 180;
      const earthRadius = 6_371_000;
      const deltaLat = radians(latitude - station.latitude);
      const deltaLng = radians(longitude - station.longitude);
      const haversine = Math.min(
        1,
        Math.max(
          0,
          Math.sin(deltaLat / 2) ** 2 +
            Math.cos(radians(station.latitude)) *
              Math.cos(radians(latitude)) *
              Math.sin(deltaLng / 2) ** 2,
        ),
      );
      const distanceMeters = Math.round(
        earthRadius *
          2 *
          Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)),
      );
      const radius = station.geofenceRadiusMeters;
      if (!Number.isFinite(radius) || radius < 25)
        throw new MockHttpError(
          409,
          "Le périmètre de pointage de cette station est invalide. Contactez le superviseur.",
        );
      if (
        !Number.isFinite(accuracyMeters) ||
        accuracyMeters < 0 ||
        accuracyMeters > radius
      )
        throw new MockHttpError(
          409,
          "Votre position manque de précision pour vérifier le périmètre. Réessayez avec le GPS activé.",
        );
      if (distanceMeters + accuracyMeters > radius)
        throw new MockHttpError(
          403,
          `Pointage refusé : votre position est estimée à ${distanceMeters} m de ${station.name}; le périmètre autorisé est de ${radius} m et la précision GPS ne permet pas de confirmer que vous êtes dedans.`,
        );

      const start = Date.parse(occurrence.startTime);
      const end = Date.parse(occurrence.endTime);
      const record = recordOf(ctx, occurrence.id);
      const tolerance = station.latenessToleranceMinutes;
      if (kind === "CHECKIN") {
        if (ctx.now < start || ctx.now > end)
          throw new MockHttpError(
            409,
            "La prise de service est possible uniquement pendant le créneau prévu.",
          );
        if (record?.checkedInAt)
          throw new MockHttpError(
            409,
            "La prise de service est déjà enregistrée pour ce shift.",
          );
        const late = ctx.now > start + tolerance * 60_000;
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
        ctx.db.absences = ctx.db.absences.filter(
          (item) =>
            !(
              item.shiftId === occurrence.id &&
              item.origin === "AUTOMATIC_ABSENCE" &&
              item.status === "OPEN"
            ),
        );
        ctx.db.automatedAbsences = ctx.db.automatedAbsences.filter(
          (id) => id !== occurrence.id,
        );
        notifyStaff(
          ctx.db,
          occurrence.stationId,
          "CHECKIN",
          "Prise de service enregistrée",
          `${user.fullName} · ${occurrence.label} (${late ? "en retard" : "à l'heure"}).`,
          [user.id],
          occurrence.id,
        );
        return {
          kind,
          status: created.status,
          checkedInAt: created.checkedInAt,
          toleranceMinutes: tolerance,
          timezone: station.timezone,
          distanceMeters,
        };
      }

      if (!record?.checkedInAt)
        throw new MockHttpError(
          409,
          "La fin de service nécessite une prise de service enregistrée.",
        );
      if (record.checkedOutAt)
        throw new MockHttpError(409, "La fin de service est déjà enregistrée.");
      if (ctx.now > end + 5 * 60_000)
        throw new MockHttpError(
          409,
          "La fenêtre de fin de service est dépassée. Le superviseur peut corriger le pointage.",
        );
      record.checkedOutAt = isoFromMs(ctx.now);
      record.status = "CLOSED";
      notifyStaff(
        ctx.db,
        occurrence.stationId,
        "CHECKOUT",
        "Fin de service enregistrée",
        `${user.fullName} · ${occurrence.label}.`,
        [user.id],
        occurrence.id,
      );
      return {
        kind,
        status: "CLOSED",
        checkedInAt: record.checkedInAt,
        checkedOutAt: record.checkedOutAt,
        toleranceMinutes: tolerance,
        timezone: station.timezone,
        distanceMeters,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/shifts$/,
    handler: (ctx) => {
      const user = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const scope = scopeStationId(user);
      return ctx.db.occurrences
        .filter((item) => (scope ? item.stationId === scope : true))
        .map((item) => {
          const station = stationOf(ctx.db, item.stationId);
          const swapper = item.swapperId
            ? (ctx.db.users.find((entry) => entry.id === item.swapperId) ??
              null)
            : null;
          const record = recordOf(ctx, item.id);
          return {
            id: item.id,
            startTime: item.startTime,
            endTime: item.endTime,
            publishedAt:
              ctx.db.plannings.find(
                (planning) => planning.id === item.planningId,
              )?.publishedAt ?? null,
            station: {
              id: station.id,
              name: station.name,
              timezone: station.timezone,
              latenessToleranceMinutes: station.latenessToleranceMinutes,
            },
            swapper: swapper
              ? { id: swapper.id, fullName: swapper.fullName }
              : null,
            templateVersion: { label: item.label },
            attendance: record
              ? {
                  checkedInAt: record.checkedInAt,
                  checkedOutAt: record.checkedOutAt,
                  isLate: record.isLate,
                  isAbsent: record.status === "ABSENT",
                }
              : null,
          };
        });
    },
  },
  {
    method: "GET",
    pattern: /^\/attendance$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      requireRole(user, ["ADMIN", "SUPERVISOR"]);
      const stationScope = scopeStationId(user);
      const published = publishedPlanningIds(ctx);
      return ctx.db.occurrences
        .filter((item) => published.has(item.planningId))
        .filter((item) => Date.parse(item.startTime) <= ctx.now)
        .filter((item) => item.swapperId)
        .filter((item) =>
          stationScope ? item.stationId === stationScope : true,
        )
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
        .map((item) => {
          const station = stationOf(ctx.db, item.stationId);
          const swapper = ctx.db.users.find(
            (entry) => entry.id === item.swapperId,
          )!;
          const record = recordOf(ctx, item.id);
          return {
            id: `attendance-${item.id}`,
            shiftId: item.id,
            status: attendanceStatus(ctx.db, item),
            checkInAt: record?.checkedInAt ?? null,
            checkOutAt: record?.checkedOutAt ?? null,
            isLate: record?.isLate ?? false,
            correctedAt: record?.correction?.at ?? null,
            correctionReason: record?.correction?.reason ?? null,
            station: {
              id: station.id,
              name: station.name,
              timezone: station.timezone,
              latenessToleranceMinutes: station.latenessToleranceMinutes,
            },
            swapper: { id: swapper.id, fullName: swapper.fullName },
            shift: {
              startTime: item.startTime,
              endTime: item.endTime,
              template: { label: item.label },
              station: {
                id: station.id,
                name: station.name,
                timezone: station.timezone,
                latenessToleranceMinutes: station.latenessToleranceMinutes,
              },
              swapper: { id: swapper.id, fullName: swapper.fullName },
            },
          };
        });
    },
  },
  {
    method: "GET",
    pattern: /^\/attendance\/monitor$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      requireRole(user, ["SUPERVISOR"]);
      const stationScope = scopeStationId(user);
      const rows = publishedShiftsOfDay(ctx.db, ctx.now, stationScope)
        .filter((item) => item.swapperId)
        .map((item) => {
          const station = stationOf(ctx.db, item.stationId);
          const swapper = ctx.db.users.find(
            (entry) => entry.id === item.swapperId,
          )!;
          const record = recordOf(ctx, item.id);
          const status = attendanceStatus(ctx.db, item);
          return {
            shiftId: item.id,
            station: {
              id: station.id,
              name: station.name,
              timezone: station.timezone,
            },
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
      const summary = {
        expected: 0,
        present: 0,
        late: 0,
        absent: 0,
        closed: 0,
        justified: 0,
      };
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
      const user = requireRole(requireUser(ctx.db, ctx.user), [
        "SWAPPER",
        "SUPERVISOR",
        "ADMIN",
      ]);
      const fromValue = asText(ctx.query.get("from"));
      const toValue = asText(ctx.query.get("to"));
      const from = fromValue
        ? Date.parse(fromValue)
        : user.role === "SWAPPER"
          ? ctx.now - 30 * 86400000
          : Number.NEGATIVE_INFINITY;
      const to = toValue
        ? Date.parse(toValue)
        : user.role === "SWAPPER"
          ? ctx.now + 7 * 86400000
          : Number.POSITIVE_INFINITY;
      const stationScope = scopeStationId(user);
      // US 2040 : un swappeur ne consulte que ses propres pointages.
      const swapperFilter = user.role === "SWAPPER" ? user.id : null;
      const published = publishedPlanningIds(ctx);
      return ctx.db.occurrences
        .filter((item) => published.has(item.planningId))
        .filter((item) =>
          swapperFilter ? item.swapperId === swapperFilter : true,
        )
        .filter((item) =>
          stationScope ? item.stationId === stationScope : true,
        )
        .filter(
          (item) =>
            Date.parse(item.startTime) >= from &&
            Date.parse(item.startTime) <= to,
        )
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
        .map((item) => {
          const station = stationOf(ctx.db, item.stationId);
          const record = recordOf(ctx, item.id);
          const status = attendanceStatus(ctx.db, item);
          return {
            shiftId: item.id,
            station: {
              id: station.id,
              name: station.name,
              timezone: station.timezone,
            },
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
