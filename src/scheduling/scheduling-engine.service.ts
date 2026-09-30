import {
BadRequestException,
Injectable,
NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import {
ConflictResult,
ShiftValidationInput,
ShiftValidationResult,
ShiftDurationResult,
WeeklyHoursResult,
} from './scheduling.types';

import {
DAILY_SHIFT_HOURS,
MIN_REST_HOURS,
getBusinessDate,
getDurationInHours,
getWeekStart,
hoursBetween,
} from './scheduling.utils';

@Injectable()
export class SchedulingEngineService {
constructor(
private readonly prisma: PrismaService,
) {}

async validateShift(
input: ShiftValidationInput,
): Promise<ShiftValidationResult> {
const errors: string[] = [];
const warnings: string[] = [];

const {
  swapperId,
  stationId,
  startTime,
  endTime,
  planningId,
  excludeShiftId,
} = input;

if (endTime <= startTime) {
  errors.push(
    "L'heure de fin doit etre apres l'heure de debut.",
  );

  return {
    valid: false,
    errors,
    warnings,
  };
}

const durationCheck =
  this.checkShiftDuration(
    startTime,
    endTime,
  );

if (!durationCheck.valid) {
  errors.push(
    durationCheck.message!,
  );
}

const station =
  await this.prisma.station.findUnique({
    where: {
      id: stationId,
    },
  });

if (!station) {
  errors.push(
    'Station introuvable.',
  );
} else if (!station.isActive) {
  errors.push(
    'Cette station est desactivee.',
  );
}

const swapper =
  await this.prisma.user.findUnique({
    where: {
      id: swapperId,
    },
  });

if (!swapper) {
  errors.push(
    'Swappeur introuvable.',
  );
} else {
  if (swapper.role !== 'SWAPPER') {
    errors.push(
      "L'utilisateur assigne doit avoir le role SWAPPER.",
    );
  }

  if (!swapper.isActive) {
    errors.push(
      'Ce swappeur est desactive.',
    );
  }
}

if (!station || !swapper) {
  return {
    valid: false,
    errors,
    warnings,
  };
}

if (planningId) {
  const planning =
    await this.prisma.planning.findUnique({
      where: {
        id: planningId,
      },
    });

  if (!planning) {
    errors.push(
      'Planning introuvable.',
    );
  } else {
    if (
      startTime < planning.startDate ||
      endTime > planning.endDate
    ) {
      errors.push(
        'Le creneau doit se situer dans la periode du planning.',
      );
    }
  }
}

const conflict =
  await this.checkConflict(
    swapperId,
    startTime,
    endTime,
    excludeShiftId,
  );

if (conflict.hasConflict) {
  errors.push(
    conflict.reason ??
      'Le swappeur a deja un creneau qui chevauche cette periode.',
  );
}

const oneShift =
  await this.checkOneShiftPerDay(
    swapperId,
    startTime,
    excludeShiftId,
  );

if (!oneShift.valid) {
  errors.push(
    oneShift.reason!,
  );
}

const configuredRestHours =
  station.minRestHours;

const minimumRest =
  configuredRestHours >= 0
    ? configuredRestHours
    : MIN_REST_HOURS;

const rest =
  await this.checkMinimumRest(
    swapperId,
    startTime,
    endTime,
    minimumRest,
    excludeShiftId,
  );

if (!rest.valid) {
  errors.push(
    rest.reason!,
  );
}

const configuredWeeklyLimit =
  station.weeklyHoursLimit;

const weeklyLimit =
  configuredWeeklyLimit > 0
    ? configuredWeeklyLimit
    : 48;

const weekly =
  await this.checkWeeklyHours(
    swapperId,
    startTime,
    endTime,
    weeklyLimit,
    excludeShiftId,
  );

if (weekly.exceedsLimit) {
  errors.push(
    `Limite hebdomadaire depassee : ${weekly.totalHours.toFixed(
      1,
    )}h projetees, maximum ${weekly.weeklyLimit}h autorise.`,
  );
}

const leave =
  await this.checkLeaveConflict(
    swapperId,
    startTime,
    endTime,
  );

if (!leave.valid) {
  errors.push(
    leave.reason!,
  );
}

return {
  valid: errors.length === 0,
  errors,
  warnings,
};

}

checkShiftDuration(
startTime: Date,
endTime: Date,
): ShiftDurationResult {
const durationHours =
getDurationInHours(
startTime,
endTime,
);

const valid =
  Math.abs(
    durationHours -
      DAILY_SHIFT_HOURS,
  ) < 0.001;

return {
  valid,
  durationHours,
  message: valid
    ? undefined
    : `La duree du creneau doit etre exactement de ${DAILY_SHIFT_HOURS} heures. Duree actuelle : ${durationHours.toFixed(
        1,
      )}h.`,
};

}

async checkConflict(
swapperId: string,
startTime: Date,
endTime: Date,
excludeShiftId?: string,
): Promise<ConflictResult> {
const shift =
await this.prisma.shift.findFirst({
where: {
swapperId: swapperId,
id: excludeShiftId
? {
not: excludeShiftId,
}
: undefined,
startTime: {
lt: endTime,
},
endTime: {
gt: startTime,
},
},
include: {
station: true,
},
});

if (!shift) {
  return {
    hasConflict: false,
    conflictingShiftIds: [],
  };
}

return {
  hasConflict: true,
  conflictingShiftIds: [
    shift.id,
  ],
  reason:
    `Ce swappeur a deja un creneau qui chevauche cette periode, ` +
    `sur la station ${shift.station.name}.`,
};

}

async checkOneShiftPerDay(
swapperId: string,
startTime: Date,
excludeShiftId?: string,
): Promise<{
valid: boolean;
reason?: string;
}> {
const businessDate =
getBusinessDate(startTime);

const shifts =
  await this.prisma.shift.findMany({
    where: {
      swapperId: swapperId,
      id: excludeShiftId
        ? {
            not: excludeShiftId,
          }
        : undefined,
    },
    select: {
      startTime: true,
    },
  });

for (const shift of shifts) {
  const shiftDate =
    getBusinessDate(
      shift.startTime,
    );

  if (
    shiftDate ===
    businessDate
  ) {
    return {
      valid: false,
      reason:
        `Ce swappeur a deja un creneau le ${businessDate}. ` +
        `Un swappeur ne peut travailler qu'un seul creneau par jour.`,
    };
  }
}

return {
  valid: true,
};

}

async checkMinimumRest(
swapperId: string,
startTime: Date,
endTime: Date,
minRestHours: number,
excludeShiftId?: string,
): Promise<{
valid: boolean;
reason?: string;
}> {
const minimumRest =
minRestHours >= 0
? minRestHours
: MIN_REST_HOURS;

const previous =
  await this.prisma.shift.findFirst({
    where: {
      swapperId: swapperId,
      id: excludeShiftId
        ? {
            not: excludeShiftId,
          }
        : undefined,
      endTime: {
        lte: startTime,
      },
    },
    orderBy: {
      endTime: 'desc',
    },
  });

if (previous) {
  const restHours =
    hoursBetween(
      previous.endTime,
      startTime,
    );

  if (
    restHours <
    minimumRest
  ) {
    return {
      valid: false,
      reason:
        `Repos insuffisant avant ce creneau : ` +
        `${restHours.toFixed(1)}h de repos. ` +
        `Minimum ${minimumRest}h requis.`,
    };
  }
}

const next =
  await this.prisma.shift.findFirst({
    where: {
      swapperId: swapperId,
      id: excludeShiftId
        ? {
            not: excludeShiftId,
          }
        : undefined,
      startTime: {
        gte: endTime,
      },
    },
    orderBy: {
      startTime: 'asc',
    },
  });

if (next) {
  const restHours =
    hoursBetween(
      endTime,
      next.startTime,
    );

  if (
    restHours <
    minimumRest
  ) {
    return {
      valid: false,
      reason:
        `Repos insuffisant apres ce creneau : ` +
        `${restHours.toFixed(1)}h de repos. ` +
        `Minimum ${minimumRest}h requis.`,
    };
  }
}

return {
  valid: true,
};

}

async checkWeeklyHours(
swapperId: string,
startTime: Date,
endTime: Date,
weeklyLimit: number,
excludeShiftId?: string,
): Promise<WeeklyHoursResult> {
const weekStart =
getWeekStart(startTime);

const weekEnd =
  new Date(weekStart);

weekEnd.setUTCDate(
  weekEnd.getUTCDate() + 7,
);

const shifts =
  await this.prisma.shift.findMany({
    where: {
      swapperId: swapperId,
      id: excludeShiftId
        ? {
            not: excludeShiftId,
          }
        : undefined,
      startTime: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
    select: {
      startTime: true,
      endTime: true,
    },
  });

const existingHours =
  shifts.reduce(
    (
      total,
      shift,
    ) => {
      return (
        total +
        getDurationInHours(
          shift.startTime,
          shift.endTime,
        )
      );
    },
    0,
  );

const newShiftHours =
  getDurationInHours(
    startTime,
    endTime,
  );

const totalHours =
  existingHours +
  newShiftHours;

return {
  totalHours: totalHours,
  weeklyLimit: weeklyLimit,
  remainingHours:
    Math.max(
      0,
      weeklyLimit -
        totalHours,
    ),
  exceedsLimit:
    totalHours >
    weeklyLimit,
};

}

async checkLeaveConflict(
swapperId: string,
startTime: Date,
endTime: Date,
): Promise<{
valid: boolean;
reason?: string;
}> {
const leave =
await this.prisma.leaveRequest.findFirst({
where: {
userId: swapperId,
status: 'APPROVED',
startDate: {
lt: endTime,
},
endDate: {
gt: startTime,
},
},
});

if (leave) {
  return {
    valid: false,
    reason:
      'Ce swappeur est en conge approuve pendant cette periode.',
  };
}

return {
  valid: true,
};

}

async assertValidShift(
input: ShiftValidationInput,
): Promise<void> {
const result =
await this.validateShift(
input,
);

if (!result.valid) {
  throw new BadRequestException({
    message:
      'Le creneau ne respecte pas les regles de planning.',
    errors:
      result.errors,
    warnings:
      result.warnings,
  });
}

}

async getShiftOrThrow(
shiftId: string,
) {
const shift =
await this.prisma.shift.findUnique({
where: {
id: shiftId,
},
include: {
station: true,
swapper: true,
planning: true,
},
});

if (!shift) {
  throw new NotFoundException(
    'Creneau introuvable.',
  );
}

return shift;

}
}