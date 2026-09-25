import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

import {
  CorrectionsService,
  type UploadedAttachment,
} from './corrections.service';

type AuthenticatedRequest = {
  user: {
    id: string;
    role: Role;
  };
};

type CorrectShiftBody = {
  reason: string;
  attachmentId?: string;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  isLate?: boolean;
  isAbsent?: boolean;
};

@ApiTags('corrections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('corrections')
export class CorrectionsController {
  constructor(
    private readonly correctionsService: CorrectionsService,
  ) {}

  // ============================================================
  // UPLOAD AN EVIDENCE DOCUMENT
  // ============================================================

  @Post('attachments')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @UploadedFile() file?: UploadedAttachment,
  ) {
    return this.correctionsService.saveAttachment(file);
  }

  // ============================================================
  // CORRECT A SHIFT'S ATTENDANCE
  // ============================================================

  @Patch('shifts/:shiftId')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  correctShift(
    @Req() req: AuthenticatedRequest,
    @Param('shiftId') shiftId: string,
    @Body() body: CorrectShiftBody,
  ) {
    return this.correctionsService.correctShift({
      correctedById: req.user.id,
      shiftId,
      reason: body.reason,
      attachmentId: body.attachmentId,
      checkedInAt: body.checkedInAt,
      checkedOutAt: body.checkedOutAt,
      isLate: body.isLate,
      isAbsent: body.isAbsent,
    });
  }

  // ============================================================
  // CORRECTION HISTORY FOR A SHIFT
  // ============================================================

  @Get('shifts/:shiftId')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  findShiftCorrections(
    @Req() req: AuthenticatedRequest,
    @Param('shiftId') shiftId: string,
  ) {
    return this.correctionsService.findShiftCorrections(
      req.user.id,
      shiftId,
    );
  }
}