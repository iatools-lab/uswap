import {
Body,
Controller,
Get,
Param,
Patch,
Post,
Query,
Req,
UseGuards,
} from '@nestjs/common';

import {
AttendanceStatus,
AttendanceQrType,
Role,
} from '@prisma/client';

import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
constructor(
private readonly attendanceService: AttendanceService,
) {}

// ============================================================
// GENERATE ATTENDANCE QR
// ============================================================

@Post('qr')
@Roles(Role.SUPERVISOR, Role.STATION_CHIEF)
async generateQr(
@Req() req: any,
@Body()
body: {
shiftId: string;
stationId: string;
type: AttendanceQrType;
},
) {
return this.attendanceService.generateQr(
body.shiftId,
body.stationId,
req.user.id,
body.type,
);
}

// ============================================================
// CHECK IN
// ============================================================

@Post('check-in')
@Roles(Role.SWAPPER)
async checkIn(
@Req() req: any,
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

// ============================================================
// CHECK OUT
// ============================================================

@Post('check-out')
@Roles(Role.SWAPPER)
async checkOut(
@Req() req: any,
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

// ============================================================
// FIND ALL ATTENDANCES
// ============================================================

@Get()
@Roles(Role.ADMIN, Role.SUPERVISOR)
async findAll(
@Query('status') status?: AttendanceStatus,
) {
return this.attendanceService.findAll(status);
}

// ============================================================
// GET ATTENDANCE STATISTICS
// ============================================================

@Get('statistics')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async getStatistics() {
return this.attendanceService.getStatistics();
}

// ============================================================
// FIND ATTENDANCES BY SHIFT
// ============================================================

@Get('shift/:shiftId')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async findByShift(
@Param('shiftId') shiftId: string,
@Query('status') status?: AttendanceStatus,
) {
return this.attendanceService.findByShift(
shiftId,
status,
);
}

// ============================================================
// FIND PENDING CHECKOUTS
// ============================================================

@Get('shift/:shiftId/pending-checkout')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async findPendingCheckouts(
@Param('shiftId') shiftId: string,
) {
return this.attendanceService.findPendingCheckouts(
shiftId,
);
}

// ============================================================
// FIND ATTENDANCES BY STATION
// ============================================================

@Get('station/:stationId')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async findByStation(
@Param('stationId') stationId: string,
@Query('status') status?: AttendanceStatus,
) {
return this.attendanceService.findByStation(
stationId,
status,
);
}

// ============================================================
// FIND ATTENDANCES BY SWAPPER
// ============================================================

@Get('swapper/:swapperId')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async findBySwapper(
@Param('swapperId') swapperId: string,
@Query('status') status?: AttendanceStatus,
) {
return this.attendanceService.findBySwapper(
swapperId,
status,
);
}

// ============================================================
// CORRECT ATTENDANCE
// ============================================================

@Patch(':id/correct')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async correctAttendance(
@Param('id') id: string,
@Body()
body: {
newStatus: AttendanceStatus;
reason: string;
checkInAt?: string;
checkOutAt?: string;
evidenceUrl?: string;
},
@Req() req: any,
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

// ============================================================
// FIND ONE ATTENDANCE
// ============================================================

@Get(':id')
@Roles(Role.ADMIN, Role.SUPERVISOR)
async findOne(@Param('id') id: string) {
return this.attendanceService.findOne(id);
}
}