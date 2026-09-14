import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlanningService } from './planning.service';
import { CreatePlanningDto } from './dto/create-planning.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('plannings')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post()
  create(@Body() dto: CreatePlanningDto, @Req() req: { user: { id: string } }) {
    return this.planningService.create(dto, req.user.id);
  }

  @Get()
  findAll() {
    return this.planningService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.planningService.findOne(id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/publish')
  publish(@Param('id') id: string) {
    return this.planningService.publish(id);
  }
}