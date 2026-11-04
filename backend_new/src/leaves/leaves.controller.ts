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
import { IsOptional, IsString } from 'class-validator';
import { LeavesService } from './leaves.service';
import {
  CurrentUser,
  Public,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';
import {
  AgentRoute,
  PilotRoute,
  SuperAdminRoute,
  SupervisionRoute,
} from '../common/routing/role-route';

class LeaveRequestDto {
  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsString()
  type!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  attachmentId?: string | null;
}

class DecisionDto {
  @IsString()
  decision!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('leaves')
@ApiBearerAuth()
// Congés : le parcours de l'agent et la file de décision partagent le même
// contrôleur, d'où la déclaration dans les trois espaces opérationnels. La
// séparation réelle est faite par `@Roles` méthode par méthode.
@Controller()
@SupervisionRoute('leaves')
@AgentRoute('leaves')
@PilotRoute('leaves')
@SuperAdminRoute('leaves')
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  // Base du contrôleur = `leaves` : `workspace` seul donne
  // `/agent/leaves/workspace`. L'ancien chemin complet reste déclaré.
  @Get(['workspace', 'leaves/workspace'])
  @Roles(Role.SWAPPER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Solde, demandes et état de l’intégration RH' })
  workspace(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.workspace(user);
  }

  @Get(['balance', 'leaves/balance'])
  @Roles(Role.SWAPPER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Solde de congés annuel' })
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.balance(user);
  }

  // `''` (c.-à-d. `/agent/leaves` exactement) + l'ancien chemin complet : le
  // frontend poste sur `/leaves`, que `api()` préfixe en `/agent/leaves`.
  @Post(['', 'leaves'])
  @Roles(Role.SWAPPER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Nouvelle demande de congé' })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: LeaveRequestDto,
  ) {
    return this.leaves.submit(user, body);
  }

  @Patch([':id', 'leaves/:id'])
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Modifie une demande encore en attente' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: LeaveRequestDto,
  ) {
    return this.leaves.update(user, id, body);
  }

  @Patch([':id/cancel', 'leaves/:id/cancel'])
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Annule une demande en attente' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leaves.cancel(user, id);
  }

  /**
   * Deux chemins pour le même suivi :
   *  - `leaves/management` : historique, appelé par le frontend ;
   *  - `management` : forme attendue dans l'espace (`/superadmin/management`).
   * Le doublon de segment (`/superadmin/leaves/leaves/management`) rendait la
   * route incohérente avec le préfixe d'espace ; l'ancien chemin est conservé
   * pour ne pas casser les clients existants.
   */
  // Base du contrôleur = `leaves` : `management` suffit pour donner
  // `/pilot/leaves/management`. Le chemin complet reste accepté pour les
  // clients historiques.
  @Get(['management', 'leaves/management'])
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Suivi des congés (périmètre du rôle)' })
  management(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.management(user);
  }

  // Le frontend appelle `/leaves/pending` (`api/role-routes.ts` l'étend en
  // `/agent/leaves/pending`, `/superadmin/leaves/pending`…). Le chemin
  // historique `admin/leaves/pending` n'était appelé par aucun écran : il est
  // retiré, une seule forme = une seule URL à auditer.
  @Get('pending')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Demandes en attente de décision' })
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.pending(user);
  }

  @Patch('leaves/:id/decision')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Approuve ou refuse une demande' })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.leaves.decide(user, id, body);
  }

  @Patch('admin/leaves/:id/decision')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Alias administration de la décision de congé' })
  decideAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: DecisionDto,
  ) {
    return this.leaves.decide(user, id, body);
  }

  @Get('admin/integrations/leaves')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Santé de l’intégration RH externe' })
  integration() {
    return this.leaves.integrationHealth();
  }

  @Post('admin/integrations/leaves/:operationId/retry')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejoue une opération de synchronisation échouée' })
  retry(@Param('operationId') operationId: string) {
    return this.leaves.retrySync(operationId);
  }

  @Post('integrations/leaves/webhook')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook entrant du système RH (RM-15)' })
  webhook(
    @Body()
    body: {
      idempotencyKey?: string;
      externalId?: string;
      status?: string;
      secret?: string;
    },
  ) {
    return this.leaves.syncWebhook(body);
  }
}
