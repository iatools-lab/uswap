import { stationIso } from "../seed";
import { constraintReport } from "../constraints";
import {
  durationHours,
  nextId,
  notifyStaff,
  notifyUser,
  occurrenceView,
  planningView,
  planningViewFor,
  planningScopeOf,
  canReadPlanning,
  requireRole,
  requireUser,
  stationOf,
} from "../shared";
import {
  MockHttpError,
  type MockCtx,
  type MockOccurrence,
  type MockPlanning,
  type MockRoute,
} from "../types";

const asText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const pad = (value: number) => String(value).padStart(2, "0");
const dayKeyOfIso = (iso: string) => iso.slice(0, 10);

const dayList = (startIso: string, endIso: string): string[] => {
  const result: string[] = [];
  for (
    let cursor = Date.parse(startIso);
    cursor <= Date.parse(endIso);
    cursor += 86400000
  ) {
    const date = new Date(cursor);
    result.push(
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    );
  }
  return result;
};

/** 1 = lundi … 7 = dimanche, comme les jours du formulaire de génération. */
const isoWeekday = (dayKey: string) => {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

type Candidate = {
  templateId: string;
  label: string;
  stationName: string;
  timezone: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number;
};

/** Occurrences que la génération produirait pour la sélection demandée. */
function candidateWindows(
  ctx: MockCtx,
  planningId: string,
  body: Record<string, unknown>,
) {
  const planning = ctx.db.plannings.find((item) => item.id === planningId);
  if (!planning) throw new MockHttpError(404, "Planning introuvable.");
  const station = stationOf(ctx.db, asText(body.stationId));
  const templateIds = Array.isArray(body.templateIds)
    ? body.templateIds.map((value) => String(value))
    : [];
  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.map(Number)
    : [];
  if (!templateIds.length)
    throw new MockHttpError(400, "Sélectionnez au moins un modèle de shift.");
  if (!weekdays.length)
    throw new MockHttpError(
      400,
      "Sélectionnez au moins un jour de la semaine.",
    );

  const templates = ctx.db.templates.filter(
    (item) => item.stationId === station.id && templateIds.includes(item.id),
  );
  if (!templates.length)
    throw new MockHttpError(
      400,
      "Aucun modèle ne correspond à cette sélection.",
    );

  const existing = new Set(
    ctx.db.occurrences
      .filter((item) => item.planningId === planning.id)
      .map((item) => `${item.templateId}|${item.startTime}`),
  );

  const occurrences: Candidate[] = [];
  const duplicates: { startTime: string; label: string }[] = [];

  for (const dayKey of dayList(planning.startDate, planning.endDate)) {
    if (!weekdays.includes(isoWeekday(dayKey))) continue;
    for (const template of templates) {
      const crosses = template.startTime >= template.endTime;
      const [year, month, day] = dayKey.split("-").map(Number);
      const next = new Date(Date.UTC(year, month - 1, day + 1));
      const nextKey = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
      const startTime = stationIso(dayKey, template.startTime);
      const endTime = stationIso(crosses ? nextKey : dayKey, template.endTime);
      if (existing.has(`${template.id}|${startTime}`)) {
        duplicates.push({ startTime, label: template.label });
        continue;
      }
      occurrences.push({
        templateId: template.id,
        label: template.label,
        stationName: station.name,
        timezone: station.timezone,
        startTime,
        endTime,
        durationHours:
          Math.round(
            ((Date.parse(endTime) - Date.parse(startTime)) / 3600000 -
              template.breakMinutes / 60) *
              100,
          ) / 100,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: template.breakMinutes,
      });
    }
  }
  return { planning, station, occurrences, duplicates };
}

export const planningRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: /^\/plannings$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      const scope = planningScopeOf(user);
      // Tri « le plus utile d'abord » : le planning qui couvre la période en
      // cours d'abord, puis les publiés à venir, puis les brouillons. Sans
      // cela, une semaine future encore vide passerait devant la semaine
      // réellement en activité, ce qui est contre-intuitif.
      const today = new Date().toISOString().slice(0, 10);
      const relevance = (item: MockPlanning) => {
        const start = item.startDate.slice(0, 10);
        const end = item.endDate.slice(0, 10);
        if (start <= today && end >= today) return 0;
        if (item.status === "PUBLISHED") return 1;
        return 2;
      };
      // La liste ne contient que ce que l'utilisateur peut légitimement voir :
      // un swappeur ne reçoit ni les brouillons, ni les autres stations.
      return [...ctx.db.plannings]
        .filter((item) =>
          scope.publishedOnly ? item.status === "PUBLISHED" : true,
        )
        .filter((item) => canReadPlanning(ctx.db, item.id, user))
        .sort(
          (a, b) =>
            relevance(a) - relevance(b) ||
            Date.parse(b.startDate) - Date.parse(a.startDate),
        )
        .map((item) => planningViewFor(ctx.db, item.id, user));
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const startDate = asText(ctx.body.startDate);
      const name = asText(ctx.body.name);
      if (!name || name.length > 100)
        throw new MockHttpError(400, "Indiquez un nom de planning de 1 à 100 caractères.");
      const endDate = asText(ctx.body.endDate);
      if (!startDate || !endDate)
        throw new MockHttpError(400, "Période incomplète.");
      if (!(Date.parse(endDate) > Date.parse(startDate)))
        throw new MockHttpError(400, "La fin de période doit suivre le début.");
      if (dayList(startDate, endDate).length > 62)
        throw new MockHttpError(
          400,
          "La période ne peut pas dépasser 62 jours.",
        );
      const duplicate = ctx.db.plannings.find(
        (item) =>
          dayKeyOfIso(item.startDate) === dayKeyOfIso(startDate) &&
          dayKeyOfIso(item.endDate) === dayKeyOfIso(endDate),
      );
      if (duplicate)
        throw new MockHttpError(409, "Un planning couvre déjà cette période.");
      const created = {
        id: nextId("pl"),
        name,
        startDate,
        endDate,
        status: "DRAFT" as const,
        revision: 1,
        createdAt: new Date().toISOString(),
        publishedAt: null,
      };
      ctx.db.plannings.push(created);
      return planningView(ctx.db, created.id);
    },
  },
  {
    method: "GET",
    pattern: /^\/plannings\/notices$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      return ctx.db.notices
        .filter((item) => item.userId === user.id)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((item) => ({
          id: item.id,
          planningId: item.planningId,
          readAt: item.readAt,
          createdAt: item.createdAt,
        }));
    },
  },
  {
    method: "PATCH",
    pattern: /^\/plannings\/notices\/([^/]+)\/read$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      const notice = ctx.db.notices.find(
        (item) => item.id === ctx.params[0] && item.userId === user.id,
      );
      if (!notice) throw new MockHttpError(404, "Avis introuvable.");
      notice.readAt = new Date().toISOString();
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/preview$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const { occurrences, duplicates } = candidateWindows(
        ctx,
        ctx.params[0],
        ctx.body,
      );
      return {
        previewHash: nextId("prev"),
        occurrences,
        duplicates,
        outside: [],
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/generate$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const { planning, occurrences } = candidateWindows(
        ctx,
        ctx.params[0],
        ctx.body,
      );
      if (
        typeof ctx.body.revision === "number" &&
        ctx.body.revision !== planning.revision
      )
        throw new MockHttpError(
          409,
          "Ce planning a été modifié entre-temps. Rechargez-le avant d'ajouter des shifts.",
        );
      let sequence = ctx.db.occurrences.filter(
        (item) => item.planningId === planning.id,
      ).length;
      for (const candidate of occurrences) {
        ctx.db.occurrences.push({
          id: `${planning.id}-occ-${sequence++}`,
          planningId: planning.id,
          stationId: ctx.db.templates.find(
            (item) => item.id === candidate.templateId,
          )!.stationId,
          templateId: candidate.templateId,
          label: candidate.label,
          breakStart: candidate.breakStart,
          breakEnd: candidate.breakEnd,
          breakMinutes: candidate.breakMinutes,
          swapperId: null,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
        } as MockOccurrence);
      }
      planning.revision += 1;
      return planningView(ctx.db, planning.id);
    },
  },
  {
    method: "GET",
    pattern: /^\/plannings\/([^/]+)$/,
    handler: (ctx) => {
      const user = requireUser(ctx.db, ctx.user);
      if (!ctx.db.plannings.some((item) => item.id === ctx.params[0]))
        throw new MockHttpError(404, "Planning introuvable.");
      if (!canReadPlanning(ctx.db, ctx.params[0], user))
        throw new MockHttpError(
          403,
          "Ce planning ne concerne pas votre périmètre.",
        );
      return planningViewFor(ctx.db, ctx.params[0], user);
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/occurrences\/([^/]+)\/duplicate$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      const source = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!planning || !source)
        throw new MockHttpError(404, "Poste introuvable.");
      if (
        typeof ctx.body.revision === "number" &&
        ctx.body.revision !== planning.revision
      )
        throw new MockHttpError(409, "Le planning a changé. Rechargez-le.");
      const duplicate: MockOccurrence = {
        ...source,
        id: nextId("occ"),
        swapperId: null,
      };
      ctx.db.occurrences.push(duplicate);
      planning.revision += 1;
      return { ok: true, id: duplicate.id, revision: planning.revision };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/occurrences\/([^/]+)\/remove$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      const target = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!planning || !target)
        throw new MockHttpError(404, "Poste introuvable.");
      if (
        typeof ctx.body.revision === "number" &&
        ctx.body.revision !== planning.revision
      )
        throw new MockHttpError(409, "Le planning a changé. Rechargez-le.");
      if (ctx.db.attendance.some((item) => item.shiftId === target.id))
        throw new MockHttpError(
          409,
          "Ce poste porte déjà un pointage : il ne peut plus être retiré.",
        );
      ctx.db.occurrences = ctx.db.occurrences.filter(
        (item) => item.id !== target.id,
      );
      planning.revision += 1;
      return { ok: true, revision: planning.revision };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/occurrences\/([^/]+)\/validate$/,
    handler: (ctx) => {
      requireUser(ctx.db, ctx.user);
      const occurrence = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!occurrence) throw new MockHttpError(404, "Poste introuvable.");
      const swapperId = asText(ctx.body.swapperId);
      if (!swapperId) throw new MockHttpError(400, "Sélectionnez un swappeur.");
      return constraintReport(ctx.db, {
        stationId: occurrence.stationId,
        swapperId,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        hours: durationHours(ctx.db, occurrence),
        ignoreOccurrenceId: occurrence.id,
      });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/plannings\/([^/]+)\/occurrences\/([^/]+)$/,
    handler: (ctx) => {
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      const occurrence = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!planning || !occurrence)
        throw new MockHttpError(404, "Poste introuvable.");
      if (
        typeof ctx.body.revision === "number" &&
        ctx.body.revision !== planning.revision
      )
        throw new MockHttpError(
          409,
          "Ce planning a été modifié entre-temps. Rechargez-le avant d'affecter.",
        );
      const swapperId = ctx.body.swapperId ? String(ctx.body.swapperId) : null;
      const swapWithId = ctx.body.swapWith ? String(ctx.body.swapWith) : null;
      const counterpart = swapWithId
        ? (ctx.db.occurrences.find(
            (item) => item.id === swapWithId && item.planningId === planning.id,
          ) ?? null)
        : null;
      const beforeUser = occurrence.swapperId
        ? (ctx.db.users.find((item) => item.id === occurrence.swapperId) ??
          null)
        : null;
      const counterpartUser = counterpart?.swapperId
        ? (ctx.db.users.find((item) => item.id === counterpart.swapperId) ??
          null)
        : null;
      // Permutation (US 2043) : les contraintes sont évaluées sur l'état projeté,
      // l'échange étant traité comme atomique.
      if (counterpart) counterpart.swapperId = null;
      try {
        if (swapperId) {
          const report = constraintReport(ctx.db, {
            stationId: occurrence.stationId,
            swapperId,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            hours: durationHours(ctx.db, occurrence),
            ignoreOccurrenceId: occurrence.id,
          });
          if (!report.valid)
            throw new MockHttpError(
              409,
              report.errors[0]?.message ?? "Affectation impossible.",
            );
        }
      } finally {
        if (counterpart) counterpart.swapperId = counterpartUser?.id ?? null;
      }
      const afterUser = swapperId
        ? (ctx.db.users.find((item) => item.id === swapperId) ?? null)
        : null;
      occurrence.swapperId = swapperId;
      if (counterpart) counterpart.swapperId = beforeUser?.id ?? null;
      planning.revision += 1;
      if (beforeUser?.id !== afterUser?.id || counterpart) {
        const station = stationOf(ctx.db, occurrence.stationId);
        const permutation =
          Boolean(counterpart) || Boolean(beforeUser && afterUser);
        ctx.db.changes.unshift({
          id: nextId("chg"),
          shiftId: occurrence.id,
          type: permutation ? "PERMUTATION" : "REASSIGNMENT",
          initiatorId: actor.id,
          initiator: actor.fullName,
          stationId: station.id,
          station: station.name,
          outSwapper: beforeUser?.fullName ?? null,
          inSwapper: afterUser?.fullName ?? null,
          before: { swapper: beforeUser?.fullName ?? null },
          after: { swapper: afterUser?.fullName ?? null },
          outSwapperId: beforeUser?.id ?? null,
          inSwapperId: afterUser?.id ?? null,
          reason: permutation
            ? `${asText(ctx.body.reason) || "Permutation depuis le planning"}${counterpartUser ? ` (échange avec ${counterpartUser.fullName})` : " (poste vacant échangé)"}`
            : asText(ctx.body.reason) ||
              "Modification directe depuis le planning",
          createdAt: new Date().toISOString(),
        });
        if (afterUser)
          notifyUser(
            ctx.db,
            afterUser.id,
            "ASSIGNMENT",
            "Nouvelle affectation",
            `${station.name} · ${occurrence.label} le ${new Date(occurrence.startTime).toLocaleDateString("fr-FR")}.`,
          );
        notifyStaff(
          ctx.db,
          station.id,
          "ASSIGNMENT",
          "Affectation modifiée",
          beforeUser && afterUser
            ? `${beforeUser.fullName} remplacé par ${afterUser.fullName} (${occurrence.label}).`
            : `${afterUser?.fullName ?? "Affectation retirée"} · ${occurrence.label}.`,
          [beforeUser?.id ?? "", afterUser?.id ?? ""].filter(Boolean),
        );
        // Un planning déjà publié reste modifiable : les personnes concernées
        // sont averties de la mise à jour de leurs horaires.
        if (planning.status === "PUBLISHED") {
          const stamp = new Date().toISOString();
          for (const user of ctx.db.users) {
            const concerned =
              (user.role === "SWAPPER" &&
                [beforeUser?.id, afterUser?.id].includes(user.id)) ||
              (user.role === "STATION_CHIEF" && user.stationId === station.id);
            if (!concerned) continue;
            ctx.db.notices.unshift({
              id: nextId("ntc"),
              userId: user.id,
              planningId: planning.id,
              readAt: null,
              createdAt: stamp,
            });
            notifyUser(
              ctx.db,
              user.id,
              "PLANNING_UPDATED",
              "Planning mis à jour",
              `Vos horaires ont changé sur le planning publié du ${new Date(planning.startDate).toLocaleDateString("fr-FR")} au ${new Date(planning.endDate).toLocaleDateString("fr-FR")}.`,
            );
          }
        }
      }
      return {
        ...occurrenceView(ctx.db, occurrence),
        revision: planning.revision,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/validate$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      if (!planning) throw new MockHttpError(404, "Planning introuvable.");
      const occurrences = ctx.db.occurrences.filter(
        (item) => item.planningId === planning.id,
      );
      const errors: { code: string; message: string }[] = [];
      const warnings: { code: string; message: string }[] = [];
      if (!occurrences.length)
        errors.push({
          code: "EMPTY",
          message: "Le planning ne contient aucune affectation à publier.",
        });
      const vacant = occurrences.filter((item) => !item.swapperId);
      if (vacant.length)
        warnings.push({
          code: "VACANT",
          message: `${vacant.length} poste(s) sans swappeur seront publiés comme vacants.`,
        });
      for (const occurrence of occurrences) {
        if (!occurrence.swapperId) continue;
        const report = constraintReport(ctx.db, {
          stationId: occurrence.stationId,
          swapperId: occurrence.swapperId,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
          hours: durationHours(ctx.db, occurrence),
          ignoreOccurrenceId: occurrence.id,
        });
        const blocking = report.errors.filter(
          (item) => item.code === "OVERLAP" || item.code === "REST",
        );
        if (blocking.length)
          errors.push({
            code: blocking[0].code,
            message: `${report.stationName} · ${occurrence.label} : ${blocking[0].message}`,
          });
      }
      return {
        valid: errors.length === 0,
        errors,
        warnings,
        totals: {
          occurrences: occurrences.length,
          assigned: occurrences.length - vacant.length,
          vacant: vacant.length,
          hours:
            Math.round(
              occurrences.reduce(
                (sum, item) => sum + durationHours(ctx.db, item),
                0,
              ) * 100,
            ) / 100,
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/publish$/,
    handler: (ctx) => {
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      if (!planning) throw new MockHttpError(404, "Planning introuvable.");
      if (
        typeof ctx.body.revision === "number" &&
        ctx.body.revision !== planning.revision
      )
        throw new MockHttpError(
          409,
          "Ce planning a été modifié entre-temps. Rechargez-le avant de publier.",
        );
      const occurrences = ctx.db.occurrences.filter(
        (item) => item.planningId === planning.id,
      );
      if (!occurrences.length)
        throw new MockHttpError(
          400,
          "Ajoutez au moins un shift avant de publier.",
        );
      // Une publication peut concerner un brouillon comme un planning déjà
      // publié que l'on vient de réviser : les personnes concernées sont
      // notifiées dans les deux cas.
      const republishing = planning.status === "PUBLISHED";
      planning.status = "PUBLISHED";
      planning.publishedAt = new Date().toISOString();
      planning.revision += 1;
      const stationIds = Array.from(
        new Set(occurrences.map((item) => item.stationId)),
      );
      const period = `du ${new Date(planning.startDate).toLocaleDateString("fr-FR")} au ${new Date(planning.endDate).toLocaleDateString("fr-FR")}`;
      for (const user of ctx.db.users) {
        const concerned =
          user.role === "SUPERVISOR" ||
          (user.role === "STATION_CHIEF" &&
            stationIds.includes(user.stationId ?? "")) ||
          (user.role === "SWAPPER" &&
            occurrences.some((item) => item.swapperId === user.id));
        if (!concerned) continue;
        ctx.db.notices.unshift({
          id: nextId("ntc"),
          userId: user.id,
          planningId: planning.id,
          readAt: null,
          createdAt: planning.publishedAt,
        });
        notifyUser(
          ctx.db,
          user.id,
          "PLANNING_PUBLISHED",
          republishing ? "Planning republié" : "Planning publié",
          republishing
            ? `Le planning ${period} a été révisé : vérifiez vos horaires à jour.`
            : `Le planning ${period} est disponible.`,
        );
      }
      return { ...planningView(ctx.db, planning.id), author: actor.id };
    },
  },
];
