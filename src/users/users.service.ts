import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(role?: string, stationId?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(role ? { role: role as any } : {}),
        ...(stationId ? { stationId } : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        phoneNumber: true,
        address: true,
        isActive: true,
        stationId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return users;
  }
}