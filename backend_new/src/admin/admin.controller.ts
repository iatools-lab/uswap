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
import { PilotRoute, SuperAdminRoute } from '../common/routing/role-route';

@ApiTags('admin')
@ApiBearerAuth()
// Réglages, audit et restauration d'accès : pilotage.
//   /admin/...        historique (compatibilité)
//   /pilot/...        administrateur et super administrateur
//   /superadmin/...   super administrateur
//
// Les MÉTHODES portent déjà `admin/settings`, `admin/audit`… : ce contrôleur
// est « à plat » (voir `scopedBaseFor`). `main.ts` réenregistre chacun de ses
// handlers sous `/superadmin/<chemin>`, ce qui donne
// `/superadmin/admin/settings` — exactement ce qu'appelle le frontend.
@Controller()
@SuperAdminRoute('admin')
@PilotRoute('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get(['admin/settings', 'settings'])
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Réglages globaux et historique des révisions' })
  settings() {
    return this.admin.settings();
  }

  @Patch(['admin/settings', 'settings'])
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Met à jour les réglages globaux' })
  updateSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.admin.updateSettings(actor, body);
  }

  @Get(['admin/audit', 'audit'])
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Journal d’audit unifié' })
  audit(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('actorId') actorId?: string,
  ) {
    return this.admin.audit({ from, to, category, actorId });
  }

  @Get(['admin/integrations', 'integrations'])
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'État des intégrations externes' })
  integrations() {
    return this.admin.integrations();
  }

  @Get(['admin/platform', 'platform'])
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Diagnostic de plateforme (volumes, files)' })
  platform() {
    return this.admin.platform();
  }

  @Post(['admin/access/restore', 'access/restore'])
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Restaure l’accès administrateur principal' })
  restore(@CurrentUser() actor: AuthenticatedUser) {
    return this.admin.restoreAdminAccess(actor);
  }
}
