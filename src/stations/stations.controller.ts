import {
Body,
Controller,
Get,
Param,
Patch,
Post,
UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

import { StationsService } from './stations.service';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stations')
export class StationsController {
constructor(
private readonly stationsService: StationsService,
) {}

@Roles(Role.ADMIN)
@Post()
create(@Body() dto: CreateStationDto) {
return this.stationsService.create(dto);
}

@Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
@Get()
findAll() {
return this.stationsService.findAll();
}

@Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
@Get(':id')
findOne(@Param('id') id: string) {
  return this.stationsService.findOne(id);
}

// ============================================================
// SHIFT TEMPLATES (nested under a station, as the screen calls them)
// ============================================================

@Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
@Get(':id/shift-templates')
findTemplates(@Param('id') id: string) {
  return this.stationsService.findTemplates(id);
}

@Roles(Role.ADMIN, Role.SUPERVISOR)
@Post(':id/shift-templates')
createTemplate(
  @Param('id') id: string,
  @Body()
  body: {
    label?: string;
    startTime?: string;
    endTime?: string;
    breakStart?: string | null;
    breakEnd?: string | null;
  },
) {
  return this.stationsService.createTemplate(id, body);
}

@Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
@Get(':id/shift-templates/:templateId/history')
findTemplateHistory(
  @Param('id') id: string,
  @Param('templateId') templateId: string,
) {
  return this.stationsService.findTemplateHistory(id, templateId);
}

@Roles(Role.ADMIN, Role.SUPERVISOR)
@Patch(':id/shift-templates/:templateId')
updateTemplate(
  @Param('id') id: string,
  @Param('templateId') templateId: string,
  @Body()
  body: {
    label?: string;
    startTime?: string;
    endTime?: string;
    breakStart?: string | null;
    breakEnd?: string | null;
    isActive?: boolean;
  },
) {
  return this.stationsService.updateTemplate(id, templateId, body);
}

@Roles(Role.ADMIN)
@Patch(':id')
update(
@Param('id') id: string,
@Body() dto: UpdateStationDto,
) {
return this.stationsService.update(id, dto);
}

@Roles(Role.ADMIN)
@Patch(':id/active')
setActive(
@Param('id') id: string,
@Body('isActive') isActive: boolean,
) {
return this.stationsService.setActive(
id,
isActive,
);
}

@Roles(Role.ADMIN)
@Patch(':id/activate')
activate(@Param('id') id: string) {
  // Alias used by the station manager: a dedicated verb per direction.
  return this.stationsService.setActive(id, true);
}

@Roles(Role.ADMIN)
@Patch(':id/deactivate')
deactivate(@Param('id') id: string) {
  return this.stationsService.setActive(id, false);
}

@Roles(Role.ADMIN)
@Patch(':id/status')
setStatus(
@Param('id') id: string,
@Body() body: { isActive?: boolean; enabled?: boolean },
) {
// Alias used by the stations screen, which sends enabled/isActive.
return this.stationsService.setActive(
id,
body.isActive ?? body.enabled ?? false,
);
}
}
