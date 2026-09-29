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
