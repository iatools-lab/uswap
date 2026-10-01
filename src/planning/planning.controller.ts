import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlanningService } from './planning.service';
import { CreatePlanningDto } from './dto/create-planning.dto';
import { GeneratePlanningDto } from './dto/generate-planning.dto';
import { PreviewPlanningDto } from './dto/preview-planning.dto';

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

  /**
   * Planning inbox for the signed-in user. Declared before `GET /:id` so
   * "notices" is never captured as a planning identifier.
   */
  @Get('notices')
  findNotices(@Req() req: { user: { id: string } }) {
    return this.planningService.findNotices(req.user.id);
  }

  @Patch('notices/:id/read')
  readNotice(@Req() req: { user: { id: string } }, @Param('id') id: string) {
    return this.planningService.readNotice(req.user.id, id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.planningService.findOne(id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post(':id/generate')
  generate(@Param('id') id: string, @Body() dto: GeneratePlanningDto) {
    return this.planningService.generateShifts(id, dto);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/publish')
  publish(@Param('id') id: string) {
    return this.planningService.publish(id);
  }

  // ============================================================
  // SPRINT 5 — PREVIEW / AUTO-ASSIGN / VALIDATE / OCCURRENCES
  // ============================================================

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post(':id/preview')
  preview(@Param('id') id: string, @Body() dto: PreviewPlanningDto) {
    return this.planningService.preview(id, dto);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/validate')
  validate(@Param('id') id: string) {
    return this.planningService.validatePlanning(id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post(':id/auto-assign')
  autoAssign(@Param('id') id: string) {
    return this.planningService.autoAssign(id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/occurrences/:occurrenceId')
  updateOccurrence(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body()
    body: { swapperId?: string | null; swapWithId?: string | null; revision?: number },
    @Req() req: { user: { id: string } },
  ) {
    return this.planningService.updateOccurrence(
      id,
      occurrenceId,
      body,
      req.user.id,
    );
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post(':id/occurrences/:occurrenceId/duplicate')
  duplicateOccurrence(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
  ) {
    return this.planningService.duplicateOccurrence(id, occurrenceId);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post(':id/occurrences/:occurrenceId/validate')
  validateOccurrence(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: { swapperId?: string; revision?: number },
  ) {
    return this.planningService.validateOccurrence(id, occurrenceId, body);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/occurrences/:occurrenceId/remove')
  removeOccurrence(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
  ) {
    return this.planningService.removeOccurrence(id, occurrenceId);
  }
}