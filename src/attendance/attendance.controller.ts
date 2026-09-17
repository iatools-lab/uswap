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
ApiBearerAuth,
ApiOperation,
ApiQuery,
ApiTags,
} from '@nestjs/swagger';

import { AttendanceStatus, Role } from '@prisma/client';

import { AttendanceService } from './attendance.service';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
constructor(
private readonly attendanceService: AttendanceService,
) {}

// ============================================================
// GENERATE ATTENDANCE QR
// ============================================================

@Post('qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR)
@ApiOperation({
summary: 'Generate attendance QR code',
})
async generateQr(
@Req() req: { user: { id: string } },
@Body()
body: {
shiftId: string;
stationId: string;
type: 'START' | 'END';
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SWAPPER)
@ApiOperation({
summary: 'Check in using attendance QR code',
})
async checkIn(
@Req() req: { user: { id: string } },
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SWAPPER)
@ApiOperation({
summary: 'Check out using attendance QR code',
})
async checkOut(
@Req() req: { user: { id: string } },
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
// GET ALL ATTENDANCES
// ============================================================

@Get()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get all attendance records',
})
@ApiQuery({
name: 'status',
required: false,
enum: AttendanceStatus,
})
async findAll(
@Query('status') status?: AttendanceStatus,
) {
return this.attendanceService.findAll(status);
}

// ============================================================
// DASHBOARD STATISTICS
// ============================================================

@Get('statistics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get attendance dashboard statistics',
})
async getStatistics() {
return this.attendanceService.getStatistics();
}

// ============================================================
// GET ATTENDANCE BY SHIFT
// ============================================================

@Get('shift/:shiftId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get attendance records for a shift',
})
@ApiQuery({
name: 'status',
required: false,
enum: AttendanceStatus,
})
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
// GET SWAPPERS PENDING CHECK-OUT
// ============================================================

@Get('shift/:shiftId/pending-checkout')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get swappers who have not checked out',
})
async findPendingCheckouts(
@Param('shiftId') shiftId: string,
) {
return this.attendanceService.findPendingCheckouts(
shiftId,
);
}

// ============================================================
// GET ATTENDANCE BY STATION
// ============================================================

@Get('station/:stationId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get attendance records for a station',
})
@ApiQuery({
name: 'status',
required: false,
enum: AttendanceStatus,
})
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
// GET ATTENDANCE BY SWAPPER
// ============================================================

@Get('swapper/:swapperId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get attendance history for a swapper',
})
@ApiQuery({
name: 'status',
required: false,
enum: AttendanceStatus,
})
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Correct an attendance record',
})
async correctAttendance(
@Req() req: { user: { id: string } },
@Param('id') attendanceId: string,
@Body()
body: {
newStatus: AttendanceStatus;
reason: string;
checkInAt?: string;
checkOutAt?: string;
evidenceUrl?: string;
},
) {
return this.attendanceService.correctAttendance(
attendanceId,
req.user.id,
body.newStatus,
body.reason,
body.checkInAt,
body.checkOutAt,
body.evidenceUrl,
);
}

// ============================================================
// GET ONE ATTENDANCE
// ============================================================

@Get(':id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR)
@ApiOperation({
summary: 'Get one attendance record',
})
async findOne(
@Param('id') id: string,
) {
return this.attendanceService.findOne(id);
}
}