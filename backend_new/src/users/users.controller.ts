import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { UserImportService } from './user-import.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import {
  PilotRoute,
  SuperAdminRoute,
  SupervisionRoute,
} from '../common/routing/role-route';
import { Role } from '../common/enums';
import { parseIntOrDefault } from '../common/security/session';

class CreateUserDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsIn(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SWAPPER'])
  role!: string;

  @IsOptional()
  @IsString()
  stationId?: string | null;

  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PENDING', 'active', 'pending'])
  accountStatus?: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SWAPPER'])
  role?: string;

  @IsOptional()
  @IsString()
  stationId?: string | null;

  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  updatedAt?: string;
}

class StatusDto {
  /** `true` = activer / réactiver, `false` = désactiver. */
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  updatedAt?: string;
}

@ApiTags('users')
@ApiBearerAuth()
// Gestion des comptes : elle appartient aux espaces de pilotage.
//   /admin/users        historique (compatibilité)
//   /superadmin/users   super administrateur (son espace propre, sans délégation)
//   /pilot/users        administrateur et super administrateur
//   /supervision/users  superviseur (il gère les comptes de son périmètre)
//   /agent/users        lecture de sa propre fiche / de son équipe
//
// `/superadmin/users` est OBLIGATOIRE : le frontend préfixe chaque appel par
// l'espace du rôle connecté (`api/role-routes.ts`), donc un super administrateur
// appelait `/superadmin/users/page` — route qui n'existait pas et répondait 404.
@Controller()
@SuperAdminRoute('users')
@PilotRoute('users', 'users')
@SupervisionRoute('users')
// Agent : pas `/agent/users` (l'annuaire complet n'est pas une donnée d'agent),
// mais `/agent/users/self` — le profil dont l'agent a besoin (sélecteurs,
// filtres par collègue dans ses plannings). Voir `self` ci-dessous.
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly imports: UserImportService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Liste des comptes (filtre par rôle)' })
  @ApiQuery({ name: 'role', required: false })
  list(@Query('role') role?: string) {
    return this.users.list({ role });
  }

  /**
   * Profil du compte connecté, dans l'espace de l'agent.
   *
   * C'est la seule information d'annuaire dont un swappeur a besoin : son
   * propre nom, sa station, son rôle. Elle remplace l'accès à `/agent/users`,
   * qui exposait la liste COMPLÈTE des comptes (e-mails, téléphones) à tous les
   * agents — y compris aux comptes les moins privilégiés.
   */
  @Get('self')
  @Roles(Role.SWAPPER, Role.SUPERVISOR, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Profil du compte connecté' })
  async self(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findSelf(user.id);
  }

  @Get('page')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Liste paginée avec compteurs par statut' })
  page(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('stationId') stationId?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.page({
      q,
      role,
      status,
      stationId,
      sort,
      page: parseIntOrDefault(page, 1),
      limit: parseIntOrDefault(limit, 8),
    });
  }

  @Get('export')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Données d’export (classeur généré par le client)' })
  export(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('stationId') stationId?: string,
    @Query('sort') sort?: string,
  ) {
    return this.users.exportRows({ q, role, status, stationId, sort });
  }

  @Get('pending')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Comptes en attente d’activation' })
  pending() {
    return this.users.pending();
  }

  @Get('imports/template')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modèle XLSX d’import de comptes' })
  template(@Res() response: Response) {
    const { buffer, filename } = this.imports.template();
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.end(buffer);
  }

  @Post('imports/preview')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Analyse un fichier d’import sans rien créer' })
  preview(
    @UploadedFile()
    file: {
      originalname: string;
      buffer: Buffer;
      size: number;
      mimetype: string;
    },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.imports.preview(file, actor);
  }

  @Post('imports/:batchId/confirm')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Crée les comptes du lot analysé et invite' })
  confirm(
    @Param('batchId') batchId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.imports.confirm(batchId, actor);
  }

  @Post('request-access')
  @HttpCode(200)
  @ApiOperation({ summary: 'Demande d’activation depuis l’écran de connexion' })
  requestAccess(@Body() body: { email: string }) {
    return this.users.requestAccess(body.email ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fiche détaillée d’un compte' })
  detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.detail(id, actor);
  }

  // Le superviseur cree les comptes comme l'administrateur ; le service
  // applique ensuite qui peut attribuer quel role.
  @Post()
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Crée un compte (invitation ou accès immédiat)' })
  create(@Body() body: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.create(body, actor);
  }

  @Patch(':id')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Met à jour une fiche de compte' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.update(id, body as Record<string, unknown>, actor);
  }

  /**
   * Le corps est recu **non type** : `UsersService.setStatus` applique
   * `readEnabled`, qui accepte les formes courantes (`true`, `"false"`, `0`…) et
   * refuse tout le reste par un 400. Un DTO `@IsBoolean()` en amont
   * transformerait un rejet légitime en simple erreur de validation, sans
   * message métier — et surtout sans garantie sur le comportement.
   */
  @Patch(':id/status')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Active, désactive ou réactive un compte' })
  status(
    @Param('id') id: string,
    @Body() body: { enabled?: unknown; updatedAt?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.setStatus(id, body?.enabled, actor, body?.updatedAt);
  }

  @Post(':id/activate')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Active un compte en attente' })
  activate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.activate(id, actor);
  }

  @Post('invitations/:id/resend')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Renvoie une invitation' })
  resend(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.resendInvitation(id, actor);
  }
}
