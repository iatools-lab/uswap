import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { IncidentsService } from './incidents.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

class CreateIncidentDto {
  @IsString()
  stationId!: string;

  @IsString()
  affectedSwapperId!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;

  @IsOptional()
  @IsArray()
  attachmentIds?: string[];
}

class UpdateIncidentDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsString()
  comment?: string;
}

@ApiTags('incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Incidents, métriques et périmètre de filtrage' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('stationId') stationId?: string,
  ) {
    return this.incidents.list(user, stationId);
  }

  @Post()
  @Roles(Role.SUPERVISOR, Role.SWAPPER, Role.ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Signale un incident' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateIncidentDto,
  ) {
    return this.incidents.create(user, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Incident et fil d’actions' })
  detail(@Param('id') id: string) {
    return this.incidents.detail(id);
  }

  @Patch(':id')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Fait avancer le traitement de l’incident' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateIncidentDto,
  ) {
    return this.incidents.update(user, id, body);
  }
}
