import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StationsService, type StationPayload, type TemplatePayload } from './stations.service';
import { Roles, type AuthenticatedUser, CurrentUser } from '../common/guards/roles.guard';
import { Role } from '../common/enums';

@ApiTags('stations')
@ApiBearerAuth()
@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des stations' })
  list() {
    return this.stations.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fiche d’une station' })
  detail(@Param('id') id: string) {
    return this.stations.detail(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Création d’une station' })
  create(@Body() body: StationPayload) {
    return this.stations.create(body);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mise à jour d’une station' })
  update(@Param('id') id: string, @Body() body: StationPayload) {
    return this.stations.update(id, body);
  }

  @Patch(':id/activate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Réactiver une station' })
  activate(@Param('id') id: string) {
    return this.stations.setActive(id, true);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Désactiver une station' })
  deactivate(@Param('id') id: string) {
    return this.stations.setActive(id, false);
  }

  @Get(':id/shift-templates')
  @ApiOperation({ summary: 'Modèles de shift d’une station' })
  templates(@Param('id') id: string) {
    return this.stations.templates(id);
  }

  @Post('shift-templates/apply')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Applique un même modèle à plusieurs stations',
  })
  applyTemplate(@Body() body: TemplatePayload & { stationIds?: string[] }) {
    return this.stations.applyTemplateToStations(body);
  }

  @Post(':id/shift-templates')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Création d’un modèle de shift' })
  createTemplate(@Param('id') id: string, @Body() body: TemplatePayload) {
    return this.stations.createTemplate(id, body);
  }

  @Get(':id/shift-templates/:templateId/history')
  @ApiOperation({ summary: 'Historique des révisions d’un modèle' })
  templateHistory(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
  ) {
    return this.stations.templateHistory(id, templateId);
  }

  @Patch(':id/shift-templates/:templateId')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Mise à jour d’un modèle de shift' })
  updateTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() body: TemplatePayload,
  ) {
    return this.stations.updateTemplate(id, templateId, body);
  }
}
