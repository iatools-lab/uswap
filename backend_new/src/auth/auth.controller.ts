import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PasswordsService, SessionsService } from './passwords.service';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { UsersService } from '../users/users.service';
import { serializeUser } from '../common/serializers';
import {
  CurrentUser,
  Public,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { DomainException, ErrorCode } from '../common/errors/domain-errors';
import { Role } from '../common/enums';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { GoogleAuthService } from './google-auth.service';



class LoginDto {
  @IsEmail({}, { message: 'Renseignez une adresse e-mail valide.' })
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

class ForgotPasswordDto {
  @IsEmail({}, { message: 'Renseignez une adresse e-mail valide.' })
  email!: string;
}

class VerifyTokenDto {
  @IsString()
  @Length(64, 64, { message: 'Ce lien est incomplet ou a expiré.' })
  token!: string;
}

class TokenPasswordDto {
  @IsString()
  @Length(64, 64, { message: 'Ce lien est incomplet ou a expiré.' })
  token!: string;

  @IsString()
  password!: string;
}

/** Changement de mot de passe par le titulaire du compte. */
class ChangePasswordDto {
  /** Facultatif : le profil ne demande plus l'ancien mot de passe. */
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @Length(8, 200, {
    message: 'Le nouveau mot de passe doit faire au moins 8 caractères.',
  })
  newPassword!: string;
}

/** Vérification du mot de passe courant, sans modification. */
class VerifyPasswordDto {
  @IsString()
  @Length(1, 200, { message: 'Indiquez votre mot de passe actuel.' })
  password!: string;
}

/** Jeton d'identité fourni par Google Identity Services. */
class GoogleLoginDto {
  @IsString()
  @Length(20, 5000, { message: 'Jeton Google invalide.' })
  idToken!: string;
}

/** Segment d'URL de chaque rôle sur les routes de connexion. */
const LOGIN_ROLES = ['superadmin', 'admin', 'supervisor', 'swapper'] as const;
type LoginRoleSegment = (typeof LOGIN_ROLES)[number];

/** Rôle attendu par chaque route de connexion. */
const LOGIN_SEGMENT_ROLE: Record<LoginRoleSegment, Role> = {
  superadmin: Role.SUPER_ADMIN,
  admin: Role.ADMIN,
  supervisor: Role.SUPERVISOR,
  swapper: Role.SWAPPER,
};



/**
 * Authentification, session et parcours de securite.
 *
 * Le refresh token vit dans un cookie HttpOnly : le frontend ne le lit jamais
 * et ne stocke donc aucun secret durable. Le jeton d'acces, court, est renvoye
 * dans le corps de la reponse.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('AuthController');

  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordsService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly users: UsersService,
    private readonly google: GoogleAuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion par e-mail et mot de passe' })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Route historique : conservée pour les clients existants. Le rôle n'y est
    // pas imposé ; les applications utilisent `login/:role`.
    return this.authenticate(body, request, response);
  }

  /**
   * Connexion propre à un rôle.
   *
   *   POST /auth/login/superadmin | admin | supervisor | swapper
   *
   * Un compte dont le rôle ne correspond pas à la route est refusé (403)
   * même si ses identifiants sont corrects : le frontend d'un rôle ne peut
   * pas ouvrir une session destinée à un autre. Le message ne précise jamais
   * le rôle réel du compte (pas de fuite d'information).
   */
  @Public()
  @Post('login/:role')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion par rôle (superadmin, admin, supervisor, swapper)' })
  async loginAsRole(
    @Param('role') role: string,
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const segment = role.trim().toLowerCase() as LoginRoleSegment;
    if (!LOGIN_ROLES.includes(segment)) {
      throw new DomainException(
        ErrorCode.VALIDATION,
        'Cette page de connexion n’existe pas.',
        404,
      );
    }
    return this.authenticate(body, request, response, LOGIN_SEGMENT_ROLE[segment]);
  }

  // L'inscription publique du super administrateur n'existe plus : le premier
  // compte est créé lors du déploiement (voir `prisma/bootstrap.ts` et
  // `deploy/README_DOCKER.md`). Toute création ultérieure passe par un super
  // administrateur authentifié.

  /** Societe de connexion commune a `/auth/login` et `/auth/login/:role`. */
  private async authenticate(
    body: LoginDto,
    request: Request,
    response: Response,
    expectedRole?: Role,
  ) {
    const email = body.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Reponse uniforme : on ne revele pas si l'adresse existe.
    if (!user) {
      throw new DomainException(
        ErrorCode.INVALID_CREDENTIALS,
        'Identifiants invalides ou session expirée.',
        401,
      );
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new DomainException(
        ErrorCode.ACCOUNT_LOCKED,
        'Trop de tentatives infructueuses. Réessayez plus tard.',
        429,
      );
    }

    const valid = await this.passwords.verify(body.password, user.passwordHash);
    if (!valid) {
      const attempt = await this.tokens.registerFailedAttempt(user.id);
      throw new DomainException(
        attempt.locked
          ? ErrorCode.ACCOUNT_LOCKED
          : ErrorCode.INVALID_CREDENTIALS,
        attempt.locked
          ? 'Compte temporairement verrouillé après plusieurs échecs.'
          : 'Identifiants invalides ou session expirée.',
        attempt.locked ? 429 : 401,
      );
    }

    if (user.disabledAt) {
      throw new DomainException(
        ErrorCode.ACCOUNT_DISABLED,
        'Ce compte est désactivé. Contactez votre administrateur.',
        403,
      );
    }
    if (!user.isActive) {
      throw new DomainException(
        ErrorCode.ACCESS_DENIED,
        "Ce compte n'est pas encore activé. Ouvrez le lien reçu par e-mail.",
        403,
      );
    }

    if (expectedRole && user.role !== expectedRole) {
      // Meme statut qu'un refus de droit, message neutre : l'utilisateur ne
      // doit pas apprendre le role réel du compte par cette route.
      throw new DomainException(
        ErrorCode.ROLE_NOT_ALLOWED,
        'Ce compte ne peut pas se connecter depuis cette page.',
        403,
      );
    }

    await this.tokens.clearFailedAttempts(user.id);
    return this.startSession(user.id, request, response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Renouvelle la session a partir du cookie HttpOnly' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.readRefreshCookie(request);
    if (!token) throw this.expired();
    const stored = await this.tokens.find(token);
    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      await this.clearCookie(response);
      throw this.expired();
    }
    if (stored.user.disabledAt || !stored.user.isActive) {
      await this.tokens.revokeAll(stored.user.id);
      await this.clearCookie(response);
      throw new DomainException(
        stored.user.disabledAt
          ? ErrorCode.ACCOUNT_DISABLED
          : ErrorCode.ACCESS_DENIED,
        stored.user.disabledAt
          ? 'Ce compte est désactivé.'
          : "Ce compte n'est pas encore activé.",
        403,
      );
    }

    // Rotation : l'ancien jeton est remplace, jamais reutilise.
    await this.tokens.revokeById(stored.id);
    return this.startSession(stored.userId, request, response);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ferme la session courante' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.readRefreshCookie(request);
    if (token) await this.tokens.revoke(token);
    await this.clearCookie(response);
    return { ok: true };
  }

  /**
   * Changement de mot de passe par le titulaire du compte.
   *
   * L'ancien mot de passe est EXIGÉ : un jeton d'accès volé ne suffit donc pas
   * à verrouiller le propriétaire hors de son propre compte. Toutes les autres
   * sessions sont révoquées (`tokenVersion`), comme lors d'une
   * réinitialisation.
   */
  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change le mot de passe du compte connecté' })
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.users.changeOwnPassword(user.id, body);
    return { ok: true };
  }

  /**
   * Vérifie le mot de passe du compte connecté, sans rien modifier.
   *
   * Permet à l'écran de profil d'exiger le mot de passe ACTUEL avant
   * d'afficher le formulaire de changement : une session laissée ouverte ne
   * suffit donc pas à prendre la main sur le compte.
   */
  @Post('verify-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Vérifie le mot de passe du compte connecté' })
  async verifyPassword(
    @Body() body: VerifyPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.users.verifyOwnPassword(user.id, body.password);
    return { ok: true };
  }

  /**
   * Renvoie le mot de passe du compte connecté à son titulaire.
   *
   * Demande explicite du profil : le mot de passe est visible AVANT que
   * l'utilisateur décide de le modifier ou non. Il n'est jamais exposé par les
   * routes d'administration — seul le titulaire de la session y accède.
   *
   * La valeur stockée étant un condensat (non réversible), le service la
   * déchiffre s'il détient une copie chiffrée ; sinon il renvoie le condensat
   * masqué, avec l'indication que le mot de passe ne peut pas être affiché.
   */
  @Get('own-password')
  @ApiOperation({ summary: 'Mot de passe du compte connecté (titulaire)' })
  async ownPassword(@CurrentUser() user: AuthenticatedUser) {
    const password = await this.users.revealOwnPassword(user.id);
    return { password };
  }

  /**
   * Connexion par Google (SSO) — réservée aux comptes professionnels uPowa.
   *
   * Le frontend transmet l'`id_token` fourni par Google Identity Services.
   * Le jeton est vérifié auprès de Google, puis :
   *   1. le domaine de l'adresse doit figurer dans `GOOGLE_ALLOWED_DOMAINS`
   *      (`upowa.org`) — un Gmail personnel est refusé ;
   *   2. le compte doit déjà exister localement et être actif.
   *
   * Aucun compte n'est créé automatiquement : un utilisateur Google inconnu
   * reçoit un refus. Cela évite qu'une adresse valide ouvre un accès sans
   * qu'un administrateur l'ait décidé.
   */
  @Public()
  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion Google (domaines uPowa uniquement)' })
  async loginWithGoogle(
    @Body() body: GoogleLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.google.enabled()) {
      throw new DomainException(
        ErrorCode.VALIDATION,
        'La connexion Google n’est pas configurée sur ce serveur.',
        400,
      );
    }

    const identity = await this.google.verify(body.idToken ?? '');
    if (!identity) {
      throw new DomainException(
        ErrorCode.INVALID_CREDENTIALS,
        'Connexion Google refusée. Réessayez depuis votre compte professionnel.',
        401,
      );
    }

    // Domaine autorisé uniquement.
    const domain = identity.email.split('@')[1] ?? '';
    const allowed = this.config.get('googleAllowedDomains', { infer: true });
    if (!allowed.includes(domain)) {
      throw new DomainException(
        ErrorCode.ROLE_NOT_ALLOWED,
        `Seuls les comptes @${allowed.join(', @')} peuvent se connecter par Google.`,
        403,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: identity.email },
    });
    if (!user) {
      throw new DomainException(
        ErrorCode.INVALID_CREDENTIALS,
        'Aucun compte uSwap n’est associé à cette adresse. Contactez votre administrateur.',
        401,
      );
    }
    if (user.disabledAt || !user.isActive) {
      throw new DomainException(
        ErrorCode.ACCOUNT_DISABLED,
        'Ce compte est désactivé ou non activé.',
        403,
      );
    }

    return this.startSession(user.id, request, response);
  }

  /**
   * Verifie un lien recu par e-mail SANS le consommer.
   *
   * L'ecran `/auth/reset-password?token=...` doit afficher « lien expire ou
   * invalide » avant la saisie du nouveau mot de passe ; sans cette route, le
   * seul moyen de le savoir etait d'envoyer le formulaire et de lire l'erreur.
   */
  @Public()
  @Post('verify-reset-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valide un lien de reinitialisation (sans le consommer)' })
  async verifyResetToken(@Body() body: VerifyTokenDto) {
    const record = await this.auth.findAccessToken(body.token, 'PASSWORD_RESET');
    return {
      ok: true,
      email: record.user.email,
      fullName: record.user.fullName,
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  /** Meme verification pour un lien d'activation de compte. */
  @Public()
  @Post('verify-activation-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valide un lien d’activation (sans le consommer)' })
  async verifyActivationToken(@Body() body: VerifyTokenDto) {
    const record = await this.auth.findAccessToken(body.token, 'ACTIVATION');
    return {
      ok: true,
      email: record.user.email,
      fullName: record.user.fullName,
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  @Public()
  @Get('session')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Restaure la session au chargement de l’application',
  })
  async restore(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.readRefreshCookie(request);
    if (!token) {
      response.status(204);
      return null;
    }
    const stored = await this.tokens.find(token);
    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      await this.clearCookie(response);
      response.status(204);
      return null;
    }
    return this.startSession(stored.userId, request, response, stored.id);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: "Identite et perimetre de l'utilisateur connecte" })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const ctx = await this.scope.serializeContext();
    return { user: serializeUser(record, ctx) };
  }

  /**
   * Création de compte depuis l'écran d'administration.
   *
   * Le formulaire du frontend poste sur `/auth/register` et non `/users` : on
   * expose donc la même logique ici, avec les mêmes règles de rôle.
   */
  @Post('register')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crée un compte (alias de POST /users)' })
  register(
    @Body()
    body: {
      fullName: string;
      email: string;
      role: string;
      stationId?: string | null;
      phoneNumber?: string | null;
      address?: string | null;
      password?: string;
      accountStatus?: string;
      sendInvite?: boolean;
    },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.create(body, actor);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Demande de reinitialisation du mot de passe' })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const email = body.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Meme reponse dans tous les cas : aucune fuite d'information.
    if (user && !user.disabledAt && user.isActive) {
      await this.auth.sendPasswordReset(user).catch((error: unknown) =>
        this.logger.warn(
          `Reinitialisation non envoyee a ${user.email} : ${
            error instanceof Error ? error.message : error
          }`,
        ),
      );
    }
    return { ok: true };
  }

  @Public()
  @Post('activate-account')
  @HttpCode(200)
  @ApiOperation({ summary: "Active un compte via le jeton d'invitation" })
  async activateAccount(
    @Body() body: TokenPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const userId = await this.applyPassword(
      body.token,
      body.password,
      'ACTIVATION',
    );
    return this.startSession(userId, request, response);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Definit un nouveau mot de passe via un lien' })
  async resetPassword(@Body() body: TokenPasswordDto) {
    await this.applyPassword(body.token, body.password, 'PASSWORD_RESET');
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /** Valide le jeton, applique le mot de passe, active le compte si besoin. */
  private async applyPassword(
    raw: string,
    password: string,
    purpose: 'ACTIVATION' | 'PASSWORD_RESET',
  ): Promise<string> {
    const policy = PasswordsService.policy(password);
    if (!policy.valid) {
      throw new DomainException(
        ErrorCode.PASSWORD_POLICY,
        policy.issues[0] ?? 'Mot de passe trop faible.',
      );
    }

    const record = await this.auth.findAccessToken(raw, purpose);
    const passwordHash = await this.passwords.hash(password);

    // La transaction ne doit contenir QUE des ecritures serialisees. Une
    // promesse `prisma.x.create()` simplement construite (mais non attendue)
    // commencait sa requete hors transaction : Prisma la reprenait comme un
    // verrou consultatif (P2024, « Timed out fetching a new connection »), et
    // le reset de mot de passe renvoyait 409.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          ...(purpose === 'ACTIVATION'
            ? {
                isActive: true,
                disabledAt: null,
                invitationStatus: 'ACTIVATED' as const,
                invitationExpiresAt: null,
              }
            : {}),
        },
      }),
      this.prisma.invitationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.accountAudit.create({
        data: {
          userId: record.userId,
          action: purpose === 'ACTIVATION' ? 'ACTIVATED' : 'PASSWORD_RESET',
          actorId: record.userId,
          before: JSON.stringify({
            isActive: purpose === 'ACTIVATION' ? false : record.user.isActive,
          }),
          after: JSON.stringify({ isActive: true, passwordUpdated: true }),
          message:
            purpose === 'ACTIVATION'
              ? "Compte activé par le titulaire de l'invitation."
              : 'Mot de passe réinitialisé via un lien sécurisé.',
        },
      }),
    ]);

    // Toutes les sessions precedentes sont fermees par precaution.
    await this.sessions.revokeAllExcept(record.userId);
    return record.userId;
  }

  private async startSession(
    userId: string,
    request: Request,
    response: Response,
    previousTokenId?: string,
  ) {
    if (!userId) throw this.expired();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw this.expired();

    if (previousTokenId) await this.tokens.revokeAll(userId, previousTokenId);
    const { session, refreshToken } = await this.auth.openSession(user, {
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip ?? null,
    });

    response.cookie(
      this.auth.cookieName(),
      refreshToken,
      this.auth.refreshCookieOptions(),
    );
    return session;
  }

  private readRefreshCookie(request: Request): string | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[this.auth.cookieName()] ?? null;
  }

  private async clearCookie(response: Response) {
    response.clearCookie(this.auth.cookieName(), { path: '/' });
  }

  private expired(): UnauthorizedException {
    return new UnauthorizedException({
      code: ErrorCode.SESSION_EXPIRED,
      message: 'Votre session a expiré. Veuillez vous reconnecter.',
    });
  }
}
