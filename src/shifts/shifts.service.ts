import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

interface AssignmentCheck {
  stationId: string;
  swapperId: string;
  start: Date;
  end: Date;
  planningId?: string | null;
  excludeShiftId?: string;
}

type CheckResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShiftDto) {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (end <= start) {
      throw new BadRequestException("L'heure de fin doit etre apres l'heure de debut");
    }

    const check = await this.checkAssignment({
      stationId: dto.stationId,
      swapperId: dto.swapperId,
      start,
      end,
      planningId: dto.planningId,
    });

    if (!check.ok) {
      throw new ForbiddenException(check.reason);
    }

    return this.prisma.shift.create({
      data: {
        stationId: dto.stationId,
        swapperId: dto.swapperId,
        startTime: start,
        endTime: end,
        planningId: dto.planningId,
      },
      include: { station: true, swapper: { select: { id: true, fullName: true } } },
    });
  }

  findAll() {
    return this.prisma.shift.findMany({
      include: { station: true, swapper: { select: { id: true, fullName: true } } },
      orderBy: { startTime: 'asc' },
    });
  }

  findMine(swapperId: string) {
    return this.prisma.shift.findMany({
      where: { swapperId },
      include: { station: true },
      orderBy: { startTime: 'asc' },
    });
  }

  async update(id: string, dto: UpdateShiftDto) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Creneau introuvable');
    }

    const stationId = dto.stationId ?? existing.stationId;
    const swapperId = dto.swapperId ?? existing.swapperId;
    const start = dto.startTime ? new Date(dto.startTime) : existing.startTime;
    const end = dto.endTime ? new Date(dto.endTime) : existing.endTime;
    const planningId = dto.planningId !== undefined ? dto.planningId : existing.planningId;

    if (end <= start) {
      throw new BadRequestException("L'heure de fin doit etre apres l'heure de debut");
    }

    const check = await this.checkAssignment({
      stationId,
      swapperId,
      start,
      end,
      planningId,
      excludeShiftId: id,
    });

    if (!check.ok) {
      throw new ForbiddenException(check.reason);
    }

    return this.prisma.shift.update({
      where: { id },
      data: { stationId, swapperId, startTime: start, endTime: end, planningId },
      include: { station: true, swapper: { select: { id: true, fullName: true } } },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Creneau introuvable');
    }
    await this.prisma.shift.delete({ where: { id } });
    return { message: 'Creneau supprime avec succes' };
  }

  async checkAssignment(params: AssignmentCheck): Promise<CheckResult> {
    const { stationId, swapperId, start, end, planningId, excludeShiftId } = params;

    const station = await this.prisma.station.findUnique({ where: { id: stationId } });
    if (!station) {
      return { ok: false, reason: 'Station introuvable' };
    }
    if (!station.isActive) {
      return { ok: false, reason: 'Cette station est desactivee' };
    }

    const swapper = await this.prisma.user.findUnique({ where: { id: swapperId } });
    if (!swapper) {
      return { ok: false, reason: 'Swappeur introuvable' };
    }
    if (swapper.role !== 'SWAPPER') {
      return { ok: false, reason: "L'utilisateur assigne doit avoir le role Swappeur" };
    }
    if (!swapper.isActive) {
      return { ok: false, reason: 'Ce swappeur est desactive' };
    }

    if (planningId) {
      const planning = await this.prisma.planning.findUnique({ where: { id: planningId } });
      if (!planning) {
        return { ok: false, reason: 'Planning introuvable' };
      }
      if (start < planning.startDate || end > planning.endDate) {
        return { ok: false, reason: 'Le creneau doit se situer dans la periode du planning' };
      }
    }

    const overlapping = await this.prisma.shift.findFirst({
      where: {
        swapperId,
        id: excludeShiftId ? { not: excludeShiftId } : undefined,
        startTime: { lt: end },
        endTime: { gt: start },
      },
      include: { station: true },
    });
    if (overlapping) {
      return {
        ok: false,
        reason: `Ce swappeur a deja un creneau qui chevauche cette periode, sur la station ${overlapping.station.name}`,
      };
    }

    const restCheck = await this.checkRest(swapperId, start, end, station.minRestHours, excludeShiftId);
    if (!restCheck.ok) {
      return restCheck;
    }

    const weeklyCheck = await this.checkWeeklyLimit(
      swapperId,
      start,
      end,
      station.weeklyHoursLimit,
      excludeShiftId,
    );
    if (!weeklyCheck.ok) {
      return weeklyCheck;
    }

    return { ok: true };
  }

  private async checkRest(
    swapperId: string,
    start: Date,
    end: Date,
    minRestHours: number,
    excludeShiftId?: string,
  ): Promise<CheckResult> {
    const minRestMs = minRestHours * 60 * 60 * 1000;

    const previousShift = await this.prisma.shift.findFirst({
      where: {
        swapperId,
        id: excludeShiftId ? { not: excludeShiftId } : undefined,
        endTime: { lte: start },
      },
      orderBy: { endTime: 'desc' },
    });

    if (previousShift) {
      const gap = start.getTime() - previousShift.endTime.getTime();
      if (gap < minRestMs) {
        return {
          ok: false,
          reason: `Repos insuffisant avant ce creneau : ${Math.round(gap / 3600000)}h de repos, minimum ${minRestHours}h requis`,
        };
      }
    }

    const nextShift = await this.prisma.shift.findFirst({
      where: {
        swapperId,
        id: excludeShiftId ? { not: excludeShiftId } : undefined,
        startTime: { gte: end },
      },
      orderBy: { startTime: 'asc' },
    });

    if (nextShift) {
      const gap = nextShift.startTime.getTime() - end.getTime();
      if (gap < minRestMs) {
        return {
          ok: false,
          reason: `Repos insuffisant apres ce creneau : ${Math.round(gap / 3600000)}h de repos, minimum ${minRestHours}h requis`,
        };
      }
    }

    return { ok: true };
  }

  private async checkWeeklyLimit(
    swapperId: string,
    start: Date,
    end: Date,
    weeklyHoursLimit: number,
    excludeShiftId?: string,
  ): Promise<CheckResult> {
    const weekStart = this.getWeekStart(start);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const shiftsThisWeek = await this.prisma.shift.findMany({
      where: {
        swapperId,
        id: excludeShiftId ? { not: excludeShiftId } : undefined,
        startTime: { gte: weekStart, lt: weekEnd },
      },
    });

    const existingMs = shiftsThisWeek.reduce(
      (total, shift) => total + (shift.endTime.getTime() - shift.startTime.getTime()),
      0,
    );
    const projectedMs = existingMs + (end.getTime() - start.getTime());
    const projectedHours = projectedMs / 3600000;

    if (projectedHours > weeklyHoursLimit) {
      return {
        ok: false,
        reason: `Limite hebdomadaire depassee : ${projectedHours.toFixed(1)}h projetees, maximum ${weeklyHoursLimit}h autorise`,
      };
    }

    return { ok: true };
  }

  private getWeekStart(date: Date): Date {
    const result = new Date(date);
    const day = result.getDay();
    const diff = day === 0 ? 6 : day - 1;
    result.setDate(result.getDate() - diff);
    result.setHours(0, 0, 0, 0);
    return result;
  }
}