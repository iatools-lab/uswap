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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  PlanningService,
  type CreatePlanningDto,
} from './planning.service';
import { ConstraintsService } from './constraints.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

/**
 * Planifications.
 *
 * Le contrat est celui de `frontend_new` : les routes sont exposées au pluriel
 * (`/plannings`) et chaque réponse reprend la forme attendue par les écrans
 * (calendrier, génération guidée, avis de publication).
 */

class CreatePlanningBody implements CreatePlanningDto {
  @IsOptional()
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  stationIds!: string[];

  @IsOptional()
  @IsString()
  periodStart!: string;

  @IsOptional()
  @IsString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  conflictPolicy?: string;

  @IsOptional()
  @IsNumber()
  requiredStaff?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /**
   * Créneaux envoyés avec le planning (génération guidée). Sans cette
   * déclaration, la whitelist de validation retirait la propriété et le
   * serveur créait un planning **vide** en répondant 201.
   */
  @IsOptional()
  @IsArray()
  assignments?: CreatePlanningDto['assignments'];

  /** Le frontend envoie `startDate`/`endDate` : alias de la période. */
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

class GenerateBody {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  stationIds?: string[];

  @IsOptional()
  @IsString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  requiredStaff?: number;

  @IsOptional()
  shuffle?: boolean;
}

class PreviewBody {
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsArray()
  templateIds?: string[];

  @IsOptional()
  @IsArray()
  weekdays?: number[];

  @IsOptional()
  @IsNumber()
  revision?: number;
}

class ValidateShiftBody {
  @IsString()
  stationId!: string;

  @IsString()
  swapperId!: string;

  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;
}

class OccurrenceUpdateBody {
  @IsOptional()
  @IsString()
  swapperId?: string | null;

  @IsOptional()
  @IsString()
  swapWith?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  // Tolerance propre au creneau (prioritaire sur celle de la station).
  // `null` efface l'override ; absent laisse la valeur inchangee.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  latenessToleranceOverrideMinutes?: number | null;

  @IsOptional()
  @IsNumber()
  revision?: number;
}

@ApiTags('plannings')
@ApiBearerAuth()
@Controller('plannings')
export class PlanningsController {
  constructor(
    private readonly planning: PlanningService,
    private readonly constraints: ConstraintsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Planifications filtrées par station et période' })
  @ApiQuery({ name: 'stationId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'status', required: false })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('stationId') stationId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.planning.list({ stationId, from, to, status }, actor);
  }

  @Get('notices')
  @ApiOperation({ summary: 'Avis de publication de l’utilisateur connecté' })
  notices(@CurrentUser() user: AuthenticatedUser) {
    return this.planning.notices(user.id);
  }

  @Patch('notices/:id/read')
  @ApiOperation({ summary: 'Marquer un avis de publication comme lu' })
  readNotice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.planning.readNotice(user.id, id);
  }

  @Get('occurrences')
  @ApiOperation({ summary: 'Postes planifiés avec agent et statut de pointage' })
  @ApiQuery({ name: 'stationId', required: false })
  @ApiQuery({ name: 'stationIds', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'swapperId', required: false })
  occurrences(
    @Query('stationId') stationId?: string,
    @Query('stationIds') stationIds?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('swapperId') swapperId?: string,
  ) {
    return this.planning.occurrences({
      stationId,
      stationIds: stationIds ? stationIds.split(',').filter(Boolean) : undefined,
      from,
      to,
      swapperId,
    });
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée une planification (brouillon par défaut)' })
  create(
    @Body() body: CreatePlanningBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.create(this.normalise(body, actor), actor);
  }

  @Post('generate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Génère automatiquement postes et affectations' })
  generate(
    @Body() body: GenerateBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.generate(
      {
        stationIds: body.stationIds ?? [],
        periodStart: body.periodStart ?? body.startDate ?? '',
        periodEnd: body.periodEnd ?? body.endDate ?? '',
        requiredStaff: body.requiredStaff,
        shuffle: body.shuffle,
        name: body.name,
      },
      actor,
    );
  }

  @Post('validate-shift')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Contrôles métier avant affectation d’un agent' })
  validateShift(@Body() body: ValidateShiftBody) {
    return this.constraints.report({
      stationId: body.stationId,
      swapperId: body.swapperId,
      startTime: body.startTime,
      endTime: body.endTime,
      hours: hoursBetween(body.startTime, body.endTime),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une planification' })
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.planning.detail(id, user);
  }

  @Get(':id/coverage')
  @ApiOperation({ summary: 'Matrice de couverture (jours x stations)' })
  coverage(@Param('id') id: string) {
    return this.planning.coverage(id);
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: 'Historique des révisions' })
  revisions(@Param('id') id: string) {
    return this.planning.revisions(id);
  }

  @Post(':id/preview')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aperçu des postes avant génération' })
  preview(@Param('id') id: string, @Body() body: PreviewBody) {
    return this.planning.preview(id, body);
  }

  @Post(':id/generate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(201)
  @ApiOperation({ summary: 'Ajoute au planning les postes confirmés' })
  generateFor(
    @Param('id') id: string,
    @Body() body: PreviewBody & { previewHash?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.generateFor(id, body, actor);
  }

  @Post(':id/auto-assign')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Répartit automatiquement les agents disponibles' })
  autoAssign(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.planning.autoAssign(id, actor);
  }

  @Post(':id/validate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Contrôle la couverture avant publication' })
  // Les écrans envoient `{ revision }` : sans `@Body()`, la whitelist globale
  // rejetait la propriété en 400 ("property revision should not exist") et le
  // contrôle était indisponible pour tous les candidats — l'écran d'affectation
  // restait donc entièrement grisé.
  validate(
    @Param('id') id: string,
    @Body() _body?: { revision?: number },
  ) {
    return this.planning.validatePlanning(id);
  }

  // Alias PATCH : certains écrans publient en PATCH.
  @Patch(':id/validate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Alias de la validation de planification' })
  validatePatch(
    @Param('id') id: string,
    @Body() _body?: { revision?: number },
  ) {
    return this.planning.validatePlanning(id);
  }

  @Post(':id/publish')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Publie la planification et notifie les agents' })
  publish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body?: { revision?: number },
  ) {
    return this.planning.publish(id, actor);
  }

  @Patch(':id/publish')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Alias de publication de planification' })
  publishPatch(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body?: { revision?: number },
  ) {
    return this.planning.publish(id, actor);
  }

  @Patch(':id/occurrences/:occurrenceId/assignments')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Remplace les agents affectés à un poste' })
  setAssignments(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: { userIds?: string[] },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.setAssignments(id, occurrenceId, body.userIds ?? [], actor);
  }

  @Post(':id/occurrences/:occurrenceId/duplicate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Duplique un poste' })
  duplicate(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.duplicateOccurrence(id, occurrenceId, actor);
  }

  @Post(':id/occurrences/:occurrenceId/remove')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Retire un poste (ou le vide si c’est le dernier)' })
  remove(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.removeOccurrence(id, occurrenceId, actor);
  }

  @Post(':id/occurrences/:occurrenceId/validate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Vérifie qu’un agent peut couvrir un poste' })
  validateOccurrence(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: { swapperId?: string; revision?: number },
  ) {
    return this.planning.validateOccurrence(id, occurrenceId, body.swapperId ?? '');
  }

  @Patch(':id/occurrences/:occurrenceId/validate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Alias de validation d’un poste' })
  validateOccurrencePatch(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: { swapperId?: string; revision?: number },
  ) {
    return this.planning.validateOccurrence(id, occurrenceId, body.swapperId ?? '');
  }

  @Patch(':id/occurrences/:occurrenceId')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Met à jour un poste (agent, permutation, horaires)' })
  updateOccurrence(
    @Param('id') id: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: OccurrenceUpdateBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.planning.updateOccurrence(id, occurrenceId, body, actor);
  }

  /** Accepte indifféremment `startDate`/`endDate` et `periodStart`/`periodEnd`. */
  private normalise(
    body: CreatePlanningBody,
    _actor: AuthenticatedUser,
  ): CreatePlanningDto {
    return {
      name: body.name,
      stationIds: body.stationIds ?? [],
      periodStart: body.periodStart ?? body.startDate ?? '',
      periodEnd: body.periodEnd ?? body.endDate ?? '',
      status: body.status,
      conflictPolicy: body.conflictPolicy,
      requiredStaff: body.requiredStaff,
      idempotencyKey: body.idempotencyKey,
      ...(Array.isArray(body.assignments) && body.assignments.length
        ? { assignments: body.assignments }
        : {}),
    };
  }
}

function hoursBetween(start: string, end: string): number {
  const diff = Date.parse(end) - Date.parse(start);
  return Math.max(0, Math.round((diff / 3_600_000) * 100) / 100);
}
