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
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

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
@Controller()
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Get('leaves/workspace')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Solde, demandes et état de l’intégration RH' })
  workspace(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.workspace(user);
  }

  @Get('leaves/balance')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Solde de congés annuel' })
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.balance(user);
  }

  @Post('leaves')
  @Roles(Role.SWAPPER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Nouvelle demande de congé' })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() body: LeaveRequestDto) {
    return this.leaves.submit(user, body);
  }

  @Patch('leaves/:id')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Modifie une demande encore en attente' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: LeaveRequestDto,
  ) {
    return this.leaves.update(user, id, body);
  }

  @Patch('leaves/:id/cancel')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Annule une demande en attente' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leaves.cancel(user, id);
  }

  @Get('leaves/management')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Suivi des congés (périmètre du rôle)' })
  management(@CurrentUser() user: AuthenticatedUser) {
    return this.leaves.management(user);
  }

  @Get('admin/leaves/pending')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
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
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook entrant du système RH (RM-15)' })
  webhook(
    @Body()
    body: { idempotencyKey?: string; externalId?: string; status?: string },
  ) {
    return this.leaves.syncWebhook(body);
  }
}
