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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { QueryIncidentsDto } from './dto/query-incidents.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
import { IncidentsService } from './incidents.service';

type AuthenticatedRequest = { user: { id: string; role: Role } };

@ApiTags('incidents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  /**
   * Supervisors and station chiefs read the incident board. The service scopes
   * the query to the caller's station when the role requires it.
   */
  @Get()
  @Roles(Role.SUPERVISOR, Role.STATION_CHIEF, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des incidents et indicateurs associes' })
  list(@Req() req: AuthenticatedRequest, @Query() query: QueryIncidentsDto) {
    return this.incidentsService.list(req.user, query);
  }

  @Post()
  @Roles(Role.STATION_CHIEF)
  @ApiOperation({ summary: 'Declarer un incident (chef de station)' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateIncidentDto) {
    return this.incidentsService.create(req.user, dto);
  }

  @Patch(':id')
  @Roles(Role.SUPERVISOR)
  @ApiOperation({ summary: 'Faire evoluer un incident (superviseur)' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateIncidentDto,
  ) {
    return this.incidentsService.update(req.user, id, dto);
  }
}
