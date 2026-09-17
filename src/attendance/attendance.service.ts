import {
BadRequestException,
Injectable,
NotFoundException,
UnauthorizedException,
} from '@nestjs/common';

import {
AttendanceStatus,
PlanningStatus,
Role,
} from '@prisma/client';

import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
constructor(private readonly prisma: PrismaService) {}

// ============================================================
// GENERATE ATTENDANCE QR
// ============================================================

async generateQr(
shiftId: string,
stationId: string,
supervisorId: string,
type: 'START' | 'END',
) {
const supervisor = await this.prisma.user.findUnique({
where: {
id: supervisorId,
},
select: {
id: true,
role: true,
isActive: true,
stationId: true,
stationScopes: {
select: {
stationId: true,
},
},
},
});

if (!supervisor) {
  throw new UnauthorizedException(
    'Supervisor account not found.',
  );
}

if (
  !supervisor.isActive ||
  supervisor.role !== Role.SUPERVISOR
) {
  throw new UnauthorizedException(
    'Only an active supervisor can generate attendance QR codes.',
  );
}

const hasStationAccess =
  supervisor.stationId === stationId ||
  supervisor.stationScopes.some(
    (scope) => scope.stationId === stationId,
  );

if (!hasStationAccess) {
  throw new UnauthorizedException(
    'You do not have access to this station.',
  );
}

const shift = await this.prisma.shift.findUnique({
  where: {
    id: shiftId,
  },
  include: {
    planning: {
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    },
  },
});

if (!shift) {
  throw new NotFoundException('Shift not found.');
}

if (shift.stationId !== stationId) {
  throw new BadRequestException(
    'This shift does not belong to the selected station.',
  );
}

if (!shift.planning) {
  throw new BadRequestException(
    'The shift is not attached to a planning.',
  );
}

if (shift.planning.status !== PlanningStatus.PUBLISHED) {
  throw new BadRequestException(
    'Attendance QR codes can only be generated for a published planning.',
  );
}

const station = await this.prisma.station.findUnique({
  where: {
    id: stationId,
  },
  select: {
    id: true,
    isActive: true,
    checkinQrTtl: true,
    checkoutQrTtl: true,
  },
});

if (!station) {
  throw new NotFoundException('Station not found.');
}

if (!station.isActive) {
  throw new BadRequestException(
    'The selected station is inactive.',
  );
}

const qrTtl =
  type === 'START'
    ? station.checkinQrTtl
    : station.checkoutQrTtl;

if (!Number.isInteger(qrTtl) || qrTtl <= 0) {
  throw new BadRequestException(
    'The QR validity duration configured for this station is invalid.',
  );
}

const rawToken = randomBytes(32).toString('hex');

const tokenHash = createHash('sha256')
  .update(rawToken)
  .digest('hex');

const expiresAt = new Date(
  Date.now() + qrTtl * 1000,
);

const qr = await this.prisma.attendanceQr.create({
  data: {
    stationId,
    shiftId,
    type,
    tokenHash,
    expiresAt,
    createdById: supervisorId,
  },
});

return {
  id: qr.id,
  token: rawToken,
  type: qr.type,
  shiftId: qr.shiftId,
  stationId: qr.stationId,
  expiresAt: qr.expiresAt,
  ttlSeconds: qrTtl,
};

}

// ============================================================
// CHECK IN
// ============================================================

async checkIn(
token: string,
swapperId: string,
shiftId: string,
stationId: string,
latitude?: number,
longitude?: number,
) {
if (!token) {
throw new BadRequestException(
'Attendance QR token is required.',
);
}

const tokenHash = createHash('sha256')
  .update(token)
  .digest('hex');

const qr = await this.prisma.attendanceQr.findUnique({
  where: {
    tokenHash,
  },
});

if (!qr) {
  throw new BadRequestException(
    'Invalid attendance QR code.',
  );
}

if (qr.type !== 'START') {
  throw new BadRequestException(
    'This QR code is not a check-in QR code.',
  );
}

if (qr.expiresAt.getTime() < Date.now()) {
  throw new BadRequestException(
    'This attendance QR code has expired.',
  );
}

if (qr.usedAt) {
  throw new BadRequestException(
    'This attendance QR code has already been used.',
  );
}

if (
  qr.shiftId !== shiftId ||
  qr.stationId !== stationId
) {
  throw new BadRequestException(
    'This QR code does not belong to the selected shift and station.',
  );
}

const swapper = await this.prisma.user.findUnique({
  where: {
    id: swapperId,
  },
  select: {
    id: true,
    fullName: true,
    role: true,
    isActive: true,
  },
});

if (!swapper) {
  throw new UnauthorizedException(
    'Swapper account not found.',
  );
}

if (
  !swapper.isActive ||
  swapper.role !== Role.SWAPPER
) {
  throw new UnauthorizedException(
    'Only an active swapper can check in.',
  );
}

const attendance = await this.prisma.attendance.findUnique({
  where: {
    shiftId_swapperId: {
      shiftId,
      swapperId,
    },
  },
});

if (!attendance) {
  throw new BadRequestException(
    'No attendance record exists for this swapper and shift.',
  );
}

if (attendance.stationId !== stationId) {
  throw new BadRequestException(
    'The attendance record does not belong to this station.',
  );
}

if (attendance.status === AttendanceStatus.CHECKED_IN) {
  throw new BadRequestException(
    'This swapper is already checked in.',
  );
}

if (attendance.status === AttendanceStatus.CHECKED_OUT) {
  throw new BadRequestException(
    'This attendance record has already been completed.',
  );
}

if (attendance.status === AttendanceStatus.ABSENT) {
  throw new BadRequestException(
    'This attendance has already been marked as absent.',
  );
}

if (attendance.status === AttendanceStatus.JUSTIFIED) {
  throw new BadRequestException(
    'This attendance has been marked as justified.',
  );
}

const station = await this.prisma.station.findUnique({
  where: {
    id: stationId,
  },
  select: {
    latenessToleranceMinutes: true,
  },
});

if (!station) {
  throw new NotFoundException('Station not found.');
}

const shift = await this.prisma.shift.findUnique({
  where: {
    id: shiftId,
  },
  select: {
    startTime: true,
  },
});

if (!shift) {
  throw new NotFoundException('Shift not found.');
}

const now = new Date();

const toleranceMs =
  station.latenessToleranceMinutes * 60 * 1000;

const allowedStartTime =
  shift.startTime.getTime() + toleranceMs;

const isLate =
  now.getTime() > allowedStartTime;

const result = await this.prisma.$transaction(
  async (tx) => {
    const updatedAttendance =
      await tx.attendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status: AttendanceStatus.CHECKED_IN,
          checkInAt: now,
          checkInLatitude: latitude,
          checkInLongitude: longitude,
        },
      });

    await tx.attendanceQr.update({
      where: {
        id: qr.id,
      },
      data: {
        usedAt: now,
      },
    });

    return updatedAttendance;
  },
);

return {
  message: 'Check-in successful',
  punctuality: isLate ? 'LATE' : 'ON_TIME',
  attendance: result,
};

}

// ============================================================
// CHECK OUT
// ============================================================

async checkOut(
token: string,
swapperId: string,
shiftId: string,
stationId: string,
latitude?: number,
longitude?: number,
) {
if (!token) {
throw new BadRequestException(
'Attendance QR token is required.',
);
}

const tokenHash = createHash('sha256')
  .update(token)
  .digest('hex');

const qr = await this.prisma.attendanceQr.findUnique({
  where: {
    tokenHash,
  },
});

if (!qr) {
  throw new BadRequestException(
    'Invalid attendance QR code.',
  );
}

if (qr.type !== 'END') {
  throw new BadRequestException(
    'This QR code is not a check-out QR code.',
  );
}

if (qr.expiresAt.getTime() < Date.now()) {
  throw new BadRequestException(
    'This attendance QR code has expired.',
  );
}

if (qr.usedAt) {
  throw new BadRequestException(
    'This attendance QR code has already been used.',
  );
}

if (
  qr.shiftId !== shiftId ||
  qr.stationId !== stationId
) {
  throw new BadRequestException(
    'This QR code does not belong to the selected shift and station.',
  );
}

const swapper = await this.prisma.user.findUnique({
  where: {
    id: swapperId,
  },
  select: {
    id: true,
    fullName: true,
    role: true,
    isActive: true,
  },
});

if (!swapper) {
  throw new UnauthorizedException(
    'Swapper account not found.',
  );
}

if (
  !swapper.isActive ||
  swapper.role !== Role.SWAPPER
) {
  throw new UnauthorizedException(
    'Only an active swapper can check out.',
  );
}

const attendance = await this.prisma.attendance.findUnique({
  where: {
    shiftId_swapperId: {
      shiftId,
      swapperId,
    },
  },
});

if (!attendance) {
  throw new BadRequestException(
    'No attendance record exists for this swapper and shift.',
  );
}

if (attendance.stationId !== stationId) {
  throw new BadRequestException(
    'The attendance record does not belong to this station.',
  );
}

if (attendance.status === AttendanceStatus.CHECKED_OUT) {
  throw new BadRequestException(
    'This swapper has already checked out.',
  );
}

if (attendance.status !== AttendanceStatus.CHECKED_IN) {
  throw new BadRequestException(
    'Check-in must be completed before check-out.',
  );
}

const now = new Date();

const result = await this.prisma.$transaction(
  async (tx) => {
    const updatedAttendance =
      await tx.attendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status: AttendanceStatus.CHECKED_OUT,
          checkOutAt: now,
          checkOutLatitude: latitude,
          checkOutLongitude: longitude,
        },
      });

    await tx.attendanceQr.update({
      where: {
        id: qr.id,
      },
      data: {
        usedAt: now,
      },
    });

    return updatedAttendance;
  },
);

return {
  message: 'Check-out successful',
  attendance: result,
};

}

// ============================================================
// FIND ALL ATTENDANCES
// ============================================================

async findAll(status?: AttendanceStatus) {
return this.prisma.attendance.findMany({
where: status
? {
status,
}
: undefined,
include: {
shift: true,
station: true,
swapper: {
select: {
id: true,
fullName: true,
email: true,
phoneNumber: true,
role: true,
},
},
},
orderBy: {
createdAt: 'desc',
},
});
}

// ============================================================
// GET ATTENDANCE STATISTICS
// ============================================================

async getStatistics() {
const grouped = await this.prisma.attendance.groupBy({
by: ['status'],
_count: {
_all: true,
},
});

const statistics = {
  total: 0,
  expected: 0,
  checkedIn: 0,
  checkedOut: 0,
  absent: 0,
  justified: 0,
};

for (const item of grouped) {
  const count = item._count._all;

  statistics.total += count;

  if (item.status === AttendanceStatus.EXPECTED) {
    statistics.expected = count;
  }

  if (item.status === AttendanceStatus.CHECKED_IN) {
    statistics.checkedIn = count;
  }

  if (item.status === AttendanceStatus.CHECKED_OUT) {
    statistics.checkedOut = count;
  }

  if (item.status === AttendanceStatus.ABSENT) {
    statistics.absent = count;
  }

  if (item.status === AttendanceStatus.JUSTIFIED) {
    statistics.justified = count;
  }
}

return statistics;

}

// ============================================================
// FIND ATTENDANCES BY SHIFT
// ============================================================

async findByShift(
shiftId: string,
status?: AttendanceStatus,
) {
const shift = await this.prisma.shift.findUnique({
where: {
id: shiftId,
},
select: {
id: true,
},
});

if (!shift) {
  throw new NotFoundException('Shift not found.');
}

return this.prisma.attendance.findMany({
  where: {
    shiftId,
    ...(status ? { status } : {}),
  },
  include: {
    station: true,
    swapper: {
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
      },
    },
  },
  orderBy: {
    checkInAt: 'asc',
  },
});

}

// ============================================================
// FIND PENDING CHECKOUTS
// ============================================================

async findPendingCheckouts(shiftId: string) {
const shift = await this.prisma.shift.findUnique({
where: {
id: shiftId,
},
select: {
id: true,
stationId: true,
startTime: true,
endTime: true,
},
});

if (!shift) {
  throw new NotFoundException('Shift not found.');
}

const attendances =
  await this.prisma.attendance.findMany({
    where: {
      shiftId,
      status: AttendanceStatus.CHECKED_IN,
    },
    include: {
      swapper: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
        },
      },
    },
    orderBy: {
      checkInAt: 'asc',
    },
  });

return {
  shift: {
    id: shift.id,
    stationId: shift.stationId,
    startTime: shift.startTime,
    endTime: shift.endTime,
  },
  count: attendances.length,
  swappers: attendances.map((attendance) => ({
    attendanceId: attendance.id,
    swapperId: attendance.swapper.id,
    fullName: attendance.swapper.fullName,
    email: attendance.swapper.email,
    phoneNumber: attendance.swapper.phoneNumber,
    status: attendance.status,
    checkInAt: attendance.checkInAt,
  })),
};

}

// ============================================================
// FIND ATTENDANCES BY STATION
// ============================================================

async findByStation(
stationId: string,
status?: AttendanceStatus,
) {
const station = await this.prisma.station.findUnique({
where: {
id: stationId,
},
select: {
id: true,
},
});

if (!station) {
  throw new NotFoundException('Station not found.');
}

return this.prisma.attendance.findMany({
  where: {
    stationId,
    ...(status ? { status } : {}),
  },
  include: {
    shift: true,
    swapper: {
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
      },
    },
  },
  orderBy: {
    createdAt: 'desc',
  },
});

}

// ============================================================
// FIND ATTENDANCES BY SWAPPER
// ============================================================

async findBySwapper(
swapperId: string,
status?: AttendanceStatus,
) {
const swapper = await this.prisma.user.findUnique({
where: {
id: swapperId,
},
select: {
id: true,
role: true,
},
});

if (!swapper) {
  throw new NotFoundException(
    'Swapper not found.',
  );
}

if (swapper.role !== Role.SWAPPER) {
  throw new BadRequestException(
    'The selected user is not a swapper.',
  );
}

return this.prisma.attendance.findMany({
  where: {
    swapperId,
    ...(status ? { status } : {}),
  },
  include: {
    shift: true,
    station: true,
  },
  orderBy: {
    createdAt: 'desc',
  },
});

}

// ============================================================
// FIND ONE ATTENDANCE
// ============================================================

async findOne(id: string) {
const attendance =
await this.prisma.attendance.findUnique({
where: {
id,
},
include: {
shift: true,
station: true,
swapper: {
select: {
id: true,
fullName: true,
email: true,
phoneNumber: true,
role: true,
},
},
correctionHistory: {
orderBy: {
createdAt: 'desc',
},
},
},
});

if (!attendance) {
  throw new NotFoundException(
    `Attendance ${id} not found.`,
  );
}

return attendance;

}

// ============================================================
// CORRECT ATTENDANCE
// ============================================================

async correctAttendance(
attendanceId: string,
correctedById: string,
newStatus: AttendanceStatus,
reason: string,
checkInAt?: string,
checkOutAt?: string,
evidenceUrl?: string,
) {
if (!reason || !reason.trim()) {
throw new BadRequestException(
'A correction reason is required.',
);
}

const attendance =
  await this.prisma.attendance.findUnique({
    where: {
      id: attendanceId,
    },
  });

if (!attendance) {
  throw new NotFoundException(
    `Attendance ${attendanceId} not found.`,
  );
}

const correctedBy = await this.prisma.user.findUnique({
  where: {
    id: correctedById,
  },
  select: {
    id: true,
    role: true,
    isActive: true,
  },
});

if (!correctedBy) {
  throw new NotFoundException(
    `User ${correctedById} not found.`,
  );
}

if (
  !correctedBy.isActive ||
  (
    correctedBy.role !== Role.ADMIN &&
    correctedBy.role !== Role.SUPERVISOR
  )
) {
  throw new UnauthorizedException(
    'Only active administrators or supervisors can correct attendance.',
  );
}

let newCheckInAt: Date | null =
  attendance.checkInAt;

let newCheckOutAt: Date | null =
  attendance.checkOutAt;

if (checkInAt !== undefined) {
  const parsedCheckIn = new Date(checkInAt);

  if (Number.isNaN(parsedCheckIn.getTime())) {
    throw new BadRequestException(
      'Invalid check-in date.',
    );
  }

  newCheckInAt = parsedCheckIn;
}

if (checkOutAt !== undefined) {
  const parsedCheckOut = new Date(checkOutAt);

  if (Number.isNaN(parsedCheckOut.getTime())) {
    throw new BadRequestException(
      'Invalid check-out date.',
    );
  }

  newCheckOutAt = parsedCheckOut;
}

if (
  newStatus === AttendanceStatus.CHECKED_IN &&
  !newCheckInAt
) {
  throw new BadRequestException(
    'Check-in time is required for CHECKED_IN status.',
  );
}

if (
  newStatus === AttendanceStatus.CHECKED_OUT &&
  (!newCheckInAt || !newCheckOutAt)
) {
  throw new BadRequestException(
    'Both check-in and check-out times are required for CHECKED_OUT status.',
  );
}

if (
  newCheckInAt &&
  newCheckOutAt &&
  newCheckOutAt.getTime() < newCheckInAt.getTime()
) {
  throw new BadRequestException(
    'Check-out time cannot be before check-in time.',
  );
}

const result = await this.prisma.$transaction(
  async (tx) => {
    const correction =
      await tx.attendanceCorrection.create({
        data: {
          attendanceId: attendance.id,
          correctedById: correctedBy.id,
          oldStatus: attendance.status,
          newStatus,
          oldCheckInAt: attendance.checkInAt,
          newCheckInAt: newCheckInAt,
          oldCheckOutAt: attendance.checkOutAt,
          newCheckOutAt: newCheckOutAt,
          reason: reason.trim(),
          evidenceUrl:
            evidenceUrl?.trim() || null,
        },
      });

    const updatedAttendance =
      await tx.attendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status: newStatus,
          checkInAt: newCheckInAt,
          checkOutAt: newCheckOutAt,
          correctedAt: new Date(),
          correctedById: correctedBy.id,
          correctionReason: reason.trim(),
        },
      });

    return {
      correction,
      attendance: updatedAttendance,
    };
  },
);

return {
  message: 'Attendance corrected successfully.',
  attendance: result.attendance,
  correction: result.correction,
};

}

// ============================================================
// AUTOMATICALLY MARK EXPECTED ATTENDANCES AS ABSENT
// ============================================================

async markExpectedAsAbsent() {
const now = new Date();

const completedShifts =
  await this.prisma.shift.findMany({
    where: {
      endTime: {
        lt: now,
      },
    },
    select: {
      id: true,
    },
  });

if (completedShifts.length === 0) {
  return {
    updatedCount: 0,
  };
}

const shiftIds =
  completedShifts.map((shift) => shift.id);

const result =
  await this.prisma.attendance.updateMany({
    where: {
      shiftId: {
        in: shiftIds,
      },
      status: AttendanceStatus.EXPECTED,
    },
    data: {
      status: AttendanceStatus.ABSENT,
      absenceReason:
        'No check-in was recorded before the shift ended.',
    },
  });

return {
  updatedCount: result.count,
};

}
}