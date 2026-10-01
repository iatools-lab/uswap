import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  AttendanceQrType,
  AttendanceStatus,
  Role,
} from "@prisma/client";

import { AttendanceService } from "./attendance.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { OperationsService } from "../operations/operations.service";
import { PrismaService } from "../prisma/prisma.service";

@Controller("attendance")
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly operationsService: OperationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("qr")
  @Roles(
    Role.SUPERVISOR,
    Role.STATION_CHIEF,
  )
  async generateQr(
    @Req()
    req: {
      user: {
        id: string;
      };
    },
    @Body()
    body: {
      shiftId: string;
      stationId: string;
      type?: AttendanceQrType;
      kind?:
        | "CHECKIN"
        | "CHECKOUT";
    },
  ) {
    const type =
      body.type ??
      (body.kind ===
      "CHECKOUT"
        ? AttendanceQrType.END
        : AttendanceQrType.START);

    const result =
      await this.attendanceService.generateQr(
        body.shiftId,
        body.stationId,
        req.user.id,
        type,
      );

    const station =
      await this.prisma.station.findUnique(
        {
          where: {
            id: body.stationId,
          },
          select: {
            name: true,
            timezone: true,
          },
        },
      );

    if (!station) {
      throw new ForbiddenException(
        "Station introuvable.",
      );
    }

    return {
      ...result,
      kind:
        type ===
        AttendanceQrType.END
          ? "CHECKOUT"
          : "CHECKIN",
      stationName:
        station.name,
      timezone:
        station.timezone,
    };
  }

  @Post("check-in")
  @Roles(Role.SWAPPER)
  async checkIn(
    @Req()
    req: {
      user: {
        id: string;
      };
    },
    @Body()
    body: {
      token: string;
      shiftId: string;
      stationId: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.attendanceService.checkIn(
      body.token,
      req.user.id,
      body.shiftId,
      body.stationId,
      body.latitude,
      body.longitude,
    );
  }

  @Post("check-out")
  @Roles(Role.SWAPPER)
  async checkOut(
    @Req()
    req: {
      user: {
        id: string;
      };
    },
    @Body()
    body: {
      token: string;
      shiftId: string;
      stationId: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.attendanceService.checkOut(
      body.token,
      req.user.id,
      body.shiftId,
      body.stationId,
      body.latitude,
      body.longitude,
    );
  }

  @Get()
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async findAll(
    @Query("status")
    status?: AttendanceStatus,
  ) {
    return this.attendanceService.findAll(
      status,
    );
  }

  @Get("statistics")
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async getStatistics() {
    return this.attendanceService.getStatistics();
  }

  @Get("mine")
  @Roles(Role.SWAPPER)
  async findMine(
    @Req()
    req: {
      user: {
        id: string;
      };
    },
    @Query("status")
    status?: AttendanceStatus,
  ) {
    return this.attendanceService.findBySwapper(
      req.user.id,
      status,
    );
  }

  @Get("shift/:shiftId")
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async findByShift(
    @Param("shiftId")
    shiftId: string,
    @Query("status")
    status?: AttendanceStatus,
  ) {
    return this.attendanceService.findByShift(
      shiftId,
      status,
    );
  }

  @Get(
    "shift/:shiftId/pending-checkout",
  )
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async findPendingCheckouts(
    @Param("shiftId")
    shiftId: string,
  ) {
    return this.attendanceService.findPendingCheckouts(
      shiftId,
    );
  }

  @Get("station/:stationId")
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
    Role.STATION_CHIEF,
  )
  async findByStation(
    @Req()
    req: {
      user: {
        id: string;
      };
    },
    @Param("stationId")
    stationId: string,
    @Query("status")
    status?: AttendanceStatus,
  ) {
    const access =
      await this.operationsService.resolveAccessibleStationIds(
        req.user.id,
      );

    if (
      !access.unrestricted &&
      !access.stationIds.includes(
        stationId,
      )
    ) {
      throw new ForbiddenException(
        "Vous ne disposez pas des droits sur cette station.",
      );
    }

    return this.attendanceService.findByStation(
      stationId,
      status,
    );
  }

  @Get("swapper/:swapperId")
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async findBySwapper(
    @Param("swapperId")
    swapperId: string,
    @Query("status")
    status?: AttendanceStatus,
  ) {
    return this.attendanceService.findBySwapper(
      swapperId,
      status,
    );
  }

  @Patch(":id/correct")
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async correctAttendance(
    @Param("id")
    id: string,
    @Body()
    body: {
      newStatus: AttendanceStatus;
      reason: string;
      checkInAt?: string;
      checkOutAt?: string;
      evidenceUrl?: string;
    },
    @Req()
    req: {
      user: {
        id: string;
      };
    },
  ) {
    return this.attendanceService.correctAttendance(
      id,
      req.user.id,
      body.newStatus,
      body.reason,
      body.checkInAt,
      body.checkOutAt,
      body.evidenceUrl,
    );
  }

  /**
   * Sprint 5: live attendance board for supervisors and station chiefs.
   * Declared before GET ':id' so 'monitor' is not read as an attendance id.
   */
  @Get("monitor")
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  async monitor(@Req() req: { user: { id: string } }) {
    return this.attendanceService.monitor(req.user.id);
  }

  /**
   * Sprint 5: personal attendance history of the signed-in swapper.
   * Declared before GET ':id' as well.
   */
  @Get("history")
  @Roles(Role.SWAPPER)
  async history(
    @Req() req: { user: { id: string } },
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.attendanceService.history(req.user.id, from, to);
  }

  @Get(":id")
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
  )
  async findOne(
    @Param("id")
    id: string,
  ) {
    return this.attendanceService.findOne(
      id,
    );
  }
}