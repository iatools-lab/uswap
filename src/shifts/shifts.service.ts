import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShiftDto) {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (end <= start) {
      throw new ForbiddenException("L'heure de fin doit etre apres l'heure de debut");
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
}