import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { SchedulingEngineService } from '../scheduling/scheduling-engine.service';

import { CreatePlanningDto } from './dto/create-planning.dto';
import { GeneratePlanningDto } from './dto/generate-planning.dto';

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
  ) {}

  async create(
    dto: CreatePlanningDto,
    createdBy: string,
  ) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

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

  async findOne(id: string) {
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

  async publish(id: string) {
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

    const stations =
      await this.prisma.station.findMany({
        where: {
          isActive: true,

          id: dto.stationIds?.length
            ? {
                in: dto.stationIds,
              }
            : undefined,
        },

        orderBy: {
          name: 'asc',
        },
      });

    const swappers =
      await this.prisma.user.findMany({
        where: {
          role: 'SWAPPER',
          isActive: true,

          id: dto.swapperIds?.length
            ? {
                in: dto.swapperIds,
              }
            : undefined,
        },

        orderBy: {
          fullName: 'asc',
        },
      });

    if (stations.length === 0) {
      throw new BadRequestException(
        'Aucune station active disponible.',
      );
    }

    if (swappers.length === 0) {
      throw new BadRequestException(
        'Aucun swappeur actif disponible.',
      );
    }

    const createdShifts: any[] = [];
    const vacancies: any[] = [];

    let rotationIndex = 0;

    for (
      const day of this.eachDay(
        planning.startDate,
        planning.endDate,
      )
    ) {
      for (const station of stations) {
        for (const slot of SHIFT_SLOTS) {
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

          if (slot.name === 'NIGHT') {
            endTime =
              this.buildSlotEnd(
                this.addDays(day, 1),
                6,
              );
          }

          if (
            startTime < planning.startDate ||
            endTime > planning.endDate
          ) {
            continue;
          }

          let assigned = false;

          let lastReason =
            'Aucun swappeur eligible.';

          for (
            let attempt = 0;
            attempt < swappers.length;
            attempt++
          ) {
            const index =
              (rotationIndex + attempt) %
              swappers.length;

            const swapper =
              swappers[index];

            const validation =
              await this.schedulingEngine.validateShift(
                {
                  swapperId:
                    swapper.id,

                  stationId:
                    station.id,

                  startTime,
                  endTime,

                  planningId,
                },
              );

            if (validation.valid) {
              const shift =
                await this.prisma.shift.create({
                  data: {
                    planningId,

                    stationId:
                      station.id,

                    swapperId:
                      swapper.id,

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

              createdShifts.push(
                shift,
              );

              rotationIndex =
                (index + 1) %
                swappers.length;

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
      result.getDate() + days,
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

    while (current <= last) {
      yield new Date(current);

      current.setDate(
        current.getDate() + 1,
      );
    }
  }
}