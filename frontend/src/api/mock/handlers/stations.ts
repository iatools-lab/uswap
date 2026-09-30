import { nextId, requireRole, requireUser, stationOf } from "../shared";
import { MockHttpError, type MockRoute, type MockStation, type MockTemplate } from "../types";

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function stationPayload(body: Record<string, unknown>, current?: MockStation): Partial<MockStation> {
  return {
    name: asText(body.name) || current?.name,
    address: asText(body.address) || null,
    city: asText(body.city) || null,
    latitude: body.latitude === null || body.latitude === "" ? null : asNumber(body.latitude, current?.latitude ?? 0),
    longitude: body.longitude === null || body.longitude === "" ? null : asNumber(body.longitude, current?.longitude ?? 0),
    location: asText(body.location) || null,
    timezone: asText(body.timezone) || current?.timezone || "Africa/Douala",
    contactName: asText(body.contactName) || null,
    contactPhone: asText(body.contactPhone) || null,
    latenessToleranceMinutes: asNumber(body.latenessToleranceMinutes, current?.latenessToleranceMinutes ?? 5),
    minRestHours: asNumber(body.minRestHours, current?.minRestHours ?? 8),
    weeklyHoursLimit: asNumber(body.weeklyHoursLimit, current?.weeklyHoursLimit ?? 48),
    checkinQrTtl: Math.max(30, asNumber(body.checkinQrTtl, current?.checkinQrTtl ?? 300)),
    checkoutQrTtl: Math.max(30, asNumber(body.checkoutQrTtl, current?.checkoutQrTtl ?? 300)),
  };
}

const templatePayload = (body: Record<string, unknown>) => ({
  label: asText(body.label),
  startTime: asText(body.startTime),
  endTime: asText(body.endTime),
  breakStart: asText(body.breakStart) || null,
  breakEnd: asText(body.breakEnd) || null,
});

const slotMinutes = (start: string, end: string) => {
  const minutes = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return (minutes(end) - minutes(start) + 1440) % 1440;
};

export const stationRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: /^\/stations$/,
    handler: (ctx) => {
      requireUser(ctx.db, ctx.user);
      return ctx.db.stations;
    },
  },
  {
    method: "POST",
    pattern: /^\/stations$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const payload = stationPayload(ctx.body);
      if (!payload.name) throw new MockHttpError(400, "Le nom de la station est obligatoire.");
      if (ctx.db.stations.some((item) => item.name.toLowerCase() === payload.name!.toLowerCase()))
        throw new MockHttpError(409, "Une station porte déjà ce nom.");
      const created: MockStation = {
        id: nextId("st"),
        name: payload.name!,
        address: payload.address ?? null,
        city: payload.city ?? null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        location: payload.location ?? null,
        timezone: payload.timezone ?? "Africa/Douala",
        contactName: payload.contactName ?? null,
        contactPhone: payload.contactPhone ?? null,
        isActive: true,
        latenessToleranceMinutes: payload.latenessToleranceMinutes ?? 5,
        minRestHours: payload.minRestHours ?? 8,
        weeklyHoursLimit: payload.weeklyHoursLimit ?? 48,
        checkinQrTtl: payload.checkinQrTtl ?? 300,
        checkoutQrTtl: payload.checkoutQrTtl ?? 300,
      };
      ctx.db.stations.push(created);
      return created;
    },
  },
  {
    method: "PATCH",
    pattern: /^\/stations\/([^/]+)\/(activate|deactivate)$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const station = stationOf(ctx.db, ctx.params[0]);
      const active = ctx.params[1] === "activate";
      if (!active) {
        const pending = ctx.db.occurrences.filter(
          (item) => item.stationId === station.id && Date.parse(item.endTime) > Date.now(),
        );
        if (pending.length)
          throw new MockHttpError(
            409,
            `Impossible de désactiver : ${pending.length} affectation(s) à venir sur cette station.`,
          );
      }
      station.isActive = active;
      return { ok: true, isActive: station.isActive };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/stations\/([^/]+)$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const station = stationOf(ctx.db, ctx.params[0]);
      const payload = stationPayload(ctx.body, station);
      if (!payload.name) throw new MockHttpError(400, "Le nom de la station est obligatoire.");
      if (
        ctx.db.stations.some(
          (item) =>
            item.id !== station.id && item.name.toLowerCase() === payload.name!.toLowerCase(),
        )
      )
        throw new MockHttpError(409, "Une autre station porte déjà ce nom.");
      Object.assign(station, payload);
      return station;
    },
  },
  {
    method: "GET",
    pattern: /^\/stations\/([^/]+)\/shift-templates$/,
    handler: (ctx) => {
      requireUser(ctx.db, ctx.user);
      stationOf(ctx.db, ctx.params[0]);
      return ctx.db.templates
        .filter((item) => item.stationId === ctx.params[0])
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
    },
  },
  {
    method: "POST",
    pattern: /^\/stations\/([^/]+)\/shift-templates$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const station = stationOf(ctx.db, ctx.params[0]);
      const payload = templatePayload(ctx.body);
      if (!payload.label || !payload.startTime || !payload.endTime)
        throw new MockHttpError(400, "Libellé, début et fin du modèle sont obligatoires.");
      if (slotMinutes(payload.startTime, payload.endTime) === 0)
        throw new MockHttpError(400, "Le créneau doit avoir une durée supérieure à zéro.");
      if (payload.breakStart !== payload.breakEnd && (!payload.breakStart || !payload.breakEnd))
        throw new MockHttpError(400, "Renseignez le début et la fin de la pause.");
      if (
        ctx.db.templates.some(
          (item) =>
            item.stationId === station.id &&
            item.startTime === payload.startTime &&
            item.endTime === payload.endTime,
        )
      )
        throw new MockHttpError(409, "Un modèle occupe déjà ce créneau sur cette station.");
      const base = {
        id: nextId("tpl"),
        stationId: station.id,
        label: payload.label,
        startTime: payload.startTime,
        endTime: payload.endTime,
        breakStart: payload.breakStart,
        breakEnd: payload.breakEnd,
        breakMinutes:
          payload.breakStart && payload.breakEnd
            ? slotMinutes(payload.breakStart, payload.breakEnd)
            : 0,
        durationMinutes: slotMinutes(payload.startTime, payload.endTime),
        isActive: true,
        revision: 1,
      };
      const created: MockTemplate = {
        ...base,
        versions: [{ ...base, createdAt: new Date().toISOString() }],
      };
      ctx.db.templates.push(created);
      return created;
    },
  },
  {
    method: "GET",
    pattern: /^\/stations\/([^/]+)\/shift-templates\/([^/]+)\/history$/,
    handler: (ctx) => {
      requireUser(ctx.db, ctx.user);
      const template = ctx.db.templates.find(
        (item) => item.id === ctx.params[1] && item.stationId === ctx.params[0],
      );
      if (!template) throw new MockHttpError(404, "Modèle de shift introuvable.");
      return [...template.versions].reverse();
    },
  },
  {
    method: "PATCH",
    pattern: /^\/stations\/([^/]+)\/shift-templates\/([^/]+)$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const template = ctx.db.templates.find(
        (item) => item.id === ctx.params[1] && item.stationId === ctx.params[0],
      );
      if (!template) throw new MockHttpError(404, "Modèle de shift introuvable.");
      if (typeof ctx.body.revision === "number" && ctx.body.revision !== template.revision)
        throw new MockHttpError(
          409,
          "Ce modèle a été modifié entre-temps. Rechargez la liste.",
        );
      const payload = templatePayload(ctx.body);
      if (payload.label) template.label = payload.label;
      if (payload.startTime && payload.endTime) {
        if (slotMinutes(payload.startTime, payload.endTime) === 0)
          throw new MockHttpError(400, "Le créneau doit avoir une durée supérieure à zéro.");
        template.startTime = payload.startTime;
        template.endTime = payload.endTime;
        template.durationMinutes = slotMinutes(payload.startTime, payload.endTime);
      }
      if ("breakStart" in ctx.body || "breakEnd" in ctx.body) {
        template.breakStart = asText(ctx.body.breakStart) || null;
        template.breakEnd = asText(ctx.body.breakEnd) || null;
        if (template.breakStart !== template.breakEnd && (!template.breakStart || !template.breakEnd))
          throw new MockHttpError(400, "Renseignez le début et la fin de la pause.");
        template.breakMinutes =
          template.breakStart && template.breakEnd
            ? slotMinutes(template.breakStart, template.breakEnd)
            : 0;
      }
      if (typeof ctx.body.isActive === "boolean") template.isActive = ctx.body.isActive;
      template.revision += 1;
      const { versions: _versions, ...snapshot } = template;
      template.versions.push({ ...snapshot, createdAt: new Date().toISOString() });
      return template;
    },
  },
];
