import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AppConfig } from '../config/configuration';
import {
  DomainException,
  ErrorCode,
} from '../common/errors/domain-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { ScopeService } from '../common/scope.service';
import { serializeUser } from '../common/serializers';
import { PasswordsService, SessionsService } from './passwords.service';
import { TokensService } from './tokens.service';
import { randomBytes, createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { User } from '@prisma/client';

export interface SessionResponse {
  user: ReturnType<typeof serializeUser>;
  accessToken: string;
  expiresIn: number;
  sessionExpiresAt: string;
  idleTimeoutSeconds: number;
  absoluteExpiresAt: string;
}

/**
 * Sessions et parcours de securite.
 *
 * - Jeton d'acces court (15 min par defaut) signe en JWT.
 * - Refresh token opaque, conserve **hashe** en base, transmis par cookie
 *   HttpOnly et renouvele (rotation) a chaque appel de `/auth/refresh`.
 * - Jetons d'activation / reinitialisation a usage unique, 64 caracteres,
 *   valeurs valables une seule fois et horodatees.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokensService,
    private readonly passwords: PasswordsService,
    private readonly sessions: SessionsService,
    private readonly scope: ScopeService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Sessions                                                          */
  /* ---------------------------------------------------------------- */

  /** Ouvre une session : cree le refresh token et signe le jeton d'acces. */
  async openSession(
    user: User,
    metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<{ session: SessionResponse; refreshToken: string }> {
    const idleTtl = this.config.get('refreshTtlSeconds', { infer: true });
    const issued = await this.tokens.issue(user.id, idleTtl, metadata);
    const access = await this.signAccessToken({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      stationId: user.stationId,
      sessionId: issued.session.id,
    });

    const idle = this.config.get('sessionIdleSeconds', { infer: true });
    const absolute = this.config.get('sessionAbsoluteSeconds', { infer: true });
    const ctx = await this.scope.serializeContext();

    return {
      session: {
        user: serializeUser(user, ctx),
        accessToken: access.token,
        expiresIn: access.expiresIn,
        sessionExpiresAt: new Date(
          Date.now() + Math.min(idle, absolute) * 1000,
        ).toISOString(),
        idleTimeoutSeconds: idle,
        absoluteExpiresAt: new Date(Date.now() + absolute * 1000).toISOString(),
      },
      refreshToken: issued.token,
    };
  }

  async signAccessToken(payload: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    stationId: string | null;
    sessionId: string;
  }): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.config.get('accessTtlSeconds', { infer: true });
    const token = await this.jwt.signAsync(
      {
        sub: payload.id,
        email: payload.email,
        name: payload.fullName,
        role: payload.role,
        stationId: payload.stationId,
        sid: payload.sessionId,
      },
      {
        secret: this.config.get('jwtSecret', { infer: true }),
        expiresIn,
      },
    );
    return { token, expiresIn };
  }

  /** HttpOnly : le frontend ne lit jamais ce cookie. */
  refreshCookieOptions(): {
    httpOnly: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    secure: boolean;
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      sameSite: this.config.get('cookieSameSite', { infer: true }),
      secure: this.config.get('cookieSecure', { infer: true }),
      path: '/',
      maxAge: this.config.get('refreshTtlSeconds', { infer: true }) * 1000,
    };
  }

  cookieName(): string {
    return this.config.get('refreshCookieName', { infer: true });
  }

  /* ---------------------------------------------------------------- */
  /* Jetons d'invitation et de reinitialisation                        */
  /* ---------------------------------------------------------------- */

  /** Genere un jeton a usage unique et renvoie l'URL complete du frontend. */
  async createAccessToken(
    user: User,
    purpose: 'ACTIVATION' | 'PASSWORD_RESET',
  ): Promise<{ url: string; token: string; expiresAt: Date }> {
    const settings = await this.prisma.globalSettings.findUnique({
      where: { id: 'global' },
    });
    const validityHours: number =
      settings?.invitationValidityHours ??
      this.config.get('invitationValidityHours', { infer: true });

    const raw = randomBytes(32).toString('hex'); // 64 caracteres hexadecimales
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + validityHours * 3_600_000);

    await this.prisma.invitationToken.create({
      data: {
        token: raw,
        tokenHash,
        userId: user.id,
        purpose,
        expiresAt,
      },
    });

    const path =
      purpose === 'ACTIVATION'
        ? '/auth/activate'
        : '/auth/reset-password';
    const url = `${this.config.get('publicAppUrl', { infer: true })}${path}?token=${raw}`;
    return { url, token: raw, expiresAt };
  }

  /** Cherche un jeton valide (non utilise, non expire) sans le consommer. */
  async findAccessToken(
    raw: string,
    purpose: 'ACTIVATION' | 'PASSWORD_RESET',
  ) {
    if (!/^[a-f0-9]{64}$/.test(raw)) {
      throw new DomainException(
        ErrorCode.INVALID_TOKEN,
        'Ce lien est incomplet ou a expiré. Demandez-en un nouveau.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const record = await this.prisma.invitationToken.findUnique({
      where: { token: raw },
      include: { user: true },
    });
    if (
      !record ||
      record.purpose !== purpose ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new DomainException(
        ErrorCode.INVALID_TOKEN,
        'Ce lien est incomplet ou a expiré. Demandez-en un nouveau.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return record;
  }

  async markAccessTokenUsed(id: string): Promise<void> {
    await this.prisma.invitationToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Invitations                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Envoie (ou renvoie) l'invitation d'un compte et met a jour son etat.
   * Le lien est personnel et a usage unique.
   */
  async sendInvitation(
    userId: string,
    options: { resend?: boolean } = {},
  ): Promise<{ url: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new DomainException(
        ErrorCode.NOT_FOUND,
        'Compte introuvable.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (user.isActive && !options.resend) {
      throw new DomainException(
        ErrorCode.CONFLICT,
        'Ce compte est déjà activé.',
        HttpStatus.CONFLICT,
      );
    }

    const { url, expiresAt } = await this.createAccessToken(user, 'ACTIVATION');
    const station = user.stationId
      ? await this.prisma.station.findUnique({
          where: { id: user.stationId },
          select: { name: true },
        })
      : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        invitationStatus: 'SENT',
        invitationSentAt: new Date(),
        invitationExpiresAt: expiresAt,
      },
    });

    await this.notifications
      .sendMail(user.email, 'INVITATION', {
        fullName: user.fullName,
        roleLabel: this.roleLabel(user.role),
        stationName: station?.name ?? '',
        url,
        expiresAt: expiresAt.toLocaleString('fr-FR'),
        appUrl: this.config.get('publicAppUrl', { infer: true }),
      })
      .catch((error: unknown) => {
        // Un e-mail indisponible ne doit pas empecher la creation du compte.
        this.logger.warn(
          `Invitation non envoyee a ${user.email} : ${
            error instanceof Error ? error.message : error
          }`,
        );
        return this.prisma.user.update({
          where: { id: userId },
          data: { invitationStatus: 'FAILED' },
        });
      });

    return { url, expiresAt };
  }

  async sendPasswordReset(user: User): Promise<void> {
    const { url, expiresAt } = await this.createAccessToken(
      user,
      'PASSWORD_RESET',
    );
    await this.notifications.sendMail(user.email, 'PASSWORD_RESET', {
      fullName: user.fullName,
      url,
      expiresAt: expiresAt.toLocaleString('fr-FR'),
      appUrl: this.config.get('publicAppUrl', { infer: true }),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Maintenance                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Repare l'acces administrateur, comme la maquette frontend : un compte
   * administrateur ne doit jamais rester inaccessible apres une remise a zero.
   * Le changement est journalise.
   */
  async ensureAdminAccess(password: string): Promise<void> {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) return;
    if (admin.isActive && !admin.disabledAt) return;

    await this.prisma.user.update({
      where: { id: admin.id },
      data: {
        isActive: true,
        disabledAt: null,
        passwordHash: await this.passwords.hash(password),
        invitationStatus: 'ACTIVATED',
        invitationExpiresAt: null,
      },
    });
    await this.prisma.accountAudit.create({
      data: {
        userId: admin.id,
        action: 'REACTIVATED',
        before: JSON.stringify({ isActive: false }),
        after: JSON.stringify({ isActive: true, passwordUpdated: true }),
        message: 'Acces administrateur restaure automatiquement.',
      },
    });
    this.logger.warn(`Acces administrateur restaure pour ${admin.email}.`);
  }

  private roleLabel(role: string): string {
    const labels: Record<string, string> = {
      ADMIN: 'Administrateur',
      SUPERVISOR: 'Superviseur',
      SWAPPER: 'Agent',
    };
    return labels[role] ?? role;
  }
}
