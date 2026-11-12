import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { ScopeModule } from '../common/scope.service';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import {
  AgentRoute,
  PilotRoute,
  SuperAdminRoute,
  SupervisionRoute,
} from '../common/routing/role-route';

@ApiTags('dashboard')
@ApiBearerAuth()
// Indicateurs du jour : le service filtre déjà par rôle et par périmètre.
// `/superadmin/dashboard` est requis : le frontend préfixe chaque appel par
// l'espace du rôle connecté (`api/role-routes.ts`).
@Controller('dashboard')
@SuperAdminRoute('dashboard')
@PilotRoute('dashboard')
@SupervisionRoute('dashboard')
@AgentRoute('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Indicateurs du jour pour le tableau de bord' })
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.stats(user);
  }
}

@Module({
  imports: [ScopeModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
