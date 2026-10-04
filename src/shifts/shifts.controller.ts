import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulingEngineService } from '../scheduling/scheduling-engine.service';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { SHIFT_SLOTS } from './shift-slots.constant';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(
    private readonly shiftsService: ShiftsService,
    private readonly schedulingEngine: SchedulingEngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('slots')
  getSlots() {
    return SHIFT_SLOTS;
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post('validate')
  async validate(
    @Body()
    body: {
      stationId: string;
      swapperId: string;
      startTime: string;
      endTime: string;
      planningId?: string;
      excludeShiftId?: string;
    },
  ) {
    if (
      !body.stationId ||
      !body.swapperId ||
      !body.startTime ||
      !body.endTime
    ) {
      throw new BadRequestException(
        'stationId, swapperId, startTime et endTime sont requis.',
      );
    }

    const startTime = new Date(body.startTime);

    const endTime = new Date(body.endTime);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new BadRequestException('Les dates du shift sont invalides.');
    }

    const station = await this.prisma.station.findUnique({
      where: {
        id: body.stationId,
      },
      select: {
        id: true,
        name: true,
        timezone: true,
        weeklyHoursLimit: true,
      },
    });

    if (!station) {
      throw new BadRequestException('Station introuvable.');
    }

    const validation = await this.schedulingEngine.validateShift({
      stationId: body.stationId,
      swapperId: body.swapperId,
      startTime,
      endTime,
      planningId: body.planningId,
      excludeShiftId: body.excludeShiftId,
    });

    const weekStart = new Date(startTime);

    weekStart.setUTCHours(0, 0, 0, 0);

    const mondayOffset =
      weekStart.getUTCDay() === 0 ? -6 : 1 - weekStart.getUTCDay();

    weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset);

    const weekEnd = new Date(weekStart);

    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const existingShifts = await this.prisma.shift.findMany({
      where: {
        swapperId: body.swapperId,
        startTime: {
          gte: weekStart,
          lt: weekEnd,
        },
        ...(body.excludeShiftId
          ? {
              id: {
                not: body.excludeShiftId,
              },
            }
          : {}),
      },
      select: {
        startTime: true,
        endTime: true,
      },
    });

    const existingHours = existingShifts.reduce(
      (total, shift) =>
        total +
        (shift.endTime.getTime() - shift.startTime.getTime()) / 3_600_000,
      0,
    );

    const durationHours = (endTime.getTime() - startTime.getTime()) / 3_600_000;

    const projectedHours = existingHours + durationHours;

    return {
      valid: validation.valid,
      stationName: station.name,
      timezone: station.timezone,
      durationHours,
      weeks: [
        {
          startDate: weekStart.toISOString().slice(0, 10),
          existingHours,
          addedHours: durationHours,
          projectedHours,
          limitHours: station.weeklyHoursLimit,
        },
      ],
      errors: validation.errors.map((message, index) => ({
        code: `RULE_${index + 1}`,
        message,
      })),
      warnings: validation.warnings.map((message, index) => ({
        code: `WARNING_${index + 1}`,
        message,
      })),
    };
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post()
  create(
    @Body()
    dto: CreateShiftDto,
  ) {
    return this.shiftsService.create(dto);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Get()
  findAll() {
    return this.shiftsService.findAll();
  }

  @Roles(Role.SWAPPER)
  @Get('mine')
  findMine(
    @Req()
    req: {
      user: {
        id: string;
      };
    },
  ) {
    return this.shiftsService.findMine(req.user.id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id')
  update(
    @Param('id')
    id: string,
    @Body()
    dto: UpdateShiftDto,
    @Req()
    req: {
      user: {
        id: string;
      };
    },
  ) {
    return this.shiftsService.update(id, dto, req.user.id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Delete(':id')
  remove(
    @Param('id')
    id: string,
  ) {
    return this.shiftsService.remove(id);
  }
}
