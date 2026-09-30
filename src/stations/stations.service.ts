import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';

@Injectable()
export class StationsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateStationDto) {
    return this.prisma.station.create({ data: dto });
  }

  findAll() {
    return this.prisma.station.findMany();
  }

  async findOne(id: string) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) {
      throw new NotFoundException('Station introuvable');
    }
    return station;
  }

  async update(id: string, dto: UpdateStationDto) {
    await this.findOne(id);
    return this.prisma.station.update({ where: { id }, data: dto });
  }

  async setActive(id: string, isActive: boolean) {
    await this.findOne(id);
    return this.prisma.station.update({ where: { id }, data: { isActive } });
  }
}