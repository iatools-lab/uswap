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
  type MockDb,
  type MockOccurrence,
  type MockPlanning,
  type MockRoute,
  type MockUser,
} from "../types";

/** Une place initiale par shift ; l'affectation ajoute les places nécessaires. */
const GENERATED_POSITIONS_PER_SHIFT = 1;

const asText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Administrateurs et superviseurs peuvent corriger un planning, y compris
 * après sa publication. Les contrôles et notifications restent appliqués à
 * chaque modification.
 */
function assertCanMutatePlanning(_user: MockUser, _planning: MockPlanning) {}
const pad = (value: number) => String(value).padStart(2, "0");
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

function localDayKey(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function assignPlanningByShift(ctx: MockCtx, planning: MockPlanning) {
  const shiftGroups = new Map<string, MockOccurrence[]>();
  for (const occurrence of ctx.db.occurrences.filter(
    (item) => item.planningId === planning.id,
  )) {
    const key = `${occurrence.stationId}|${occurrence.templateId}`;
    shiftGroups.set(key, [...(shiftGroups.get(key) ?? []), occurrence]);
  }

  let assigned = 0;
  const planningHours = (swapperId: string) =>
    ctx.db.occurrences
      .filter(
        (item) => item.planningId === planning.id && item.swapperId === swapperId,
      )
      .reduce((total, item) => total + durationHours(ctx.db, item), 0);
  const totalHours = (swapperId: string) =>
    ctx.db.occurrences
      .filter((item) => item.swapperId === swapperId)
      .reduce((total, item) => total + durationHours(ctx.db, item), 0);
  const activeSwappers = ctx.db.users.filter(
    (user) => user.role === "SWAPPER" && user.isActive,
  );
  const lockedTemplates = new Map<string, Set<string>>();
  for (const occurrence of ctx.db.occurrences.filter(
    (item) => item.planningId === planning.id && item.swapperId,
  )) {
    const templates = lockedTemplates.get(occurrence.swapperId!) ?? new Set();
    templates.add(occurrence.templateId);
    lockedTemplates.set(occurrence.swapperId!, templates);
  }

  for (const group of shiftGroups.values()) {
    const station = stationOf(ctx.db, group[0].stationId);
    const days = new Map<string, MockOccurrence[]>();
    for (const occurrence of group) {
      const key = localDayKey(occurrence.startTime, station.timezone);
      days.set(key, [...(days.get(key) ?? []), occurrence]);
    }
    const orderedDays = [...days.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const dbOrder = new Map(
      ctx.db.occurrences.map((item, index) => [item.id, index]),
    );
    orderedDays.forEach(([, rows]) =>
      rows.sort((a, b) => (dbOrder.get(a.id) ?? 0) - (dbOrder.get(b.id) ?? 0)),
    );
    const roster = activeSwappers.filter((user) => user.stationId === station.id);
    const stationHours = ctx.db.occurrences
      .filter(
        (item) =>
          item.planningId === planning.id && item.stationId === station.id,
      )
      .reduce((total, item) => total + durationHours(ctx.db, item), 0);
    const fairHoursPerSwapper = stationHours / Math.max(roster.length, 1);
    const groupHours = group.reduce(
      (total, item) => total + durationHours(ctx.db, item),
      0,
    );
    const minimumDailyTeam = Math.max(
      1,
      ...orderedDays.map(([, rows]) => rows.length),
    );
    const targetTeamSize = Math.max(
      minimumDailyTeam,
      Math.ceil(groupHours / Math.max(fairHoursPerSwapper, 0.01)),
    );
    const team = new Set(
      group
        .map((item) => item.swapperId)
        .filter((id): id is string => Boolean(id)),
    );
    const eligibleTeam = roster
      .filter((user) => {
        const locked = lockedTemplates.get(user.id);
        return !locked?.size || locked.has(group[0].templateId);
      })
      .sort(
        (a, b) =>
          planningHours(a.id) - planningHours(b.id) ||
          totalHours(a.id) - totalHours(b.id) ||
          Math.random() - 0.5,
      );
    for (const userId of team) {
      if (!lockedTemplates.has(userId))
        lockedTemplates.set(userId, new Set([group[0].templateId]));
    }
    for (const candidate of eligibleTeam) {
      if (team.size >= targetTeamSize) break;
      team.add(candidate.id);
      const templates = lockedTemplates.get(candidate.id) ?? new Set<string>();
      templates.add(group[0].templateId);
      lockedTemplates.set(candidate.id, templates);
    }
    for (const [, rows] of orderedDays) {
      for (const occurrence of rows) {
        if (occurrence.swapperId) continue;
        const candidates = roster
          .filter((user) => team.has(user.id))
          .sort(
            (a, b) =>
              planningHours(a.id) - planningHours(b.id) ||
              totalHours(a.id) - totalHours(b.id) ||
              Math.random() - 0.5,
          );

        for (const candidate of candidates) {
          occurrence.swapperId = candidate.id;
          const report = constraintReport(ctx.db, {
            stationId: occurrence.stationId,
            swapperId: candidate.id,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            hours: durationHours(ctx.db, occurrence),
            ignoreOccurrenceId: occurrence.id,
          });
          if (report.valid) {
            assigned += 1;
            break;
          }
          occurrence.swapperId = null;
        }
      }
    }
  }

  const assignedIds = new Set(
    ctx.db.occurrences
      .filter((item) => item.planningId === planning.id && item.swapperId)
      .map((item) => item.swapperId!),
  );
  const planningStations = [
    ...new Set(
      ctx.db.occurrences
        .filter((item) => item.planningId === planning.id)
        .map((item) => item.stationId),
    ),
  ];
  const addBalancedShift = (user: MockUser, stationId: string) => {
    const sources = ctx.db.occurrences
      .filter(
        (item) =>
          item.planningId === planning.id && item.stationId === stationId,
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const preferredTemplates = new Set(
      ctx.db.occurrences
        .filter(
          (item) =>
            item.planningId === planning.id && item.swapperId === user.id,
        )
        .map((item) => item.templateId),
    );
    const locked = lockedTemplates.get(user.id);
    const options: {
      source: MockOccurrence;
      score: number;
      preferred: boolean;
    }[] = [];
    for (const source of sources) {
      if (locked?.size && !locked.has(source.templateId)) continue;
      const preview: MockOccurrence = {
        ...source,
        id: `auto-preview-${user.id}-${source.id}`,
        swapperId: user.id,
      };
      const report = constraintReport(ctx.db, {
        stationId: preview.stationId,
        swapperId: user.id,
        startTime: preview.startTime,
        endTime: preview.endTime,
        hours: durationHours(ctx.db, preview),
        ignoreOccurrenceId: preview.id,
      });
      if (!report.valid) continue;

      const roster = activeSwappers.filter(
        (item) => item.stationId === stationId,
      );
      const projected = roster.map(
        (item) =>
          planningHours(item.id) +
          (item.id === user.id ? durationHours(ctx.db, preview) : 0),
      );
      const mean = projected.reduce((sum, value) => sum + value, 0) /
        Math.max(projected.length, 1);
      options.push({
        source,
        score: projected.reduce(
          (sum, value) => sum + (value - mean) ** 2,
          0,
        ),
        preferred:
          preferredTemplates.size === 0 || preferredTemplates.has(source.templateId),
      });
    }
    options.sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        a.score - b.score ||
        Math.random() - 0.5,
    );
    const source = options[0]?.source;
    if (!source) return false;
    ctx.db.occurrences.push({
      ...source,
      id: nextId("shift"),
      swapperId: user.id,
    });
    assigned += 1;
    assignedIds.add(user.id);
    const templates = lockedTemplates.get(user.id) ?? new Set<string>();
    templates.add(source.templateId);
    lockedTemplates.set(user.id, templates);
    return true;
  };

  // Garantit une première affectation à chaque personne éligible, même si le
  // nombre de postes générés au départ est inférieur à la taille de l'équipe.
  const stationWorkers = activeSwappers.filter(
    (user) => user.stationId && planningStations.includes(user.stationId),
  );
  for (const stationId of planningStations) {
    const roster = stationWorkers
      .filter((user) => user.stationId === stationId)
      .sort(
        (a, b) =>
          planningHours(a.id) - planningHours(b.id) ||
          totalHours(a.id) - totalHours(b.id) ||
          Math.random() - 0.5,
      );
    for (const user of roster) {
      if (!assignedIds.has(user.id)) addBalancedShift(user, stationId);
    }

    // Les postes supplémentaires rapprochent les heures de travail au plus
    // près possible sans dépasser les limites hebdomadaires ou le repos requis.
    const blocked = new Set<string>();
    const maxIterations = Math.max(roster.length * 16, 16);
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const current = roster
        .filter((user) => !blocked.has(user.id))
        .sort(
          (a, b) =>
            planningHours(a.id) - planningHours(b.id) ||
            totalHours(a.id) - totalHours(b.id),
        );
      const user = current[0];
      if (!user || !roster.length) break;
      const target = Math.max(...roster.map((item) => planningHours(item.id)));
      if (planningHours(user.id) >= target - 0.01) break;
      if (!addBalancedShift(user, stationId)) blocked.add(user.id);
    }
  }

  const finalUnassigned = stationWorkers.filter(
    (user) => !assignedIds.has(user.id),
  );
  const workloadSpreads = planningStations.map((stationId) => {
    const values = stationWorkers
      .filter((user) => user.stationId === stationId)
      .map((user) => planningHours(user.id));
    return values.length ? Math.max(...values) - Math.min(...values) : 0;
  });
  const workloadSpread = workloadSpreads.length
    ? Math.round(Math.max(...workloadSpreads) * 100) / 100
    : 0;
  return {
    assigned,
    vacant: ctx.db.occurrences.filter(
      (item) => item.planningId === planning.id && !item.swapperId,
    ).length,
    coveredSwappers: stationWorkers.length - finalUnassigned.length,
    unassignedSwappers: finalUnassigned.length,
    workloadSpread,
  };
}

/** Occurrences que la génération produirait pour la sélection demandée. */
function candidateWindows(
  ctx: MockCtx,
  planningId: string,
  body: Record<string, unknown>,
) {
  const planning = ctx.db.plannings.find((item) => item.id === planningId);
  if (!planning) throw new MockHttpError(404, "Planning introuvable.");
  const station = stationOf(ctx.db, asText(body.stationId));
  if (!station.isActive)
    throw new MockHttpError(
      409,
      "Cette station est inactive : aucun shift ne peut être généré.",
    );
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
    (item) =>
      item.stationId === station.id &&
      item.isActive &&
      templateIds.includes(item.id),
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

function planningValidation(db: MockDb, planning: MockPlanning) {
  const occurrences = db.occurrences.filter(
    (item) => item.planningId === planning.id,
  );
  const errors: { code: string; message: string; occurrenceId?: string }[] = [];
  const warnings: { code: string; message: string; occurrenceId?: string }[] =
    [];
  if (!occurrences.length)
    errors.push({
      code: "EMPTY",
      message: "Le planning ne contient aucun shift à publier.",
    });
  const vacant = occurrences.filter((item) => !item.swapperId);
  if (vacant.length) {
    const blockingStations = Array.from(
      new Set(
        vacant
          .map((item) =>
            db.stations.find((station) => station.id === item.stationId),
          )
          .filter((station) => station?.blockPublishingWithVacancies)
          .map((station) => station!.name),
      ),
    );
    const issue = {
      code: "VACANT",
      message: blockingStations.length
        ? `${vacant.length} poste(s) restent vacants. La publication est bloquée pour ${blockingStations.join(", ")}.`
        : `${vacant.length} poste(s) sans swappeur seront publiés comme vacants.`,
    };
    if (blockingStations.length) errors.push(issue);
    else warnings.push(issue);
  }
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    if (!occurrence.swapperId) continue;
    const report = constraintReport(db, {
      stationId: occurrence.stationId,
      swapperId: occurrence.swapperId,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      hours: durationHours(db, occurrence),
      ignoreOccurrenceId: occurrence.id,
    });
    for (const issue of report.errors) {
      const key = `${occurrence.id}:${issue.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({
        code: issue.code,
        message: `${report.stationName} · ${occurrence.label} : ${issue.message}`,
        occurrenceId: occurrence.id,
      });
    }
    for (const issue of report.warnings) {
      const key = `${occurrence.id}:${issue.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({
        code: issue.code,
        message: `${report.stationName} · ${occurrence.label} : ${issue.message}`,
        occurrenceId: occurrence.id,
      });
    }
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
          occurrences.reduce((sum, item) => sum + durationHours(db, item), 0) *
            100,
        ) / 100,
      byStation: Array.from(
        new Set(occurrences.map((item) => item.stationId)),
      ).map((stationId) => {
        const stationOccurrences = occurrences.filter(
          (item) => item.stationId === stationId,
        );
        return {
          stationId,
          stationName: stationOf(db, stationId).name,
          total: stationOccurrences.length,
          assigned: stationOccurrences.filter((item) => item.swapperId).length,
          vacant: stationOccurrences.filter((item) => !item.swapperId).length,
        };
      }),
    },
  };
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
        throw new MockHttpError(
          400,
          "Indiquez un nom de planning de 1 à 100 caractères.",
        );
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
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/auto-assign$/,
    handler: (ctx) => {
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      if (!planning) throw new MockHttpError(404, "Planning introuvable.");
      assertCanMutatePlanning(actor, planning);
      if (planning.status !== "DRAFT")
        throw new MockHttpError(
          409,
          "L’affectation automatique est réservée aux brouillons.",
        );
      if (ctx.body.revision !== planning.revision)
        throw new MockHttpError(
          409,
          "Ce planning a été modifié. Rechargez-le avant l’affectation automatique.",
        );
      const result = assignPlanningByShift(ctx, planning);
      if (result.assigned) planning.revision += 1;
      return { ...result, planning: planningView(ctx.db, planning.id) };
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
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const { planning, occurrences, duplicates } = candidateWindows(
        ctx,
        ctx.params[0],
        ctx.body,
      );
      assertCanMutatePlanning(actor, planning);
      return {
        previewHash: nextId("prev"),
        occurrences,
        positionsPerShift: GENERATED_POSITIONS_PER_SHIFT,
        duplicates,
        outside: [],
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/plannings\/([^/]+)\/generate$/,
    handler: (ctx) => {
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const { planning, occurrences } = candidateWindows(
        ctx,
        ctx.params[0],
        ctx.body,
      );
      assertCanMutatePlanning(actor, planning);
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
        for (
          let position = 0;
          position < GENERATED_POSITIONS_PER_SHIFT;
          position += 1
        ) {
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
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      const source = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!planning || !source)
        throw new MockHttpError(404, "Poste introuvable.");
      assertCanMutatePlanning(actor, planning);
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
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const planning = ctx.db.plannings.find(
        (item) => item.id === ctx.params[0],
      );
      const target = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!planning || !target)
        throw new MockHttpError(404, "Poste introuvable.");
      assertCanMutatePlanning(actor, planning);
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
      const actor = requireRole(requireUser(ctx.db, ctx.user), [
        "ADMIN",
        "SUPERVISOR",
      ]);
      const occurrence = ctx.db.occurrences.find(
        (item) =>
          item.id === ctx.params[1] && item.planningId === ctx.params[0],
      );
      if (!occurrence) throw new MockHttpError(404, "Poste introuvable.");
      const planning = ctx.db.plannings.find(
        (item) => item.id === occurrence.planningId,
      );
      if (!planning) throw new MockHttpError(404, "Planning introuvable.");
      assertCanMutatePlanning(actor, planning);
      const swapperId = asText(ctx.body.swapperId);
      if (!swapperId) throw new MockHttpError(400, "Sélectionnez un swappeur.");
      const swapper = ctx.db.users.find((item) => item.id === swapperId);
      if (!swapper || swapper.role !== "SWAPPER" || !swapper.isActive)
        throw new MockHttpError(409, "Sélectionnez un swappeur actif.");
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
      assertCanMutatePlanning(actor, planning);
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
      if (afterUser && afterUser.role !== "SWAPPER")
        throw new MockHttpError(
          409,
          "Le collaborateur sélectionné n’est pas un swappeur.",
        );
      if (afterUser && !afterUser.isActive)
        throw new MockHttpError(409, "Sélectionnez un swappeur actif.");
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
            occurrence.planningId,
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
          occurrence.planningId,
        );
        // Un planning déjà publié reste modifiable : les personnes concernées
        // sont averties de la mise à jour de leurs horaires.
        if (planning.status === "PUBLISHED") {
          const stamp = new Date().toISOString();
          for (const user of ctx.db.users) {
            const concerned =
              user.role === "SUPERVISOR" ||
              (user.role === "SWAPPER" &&
                [beforeUser?.id, afterUser?.id].includes(user.id));
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
              planning.id,
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
      return planningValidation(ctx.db, planning);
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
      const validation = planningValidation(ctx.db, planning);
      if (!validation.valid)
        throw new MockHttpError(
          409,
          validation.errors[0]?.message ??
            "Le planning contient une erreur bloquante.",
          { validation },
        );
      // Une publication peut concerner un brouillon comme un planning déjà
      // publié que l'on vient de réviser : les personnes concernées sont
      // notifiées dans les deux cas.
      const republishing = planning.status === "PUBLISHED";
      planning.status = "PUBLISHED";
      planning.publishedAt = new Date().toISOString();
      planning.revision += 1;
      const period = `du ${new Date(planning.startDate).toLocaleDateString("fr-FR")} au ${new Date(planning.endDate).toLocaleDateString("fr-FR")}`;
      for (const user of ctx.db.users) {
        const concerned =
          user.role === "SUPERVISOR" ||
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
          planning.id,
        );
      }
      return { ...planningView(ctx.db, planning.id), author: actor.id };
    },
  },
];
