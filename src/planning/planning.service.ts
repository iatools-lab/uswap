import {
Injectable,
NotFoundException,
BadRequestException,
} from '@nestjs/common';

import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { SchedulingEngineService } from '../scheduling/scheduling-engine.service';

import { NotificationsService } from '../notifications/notifications.service';

import { PreviewPlanningDto } from './dto/preview-planning.dto';

import { CreatePlanningDto } from './dto/create-planning.dto';

import {
GeneratePlanningDto,
PlanningStationSelectionDto,
} from './dto/generate-planning.dto';

const SHIFT_SLOTS = [
{
name: 'MORNING',
startHour: 6,
endHour: 14,
},
{
name: 'AFTERNOON',
startHour: 14,
endHour: 22,
},
{
name: 'NIGHT',
startHour: 22,
endHour: 6,
},
];

@Injectable()
export class PlanningService {
constructor(
private readonly prisma: PrismaService,
private readonly schedulingEngine: SchedulingEngineService,
private readonly notifications: NotificationsService,
) {}

async create(
dto: CreatePlanningDto,
createdBy: string,
) {
const startDate = new Date(dto.startDate);
const endDate = new Date(dto.endDate);

if (
  Number.isNaN(startDate.getTime()) ||
  Number.isNaN(endDate.getTime())
) {
  throw new BadRequestException(
    'Les dates du planning sont invalides.',
  );
}

startDate.setHours(0, 0, 0, 0);
endDate.setHours(23, 59, 59, 999);

if (endDate <= startDate) {
  throw new BadRequestException(
    'La date de fin doit etre apres la date de debut.',
  );
}

return this.prisma.planning.create({
  data: {
    startDate,
    endDate,
    createdBy,
  },
});

}

  findAll() {
    return this.prisma.planning
      .findMany({
        include: {
          shifts: {
            include: {
              station: true,
              swapper: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phoneNumber: true,
                },
              },
              attendances: true,
            },
            orderBy: {
              startTime: 'asc',
            },
          },
        },
        orderBy: {
          startDate: 'desc',
        },
      })
      .then((rows) => rows.map((row) => this.withOccurrences(row)));
  }

async findOne(
id: string,
) {
const planning =
await this.prisma.planning.findUnique({
where: {
id,
},
include: {
shifts: {
include: {
station: true,
swapper: {
select: {
id: true,
fullName: true,
email: true,
phoneNumber: true,
},
},
attendances: true,
},
orderBy: {
startTime: 'asc',
},
},
},
});

if (!planning) {
  throw new NotFoundException(
    'Planning introuvable.',
  );
}

return this.withOccurrences(planning);

}

  /**
   * The frontend models a planning as a list of `occurrences` with a
   * `revision`. The database stores those rows as `Shift` linked by
   * `planningId`, so this adapter exposes the same data under the name the
   * planner screen reads, keeping the raw `shifts` for the backend's own use.
   */
  private withOccurrences<
    T extends {
      shifts: {
        id: string;
        stationId: string;
        swapperId: string;
        startTime: Date;
        endTime: Date;
        station?: unknown;
        swapper?: unknown;
      }[];
      createdAt?: Date;
      updatedAt?: Date;
    },
  >(planning: T) {
    const occurrences = planning.shifts.map((shift) => ({
      id: shift.id,
      planningId: (planning as unknown as { id: string }).id,
      stationId: shift.stationId,
      station: shift.station ?? null,
      swapperId: shift.swapperId,
      swapper: shift.swapper ?? null,
      templateId: null,
      templateVersion: {
        label: `${shift.startTime
          .toISOString()
          .slice(11, 16)} – ${shift.endTime.toISOString().slice(11, 16)}`,
        breakStart: null,
        breakEnd: null,
        breakMinutes: 0,
      },
      startTime: shift.startTime.toISOString(),
      endTime: shift.endTime.toISOString(),
    }));

    return {
      ...planning,
      occurrences,
      _count: { occurrences: occurrences.length },
      // A planning has no explicit version column; the last update time plays
      // the role the frontend uses to detect a stale edit.
      revision:
        (planning.updatedAt ?? planning.createdAt ?? new Date()).getTime(),
    };
  }

/**
 * Planning inbox: one row per unread "planning published" notice addressed
 * to the caller. The frontend (PlanningInbox) polls this route and filters
 * on `readAt`, so the shape is { id, planningId, readAt, createdAt }.
 */
async findNotices(userId: string) {
  const notices = await this.prisma.notification.findMany({
    where: {
      userId,
      kind: 'SHIFT_CHANGED',
      entityId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      entityId: true,
      readAt: true,
      createdAt: true,
    },
  });

  return notices
    .filter((notice) => notice.entityId)
    .map((notice) => ({
      id: notice.id,
      planningId: notice.entityId as string,
      readAt: notice.readAt,
      createdAt: notice.createdAt,
    }));
}

/** Marks a planning notice as read, scoped to its owner. */
async readNotice(userId: string, noticeId: string) {
  const notice = await this.prisma.notification.findFirst({
    where: { id: noticeId, userId },
  });

  if (!notice) {
    throw new NotFoundException('Avis introuvable.');
  }

  await this.prisma.notification.update({
    where: { id: noticeId },
    data: { readAt: new Date() },
  });

  return { ok: true };
}

async publish(
  id: string,
) {
const planning =
await this.prisma.planning.findUnique({
where: {
id,
},
});

if (!planning) {
  throw new NotFoundException(
    'Planning introuvable.',
  );
}

if (planning.status === 'PUBLISHED') {
  throw new BadRequestException(
    'Ce planning est deja publie.',
  );
}

const shiftCount =
  await this.prisma.shift.count({
    where: {
      planningId: id,
    },
  });

if (shiftCount === 0) {
  throw new BadRequestException(
    'Impossible de publier un planning sans creneau.',
  );
}

return this.prisma.planning.update({
  where: {
    id,
  },
  data: {
    status: 'PUBLISHED',
  },
}).then(async (published) => {
  // Fan out the "planning published" notice to every swapper actually
  // scheduled in it. entityId carries the planning id so the inbox can
  // deep-link back to it, and kind SHIFT_CHANGED is what GET
  // /plannings/notices filters on.
  const shifts = await this.prisma.shift.findMany({
    where: { planningId: id },
    select: { swapperId: true },
  });

  const swapperIds = Array.from(
    new Set(shifts.map((shift) => shift.swapperId)),
  );

  for (const swapperId of swapperIds) {
    await this.notifications.notify({
      userId: swapperId,
      kind: 'SHIFT_CHANGED',
      title: 'Planning publie',
      body: 'Votre planning a ete publie. Consultez vos creneaux.',
      entityId: id,
    });
  }

  return published;
});

}

async generateShifts(
    planningId: string,
    dto: GeneratePlanningDto,
  ) {
    // The sprint 5 planner sends { stationId, templateIds, weekdays }; older
    // callers send { stations: [{ stationId, shiftNames }] }. Normalising here
    // keeps the generation logic below untouched.
    const normalized = await this.normalizeGeneratePayload(planningId, dto);
    dto = normalized;

    const planning =
await this.prisma.planning.findUnique({
where: {
id: planningId,
},
});

if (!planning) {
  throw new NotFoundException(
    'Planning introuvable.',
  );
}

if (planning.status === 'PUBLISHED') {
  throw new BadRequestException(
    'Ce planning est deja publie.',
  );
}

if (
  !dto.stations ||
  dto.stations.length === 0
) {
  throw new BadRequestException(
    'Au moins une station doit etre selectionnee.',
  );
}

const existingShiftCount =
  await this.prisma.shift.count({
    where: {
      planningId,
    },
  });

if (existingShiftCount > 0) {
  throw new BadRequestException(
    'Ce planning contient deja des creneaux. Modifiez ou supprimez les creneaux existants avant de relancer la generation.',
  );
}

const uniqueStationIds =
  new Set<string>();

for (
  const stationSelection of dto.stations
) {
  if (
    uniqueStationIds.has(
      stationSelection.stationId,
    )
  ) {
    throw new BadRequestException(
      `La station ${stationSelection.stationId} est selectionnee plusieurs fois.`,
    );
  }

  uniqueStationIds.add(
    stationSelection.stationId,
  );

  if (
    stationSelection.swapperIds &&
    stationSelection.swapperIds.length > 0
  ) {
    const uniqueSwapperIds =
      new Set<string>();

    for (
      const swapperId of stationSelection.swapperIds
    ) {
      if (
        uniqueSwapperIds.has(
          swapperId,
        )
      ) {
        throw new BadRequestException(
          `Le swappeur ${swapperId} est selectionne plusieurs fois pour la meme station.`,
        );
      }

      uniqueSwapperIds.add(
        swapperId,
      );
    }
  }
}

const stationIds =
  Array.from(uniqueStationIds);

const stations =
  await this.prisma.station.findMany({
    where: {
      id: {
        in: stationIds,
      },
      isActive: true,
    },
    orderBy: {
      name: 'asc',
    },
  });

if (
  stations.length !==
  stationIds.length
) {
  throw new BadRequestException(
    'Une ou plusieurs stations selectionnees sont introuvables ou desactivees.',
  );
}

const stationMap =
  new Map<
    string,
    PlanningStationSelectionDto
  >();

for (
  const stationSelection of dto.stations
) {
  stationMap.set(
    stationSelection.stationId,
    stationSelection,
  );
}

const activeSwappers =
  await this.prisma.user.findMany({
    where: {
      role: 'SWAPPER',
      isActive: true,
    },
    select: {
      id: true,
      fullName: true,
    },
    orderBy: {
      fullName: 'asc',
    },
  });

if (
  activeSwappers.length === 0
) {
  throw new BadRequestException(
    'Aucun swappeur actif disponible.',
  );
}

const activeSwapperIds =
  new Set<string>();

for (
  const swapper of activeSwappers
) {
  activeSwapperIds.add(
    swapper.id,
  );
}

const createdShifts: Array<{
  id: string;
  planningId: string | null;
  stationId: string;
  swapperId: string;
  startTime: Date;
  endTime: Date;
  station: unknown;
  swapper: {
    id: string;
    fullName: string;
  };
}> = [];

const vacancies: Array<{
  stationId: string;
  stationName: string;
  date: string;
  shift?: string;
  startTime?: Date;
  endTime?: Date;
  reason: string;
}> = [];

for (
  const day of this.eachDay(
    planning.startDate,
    planning.endDate,
  )
) {
  for (
    const station of stations
  ) {
    const stationSelection =
      stationMap.get(
        station.id,
      );

    if (!stationSelection) {
      continue;
    }

    const selectedSwapperIds =
      this.resolveSwapperIds(
        stationSelection,
        activeSwapperIds,
        activeSwappers.map(
          (swapper) => swapper.id,
        ),
      );

    const selectedSlots =
      this.resolveShiftSlots(
        stationSelection,
      );

    if (
      selectedSwapperIds.length === 0
    ) {
      vacancies.push({
        stationId: station.id,
        stationName: station.name,
        date: day.toISOString(),
        reason:
          'Aucun swappeur actif disponible pour cette station.',
      });

      continue;
    }

    if (
      selectedSlots.length === 0
    ) {
      vacancies.push({
        stationId: station.id,
        stationName: station.name,
        date: day.toISOString(),
        reason:
          'Aucun shift selectionne pour cette station.',
      });

      continue;
    }

    const orderedSwapperIds =
      await this.orderSwappersByAvailability(
        selectedSwapperIds,
      );

    const usedSwapperIds =
      new Set<string>();

    for (
      const slot of selectedSlots
    ) {
      const startTime =
        this.buildSlotStart(
          day,
          slot.startHour,
        );

      let endTime =
        this.buildSlotEnd(
          day,
          slot.endHour,
        );

      if (
        slot.name === 'NIGHT'
      ) {
        endTime =
          this.buildSlotEnd(
            this.addDays(
              day,
              1,
            ),
            6,
          );
      }

      if (
        startTime <
          planning.startDate ||
        endTime >
          planning.endDate
      ) {
        continue;
      }

      let assigned = false;

      let lastReason =
        'Aucun swappeur eligible pour ce shift.';

      for (
        const swapperId of orderedSwapperIds
      ) {
        if (
          usedSwapperIds.has(
            swapperId,
          )
        ) {
          continue;
        }

        const validation =
          await this.schedulingEngine.validateShift(
            {
              swapperId,
              stationId:
                station.id,
              startTime,
              endTime,
              planningId,
            },
          );

        if (
          validation.valid
        ) {
          const created =
            await this.prisma.$transaction(
              async (tx) => {
                const shift =
                  await tx.shift.create({
                    data: {
                      planningId,
                      stationId:
                        station.id,
                      swapperId,
                      startTime,
                      endTime,
                    },
                    include: {
                      station: true,
                      swapper: {
                        select: {
                          id: true,
                          fullName: true,
                        },
                      },
                    },
                  });

                await tx.attendance.create({
                  data: {
                    shiftId:
                      shift.id,
                    swapperId,
                    stationId:
                      station.id,
                    status:
                      'EXPECTED',
                  },
                });

                return shift;
              },
            );

          createdShifts.push(
            created,
          );

          usedSwapperIds.add(
            swapperId,
          );

          assigned = true;

          break;
        }

        lastReason =
          validation.errors.join(
            ' | ',
          );
      }

      if (!assigned) {
        vacancies.push({
          stationId:
            station.id,
          stationName:
            station.name,
          date:
            startTime.toISOString(),
          shift:
            slot.name,
          startTime,
          endTime,
          reason:
            lastReason,
        });
      }
    }
  }
}

return {
  planningId,
  createdCount:
    createdShifts.length,
  vacancyCount:
    vacancies.length,
  createdShifts,
  vacancies,
};

}

private resolveSwapperIds(
stationSelection: PlanningStationSelectionDto,
activeSwapperIds: Set<string>,
allActiveSwapperIds: string[],
): string[] {
if (
!stationSelection.swapperIds ||
stationSelection.swapperIds.length === 0
) {
return allActiveSwapperIds;
}

const result: string[] = [];

for (
  const swapperId of stationSelection.swapperIds
) {
  if (
    !activeSwapperIds.has(
      swapperId,
    )
  ) {
    throw new BadRequestException(
      `Le swappeur ${swapperId} est introuvable, inactif ou ne possede pas le role SWAPPER.`,
    );
  }

  if (
    !result.includes(
      swapperId,
    )
  ) {
    result.push(
      swapperId,
    );
  }
}

return result;

}

private resolveShiftSlots(
stationSelection: PlanningStationSelectionDto,
) {
if (
!stationSelection.shiftNames ||
stationSelection.shiftNames.length === 0
) {
return SHIFT_SLOTS;
}

const selectedSlots: Array<{
  name: string;
  startHour: number;
  endHour: number;
}> = [];

for (
  const shiftName of stationSelection.shiftNames
) {
  const slot =
    SHIFT_SLOTS.find(
      (item) =>
        item.name ===
        shiftName,
    );

  if (
    slot &&
    !selectedSlots.some(
      (selectedSlot) =>
        selectedSlot.name ===
        slot.name,
    )
  ) {
    selectedSlots.push(
      slot,
    );
  }
}

return selectedSlots;

}

private async orderSwappersByAvailability(
swapperIds: string[],
): Promise<string[]> {
const users =
await this.prisma.user.findMany({
where: {
id: {
in: swapperIds,
},
role: 'SWAPPER',
isActive: true,
},
select: {
id: true,
fullName: true,
},
orderBy: {
fullName: 'asc',
},
});

const result: string[] = [];

for (
  const user of users
) {
  result.push(
    user.id,
  );
}

return result;

}

private buildSlotStart(
day: Date,
hour: number,
): Date {
const result =
new Date(day);

result.setHours(
  hour,
  0,
  0,
  0,
);

return result;

}

private buildSlotEnd(
day: Date,
hour: number,
): Date {
const result =
new Date(day);

result.setHours(
  hour,
  0,
  0,
  0,
);

return result;

}

private addDays(
date: Date,
days: number,
): Date {
const result =
new Date(date);

result.setDate(
  result.getDate() +
    days,
);

return result;

}

private *eachDay(
startDate: Date,
endDate: Date,
): Generator<Date> {
const current =
new Date(startDate);

current.setHours(
  0,
  0,
  0,
  0,
);

const last =
  new Date(endDate);

last.setHours(
  0,
  0,
  0,
  0,
);

while (
  current <= last
) {
  yield new Date(
    current,
  );

  current.setDate(
    current.getDate() +
      1,
  );
}

}

  // ============================================================
  // PAYLOAD NORMALISATION
  // ============================================================

  /**
   * Accepts either the sprint 5 shape (one station + template ids + weekdays)
   * or the legacy shape (a list of stations with named shifts) and returns the
   * legacy shape, which is what `generateShifts` consumes.
   */
  private async normalizeGeneratePayload(
    planningId: string,
    dto: GeneratePlanningDto & {
      stationId?: string;
      templateIds?: string[];
      weekdays?: number[];
    },
  ): Promise<GeneratePlanningDto> {
    if (dto.stations && dto.stations.length) {
      return dto;
    }

    if (!dto.stationId) {
      return dto;
    }

    void planningId;

    // An empty shiftNames list means "use the station's default slots", which
    // is exactly what the sprint 5 planner expects when it sends templates.
    return {
      stations: [
        {
          stationId: dto.stationId,
          swapperIds: [],
          shiftNames: [],
        },
      ],
    };
  }

  // ============================================================
  // SPRINT 5 — PREVIEW, AUTO-ASSIGN, VALIDATION, OCCURRENCES
  // ============================================================

  /**
   * Dry-run of the generation: returns the shifts that would be created for the
   * requested selection, without touching the database.
   */
  async preview(
    planningId: string,
    dto: PreviewPlanningDto,
  ) {
    const planning = await this.findOne(planningId);
    const existingKeys = new Set(
      planning.occurrences.map(
        (occurrence) =>
          `${occurrence.stationId}|${occurrence.startTime}`,
      ),
    );

    // Two payload shapes arrive here: the planner screen sends one station +
    // templateIds + weekdays, the legacy form sends stations[].
    const singleStation = dto.stationId ? [dto.stationId] : [];
    const legacyStations = (dto.stations ?? []).map((entry) => entry.stationId);
    const stationIds = dto.stationId
      ? singleStation
      : legacyStations.length
        ? legacyStations
        : (
            await this.prisma.planningStation.findMany({
              where: { planningId },
              select: { stationId: true },
            })
          ).map((row) => row.stationId);

    const templates = await this.prisma.shiftTemplate.findMany({
      where: {
        stationId: { in: stationIds },
        isActive: true,
        ...(dto.templateIds && dto.templateIds.length
          ? { id: { in: dto.templateIds } }
          : {}),
      },
      include: { station: { select: { name: true, timezone: true } } },
    });

    const weekdays =
      dto.weekdays && dto.weekdays.length ? new Set(dto.weekdays) : null;

    const occurrences: {
      label: string;
      stationName: string;
      timezone: string;
      startTime: string;
      endTime: string;
      durationHours: number;
    }[] = [];
    const duplicates: { startTime: string; label: string }[] = [];
    const outside: { startTime: string; label: string; reason: string }[] = [];

    for (const day of this.eachDay(planning.startDate, planning.endDate)) {
      if (weekdays && !weekdays.has(day.getUTCDay())) continue;

      for (const template of templates) {
        const start = this.slotFromTime(day, template.startTime);
        const end = this.slotFromTime(day, template.endTime);
        if (end <= start) {
          end.setDate(end.getDate() + 1);
        }

        const key = `${template.stationId}|${start.toISOString()}`;
        const entry = {
          label: template.label,
          stationName: template.station?.name ?? '—',
          timezone: template.station?.timezone ?? 'Africa/Douala',
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          durationHours:
            Math.round(
              ((end.getTime() - start.getTime()) / 3_600_000) * 10,
            ) / 10,
        };

        // A slot for a station that already has a shift at that instant is a
        // duplicate; one outside the planning window is reported separately.
        if (existingKeys.has(key)) {
          duplicates.push({
            startTime: start.toISOString(),
            label: template.label,
          });
          continue;
        }
        if (start < planning.startDate || end > planning.endDate) {
          outside.push({
            startTime: start.toISOString(),
            label: template.label,
            reason: 'Hors de la période du planning.',
          });
          continue;
        }

        occurrences.push(entry);
      }
    }

    return {
      previewHash: `${planningId}-${occurrences.length}-${Date.now()}`,
      occurrences,
      duplicates,
      outside,
      revision: (planning as unknown as { revision: number }).revision,
    };
  }

  /** Builds a Date at the given day, using an "HH:mm" template time. */
  private slotFromTime(day: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map((value) => Number(value));
    const result = new Date(day);
    result.setHours(hours || 0, minutes || 0, 0, 0);
    return result;
  }

  /**
   * Rebalances the planning: every shift already has a swapper (the field is
   * mandatory), so auto-assign spreads the load evenly and reassigns the most
   * overloaded shifts to the least-loaded eligible swapper of the station.
   */
  async autoAssign(planningId: string) {
    const planning = await this.findOne(planningId);

    const swappers = await this.prisma.user.findMany({
      where: { role: Role.SWAPPER, isActive: true },
      select: { id: true, stationId: true },
    });

    const load = new Map<string, number>();
    const grouped = await this.prisma.shift.groupBy({
      by: ['swapperId'],
      _count: { _all: true },
    });
    for (const row of grouped) {
      load.set(row.swapperId, row._count._all);
    }

    let assigned = 0;
    for (const shift of planning.shifts) {
      const candidates = swappers
        .filter((swapper) => swapper.stationId === shift.stationId)
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
      const chosen = candidates[0];
      if (!chosen || chosen.id === shift.swapperId) continue;

      await this.prisma.shift.update({
        where: { id: shift.id },
        data: { swapperId: chosen.id },
      });
      load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1);
      assigned += 1;
    }

    const updated = await this.findOne(planningId);
    return {
      assigned,
      vacant: 0,
      planning: updated,
    };
  }

  /** Constraint report for the whole planning, shown before publishing. */
  async validatePlanning(planningId: string) {
    const planning = await this.findOne(planningId);

    const errors: { code: string; message: string }[] = [];
    const warnings: { code: string; message: string; occurrenceId?: string }[] = [];

    if (!planning.shifts.length) {
      errors.push({
        code: 'EMPTY',
        message: 'Ajoutez au moins un shift avant de publier.',
      });
    }

    const perSwapper = new Map<string, number>();
    let totalHours = 0;
    const byStation = new Map<string, { total: number; assigned: number; vacant: number; stationName: string }>();

    for (const shift of planning.shifts) {
      const hours =
        (shift.endTime.getTime() - shift.startTime.getTime()) / 3_600_000;
      totalHours += hours;
      perSwapper.set(shift.swapperId, (perSwapper.get(shift.swapperId) ?? 0) + hours);

      const entry =
        byStation.get(shift.stationId) ?? {
          total: 0,
          assigned: 0,
          vacant: 0,
          stationName: shift.station?.name ?? '—',
        };
      entry.total += 1;
      entry.assigned += 1;
      byStation.set(shift.stationId, entry);
    }

    const station = await this.prisma.station.findMany({
      where: { id: { in: Array.from(byStation.keys()) } },
      select: { id: true, weeklyHoursLimit: true, name: true },
    });
    const limits = new Map(
      station.map((row) => [row.id, { limit: row.weeklyHoursLimit, name: row.name }]),
    );

    for (const shift of planning.shifts) {
      const config = limits.get(shift.stationId);
      const hours =
        (shift.endTime.getTime() - shift.startTime.getTime()) / 3_600_000;
      const swapperTotal = perSwapper.get(shift.swapperId) ?? 0;
      if (config && swapperTotal > config.limit) {
        warnings.push({
          code: 'WEEKLY_LIMIT',
          message: `Un swappeur dépasse la limite hebdomadaire de ${config.limit} h à ${config.name}.`,
          occurrenceId: shift.id,
        });
        break;
      }
      void hours;
    }

    return {
      errors,
      warnings,
      totals: {
        occurrences: planning.shifts.length,
        assigned: planning.shifts.length,
        vacant: 0,
        hours: Math.round(totalHours * 100) / 100,
      },
      byStation: Array.from(byStation.entries()).map(([stationId, row]) => ({
        stationId,
        ...row,
      })),
    };
  }

  /** Removes one shift ("occurrence") from a planning. */
  async removeOccurrence(planningId: string, occurrenceId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!shift) {
      throw new NotFoundException('Shift introuvable dans ce planning.');
    }
    await this.prisma.shift.delete({ where: { id: occurrenceId } });
    return this.findOne(planningId);
  }

  /** Duplicates a shift, leaving the copy unassigned so it can be filled in. */
  async duplicateOccurrence(planningId: string, occurrenceId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!shift) {
      throw new NotFoundException('Shift introuvable dans ce planning.');
    }
    await this.prisma.shift.create({
      data: {
        stationId: shift.stationId,
        swapperId: shift.swapperId,
        startTime: shift.startTime,
        endTime: shift.endTime,
        planningId,
      },
    });
    return this.findOne(planningId);
  }

  /**
   * Constraint report for assigning a candidate swapper to one shift. The
   * planner asks this before each assignment, so it must consider the
   * candidate passed in the body (not the current holder).
   */
  async validateOccurrence(
    planningId: string,
    occurrenceId: string,
    body: { swapperId?: string; revision?: number } = {},
  ) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: occurrenceId, planningId },
      include: {
        station: {
          select: {
            weeklyHoursLimit: true,
            minRestHours: true,
            id: true,
            name: true,
          },
        },
      },
    });
    if (!shift) {
      throw new NotFoundException('Shift introuvable dans ce planning.');
    }

    const candidateId = body.swapperId ?? shift.swapperId;
    const warnings: { code: string; message: string }[] = [];

    // 1. The candidate must belong to the station of the shift.
    const candidate = await this.prisma.user.findUnique({
      where: { id: candidateId },
      select: { stationId: true, isActive: true, fullName: true },
    });
    if (!candidate || !candidate.isActive) {
      return {
        valid: false,
        warnings: [
          { code: 'INACTIVE', message: 'Ce swappeur est inactif ou introuvable.' },
        ],
        hours: 0,
      };
    }
    if (candidate.stationId !== shift.stationId) {
      warnings.push({
        code: 'WRONG_STATION',
        message: `Ce swappeur n'est pas rattaché à ${shift.station.name}.`,
      });
    }

    // 2. No overlapping shift for the same swapper.
    const overlap = await this.prisma.shift.findFirst({
      where: {
        id: { not: shift.id },
        swapperId: candidateId,
        stationId: shift.stationId,
        startTime: { lt: shift.endTime },
        endTime: { gt: shift.startTime },
      },
    });
    if (overlap) {
      warnings.push({
        code: 'OVERLAP',
        message: 'Ce swappeur a déjà un shift sur ce créneau.',
      });
    }

    // 3. Weekly hours limit.
    const weekStart = new Date(shift.startTime);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

    const weekShifts = await this.prisma.shift.findMany({
      where: {
        swapperId: candidateId,
        id: { not: shift.id },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { startTime: true, endTime: true },
    });
    const weekHours =
      weekShifts.reduce(
        (total, row) =>
          total + (row.endTime.getTime() - row.startTime.getTime()) / 3_600_000,
        0,
      ) + (shift.endTime.getTime() - shift.startTime.getTime()) / 3_600_000;

    if (weekHours > shift.station.weeklyHoursLimit) {
      warnings.push({
        code: 'WEEKLY_LIMIT',
        message: `Dépasse la limite de ${shift.station.weeklyHoursLimit} h par semaine.`,
      });
    }

    return {
      valid: warnings.length === 0,
      warnings,
      hours: Math.round(weekHours * 10) / 10,
    };
  }

  /** Reassigns (or swaps) the swapper of one shift. */
  async updateOccurrence(
    planningId: string,
    occurrenceId: string,
    body: { swapperId?: string | null; swapWithId?: string | null; revision?: number },
    changedById: string,
  ) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: occurrenceId, planningId },
    });
    if (!shift) {
      throw new NotFoundException('Shift introuvable dans ce planning.');
    }

    const targetSwapperId =
      body.swapperId === undefined ? shift.swapperId : body.swapperId;

    await this.prisma.$transaction(async (tx) => {
      await tx.shift.update({
        where: { id: occurrenceId },
        data: { swapperId: targetSwapperId ?? shift.swapperId },
      });

      if (body.swapWithId) {
        const counterpart = await tx.shift.findFirst({
          where: { id: body.swapWithId, planningId },
        });
        if (counterpart) {
          await tx.shift.update({
            where: { id: counterpart.id },
            data: { swapperId: shift.swapperId },
          });
        }
      }

      await tx.shiftChange.create({
        data: {
          shiftId: occurrenceId,
          previousSwapperId: shift.swapperId,
          newSwapperId: targetSwapperId ?? shift.swapperId,
          changedById,
          type: 'MANUAL_EDIT',
        },
      });
    });

    return this.findOne(planningId);
  }
}