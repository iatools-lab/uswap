import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { OperationsService } from './operations.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

class AbsenceDto {
  @IsString()
  shiftId!: string;

  @IsString()
  reason!: string;

  // Le justificatif est facultatif : une absence peut etre declaree sans
  // piece jointe (le superviseur pourra en demander une plus tard).
  @IsOptional()
  @IsString()
  attachmentId?: string | null;

  @IsOptional()
  @IsString()
  clientRef?: string | null;

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

class ReplacementDto {
  @IsString()
  swapperId!: string;

  @IsOptional()
  @IsString()
  reason?: string | null;
}

interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

@ApiTags('operations')
@ApiBearerAuth()
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post('operations/absences/attachments')
  @Roles(Role.SWAPPER)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Dépôt du justificatif d’absence (PDF/image, 5 Mo)' })
  @UseInterceptors(FileInterceptor('file'))
  uploadAbsenceAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.operations.uploadAbsenceAttachment(user, file);
  }

  @Post('operations/absences')
  @Roles(Role.SWAPPER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Déclaration d’indisponibilité (idempotente)' })
  declareAbsence(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbsenceDto,
  ) {
    return this.operations.declareAbsence(user, body);
  }

  @Get('operations/replacements/pending')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'File des postes à couvrir, triée par urgence' })
  pending(@Query('stationId') stationId?: string) {
    return this.operations.pendingReplacements(stationId ?? null);
  }

  @Get('operations/shifts/:shiftId/candidates')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Agents candidats avec leurs conflits éventuels' })
  candidates(@Param('shiftId') shiftId: string) {
    return this.operations.candidates(shiftId);
  }

  @Post('operations/shifts/:shiftId/replacement')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Affecte un remplaçant au poste' })
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shiftId') shiftId: string,
    @Body() body: ReplacementDto,
  ) {
    return this.operations.replace(user, shiftId, body);
  }

  @Get('operations/changes')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Historique des changements d’affectation' })
  changes(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('stationId') stationId?: string,
    @Query('swapperId') swapperId?: string,
  ) {
    return this.operations.changes({ from, to, type, stationId, swapperId });
  }

  @Post('corrections/attachments')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Dépôt d’un justificatif de correction' })
  @UseInterceptors(FileInterceptor('file'))
  uploadCorrectionAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.operations.uploadCorrectionAttachment(user, file);
  }

  @Patch('operations/changes/:changeId')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Précise le motif d’un changement d’affectation' })
  annotateChange(
    @Param('changeId') changeId: string,
    @Body() body: { reason?: string },
  ) {
    return this.operations.annotateChange(changeId, body.reason ?? null);
  }
}
