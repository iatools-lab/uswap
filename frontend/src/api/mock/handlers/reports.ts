import {
  durationHours,
  nextId,
  requireRole,
  requireUser,
  stationNameOf,
} from "../shared";
import { isoFromMs } from "../seed";
import { MockHttpError, type MockRoute } from "../types";

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const reportRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: /^\/admin\/settings$/,
    handler: ({ db, user }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      return {
        settings: db.globalSettings,
        history: db.settingsHistory.slice(-8).reverse(),
      };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/admin\/settings$/,
    handler: ({ db, user, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["ADMIN"]);
      const number = (key: string, min: number, max: number) => {
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value < min || value > max)
          throw new MockHttpError(
            400,
            `La valeur « ${key} » doit être comprise entre ${min} et ${max}.`,
          );
        return Math.round(value);
      };
      const supportEmail = text(body.supportEmail);
      if (!/^\S+@\S+\.\S+$/.test(supportEmail))
        throw new MockHttpError(400, "L’adresse de support est invalide.");
      const before = { ...db.globalSettings };
      const next = {
        ...db.globalSettings,
        sessionMinutes: number("sessionMinutes", 15, 720),
        invitationValidityHours: number("invitationValidityHours", 1, 168),
        maxAttachmentMb: number("maxAttachmentMb", 1, 25),
        notificationRetentionDays: number("notificationRetentionDays", 7, 365),
        supportEmail,
        webhookSecretConfigured: text(body.webhookSecret)
          ? true
          : db.globalSettings.webhookSecretConfigured,
        revision: db.globalSettings.revision + 1,
        updatedAt: isoFromMs(now),
        updatedBy: actor.id,
      };
      db.globalSettings = next;
      db.settingsHistory.push({
        id: nextId("settings"),
        revision: next.revision,
        actorId: actor.id,
        createdAt: next.updatedAt,
        before,
        after: { ...next, webhookSecret: undefined },
      });
      return {
        settings: next,
        history: db.settingsHistory.slice(-8).reverse(),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/reports\/dashboard$/,
    handler: ({ db, user, query, now }) => {
      const actor = requireRole(requireUser(db, user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const from = Date.parse(
        query.get("from") || isoFromMs(now - 30 * 86400000),
      );
      const to = Date.parse(query.get("to") || isoFromMs(now + 86400000));
      const requestedStation = text(query.get("stationId"));
      const requestedSwapper = text(query.get("swapperId"));
      const stationId =
        actor.stationId || requestedStation || null;
      const scopeStations = actor.stationId
        ? [actor.stationId]
        : db.stations.map((item) => item.id);
      const occurrences = db.occurrences
        .filter((item) => scopeStations.includes(item.stationId))
        .filter(
          (item) =>
            Date.parse(item.startTime) >= from &&
            Date.parse(item.startTime) <= to,
        )
        .filter((item) => (stationId ? item.stationId === stationId : true))
        .filter((item) =>
          requestedSwapper ? item.swapperId === requestedSwapper : true,
        );
      const attendanceRows = occurrences.map((occurrence) => ({
        occurrence,
        record: db.attendance.find((row) => row.shiftId === occurrence.id),
      }));
      const status = {
        present: 0,
        late: 0,
        absent: 0,
        closed: 0,
        expected: 0,
        justified: 0,
      };
      const details = attendanceRows.map(({ occurrence, record }) => {
        const value =
          record?.status ??
          (db.absences.some((item) => item.shiftId === occurrence.id)
            ? "ABSENT"
            : "EXPECTED");
        const key = value.toLowerCase() as keyof typeof status;
        if (key in status) status[key] += 1;
        const person = db.users.find(
          (item) => item.id === occurrence.swapperId,
        );
        return {
          id: occurrence.id,
          startTime: occurrence.startTime,
          station: stationNameOf(db, occurrence.stationId) ?? "—",
          swapper: person?.fullName ?? "Poste vacant",
          status: key,
          label: occurrence.label,
        };
      });
      const assigned = occurrences.filter((item) => item.swapperId).length;
      const hoursBySwapper = new Map<
        string,
        { name: string; station: string; hours: number }
      >();
      for (const item of occurrences.filter((row) => row.swapperId)) {
        const person = db.users.find(
          (candidate) => candidate.id === item.swapperId,
        );
        if (!person) continue;
        const current = hoursBySwapper.get(person.id) ?? {
          name: person.fullName,
          station: stationNameOf(db, item.stationId) ?? "—",
          hours: 0,
        };
        current.hours =
          Math.round((current.hours + durationHours(db, item)) * 10) / 10;
        hoursBySwapper.set(person.id, current);
      }
      const changes = db.changes
        .filter(
          (item) =>
            Date.parse(item.createdAt) >= from &&
            Date.parse(item.createdAt) <= to,
        )
        .filter((item) =>
          stationId
            ? item.stationId === stationId
            : scopeStations.includes(item.stationId),
        );
      const leaves = db.leaves.filter(
        (item) =>
          Date.parse(item.startTime) <= to &&
          Date.parse(item.endTime) >= from &&
          item.status === "APPROVED",
      );
      const stationRows = db.stations
        .filter(
          (station) =>
            station.isActive &&
            scopeStations.includes(station.id) &&
            (stationId ? station.id === stationId : true),
        )
        .map((station) => {
          const rows = occurrences.filter(
            (item) => item.stationId === station.id,
          );
          const filled = rows.filter((item) => item.swapperId).length;
          const vacant = rows.filter((item) => !item.swapperId);
          return {
            id: station.id,
            name: station.name,
            total: rows.length,
            filled,
            coverage: rows.length
              ? Math.round((filled / rows.length) * 100)
              : 0,
            futureVacant: vacant.filter(
              (item) => Date.parse(item.startTime) >= now,
            ).length,
            pastVacant: vacant.filter(
              (item) => Date.parse(item.startTime) < now,
            ).length,
            risk: vacant.some((item) => Date.parse(item.startTime) >= now)
              ? "AT_RISK"
              : "STABLE",
            incidents: db.incidents.filter(
              (item) =>
                item.stationId === station.id &&
                !["RESOLVED", "CLOSED"].includes(item.status),
            ).length,
          };
        });
      const swappers = db.users
        .filter(
          (item) =>
            item.role === "SWAPPER" &&
            item.isActive &&
            scopeStations.includes(item.stationId || ""),
        )
        .filter((item) => (stationId ? item.stationId === stationId : true))
        .map((item) => ({ id: item.id, name: item.fullName }));
      return {
        period: {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
        },
        filters: { stationId, swapperId: requestedSwapper || null },
        stations: db.stations
          .filter((item) => item.isActive && scopeStations.includes(item.id))
          .map((item) => ({ id: item.id, name: item.name })),
        swappers,
        kpis: {
          shifts: occurrences.length,
          coverageRate: occurrences.length
            ? Math.round((assigned / occurrences.length) * 100)
            : 0,
          attendanceRate: assigned
            ? Math.round(
                ((status.present + status.closed + status.late) / assigned) *
                  100,
              )
            : 0,
          absences: status.absent,
          late: status.late,
          approvedLeaves: leaves.length,
          leavesSynced: leaves.length,
          leavesPendingSync: 0,
          leavesFailedSync: 0,
          movements: changes.length,
          totalHours: Array.from(hoursBySwapper.values()).reduce(
            (sum, row) => sum + row.hours,
            0,
          ),
          futureVacant: stationRows.reduce(
            (sum, row) => sum + row.futureVacant,
            0,
          ),
          pastVacant: stationRows.reduce((sum, row) => sum + row.pastVacant, 0),
        },
        attendance: status,
        details,
        stationRows,
        hours: Array.from(hoursBySwapper.values())
          .sort((a, b) => b.hours - a.hours)
          .slice(0, 8),
        hoursByStation: Array.from(new Map(occurrences.filter((row) => row.swapperId).map((row) => [row.stationId, row])).entries()).map(([stationId]) => ({ station: stationNameOf(db, stationId) ?? "—", hours: occurrences.filter((row) => row.stationId === stationId && row.swapperId).reduce((sum, row) => sum + durationHours(db, row), 0) })),
        hoursByWeek: [],
        hoursByMonth: [],
        changes: changes.map((item) => ({
          date: item.createdAt,
          station: item.station,
          type: item.type,
          from: item.outSwapper,
          to: item.inSwapper,
        })),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/admin\/reports\/schedules\/preview$/,
    handler: async ({ user, db, body }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      const stationId = text(body.stationId) || undefined;
      const dashboard = await reportRoutes[2].handler({
        method: "GET", path: "/reports/dashboard", params: [], query: new URLSearchParams({ ...(stationId ? { stationId } : {}) }), body: {}, file: null, db, user, now: Date.now(),
      } as never);
      return dashboard;
    },
  },
  {
    method: "GET",
    pattern: /^\/admin\/reports\/schedules\/([^/]+)\/runs$/,
    handler: ({ db, user, params }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      return [];
    },
  },
  {
    method: "GET",
    pattern: /^\/reports\/export$/,
    handler: ({ user, db }) => requireRole(requireUser(db, user), ["ADMIN", "SUPERVISOR"]),
  },
  {
    method: "GET",
    pattern: /^\/admin\/reports\/schedules$/,
    handler: ({ db, user }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      return db.scheduledReports
        .slice()
        .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
    },
  },
  {
    method: "POST",
    pattern: /^\/admin\/reports\/schedules$/,
    handler: ({ db, user, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["ADMIN"]);
      const name = text(body.name);
      const recipients = Array.isArray(body.recipients)
        ? body.recipients.map(text).filter((value) => value.includes("@"))
        : [];
      if (name.length < 4 || !recipients.length)
        throw new MockHttpError(
          400,
          "Indiquez un nom et au moins un destinataire valide.",
        );
      const frequency = (
        ["DAILY", "WEEKLY", "MONTHLY"].includes(text(body.frequency))
          ? text(body.frequency)
          : "WEEKLY"
      ) as "DAILY" | "WEEKLY" | "MONTHLY";
      const delay =
        frequency === "DAILY"
          ? 86400000
          : frequency === "WEEKLY"
            ? 7 * 86400000
            : 30 * 86400000;
      const created = {
        id: nextId("report"),
        ownerId: actor.id,
        name,
        frequency,
        format:
          text(body.format) === "CSV" ? ("CSV" as const) : ("XLSX" as const),
        scope: "NETWORK" as const,
        stationId: null,
        recipients,
        sections: ["ATTENDANCE", "COVERAGE", "HOURS", "MOVEMENTS"],
        isActive: true,
        nextRunAt: isoFromMs(now + delay),
        lastRunAt: null,
        createdAt: isoFromMs(now),
      };
      db.scheduledReports.push(created);
      return created;
    },
  },
  {
    method: "PATCH",
    pattern: /^\/admin\/reports\/schedules\/([^/]+)$/,
    handler: ({ db, user, params, body }) => {
      requireRole(requireUser(db, user), ["ADMIN"]);
      const report = db.scheduledReports.find((item) => item.id === params[0]);
      if (!report)
        throw new MockHttpError(404, "Rapport programmé introuvable.");
      report.isActive = body.isActive === true;
      return report;
    },
  },
];
