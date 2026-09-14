import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanningDto } from './dto/create-planning.dto';

@Injectable()
export class PlanningService {
  constructor(private readonly prisma: PrismaService) {}

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
}