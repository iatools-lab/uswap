import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';

@Injectable()
export class StationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStationDto) {
    return this.prisma.station.create({
      data: {
        name: dto.name,
        location: dto.location,
        address: dto.address,
        city: dto.city,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timezone: dto.timezone,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        latenessToleranceMinutes: dto.latenessToleranceMinutes,
        minRestHours: dto.minRestHours,
        weeklyHoursLimit: dto.weeklyHoursLimit,
        checkinQrTtl: dto.checkinQrTtl,
        checkoutQrTtl: dto.checkoutQrTtl,
      },
    });
  }

  async findAll() {
    return this.prisma.station.findMany({
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const station = await this.prisma.station.findUnique({
      where: {
        id: id,
      },
    });

    if (!station) {
      throw new NotFoundException('Station introuvable');
    }

    return station;
  }

  async update(id: string, dto: UpdateStationDto) {
    await this.findOne(id);

    const data: {
      name?: string;
      location?: string;
      address?: string | null;
      city?: string | null;
      latitude?: number;
      longitude?: number;
      timezone?: string;
      contactName?: string;
      contactPhone?: string;
      latenessToleranceMinutes?: number;
      minRestHours?: number;
      weeklyHoursLimit?: number;
      checkinQrTtl?: number;
      checkoutQrTtl?: number;
    } = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.location !== undefined) {
      data.location = dto.location;
    }

    if (dto.address !== undefined) {
      data.address = dto.address;
    }

    if (dto.city !== undefined) {
      data.city = dto.city;
    }

    if (dto.latitude !== undefined) {
      data.latitude = dto.latitude;
    }

    if (dto.longitude !== undefined) {
      data.longitude = dto.longitude;
    }

    if (dto.timezone !== undefined) {
      data.timezone = dto.timezone;
    }

    if (dto.contactName !== undefined) {
      data.contactName = dto.contactName;
    }

    if (dto.contactPhone !== undefined) {
      data.contactPhone = dto.contactPhone;
    }

    if (dto.latenessToleranceMinutes !== undefined) {
      data.latenessToleranceMinutes = dto.latenessToleranceMinutes;
    }

    if (dto.minRestHours !== undefined) {
      data.minRestHours = dto.minRestHours;
    }

    if (dto.weeklyHoursLimit !== undefined) {
      data.weeklyHoursLimit = dto.weeklyHoursLimit;
    }

    if (dto.checkinQrTtl !== undefined) {
      data.checkinQrTtl = dto.checkinQrTtl;
    }

    if (dto.checkoutQrTtl !== undefined) {
      data.checkoutQrTtl = dto.checkoutQrTtl;
    }

    return this.prisma.station.update({
      where: {
        id: id,
      },
      data: data,
    });
  }

  async setActive(id: string, isActive: boolean) {
    await this.findOne(id);

    return this.prisma.station.update({
      where: {
        id: id,
      },
      data: {
        isActive: isActive,
      },
    });
  }

  // ============================================================
  // SHIFT TEMPLATES
  // ============================================================

  /** "HH:mm" -> minutes since midnight. */
  private toMinutes(value?: string | null): number | null {
    if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  private slotMinutes(startTime: string, endTime: string): number {
    const start = this.toMinutes(startTime);
    const end = this.toMinutes(endTime);
    if (start === null || end === null) return 0;
    // A window that ends before it starts crosses midnight.
    return end > start ? end - start : end + 24 * 60 - start;
  }

  async findTemplates(stationId: string) {
    await this.findOne(stationId);

    return this.prisma.shiftTemplate.findMany({
      where: { stationId },
      orderBy: { startTime: 'asc' },
    });
  }

  async createTemplate(
    stationId: string,
    body: {
      label?: string;
      startTime?: string;
      endTime?: string;
      breakStart?: string | null;
      breakEnd?: string | null;
    },
  ) {
    await this.findOne(stationId);

    const label = (body.label || '').trim();
    const startTime = body.startTime || '';
    const endTime = body.endTime || '';
    const breakStart = body.breakStart || null;
    const breakEnd = body.breakEnd || null;

    if (!label || !startTime || !endTime) {
      throw new BadRequestException(
        'Libelle, debut et fin du modele sont obligatoires.',
      );
    }

    const durationMinutes = this.slotMinutes(startTime, endTime);

    if (durationMinutes === 0) {
      throw new BadRequestException(
        'Le creneau doit avoir une duree superieure a zero.',
      );
    }

    if (!!breakStart !== !!breakEnd) {
      throw new BadRequestException(
        'Renseignez le debut et la fin de la pause.',
      );
    }

    const breakMinutes =
      breakStart && breakEnd ? this.slotMinutes(breakStart, breakEnd) : 0;

    if (breakMinutes >= durationMinutes) {
      throw new BadRequestException(
        'La pause doit être plus courte que le shift.',
      );
    }

    const existing = await this.prisma.shiftTemplate.findFirst({
      where: { stationId, startTime, endTime },
    });

    if (existing) {
      throw new ConflictException(
        'Un modele occupe deja ce creneau sur cette station.',
      );
    }

    return this.prisma.shiftTemplate.create({
      data: {
        stationId,
        label,
        startTime,
        endTime,
        breakStart,
        breakEnd,
        breakMinutes,
        durationMinutes,
        versions: {
          create: {
            label,
            startTime,
            endTime,
            breakStart,
            breakEnd,
            breakMinutes,
            durationMinutes,
            isActive: true,
            revision: 1,
          },
        },
      },
    });
  }

  async findTemplateHistory(stationId: string, templateId: string) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: templateId, stationId },
    });

    if (!template) {
      throw new NotFoundException('Modele de shift introuvable.');
    }

    return this.prisma.shiftTemplateVersion.findMany({
      where: { templateId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateTemplate(
    stationId: string,
    templateId: string,
    body: {
      label?: string;
      startTime?: string;
      endTime?: string;
      breakStart?: string | null;
      breakEnd?: string | null;
      isActive?: boolean;
    },
  ) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: templateId, stationId },
    });

    if (!template) {
      throw new NotFoundException('Modele de shift introuvable.');
    }

    const label = body.label?.trim() || template.label;
    const startTime = body.startTime || template.startTime;
    const endTime = body.endTime || template.endTime;
    const breakStart =
      body.breakStart === undefined ? template.breakStart : body.breakStart;
    const breakEnd =
      body.breakEnd === undefined ? template.breakEnd : body.breakEnd;
    const isActive =
      body.isActive === undefined ? template.isActive : body.isActive;

    if (!!breakStart !== !!breakEnd) {
      throw new BadRequestException(
        'Renseignez le debut et la fin de la pause.',
      );
    }

    const durationMinutes = this.slotMinutes(startTime, endTime);

    if (durationMinutes === 0) {
      throw new BadRequestException(
        'Le creneau doit avoir une duree superieure a zero.',
      );
    }

    const breakMinutes =
      breakStart && breakEnd ? this.slotMinutes(breakStart, breakEnd) : 0;

    if (breakMinutes >= durationMinutes) {
      throw new BadRequestException(
        'La pause doit être plus courte que le shift.',
      );
    }

    const conflicting = await this.prisma.shiftTemplate.findFirst({
      where: {
        stationId,
        startTime,
        endTime,
        id: { not: templateId },
      },
      select: { id: true },
    });
    if (conflicting) {
      throw new ConflictException(
        'Un autre modèle occupe déjà ce créneau sur cette station.',
      );
    }

    const revision = template.revision + 1;

    return this.prisma.shiftTemplate.update({
      where: { id: templateId },
      data: {
        label,
        startTime,
        endTime,
        breakStart,
        breakEnd,
        breakMinutes,
        durationMinutes,
        isActive,
        revision,
        versions: {
          create: {
            label,
            startTime,
            endTime,
            breakStart,
            breakEnd,
            breakMinutes,
            durationMinutes,
            isActive,
            revision,
          },
        },
      },
    });
  }
}
