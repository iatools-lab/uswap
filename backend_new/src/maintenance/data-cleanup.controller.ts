import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { DataCleanupService } from './data-cleanup.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

class CleanupDto {
  /** Cible unique (compatibilite) ou liste de cibles. */
  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsArray()
  targets?: string[];

  /** `absent` ou `true` = simulation ; `false` = suppression réelle. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** Doit valoir « EFFACER » pour une suppression réelle. */
  @IsOptional()
  @IsString()
  confirm?: string;
}

/**
 * Maintenance de la plateforme : nettoyage des donnees de recette.
 * Toutes les routes sont reservees au super administrateur.
 */
@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('super-admin/cleanup')
export class DataCleanupController {
  constructor(private readonly cleanup: DataCleanupService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Volumes de données disponibles au nettoyage' })
  overview() {
    return this.cleanup.overview();
  }

  @Post('preview')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Simule un nettoyage (aucune écriture)' })
  preview(@CurrentUser() actor: AuthenticatedUser, @Body() body: CleanupDto) {
    return this.cleanup.run(actor, { ...body, dryRun: true });
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Nettoie les données de test (confirmation « EFFACER » requise)',
  })
  run(@CurrentUser() actor: AuthenticatedUser, @Body() body: CleanupDto) {
    return this.cleanup.run(actor, body);
  }
}
