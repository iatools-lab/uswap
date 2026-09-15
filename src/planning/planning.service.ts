import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import { CreatePlanningDto } from './dto/create-planning.dto';
import { GeneratePlanningDto } from './dto/generate-planning.dto';
import { SHIFT_SLOTS, buildSlotTimes } from '../shifts/shift-slots.constant';

@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftsService: ShiftsService,
  ) {}

  async create(dto: CreatePlanningDto, createdBy: string) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new ForbiddenException('La date de fin doit etre apres la date de debut');
    }

    return this.prisma.planning.create({
      data: { startDate, endDate, createdBy },
    });
  }

  findAll() {
    return this.prisma.planning.findMany({
      orderBy: { startDate: 'desc' },
      include: { shifts: { include: { station: true, swapper: { select: { id: true, fullName: true } } } } },
    });
  }

  async findOne(id: string) {
    const planning = await this.prisma.planning.findUnique({
      where: { id },
      include: { shifts: { include: { station: true, swapper: { select: { id: true, fullName: true } } } } },
    });
    if (!planning) {
      throw new NotFoundException('Planning introuvable');
    }
    return planning;
  }

  async publish(id: string) {
    const planning = await this.findOne(id);
    if (planning.shifts.length === 0) {
      throw new ForbiddenException('Impossible de publier un planning sans aucun creneau');
    }
    return this.prisma.planning.update({
      where: { id },
      data: { status: 'PUBLISHED' },
    });
  }

  async generateShifts(planningId: string, dto: GeneratePlanningDto) {
    const planning = await this.findOne(planningId);
    if (planning.status === 'PUBLISHED') {
      throw new ForbiddenException('Impossible de generer des creneaux dans un planning deja publie');
    }

    const stations = await this.prisma.station.findMany({
      where: {
        isActive: true,
        ...(dto.stationIds && dto.stationIds.length > 0 ? { id: { in: dto.stationIds } } : {}),
      },
    });

    const swappers = await this.prisma.user.findMany({
      where: {
        role: 'SWAPPER',
        isActive: true,
        ...(dto.swapperIds && dto.swapperIds.length > 0 ? { id: { in: dto.swapperIds } } : {}),
      },
    });

    if (stations.length === 0) {
      throw new ForbiddenException('Aucune station active disponible pour la generation');
    }
    if (swappers.length === 0) {
      throw new ForbiddenException('Aucun swappeur actif disponible pour la generation');
    }

    const created: any[] = [];
    const vacant: { date: string; station: string; slot: string; reason: string }[] = [];

    let rotationIndex = 0;
    const days = this.eachDay(planning.startDate, planning.endDate);

    for (const day of days) {
      for (const station of stations) {
        for (const slot of SHIFT_SLOTS) {
          const { start, end } = buildSlotTimes(day, slot);

          if (start < planning.startDate || end > planning.endDate) {
            continue;
          }

          let assigned = false;

          for (let attempt = 0; attempt < swappers.length; attempt++) {
            const candidate = swappers[(rotationIndex + attempt) % swappers.length];

            const check = await this.shiftsService.checkAssignment({
              stationId: station.id,
              swapperId: candidate.id,
              start,
              end,
              planningId,
            });

            if (check.ok) {
              const shift = await this.prisma.shift.create({
                data: {
                  stationId: station.id,
                  swapperId: candidate.id,
                  startTime: start,
                  endTime: end,
                  planningId,
                },
                include: { station: true, swapper: { select: { id: true, fullName: true } } },
              });
              created.push(shift);
              rotationIndex = (rotationIndex + attempt + 1) % swappers.length;
              assigned = true;
              break;
            }
          }

          if (!assigned) {
            vacant.push({
              date: day.toISOString().slice(0, 10),
              station: station.name,
              slot: slot.label,
              reason: 'Aucun swappeur disponible ne respecte les contraintes pour ce creneau',
            });
          }
        }
      }
    }

    return {
      planningId,
      createdCount: created.length,
      vacantCount: vacant.length,
      created,
      vacant,
    };
  }

  private eachDay(start: Date, end: Date): Date[] {
    const days: Date[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(end);
    last.setHours(0, 0, 0, 0);

    while (cursor <= last) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }
}