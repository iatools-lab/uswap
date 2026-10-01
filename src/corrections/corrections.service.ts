import {
  AttendanceStatus,
  Role,
} from '@prisma/client';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from '../operations/operations.service';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type UploadedAttachment = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationsService: OperationsService,
  ) {}

  // ============================================================
  // ATTACHMENTS
  // ============================================================

  /**
   * Stores an evidence file on disk and returns an id usable by the
   * correction endpoint. Kept deliberately small: PDF or image, 5 MB max,
   * matching the limits advertised in the UI.
   */
  async saveAttachment(file?: UploadedAttachment) {
    if (!file) {
      throw new BadRequestException(
        'A supporting document is required.',
      );
    }

    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Only PDF, JPEG, PNG or WebP documents are accepted.',
      );
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(
        'The supporting document exceeds the 5 MB limit.',
      );
    }

    const id = randomUUID();
    const extension =
      file.mimetype === 'application/pdf'
        ? 'pdf'
        : file.mimetype.split('/')[1];

    const directory = join(
      process.cwd(),
      'uploads',
      'corrections',
    );

    await mkdir(directory, { recursive: true });

    const filename = `${id}.${extension}`;

    await writeFile(join(directory, filename), file.buffer);

    return {
      id,
      filename: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      // Relative URL persisted in AttendanceCorrection.evidenceUrl.
      url: `/uploads/corrections/${filename}`,
    };
  }

  // ============================================================
  // CORRECT A SHIFT'S ATTENDANCE
  // ============================================================

  async correctShift(params: {
    correctedById: string;
    shiftId: string;
    reason: string;
    attachmentId?: string;
    checkedInAt?: string | null;
    checkedOutAt?: string | null;
    isLate?: boolean;
    isAbsent?: boolean;
  }) {
    const access =
      await this.operationsService.resolveAccessibleStationIds(
        params.correctedById,
      );

    if (!params.reason || params.reason.trim().length < 5) {
      throw new BadRequestException(
        'A correction reason is required (at least 5 characters).',
      );
    }

    const shift = await this.prisma.shift.findUnique({
      where: { id: params.shiftId },
      select: {
        id: true,
        stationId: true,
        swapperId: true,
        startTime: true,
        endTime: true,
        station: {
          select: {
            latenessToleranceMinutes: true,
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    if (
      !access.unrestricted &&
      !access.stationIds.includes(shift.stationId)
    ) {
      throw new BadRequestException(
        'You do not have access to this station.',
      );
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: {
        shiftId_swapperId: {
          shiftId: shift.id,
          swapperId: shift.swapperId,
        },
      },
    });

    if (!attendance) {
      throw new NotFoundException(
        'No attendance record exists for this shift.',
      );
    }

    const parse = (
      value: string | null | undefined,
      label: string,
    ): Date | null => {
      if (value === undefined) {
        return null;
      }

      if (value === null || value === '') {
        return null;
      }

      const parsed = new Date(value);

      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`Invalid ${label} date.`);
      }

      return parsed;
    };

    const newCheckInAt =
      params.checkedInAt === undefined
        ? attendance.checkInAt
        : parse(params.checkedInAt, 'check-in');

    const newCheckOutAt =
      params.checkedOutAt === undefined
        ? attendance.checkOutAt
        : parse(params.checkedOutAt, 'check-out');

    if (
      newCheckInAt &&
      newCheckOutAt &&
      newCheckOutAt.getTime() < newCheckInAt.getTime()
    ) {
      throw new BadRequestException(
        'Check-out time cannot be before check-in time.',
      );
    }

    // Derive the resulting status from the operator's intent, keeping the
    // same invariants the QR flow enforces: START without END and END
    // without START both mean ABSENT.
    let newStatus: AttendanceStatus;

    if (params.isAbsent) {
      newStatus = AttendanceStatus.ABSENT;
    } else if (newCheckInAt && newCheckOutAt) {
      newStatus = AttendanceStatus.CHECKED_OUT;
    } else if (newCheckInAt) {
      newStatus = AttendanceStatus.CHECKED_IN;
    } else if (newCheckOutAt) {
      newStatus = AttendanceStatus.ABSENT;
    } else {
      throw new BadRequestException(
        'Provide a check-in time, or mark the shift as absent.',
      );
    }

    if (params.isAbsent) {
      // An absent correction carries no times at all.
      return this.applyCorrection({
        attendance,
        newStatus,
        newCheckInAt: null,
        newCheckOutAt: null,
        reason: params.reason,
        evidenceUrl: params.attachmentId
          ? `/uploads/corrections/${params.attachmentId}`
          : null,
        correctedById: params.correctedById,
      });
    }

    return this.applyCorrection({
      attendance,
      newStatus,
      newCheckInAt,
      newCheckOutAt,
      reason: params.reason,
      evidenceUrl: params.attachmentId
        ? `/uploads/corrections/${params.attachmentId}`
        : null,
      correctedById: params.correctedById,
    });
  }

  private async applyCorrection(params: {
    attendance: {
      id: string;
      status: AttendanceStatus;
      checkInAt: Date | null;
      checkOutAt: Date | null;
    };
    newStatus: AttendanceStatus;
    newCheckInAt: Date | null;
    newCheckOutAt: Date | null;
    reason: string;
    evidenceUrl: string | null;
    correctedById: string;
  }) {
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.create({
        data: {
          attendanceId: params.attendance.id,
          correctedById: params.correctedById,
          oldStatus: params.attendance.status,
          newStatus: params.newStatus,
          oldCheckInAt: params.attendance.checkInAt,
          newCheckInAt: params.newCheckInAt,
          oldCheckOutAt: params.attendance.checkOutAt,
          newCheckOutAt: params.newCheckOutAt,
          reason: params.reason.trim(),
          evidenceUrl: params.evidenceUrl,
        },
      });

      const updated = await tx.attendance.update({
        where: { id: params.attendance.id },
        data: {
          status: params.newStatus,
          checkInAt: params.newCheckInAt,
          checkOutAt: params.newCheckOutAt,
          correctedAt: now,
          correctedById: params.correctedById,
          correctionReason: params.reason.trim(),
        },
      });

      return { correction, attendance: updated };
    });

    return {
      message: 'Attendance corrected successfully.',
      attendanceId: result.attendance.id,
      status: result.attendance.status,
      correctionId: result.correction.id,
    };
  }

  // ============================================================
  // CORRECTION HISTORY FOR A SHIFT
  // ============================================================

  async findShiftCorrections(userId: string, shiftId: string) {
    const access =
      await this.operationsService.resolveAccessibleStationIds(userId);

    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        stationId: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    if (
      !access.unrestricted &&
      !access.stationIds.includes(shift.stationId)
    ) {
      throw new BadRequestException(
        'You do not have access to this station.',
      );
    }

    const attendances = await this.prisma.attendance.findMany({
      where: { shiftId },
      select: { id: true },
    });

    const corrections =
      await this.prisma.attendanceCorrection.findMany({
        where: {
          attendanceId: {
            in: attendances.map((row) => row.id),
          },
        },
        include: {
          correctedBy: {
            select: {
              id: true,
              fullName: true,
              role: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

    // Shape expected by CorrectionHistory in the frontend.
    return corrections.map((row) => ({
      id: row.id,
      reason: row.reason,
      createdAt: row.createdAt,
      correctedBy: row.correctedBy.fullName,
      previousCheckedIn: row.oldCheckInAt,
      newCheckedIn: row.newCheckInAt,
      previousCheckedOut: row.oldCheckOutAt,
      newCheckedOut: row.newCheckOutAt,
      previousIsAbsent: row.oldStatus === AttendanceStatus.ABSENT,
      newIsAbsent: row.newStatus === AttendanceStatus.ABSENT,
      evidenceUrl: row.evidenceUrl,
    }));
  }
}

export const CORRECTIONS_ROLES = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.STATION_CHIEF,
];