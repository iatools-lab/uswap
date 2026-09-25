import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { PlanningStatus } from '@prisma/client';

import { SchedulingEngineService } from '../scheduling/scheduling-engine.service';

import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingEngine: SchedulingEngineService,
  ) {}

  // =========================================================
  // CREATE SHIFT
  // =========================================================

  async create(dto: CreateShiftDto) {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (end <= start) {
      throw new BadRequestException(
        "L'heure de fin doit etre apres l'heure de debut",
      );
    }

    if (dto.planningId) {
      const planning =
        await this.prisma.planning.findUnique({
          where: {
            id: dto.planningId,
          },
        });

      if (!planning) {
        throw new NotFoundException(
          'Planning introuvable',
        );
      }
    }

    await this.schedulingEngine.assertValidShift({
      stationId: dto.stationId,
      swapperId: dto.swapperId,
      startTime: start,
      endTime: end,
      planningId: dto.planningId,
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Create the shift
        const shift = await tx.shift.create({
          data: {
            stationId: dto.stationId,
            swapperId: dto.swapperId,
            startTime: start,
            endTime: end,
            planningId: dto.planningId,
          },

          include: {
            station: true,

            swapper: {
              select: {
                id: true,
                fullName: true,
              },
            },

            planning: true,
          },
        });

        // Create the expected attendance automatically
        await tx.attendance.create({
          data: {
            shiftId: shift.id,
            swapperId: dto.swapperId,
            stationId: dto.stationId,
            status: 'EXPECTED',
          },
        });

        return shift;
      },
    );

    return result;
  }

  // =========================================================
  // FIND ALL
  // =========================================================

  findAll() {
    return this.prisma.shift.findMany({
      include: {
        station: true,

        swapper: {
          select: {
            id: true,
            fullName: true,
          },
        },

        planning: true,

        attendances: true,
      },

      orderBy: {
        startTime: 'asc',
      },
    });
  }

  // =========================================================
  // FIND MY SHIFTS
  // =========================================================

  findMine(swapperId: string) {
    return this.prisma.shift.findMany({
      where: {
        swapperId,
        // Only shifts on a PUBLISHED planning are actionable: they are the
        // ones shown in the workspace, and the only ones an impediment can
        // be declared on. Returning draft or orphaned shifts here made the
        // two screens disagree and produced a 400 on declaration.
        planning: {
          status: PlanningStatus.PUBLISHED,
        },
        endTime: {
          gt: new Date(),
        },
      },

      include: {
        station: true,
        planning: true,
        attendances: true,
      },

      orderBy: {
        startTime: 'asc',
      },
    });
  }

  // =========================================================
  // UPDATE SHIFT
  // =========================================================

  async update(
    id: string,
    dto: UpdateShiftDto,
    changedById: string,
  ) {
    const existing =
      await this.prisma.shift.findUnique({
        where: {
          id,
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Creneau introuvable',
      );
    }

    const stationId =
      dto.stationId ??
      existing.stationId;

    const swapperId =
      dto.swapperId ??
      existing.swapperId;

    const start =
      dto.startTime
        ? new Date(dto.startTime)
        : existing.startTime;

    const end =
      dto.endTime
        ? new Date(dto.endTime)
        : existing.endTime;

    const planningId =
      dto.planningId !== undefined
        ? dto.planningId
        : existing.planningId;

    if (end <= start) {
      throw new BadRequestException(
        "L'heure de fin doit etre apres l'heure de debut",
      );
    }

    if (planningId) {
      const planning =
        await this.prisma.planning.findUnique({
          where: {
            id: planningId,
          },
        });

      if (!planning) {
        throw new NotFoundException(
          'Planning introuvable',
        );
      }
    }

    await this.schedulingEngine.assertValidShift({
      stationId,
      swapperId,
      startTime: start,
      endTime: end,
      planningId,
      excludeShiftId: id,
    });

    const changeType =
      dto.changeType ??
      'MANUAL_EDIT';

    const updatedShift =
      await this.prisma.$transaction(
        async (tx) => {
          // Update the shift
          const shift =
            await tx.shift.update({
              where: {
                id,
              },

              data: {
                stationId,
                swapperId,
                startTime: start,
                endTime: end,
                planningId,
              },

              include: {
                station: true,

                swapper: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },

                planning: true,
              },
            });

          // Record the shift change
          await tx.shiftChange.create({
            data: {
              shiftId: id,

              previousSwapperId:
                existing.swapperId,

              newSwapperId:
                swapperId,

              changedById,

              type: changeType,

              reason: dto.reason,

              oldStartTime:
                existing.startTime,

              oldEndTime:
                existing.endTime,

              newStartTime:
                start,

              newEndTime:
                end,
            },
          });

          // Find the existing attendance
          const existingAttendance =
            await tx.attendance.findUnique({
              where: {
                shiftId_swapperId: {
                  shiftId: id,
                  swapperId: existing.swapperId,
                },
              },
            });

          // If the swapper did not change,
          // update the station if necessary.
          if (
            existing.swapperId === swapperId
          ) {
            if (existingAttendance) {
              await tx.attendance.update({
                where: {
                  id: existingAttendance.id,
                },

                data: {
                  stationId,
                },
              });
            } else {
              await tx.attendance.create({
                data: {
                  shiftId: id,
                  swapperId,
                  stationId,
                  status: 'EXPECTED',
                },
              });
            }
          } else {
            // The swapper changed.
            // Remove the old EXPECTED attendance
            // and create an attendance for the new swapper.

            if (
              existingAttendance &&
              existingAttendance.status === 'EXPECTED'
            ) {
              await tx.attendance.delete({
                where: {
                  id: existingAttendance.id,
                },
              });
            }

            const newAttendance =
              await tx.attendance.findUnique({
                where: {
                  shiftId_swapperId: {
                    shiftId: id,
                    swapperId,
                  },
                },
              });

            if (!newAttendance) {
              await tx.attendance.create({
                data: {
                  shiftId: id,
                  swapperId,
                  stationId,
                  status: 'EXPECTED',
                },
              });
            }
          }

          return shift;
        },
      );

    return updatedShift;
  }

  // =========================================================
  // DELETE SHIFT
  // =========================================================

  async remove(id: string) {
    const existing =
      await this.prisma.shift.findUnique({
        where: {
          id,
        },
      });

    if (!existing) {
      throw new NotFoundException(
        'Creneau introuvable',
      );
    }

    await this.prisma.shift.delete({
      where: {
        id,
      },
    });

    return {
      message:
        'Creneau supprime avec succes',
    };
  }

  // =========================================================
  // CHECK ASSIGNMENT
  // =========================================================

  async checkAssignment(params: {
    stationId: string;
    swapperId: string;
    start: Date;
    end: Date;
    planningId?: string | null;
    excludeShiftId?: string;
  }) {
    const {
      stationId,
      swapperId,
      start,
      end,
      planningId,
      excludeShiftId,
    } = params;

    const result =
      await this.schedulingEngine.validateShift({
        stationId,
        swapperId,
        startTime: start,
        endTime: end,
        planningId,
        excludeShiftId,
      });

    if (!result.valid) {
      return {
        ok: false,

        reason:
          result.errors.join(' | '),
      };
    }

    return {
      ok: true,
    };
  }
}