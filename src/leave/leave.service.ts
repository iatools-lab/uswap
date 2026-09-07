import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveApiClient } from './leave-api.client';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private leaveApiClient: LeaveApiClient,
  ) {}

  async create(userId: string, dto: CreateLeaveRequestDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate < startDate) {
      throw new ForbiddenException('La date de fin ne peut pas preceder la date de debut');
    }

    const externalResult = await this.leaveApiClient.submitLeaveRequest({
      userId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      type: dto.type,
    });

    const leaveRequest = await this.prisma.leaveRequest.create({
      data: {
        userId,
        startDate,
        endDate,
        type: dto.type,
        reason: dto.reason,
        externalId: externalResult?.externalId ?? null,
        lastSyncedAt: externalResult ? new Date() : null,
      },
    });

    return {
      ...leaveRequest,
      transmissionStatus: externalResult ? 'transmis' : 'en_attente_envoi',
    };
  }

  findMine(userId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}