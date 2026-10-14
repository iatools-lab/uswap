import { Injectable } from '@nestjs/common';
import { Prisma, PlanningStatus, type Planning } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import {
  slotMinutes,
  stationOf,
  userOf,
} from '../common/validation/business-rules';
import { serializePlanning, serializePlanningView } from '../common/serializers';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import {
  buildMatrix,
  type AssignmentInput,
  type CoverageMatrix,
} from './planning.coverage';
import { ConstraintsService } from './constraints.service';
import { type AuthenticatedUser } from '../common/guards/roles.guard';

export interface AssignmentDto {
  stationId: string;
  day: string;
  shiftTemplateId?: string | null;
  shiftLabel?: string | null;
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  breakMinutes?: number;
  requiredStaff?: number;
  assignedUserIds?: string[];
  notes?: string | null;
}

export interface CreatePlanningDto {
  name: string;
  stationIds: string[];
  periodStart: string;
  periodEnd: string;
  status?: string;
  conflictPolicy?: string;
  requiredStaff?: number;
  assignments?: AssignmentDto[];
  idempotencyKey?: string;
  createdAt?: string;
}

@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly constraints: ConstraintsService,
    private readonly scope: ScopeService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Lecture                                                           */
  /* ---------------------------------------------------------------- */

  async list(params: {
    stationId?: string;
    from?: string;
    to?: string;
    status?: string;
  }) {
    const where: Prisma.PlanningWhereInput = {};
    if (params.status) where.status = params.status as PlanningStatus;
    if (params.stationId) where.stationIds = { has: params.stationId };
    if (params.from || params.to) {
      where.periodStart = params.from ? { gte: new Date(params.from) } : undefined;
      where.periodEnd = params.to ? { lte: new Date(params.to) } : undefined;
    }
    const plannings = await this.prisma.planning.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { name: 'asc' }],
    });
    return plannings.map((planning) => serializePlanning(planning));
  }

  async detail(id: string, actor?: AuthenticatedUser) {
    const planning = await this.requirePlanning(id);

    // Confidentialité : un agent ne voit qu'un planning publié, et uniquement
    // les postes sur lesquels il est affecté (renforts inter-stations inclus).
    if (actor?.role === 'SWAPPER' && planning.status !== PlanningStatus.PUBLISHED) {
      throw new NotFoundDomain(
        ErrorCode.NOT_FOUND,
        'Cette planification ne concerne pas votre périmètre.',
      );
    }

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        planningId: id,
        ...(actor?.role === 'SWAPPER'
          ? { assignments: { some: { userId: actor.id } } }
          : {}),
      },
      orderBy: { startTime: 'asc' },
    });

    const ctx = await this.scope.serializeContext();
    const visibleStationIds = [
      ...new Set(occurrences.map((item) => item.stationId)),
    ];
    const visibleStations = visibleStationIds.map((stationId) => ({
      id: stationId,
      name: ctx.stationNames.get(stationId) ?? 'Station inconnue',
      timezone: 'Africa/Douala',
    }));

    return serializePlanningView(planning, occurrences, ctx, visibleStations);
  }

  /**
   * Occurrences d'une periode, enrichies de l'agent affecte et de son statut de
   * pointage. C'est la source de l'ecran Operations comme du calendrier.
   */
  async occurrences(params: {
    stationId?: string;
    stationIds?: string[];
    from?: string;
    to?: string;
    swapperId?: string;
    supervisorId?: string;
  }) {
    const where: Prisma.OccurrenceWhereInput = {};
    if (params.stationIds?.length) {
      where.stationId = { in: params.stationIds };
    } else if (params.stationId) {
      where.stationId = params.stationId;
    }
    if (params.swapperId) {
      where.assignments = { some: { userId: params.swapperId } };
    }
    if (params.supervisorId) where.supervisorId = params.supervisorId;
    if (params.from || params.to) {
      where.startTime = params.from ? { gte: new Date(params.from) } : undefined;
      where.endTime = params.to ? { lte: new Date(params.to) } : undefined;
    }

    const occurrences = await this.prisma.occurrence.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: {
        station: { select: { id: true, name: true, city: true } },
        assignments: {
          include: { user: { select: { id: true, fullName: true } } },
        },
        attendance: {
          select: { status: true, checkedInAt: true, checkedOutAt: true },
        },
      },
    });

    return occurrences.map((occurrence) => ({
      id: occurrence.id,
      planningId: occurrence.planningId,
      stationId: occurrence.stationId,
      stationName: occurrence.station.name,
      shiftLabel: occurrence.shiftLabel,
      day: occurrence.day,
      startTime: occurrence.startTime.toISOString(),
      endTime: occurrence.endTime.toISOString(),
      breakStart: occurrence.breakStart,
      breakEnd: occurrence.breakEnd,
      breakMinutes: occurrence.breakMinutes,
      requiredStaff: occurrence.requiredStaff,
      assignedStaff: occurrence.assignments.length,
      swapperId: occurrence.assignments[0]?.userId ?? null,
      swapperName: occurrence.assignments[0]?.user.fullName ?? null,
      swappers: occurrence.assignments.map((assignment) => ({
        id: assignment.userId,
        fullName: assignment.user.fullName,
      })),
      notes: occurrence.notes,
      status: occurrence.status,
      attendanceStatus: occurrence.attendance?.status ?? null,
      checkedInAt: occurrence.attendance?.checkedInAt?.toISOString() ?? null,
      checkedOutAt: occurrence.attendance?.checkedOutAt?.toISOString() ?? null,
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Creation                                                          */
  /* ---------------------------------------------------------------- */

  async create(payload: CreatePlanningDto, actor: AuthenticatedUser) {
    const periodStart = this.requireDate(payload.periodStart, 'période');
    const periodEnd = this.requireDate(payload.periodEnd, 'période');
    if (periodEnd < periodStart) {
      throw this.invalid('La période de fin doit suivre la période de début.');
    }

    // Le frontend crée d'abord un planning « enveloppe » (nom et stations
    // optionnels) : les postes sont ajoutés ensuite station par station via
    // `preview` puis `generate`. On tolère donc l'absence de nom et de station
    // à la création, et on dérive un nom lisible à défaut.
    const providedName = (payload.name ?? '').trim();
    const name =
      providedName ||
      `Planning ${periodStart.toISOString().slice(0, 10)} → ${periodEnd
        .toISOString()
        .slice(0, 10)}`;
    const stationIds = [...new Set((payload.stationIds ?? []).filter(Boolean))];

    if (payload.idempotencyKey) {
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { key: payload.idempotencyKey },
      });
      if (existing) {
        const response = existing.response as Record<string, unknown>;
        return { ...response, replayed: true };
      }
    }

    const stations = await this.prisma.station.findMany({
      where: { id: { in: stationIds } },
      select: { id: true, name: true },
    });
    if (stations.length !== stationIds.length) {
      throw this.invalid('Une des stations sélectionnées n’existe plus.');
    }

    const assignments = this.normaliseAssignments(
      payload.assignments ?? [],
      stationIds,
      periodStart,
      periodEnd,
      payload.requiredStaff,
    );

    // 1) Detection des conflits d'agent AVANT d'ecrire quoi que ce soit, pour
    //    que le lot soit accepte ou refuse en entier.
    const conflicts = await this.detectConflicts(assignments);
    if (conflicts.length) {
      throw new ConflictDomain(
        'SHIFT_CONFLICT',
        `${conflicts.length} ${
          conflicts.length === 1 ? 'conflit' : 'conflits'
        } de créneau : ${conflicts
          .slice(0, 3)
          .map((conflict) => `${conflict.swapperName} le ${conflict.day}`)
          .join(', ')}${conflicts.length > 3 ? '…' : ''}.`,
        409,
        { conflicts },
      );
    }

    const status: PlanningStatus =
      payload.status === 'DRAFT' ? PlanningStatus.DRAFT : PlanningStatus.DRAFT;
    const allowVacancies = stations.length
      ? await this.vacancyPolicy(stations[0].id)
      : false;
    const vacantCount = assignments.reduce(
      (total, assignment) =>
        total + Math.max(0, assignment.requiredStaff - assignment.assignedUserIds.length),
      0,
    );

    const planning = await this.prisma.$transaction(async (tx) => {
      const created = await tx.planning.create({
        data: {
          name,
          stationIds,
          periodStart,
          periodEnd,
          status,
          createdById: actor.id,
          conflictPolicy: payload.conflictPolicy ?? 'BLOCK',
        },
      });

      for (const assignment of assignments) {
        const occurrence = await tx.occurrence.create({
          data: {
            planningId: created.id,
            stationId: assignment.stationId,
            shiftTemplateId: assignment.shiftTemplateId ?? null,
            shiftLabel: assignment.shiftLabel ?? null,
            // `label` est le libelle historise du poste : il fige le modele au
            // moment de la generation, comme le fait le frontend.
            label: assignment.shiftLabel ?? 'Service',
            day: assignment.day,
            startTime: this.combineDateAndTime(assignment.day, assignment.startTime),
            endTime: this.combineDateAndTime(
              assignment.day,
              assignment.endTime,
              assignment.endTime <= assignment.startTime,
            ),
            breakStart: assignment.breakStart ?? null,
            breakEnd: assignment.breakEnd ?? null,
            breakMinutes: assignment.breakMinutes ?? 0,
            requiredStaff: assignment.requiredStaff,
            notes: assignment.notes ?? null,
          },
        });

        const userIds = assignment.assignedUserIds.slice(0, assignment.requiredStaff);
        for (const userId of userIds) {
          await tx.occurrenceAssignment.create({
            data: { occurrenceId: occurrence.id, userId, assignedById: actor.id },
          });
        }

        if (unassigned(assignment) > 0) {
          await tx.planningVacancy.create({
            data: {
              planningId: created.id,
              occurrenceId: occurrence.id,
              stationId: assignment.stationId,
              day: assignment.day,
              startTime: assignment.startTime,
              endTime: assignment.endTime,
              missing: unassigned(assignment),
            },
          });
        }
      }

      await tx.planningRevision.create({
        data: {
          planningId: created.id,
          revision: created.revision,
          action: 'CREATED',
          actorId: actor.id,
          snapshot: {
            name: created.name,
            periodStart: created.periodStart.toISOString(),
            periodEnd: created.periodEnd.toISOString(),
            stations: stationIds,
            assignments: assignments.length,
          } as Prisma.InputJsonValue,
        },
      });

      if (payload.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            key: payload.idempotencyKey,
            scope: 'planning.create',
            response: { id: created.id } as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      }

      return created;
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'PLANNING_CREATED',
      targetType: 'Planning',
      targetId: planning.id,
      metadata: { name, assignments: assignments.length, vacant: vacantCount },
    });

    return {
      ...serializePlanning(planning),
      vacancies: vacantCount,
      published: false,
      blockedByVacancies: vacantCount > 0 && !allowVacancies,
    };
  }

  /**
   * Publie une planification : passe les occurrences en PUBLISHED, notifie
   * chaque agent affecte et refuse l'operation si la station interdit les
   * postes vacants et qu'il en reste.
   */
  async publish(id: string, actor: AuthenticatedUser) {
    const planning = await this.requirePlanning(id);
    const vacancies = await this.prisma.planningVacancy.count({
      where: { planningId: id },
    });
    const firstStation = planning.stationIds[0];
    if (vacancies && firstStation) {
      const allow = await this.vacancyPolicy(firstStation);
      if (!allow) {
        throw new ConflictDomain(
          'PUBLISH_BLOCKED_BY_VACANCIES',
          `Publication refusée : ${vacancies} ${
            vacancies === 1 ? 'poste reste vacant' : 'postes restent vacants'
          }.`,
          409,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.occurrence.updateMany({
        where: { planningId: id },
        data: { status: 'PUBLISHED' },
      });
      const next = await tx.planning.update({
        where: { id },
        data: {
          status: PlanningStatus.PUBLISHED,
          revision: { increment: 1 },
          publishedAt: new Date(),
          publishedById: actor.id,
        },
      });
      await tx.planningRevision.create({
        data: {
          planningId: id,
          revision: next.revision,
          action: 'PUBLISHED',
          actorId: actor.id,
          snapshot: { publishedAt: next.publishedAt } as Prisma.InputJsonValue,
        },
      });
      return next;
    });

    // Les notifications partent apres le commit : un envoi rate ne doit jamais
    // annuler la publication.
    await this.notifications.notifyPlanningPublished(id, actor.id);
    await this.audit.record({
      actorId: actor.id,
      action: 'PLANNING_PUBLISHED',
      targetType: 'Planning',
      targetId: id,
    });

    return { ...serializePlanning(result), published: true, vacancies };
  }

  async setAssignments(
    planningId: string,
    occurrenceId: string,
    userIds: string[],
    actor: AuthenticatedUser,
  ) {
    const planning = await this.requirePlanning(planningId);
    const occurrence = await this.prisma.occurrence.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Affectation introuvable.');
    }
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length > occurrence.requiredStaff) {
      throw this.invalid(
        `Ce poste n’accepte que ${occurrence.requiredStaff} agent(s).`,
      );
    }
    if (unique.length) {
      await this.prisma.user.findMany({ where: { id: { in: unique } } }).then(
        (users) => {
          if (users.length !== unique.length) {
            throw this.invalid('Un des agents sélectionnés est introuvable.');
          }
        },
      );
      const conflicts = await this.detectConflicts(
        unique.map((userId) => ({
          stationId: occurrence.stationId,
          day: occurrence.day,
          shiftTemplateId: occurrence.shiftTemplateId,
          shiftLabel: occurrence.shiftLabel,
          startTime: occurrence.startTime.toISOString().slice(11, 16),
          endTime: occurrence.endTime.toISOString().slice(11, 16),
          breakStart: occurrence.breakStart,
          breakEnd: occurrence.breakEnd,
          breakMinutes: occurrence.breakMinutes,
          requiredStaff: occurrence.requiredStaff,
          assignedUserIds: [userId],
          notes: occurrence.notes,
          _occurrenceId: occurrence.id,
        })),
        occurrence.id,
      );
      if (conflicts.length) {
        throw new ConflictDomain(
          'SHIFT_CONFLICT',
          `Conflit de créneau pour ${conflicts[0].swapperName} le ${conflicts[0].day}.`,
          409,
          { conflicts },
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.occurrenceAssignment.deleteMany({
        where: { occurrenceId, lockedAt: null },
      });
      for (const userId of unique) {
        await tx.occurrenceAssignment.create({
          data: { occurrenceId, userId, assignedById: actor.id },
        });
      }
      await tx.occurrence.update({
        where: { id: occurrenceId },
        data: { revision: { increment: 1 } },
      });
      await tx.planningRevision.create({
        data: {
          planningId,
          revision: planning.revision + 1,
          action: 'ASSIGNMENTS_CHANGED',
          actorId: actor.id,
          snapshot: { occurrenceId, userIds: unique } as Prisma.InputJsonValue,
        },
      });
      await tx.planning.update({
        where: { id: planningId },
        data: { revision: { increment: 1 } },
      });
      const remaining = occurrence.requiredStaff - unique.length;
      const existingVacancy = await tx.planningVacancy.findFirst({
        where: { occurrenceId },
      });
      if (remaining > 0) {
        if (existingVacancy) {
          await tx.planningVacancy.update({
            where: { id: existingVacancy.id },
            data: { missing: remaining },
          });
        } else {
          await tx.planningVacancy.create({
            data: {
              planningId,
              occurrenceId,
              stationId: occurrence.stationId,
              day: occurrence.day,
              startTime: occurrence.startTime,
              endTime: occurrence.endTime,
              missing: remaining,
            },
          });
        }
      } else if (existingVacancy) {
        await tx.planningVacancy.delete({ where: { id: existingVacancy.id } });
      }
    });

    return this.detail(planningId);
  }

  /* ---------------------------------------------------------------- */
  /* Matrice de couverture                                             */
  /* ---------------------------------------------------------------- */

  async coverage(id: string): Promise<CoverageMatrix> {
    const planning = await this.requirePlanning(id);
    const occurrences = await this.prisma.occurrence.findMany({
      where: { planningId: id },
      include: { assignments: true },
    });
    return buildMatrix({
      periodStart: planning.periodStart.toISOString(),
      periodEnd: planning.periodEnd.toISOString(),
      stations: planning.stationIds,
      occurrences: occurrences.map((occurrence) => ({
        stationId: occurrence.stationId,
        day: occurrence.day,
        shiftTemplateId: occurrence.shiftTemplateId,
        shiftLabel: occurrence.shiftLabel,
        startTime: occurrence.startTime.toISOString().slice(11, 16),
        endTime: occurrence.endTime.toISOString().slice(11, 16),
        breakStart: occurrence.breakStart,
        breakEnd: occurrence.breakEnd,
        breakMinutes: occurrence.breakMinutes,
        requiredStaff: occurrence.requiredStaff,
        assignedUserIds: occurrence.assignments.map((a) => a.userId),
        notes: occurrence.notes,
      })),
    });
  }

  async revisions(id: string) {
    await this.requirePlanning(id);
    const revisions = await this.prisma.planningRevision.findMany({
      where: { planningId: id },
      orderBy: { revision: 'desc' },
      include: { actor: { select: { fullName: true } } },
    });
    return revisions.map((revision) => ({
      id: revision.id,
      revision: revision.revision,
      action: revision.action,
      actorId: revision.actorId,
      actorName: revision.actor?.fullName ?? null,
      snapshot: revision.snapshot,
      createdAt: revision.createdAt.toISOString(),
    }));
  }

  /**
   * Simule la generation automatique d'un planning : c'est le backend qui
   * calcule les affectations (le frontend affiche le resultat tel quel).
   */
  async generate(
    payload: {
      stationIds: string[];
      periodStart: string;
      periodEnd: string;
      requiredStaff?: number;
      shuffle?: boolean;
      name?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const stationIds = [...new Set((payload.stationIds ?? []).filter(Boolean))];
    if (!stationIds.length) throw this.invalid('Sélectionnez au moins une station.');
    const periodStart = this.requireDate(payload.periodStart, 'période');
    const periodEnd = this.requireDate(payload.periodEnd, 'période');
    if (periodEnd < periodStart) {
      throw this.invalid('La période de fin doit suivre la période de début.');
    }

    const templates = await this.prisma.shiftTemplate.findMany({
      where: { stationId: { in: stationIds }, isActive: true },
      orderBy: { startTime: 'asc' },
    });
    const pool = await this.prisma.user.findMany({
      where: { role: 'SWAPPER', isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, stationId: true },
    });

    const requiredStaff = Math.max(1, Number(payload.requiredStaff) || 1);
    const days = enumerateDays(periodStart, periodEnd);
    const assignments: AssignmentDto[] = [];
    const usedOnDay = new Map<string, Set<string>>();
    let cursor = 0;
    if (payload.shuffle) {
      cursor = Math.floor(Math.random() * Math.max(1, pool.length));
    }

    for (const day of days) {
      const busy = usedOnDay.get(day) ?? new Set<string>();
      usedOnDay.set(day, busy);
      for (const stationId of stationIds) {
        const stationTemplates = templates.filter((t) => t.stationId === stationId);
        for (const template of stationTemplates) {
          const assignedUserIds: string[] = [];
          for (let attempt = 0; attempt < pool.length && assignedUserIds.length < requiredStaff; attempt += 1) {
            const candidate = pool[(cursor + attempt) % pool.length];
            if (busy.has(candidate.id)) continue;
            if (assignedUserIds.includes(candidate.id)) continue;
            assignedUserIds.push(candidate.id);
          }
          cursor += assignedUserIds.length;
          assignedUserIds.forEach((id) => busy.add(id));
          assignments.push({
            stationId,
            day,
            shiftTemplateId: template.id,
            shiftLabel: template.label,
            startTime: template.startTime,
            endTime: template.endTime,
            breakStart: template.breakStart,
            breakEnd: template.breakEnd,
            breakMinutes: template.breakMinutes,
            requiredStaff,
            assignedUserIds,
          });
        }
      }
    }

    const preview = await this.create(
      {
        name:
          payload.name ??
          `Planning ${periodStart} → ${periodEnd}`,
        stationIds,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        assignments,
        conflictPolicy: 'BLOCK',
      },
      actor,
    );

    return {
      ...preview,
      generated: {
        days: days.length,
        shifts: assignments.length,
        agents: new Set(assignments.flatMap((a) => a.assignedUserIds)).size,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Aperçu / génération par créneaux (contrat frontend_new)           */
  /* ---------------------------------------------------------------- */

  /**
   * Aperçu d'un lot de créneaux : renvoie les postes qui SERAIENT créés, les
   * doublons détectés et un `previewHash` que `generate` rejoue. Le frontend
   * affiche ce résultat avant de confirmer.
   */
  async preview(
    planningId: string,
    body: {
      stationId?: string;
      templateIds?: string[];
      weekdays?: number[];
      revision?: number;
    },
  ) {
    const planning = await this.requirePlanning(planningId);
    const stationId = body.stationId ?? planning.stationIds[0];
    if (!stationId) throw this.invalid('Sélectionnez une station.');

    const candidates = await this.buildCandidates(planning, stationId, body);
    return {
      previewHash: await this.hashPreview(planningId, stationId, candidates),
      occurrences: candidates,
      positionsPerShift: 1,
      duplicates: await this.findDuplicates(planningId, candidates),
      outside: [],
    };
  }

  /**
   * Ajoute au planning les postes décrits par le corps (mêmes règles que
   * `preview`). C'est la route réellement appelée après confirmation.
   */
  async generateFor(
    planningId: string,
    body: {
      stationId?: string;
      templateIds?: string[];
      weekdays?: number[];
      revision?: number;
      previewHash?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const planning = await this.requirePlanning(planningId);
    const stationId = body.stationId ?? planning.stationIds[0];
    if (!stationId) throw this.invalid('Sélectionnez une station.');

    const candidates = await this.buildCandidates(planning, stationId, body);
    const existing = await this.prisma.occurrence.findMany({
      where: { planningId },
      select: { id: true },
    });
    const duplicates = await this.findDuplicates(planningId, candidates);
    const duplicateKeys = new Set(
      duplicates.map((d) => `${d.stationId}|${d.shiftTemplateId}|${d.startTime}`),
    );
    const toCreate = candidates.filter(
      (c) => !duplicateKeys.has(`${c.stationId}|${c.shiftTemplateId}|${c.startTime}`),
    );

    if (!toCreate.length) {
      return this.detail(planningId);
    }

    await this.prisma.$transaction(async (tx) => {
      let sequence = existing.length;
      for (const candidate of toCreate) {
        const occurrence = await tx.occurrence.create({
          data: {
            planningId,
            stationId: candidate.stationId,
            templateId: candidate.shiftTemplateId,
            shiftTemplateId: candidate.shiftTemplateId,
            label: candidate.label,
            shiftLabel: candidate.label,
            day: candidate.startTime.slice(0, 10),
            breakStart: candidate.breakStart,
            breakEnd: candidate.breakEnd,
            breakMinutes: candidate.breakMinutes,
            requiredStaff: 1,
            startTime: new Date(candidate.startTime),
            endTime: new Date(candidate.endTime),
          },
        });
        await tx.planningVacancy.create({
          data: {
            planningId,
            occurrenceId: occurrence.id,
            stationId: candidate.stationId,
            day: candidate.startTime.slice(0, 10),
            startTime: new Date(candidate.startTime),
            endTime: new Date(candidate.endTime),
            missing: 1,
          },
        });
        sequence += 1;
      }
      await tx.planning.update({
        where: { id: planningId },
        data: {
          revision: { increment: 1 },
          // Le planning « enveloppe » peut être créé sans station : la
          // génération est ce qui rattache réellement la station.
          ...(planning.stationIds.includes(stationId)
            ? {}
            : { stationIds: [...planning.stationIds, stationId] }),
        },
      });
      await tx.planningRevision.create({
        data: {
          planningId,
          revision: planning.revision + 1,
          action: 'OCCURRENCES_GENERATED',
          actorId: actor.id,
          snapshot: { stationId, added: toCreate.length } as Prisma.InputJsonValue,
        },
      });
    });

    return this.detail(planningId, actor);
  }

  /**
   * Affectation automatique : répartit les agents disponibles sur les postes
   * vacants d'un brouillon, sans jamais dépasser les limites de la station.
   */
  async autoAssign(planningId: string, actor: AuthenticatedUser) {
    const planning = await this.requirePlanning(planningId);
    if (planning.status !== PlanningStatus.DRAFT) {
      throw new ConflictDomain(
        'PLANNING_NOT_DRAFT',
        'L’affectation automatique est réservée aux brouillons.',
        409,
      );
    }
    const vacancies = await this.prisma.occurrence.findMany({
      where: { planningId, assignments: { none: {} } },
      orderBy: { startTime: 'asc' },
    });
    if (!vacancies.length) {
      return { assigned: 0, planning: await this.detail(planningId) };
    }

    const stationId = vacancies[0].stationId;
    const pool = await this.prisma.user.findMany({
      where: {
        role: 'SWAPPER',
        isActive: true,
        OR: [{ stationId }, { stationId: null }],
      },
      select: { id: true },
      orderBy: { fullName: 'asc' },
    });

    let assigned = 0;
    for (const occurrence of vacancies) {
      for (const candidate of pool) {
        const report = await this.constraints.occurrenceReport(
          occurrence.id,
          candidate.id,
        );
        if (!report.valid) continue;
        const alreadyOnDay = await this.prisma.occurrenceAssignment.count({
          where: {
            userId: candidate.id,
            occurrence: { day: occurrence.day },
          },
        });
        if (alreadyOnDay) continue;
        await this.prisma.occurrenceAssignment.create({
          data: {
            occurrenceId: occurrence.id,
            userId: candidate.id,
            assignedById: actor.id,
          },
        });
        await this.prisma.occurrence.update({
          where: { id: occurrence.id },
          data: { swapperId: candidate.id },
        });
        await this.prisma.planningVacancy.deleteMany({
          where: { occurrenceId: occurrence.id },
        });
        assigned += 1;
        break;
      }
    }

    if (assigned) {
      await this.prisma.planning.update({
        where: { id: planningId },
        data: { revision: { increment: 1 } },
      });
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'PLANNING_AUTO_ASSIGNED',
      targetType: 'Planning',
      targetId: planningId,
      metadata: { assigned },
    });

    return { assigned, planning: await this.detail(planningId) };
  }

  /**
   * Validation d'un planning : renvoie `valid` et la liste des postes encore
   * vacants. Le bouton « Publier » du frontend lit `report.valid`.
   */
  async validatePlanning(planningId: string) {
    const planning = await this.requirePlanning(planningId);
    const occurrences = await this.prisma.occurrence.findMany({
      where: { planningId },
      select: { id: true },
    });
    const vacancyReport = await this.constraints.vacancyReport(planningId);
    const blockingStation =
      vacancyReport.blockingStations.length > 0;
    const valid = occurrences.length > 0 && !blockingStation;
    return {
      valid,
      planningId,
      revision: planning.revision,
      occurrences: occurrences.length,
      vacancies: vacancyReport.vacant,
      blockingStations: vacancyReport.blockingStations,
      reason: !occurrences.length
        ? 'Aucun poste dans ce planning : générez d’abord les créneaux.'
        : blockingStation
          ? `Publication bloquée : ${vacancyReport.vacant} poste(s) vacant(s).`
          : null,
    };
  }

  /** Avis de publication de l'utilisateur connecté. */
  async notices(userId: string) {
    const rows = await this.prisma.planningNotice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      planningId: row.planningId,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async readNotice(userId: string, noticeId: string) {
    const notice = await this.prisma.planningNotice.findFirst({
      where: { id: noticeId, userId },
    });
    if (!notice) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Avis introuvable.');
    }
    await this.prisma.planningNotice.update({
      where: { id: noticeId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** Met à jour un poste (affectation, permutation, horaires). */
  async updateOccurrence(
    planningId: string,
    occurrenceId: string,
    body: {
      swapperId?: string | null;
      swapWith?: string | null;
      notes?: string | null;
      startTime?: string;
      endTime?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const planning = await this.requirePlanning(planningId);
    const occurrence = await this.prisma.occurrence.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Poste introuvable.');
    }

    await this.prisma.$transaction(async (tx) => {
      if (body.swapperId !== undefined) {
        await tx.occurrenceAssignment.deleteMany({ where: { occurrenceId } });
        if (body.swapperId) {
          await tx.occurrenceAssignment.create({
            data: {
              occurrenceId,
              userId: body.swapperId,
              assignedById: actor.id,
            },
          });
          await tx.occurrence.update({
            where: { id: occurrenceId },
            data: { swapperId: body.swapperId },
          });
          await tx.planningVacancy.deleteMany({ where: { occurrenceId } });
          await this.recordChange(tx, occurrence, body.swapperId, actor, 'REASSIGNMENT');
        } else {
          await tx.occurrence.update({
            where: { id: occurrenceId },
            data: { swapperId: null },
          });
          await tx.planningVacancy.create({
            data: {
              planningId,
              occurrenceId,
              stationId: occurrence.stationId,
              day: occurrence.day,
              startTime: occurrence.startTime,
              endTime: occurrence.endTime,
              missing: 1,
            },
          });
        }
      }

      if (body.swapWith) {
        const counterpart = await tx.occurrence.findFirst({
          where: { id: body.swapWith, planningId },
        });
        if (counterpart) {
          const other = await tx.occurrenceAssignment.findFirst({
            where: { occurrenceId: counterpart.id },
          });
          await tx.occurrenceAssignment.deleteMany({
            where: { occurrenceId: { in: [occurrenceId, counterpart.id] } },
          });
          const firstUser = body.swapperId ?? null;
          const secondUser = other?.userId ?? null;
          if (secondUser) {
            await tx.occurrenceAssignment.create({
              data: {
                occurrenceId,
                userId: secondUser,
                assignedById: actor.id,
              },
            });
          }
          if (firstUser) {
            await tx.occurrenceAssignment.create({
              data: {
                occurrenceId: counterpart.id,
                userId: firstUser,
                assignedById: actor.id,
              },
            });
          }
        }
      }

      if (body.notes !== undefined || body.startTime || body.endTime) {
        await tx.occurrence.update({
          where: { id: occurrenceId },
          data: {
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.startTime ? { startTime: new Date(body.startTime) } : {}),
            ...(body.endTime ? { endTime: new Date(body.endTime) } : {}),
            revision: { increment: 1 },
          },
        });
      }

      await tx.planning.update({
        where: { id: planningId },
        data: { revision: { increment: 1 } },
      });
      await tx.planningRevision.create({
        data: {
          planningId,
          revision: planning.revision + 1,
          action: 'OCCURRENCE_UPDATED',
          actorId: actor.id,
          snapshot: { occurrenceId } as Prisma.InputJsonValue,
        },
      });
    });

    return this.detail(planningId);
  }

  /** Duplique un poste (utile pour couvrir un besoin supplémentaire). */
  async duplicateOccurrence(
    planningId: string,
    occurrenceId: string,
    actor: AuthenticatedUser,
  ) {
    await this.requirePlanning(planningId);
    const source = await this.prisma.occurrence.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!source) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Poste introuvable.');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.occurrence.create({
        data: {
          planningId,
          stationId: source.stationId,
          templateId: source.templateId,
          shiftTemplateId: source.shiftTemplateId,
          label: source.label,
          shiftLabel: source.shiftLabel,
          day: source.day,
          breakStart: source.breakStart,
          breakEnd: source.breakEnd,
          breakMinutes: source.breakMinutes,
          requiredStaff: source.requiredStaff,
          notes: source.notes,
          startTime: source.startTime,
          endTime: source.endTime,
        },
      });
      await tx.planning.update({
        where: { id: planningId },
        data: { revision: { increment: 1 } },
      });
      return copy;
    });
    return { ok: true, id: created.id };
  }

  /** Retire un poste. Le dernier poste d'un créneau est vidé, pas supprimé. */
  async removeOccurrence(
    planningId: string,
    occurrenceId: string,
    actor: AuthenticatedUser,
  ) {
    await this.requirePlanning(planningId);
    const target = await this.prisma.occurrence.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!target) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Poste introuvable.');
    }
    const attendance = await this.prisma.attendance.findUnique({
      where: { shiftId: occurrenceId },
    });
    if (attendance) {
      throw new ConflictDomain(
        'OCCURRENCE_HAS_ATTENDANCE',
        'Ce poste porte déjà un pointage : il ne peut plus être retiré.',
        409,
      );
    }

    const sameShift = await this.prisma.occurrence.count({
      where: {
        planningId,
        stationId: target.stationId,
        templateId: target.templateId,
        startTime: target.startTime,
        endTime: target.endTime,
      },
    });

    if (sameShift <= 1) {
      await this.prisma.$transaction(async (tx) => {
        await tx.occurrenceAssignment.deleteMany({
          where: { occurrenceId },
        });
        await tx.occurrence.update({
          where: { id: occurrenceId },
          data: { swapperId: null },
        });
        await tx.planning.update({
          where: { id: planningId },
          data: { revision: { increment: 1 } },
        });
      });
      return { ok: true, preserved: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.occurrence.delete({ where: { id: occurrenceId } });
      await tx.planning.update({
        where: { id: planningId },
        data: { revision: { increment: 1 } },
      });
    });
    return { ok: true };
  }

  /** Contrôles métier pour affecter un agent à un poste donné. */
  async validateOccurrence(
    planningId: string,
    occurrenceId: string,
    swapperId: string,
  ) {
    await this.requirePlanning(planningId);
    return this.constraints.occurrenceReport(occurrenceId, swapperId);
  }

  /* ---------------------------------------------------------------- */
  /* Internes                                                          */
  /* ---------------------------------------------------------------- */

  private async recordChange(
    tx: Prisma.TransactionClient,
    occurrence: { id: string; stationId: string; swapperId: string | null },
    inSwapperId: string,
    actor: AuthenticatedUser,
    type: 'REPLACEMENT' | 'PERMUTATION' | 'REASSIGNMENT',
  ) {
    const station = await tx.station.findUnique({
      where: { id: occurrence.stationId },
      select: { name: true },
    });
    await tx.shiftChange.create({
      data: {
        shiftId: occurrence.id,
        type,
        initiatorId: actor.id,
        initiator: actor.fullName,
        stationId: occurrence.stationId,
        station: station?.name ?? '',
        outSwapperId: occurrence.swapperId,
        inSwapperId,
      },
    });
  }

  /** Postes candidats pour un lot de modèles et de jours (aperçu/génération). */
  private async buildCandidates(
    planning: Planning,
    stationId: string,
    body: { templateIds?: string[]; weekdays?: number[] },
  ) {
    const templates = await this.prisma.shiftTemplate.findMany({
      where: {
        stationId,
        isActive: true,
        ...(body.templateIds?.length ? { id: { in: body.templateIds } } : {}),
      },
      orderBy: { startTime: 'asc' },
    });

    const days = enumerateDays(planning.periodStart, planning.periodEnd).filter(
      (day) => {
        if (!body.weekdays?.length) return true;
        const date = new Date(`${day}T00:00:00.000Z`);
        // 1 = lundi .. 7 = dimanche (convention frontend).
        const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
        return body.weekdays.includes(weekday);
      },
    );

    const candidates: {
      stationId: string;
      shiftTemplateId: string;
      label: string;
      startTime: string;
      endTime: string;
      breakStart: string | null;
      breakEnd: string | null;
      breakMinutes: number;
    }[] = [];

    for (const day of days) {
      for (const template of templates) {
        const startTime = this.combineDateAndTime(day, template.startTime);
        const crossesMidnight = template.endTime <= template.startTime;
        const endTime = this.combineDateAndTime(
          day,
          template.endTime,
          crossesMidnight,
        );
        candidates.push({
          stationId,
          shiftTemplateId: template.id,
          label: template.label,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          breakStart: template.breakStart,
          breakEnd: template.breakEnd,
          breakMinutes: template.breakMinutes,
        });
      }
    }
    return candidates;
  }

  private async findDuplicates(
    planningId: string,
    candidates: { stationId: string; shiftTemplateId: string; startTime: string }[],
  ) {
    const existing = await this.prisma.occurrence.findMany({
      where: { planningId },
      select: { stationId: true, templateId: true, startTime: true },
    });
    const keys = new Set(
      existing.map(
        (row) => `${row.stationId}|${row.templateId}|${row.startTime.toISOString()}`,
      ),
    );
    return candidates.filter((c) =>
      keys.has(`${c.stationId}|${c.shiftTemplateId}|${c.startTime}`),
    );
  }

  private async hashPreview(
    planningId: string,
    stationId: string,
    candidates: unknown[],
  ): Promise<string> {
    const payload = JSON.stringify({ planningId, stationId, candidates });
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  /* ---------------------------------------------------------------- */
  /* Validation                                                        */
  /* ---------------------------------------------------------------- */

  private normaliseAssignments(
    assignments: AssignmentDto[],
    stationIds: string[],
    periodStart: Date,
    periodEnd: Date,
    fallbackRequiredStaff?: number,
  ): (AssignmentDto & {
    requiredStaff: number;
    assignedUserIds: string[];
    day: string;
  })[] {
    const seen = new Set<string>();
    return assignments.map((assignment, index) => {
      const stationId = assignment.stationId;
      if (!stationId || !stationIds.includes(stationId)) {
        throw this.invalid(
          `Ligne ${index + 1} : la station ne fait pas partie de cette planification.`,
        );
      }
      const day = this.requireDate(assignment.day, `ligne ${index + 1}`);
      if (day < periodStart || day > periodEnd) {
        throw this.invalid(
          `Ligne ${index + 1} : la date sort de la période planifiée.`,
        );
      }
      if (!assignment.startTime || !assignment.endTime) {
        throw this.invalid(
          `Ligne ${index + 1} : les horaires de début et de fin sont obligatoires.`,
        );
      }
      slotMinutes(assignment.startTime, assignment.endTime);
      const requiredStaff = Math.max(
        1,
        Number(assignment.requiredStaff) || Number(fallbackRequiredStaff) || 1,
      );
      const assignedUserIds = [...new Set((assignment.assignedUserIds ?? []).filter(Boolean))];
      if (assignedUserIds.length > requiredStaff) {
        throw this.invalid(
          `Ligne ${index + 1} : plus d’agents affectés que de postes requis.`,
        );
      }
      const key = `${stationId}|${day.toISOString().slice(0, 10)}|${assignment.shiftTemplateId ?? assignment.shiftLabel ?? index}|${assignment.startTime}|${assignment.endTime}`;
      if (seen.has(key)) {
        throw this.invalid(
          `Ligne ${index + 1} : ce créneau est dupliqué pour cette station.`,
        );
      }
      seen.add(key);
      return {
        ...assignment,
        day: day.toISOString().slice(0, 10),
        requiredStaff,
        assignedUserIds,
      };
    });
  }

  /** Detecte les chevauchements d'un agent sur la periode concernee. */
  private async detectConflicts(
    assignments: AssignmentInput[],
    ignoreOccurrenceId?: string,
  ) {
    const userIds = [...new Set(assignments.flatMap((a) => a.assignedUserIds))];
    if (!userIds.length) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(users.map((user) => [user.id, user.fullName]));

    const days = assignments.map((a) => a.day);
    const existing = await this.prisma.occurrenceAssignment.findMany({
      where: {
        userId: { in: userIds },
        occurrence: {
          day: { in: days },
          ...(ignoreOccurrenceId ? { id: { not: ignoreOccurrenceId } } : {}),
        },
      },
      include: { occurrence: true },
    });

    const toMinutes = (date: Date) =>
      date.getUTCHours() * 60 + date.getUTCMinutes();

    const conflicts: {
      userId: string;
      swapperName: string;
      day: string;
      existingOccurrenceId: string;
    }[] = [];

    for (const assignment of assignments) {
      for (const userId of assignment.assignedUserIds) {
        const dayKey = assignment.day;
        for (const row of existing.filter((e) => e.userId === userId && e.occurrence.day === dayKey)) {
          const existingStart = toMinutes(row.occurrence.startTime);
          const existingEnd = toMinutes(row.occurrence.endTime);
          const candidateStart = Number(assignment.startTime.slice(0, 2)) * 60 + Number(assignment.startTime.slice(3, 5));
          const candidateEnd = Number(assignment.endTime.slice(0, 2)) * 60 + Number(assignment.endTime.slice(3, 5));
          if (overlaps(existingStart, existingEnd, candidateStart, candidateEnd)) {
            conflicts.push({
              userId,
              swapperName: nameOf.get(userId) ?? userId,
              day: dayKey,
              existingOccurrenceId: row.occurrence.id,
            });
          }
        }
      }
    }
    return dedupe(conflicts);
  }

  private async vacancyPolicy(stationId: string): Promise<boolean> {
    const station = await stationOf(this.prisma, stationId).catch(() => null);
    return station?.blockPublishingWithVacancies ?? false;
  }

  private async requirePlanning(id: string) {
    const planning = await this.prisma.planning.findUnique({ where: { id } });
    if (!planning) {
      throw new NotFoundDomain(
        ErrorCode.NOT_FOUND,
        'Planification introuvable.',
      );
    }
    return planning;
  }

  private requireDate(value: unknown, label: string): Date {
    const date = value ? new Date(String(value)) : null;
    if (!date || Number.isNaN(date.getTime())) {
      throw this.invalid(`La date de ${label} est invalide.`);
    }
    return date;
  }

  private invalid(message: string): ConflictDomain {
    return new ConflictDomain(ErrorCode.VALIDATION, message, 400);
  }

  /**
   * Combine un jour (AAAA-MM-JJ) et une heure locale (HH:MM) en un instant.
   * Quand le creneau franchit minuit, la fin est repoussee au lendemain — meme
   * regle que la generation de creneaux du frontend.
   */
  private combineDateAndTime(
    day: string,
    time: string,
    nextDay = false,
  ): Date {
    const [year, month, date] = day.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(
      Date.UTC(year, month - 1, date + (nextDay ? 1 : 0), hours, minutes),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function unassigned(assignment: { requiredStaff: number; assignedUserIds: string[] }) {
  return Math.max(0, assignment.requiredStaff - assignment.assignedUserIds.length);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  const aSpansMidnight = aEnd <= aStart;
  const bSpansMidnight = bEnd <= bStart;
  if (aSpansMidnight || bSpansMidnight) {
    return true;
  }
  return aStart < bEnd && bStart < aEnd;
}

function dedupe<T extends { userId: string; day: string; existingOccurrenceId: string }>(
  values: T[],
): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.userId}|${value.day}|${value.existingOccurrenceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enumerateDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
