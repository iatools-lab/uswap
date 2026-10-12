import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { ScopeModule } from '../common/scope.service';
import { CurrentUser, type AuthenticatedUser } from '../common/guards/roles.guard';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
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
