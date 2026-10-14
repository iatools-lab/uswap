import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('admin/settings')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Réglages globaux et historique des révisions' })
  settings() {
    return this.admin.settings();
  }

  @Patch('admin/settings')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Met à jour les réglages globaux' })
  updateSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.admin.updateSettings(actor, body);
  }

  @Get('admin/audit')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Journal d’audit unifié' })
  audit(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('actorId') actorId?: string,
  ) {
    return this.admin.audit({ from, to, category, actorId });
  }

  @Get('admin/integrations')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'État des intégrations externes' })
  integrations() {
    return this.admin.integrations();
  }

  @Get('admin/platform')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Diagnostic de plateforme (volumes, files)' })
  platform() {
    return this.admin.platform();
  }

  @Post('admin/access/restore')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Restaure l’accès administrateur principal' })
  restore(@CurrentUser() actor: AuthenticatedUser) {
    return this.admin.restoreAdminAccess(actor);
  }
}
