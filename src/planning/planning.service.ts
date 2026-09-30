import {
Injectable,
NotFoundException,
BadRequestException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { SchedulingEngineService } from '../scheduling/scheduling-engine.service';

import { NotificationsService } from '../notifications/notifications.service';

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
return this.prisma.planning.findMany({
include: {
shifts: {
include: {
station: true,
swapper: {
select: {
id: true,
fullName: true,
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
});
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

return planning;

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
}