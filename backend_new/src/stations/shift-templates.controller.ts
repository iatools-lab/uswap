import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  StationsService,
  type TemplatePayload,
} from '../stations/stations.service';
import { StationsModule } from '../stations/stations.module';
import { Roles } from '../common/guards/roles.guard';
import { Role } from '../common/enums';
import {
  PilotRoute,
  SuperAdminRoute,
  SupervisionRoute,
} from '../common/routing/role-route';

/**
 * Alias racine des modèles de shift.
 *
 * `StationManager` (mode maquette) appelle `POST /shift-templates/apply` sans
 * passer par le préfixe `stations`. En mode réel, le frontend boucle sur
 * `POST /stations/:id/shift-templates` : les deux chemins aboutissent donc à la
 * même opération, exposée ici pour la parité stricte du contrat.
 */
@ApiTags('stations')
@ApiBearerAuth()
// Même opération que `/stations/:id/shift-templates`, exposée au niveau racine
// pour la parité du contrat : elle suit donc les espaces de `stations`.
@Controller()
@PilotRoute('shift-templates')
@SuperAdminRoute('shift-templates')
@SupervisionRoute('shift-templates')
export class ShiftTemplatesController {
  constructor(private readonly stations: StationsService) {}

  @Post('shift-templates/apply')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Applique un modèle à plusieurs stations (alias)' })
  apply(@Body() body: TemplatePayload & { stationIds?: string[] }) {
    return this.stations.applyTemplateToStations(body);
  }
}

@Module({
  imports: [StationsModule],
  controllers: [ShiftTemplatesController],
})
export class ShiftTemplatesModule {}
