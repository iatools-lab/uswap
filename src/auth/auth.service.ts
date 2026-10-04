import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { EmailService } from './email.service';

@Injectable()
export class AuthService {
  private static readonly BCRYPT_ROUNDS = 12;
  private static readonly REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
  private static readonly INVITATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
  private static readonly ACCESS_TOKEN_TTL_SECONDS =
    Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 900;
  private static readonly GENERIC_RESET_MESSAGE =
    'Si cette adresse e-mail correspond à un compte, un lien de réinitialisation a été envoyé.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);

    if (dto.role === 'ADMIN') {
      const existingAdmin = await this.prisma.user.findFirst({
        where: { role: 'ADMIN' },
      });
      if (existingAdmin) {
        throw new BadRequestException('Un compte administrateur existe déjà');
      }
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new BadRequestException('Cet e-mail est déjà utilisé');
    }

    // The UI sends `accountStatus`; `sendInvite` is the legacy switch. Both
    // mean "create an inactive account that must be activated by e-mail".
    const wantsInvitation = dto.sendInvite || dto.accountStatus === 'PENDING';

    if (wantsInvitation) {
      const placeholderPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        AuthService.BCRYPT_ROUNDS,
      );
      const invitationToken = this.generateOpaqueToken(32);
      const invitationTokenHash = this.hashToken(invitationToken);
      const invitationTokenExpires = new Date(
        Date.now() + AuthService.INVITATION_TOKEN_TTL_MS,
      );

      const user = await this.prisma.user.create({
        data: {
          email,
          password: placeholderPassword,
          fullName: dto.fullName.trim(),
          role: dto.role,
          stationId: dto.stationId,
          phoneNumber: dto.phoneNumber,
          address: dto.address,
          isActive: false,
          invitationTokenHash,
          invitationTokenExpires,
        },
      });

      const invitationSent = await this.emailService.sendInvitation(
        user.email,
        invitationToken,
        user.id,
      );

      // Si aucun fournisseur e-mail n'est configuré, l'administrateur doit
      // pouvoir transmettre le lien lui-même : on le renvoie alors dans la
      // réponse. En production il est omis, pour ne
      // jamais exposer un jeton d'activation. Réinitialisez toujours un mot de passe.
      const activationUrl = invitationSent
        ? undefined
        : `${(process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/auth/activate?token=${encodeURIComponent(invitationToken)}`;

      return {
        ...this.sanitizeUser(user),
        invitationSent,
        ...(activationUrl ? { activationUrl } : {}),
        message: invitationSent
          ? 'Utilisateur créé. Une invitation lui a été envoyée.'
          : 'Utilisateur créé. Le service e-mail n’est pas configuré : transmettez le lien d’activation affiché ci-dessous.',
      };
    }

    if (!dto.password) {
      throw new BadRequestException(
        'Le mot de passe est requis lorsque sendInvite est désactivé',
      );
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      AuthService.BCRYPT_ROUNDS,
    );
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName: dto.fullName.trim(),
        role: dto.role,
        stationId: dto.stationId,
        phoneNumber: dto.phoneNumber,
        address: dto.address,
        isActive: true,
      },
    });

    return this.sanitizeUser(user);
  }

  async activateAccount(dto: ActivateAccountDto) {
    const invitationTokenHash = this.hashToken(dto.token);
    const user = await this.prisma.user.findFirst({
      where: {
        invitationTokenHash,
        invitationTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Lien invalide ou expiré');
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      AuthService.BCRYPT_ROUNDS,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          isActive: true,
          disabledAt: null,
          invitationTokenHash: null,
          invitationTokenExpires: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    return {
      message: 'Compte activé avec succès. Vous pouvez vous connecter.',
    };
  }

  /**
   * Current profile, used by the session watchdog (/auth/me).
   */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        phoneNumber: true,
        address: true,
        isActive: true,
        stationId: true,
        station: { select: { name: true } },
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Compte introuvable');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Compte inactif. Veuillez contacter votre administrateur.',
      );
    }

    return {
      user: {
        ...user,
        stationName: user.station?.name ?? null,
        station: undefined,
      },
    };
  }

  /**
   * Re-issues an invitation for an account that is still inactive.
   */
  async resendInvitation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    if (user.isActive) {
      throw new BadRequestException(
        'Ce compte est deja actif, aucune invitation a renvoyer.',
      );
    }

    const invitationToken = this.generateOpaqueToken(32);
    const invitationTokenHash = this.hashToken(invitationToken);
    const invitationTokenExpires = new Date(
      Date.now() + AuthService.INVITATION_TOKEN_TTL_MS,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { invitationTokenHash, invitationTokenExpires },
    });

    const invitationSent = await this.emailService.sendInvitation(
      user.email,
      invitationToken,
      user.id,
    );

    const activationUrl = invitationSent
      ? undefined
      : `${(process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/auth/activate?token=${encodeURIComponent(invitationToken)}`;

    return {
      message: invitationSent
        ? 'Invitation renvoyee.'
        : 'Invitation regeneree. Le service e-mail n’est pas configuré : transmettez le lien ci-dessous.',
      invitationSent,
      ...(activationUrl ? { activationUrl } : {}),
    };
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { station: { select: { name: true } } },
    });

    if (!user) {
      await this.recordLoginAttempt(email, false);
      throw new UnauthorizedException('Identifiants invalides');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      await this.recordLoginAttempt(email, false);
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!user.isActive) {
      await this.recordLoginAttempt(email, false);
      throw new UnauthorizedException(
        'Compte inactif. Veuillez contacter votre administrateur.',
      );
    }

    await this.recordLoginAttempt(email, true);
    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: AuthService.ACCESS_TOKEN_TTL_SECONDS,
      sessionExpiresAt: this.sessionExpiresAt(user),
      idleTimeoutSeconds: AuthService.ACCESS_TOKEN_TTL_SECONDS,
      absoluteExpiresAt: new Date(
        Date.now() + AuthService.REFRESH_TOKEN_TTL_MS,
      ).toISOString(),
      user: this.toSessionUser(user),
    };
  }

  async refreshAccessToken(dto: RefreshTokenDto) {
    const tokenHash = this.hashToken(dto.refreshToken ?? '');
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken || storedToken.expiresAt <= new Date()) {
      if (storedToken) {
        await this.prisma.refreshToken
          .delete({ where: { id: storedToken.id } })
          .catch(() => undefined);
      }
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: storedToken.userId },
      include: { station: { select: { name: true } } },
    });
    if (!user || !user.isActive) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: storedToken.userId },
      });
      throw new UnauthorizedException('Compte introuvable ou inactif');
    }

    const deleted = await this.prisma.refreshToken.deleteMany({
      where: { id: storedToken.id, tokenHash },
    });
    if (deleted.count !== 1) {
      throw new UnauthorizedException('Refresh token déjà utilisé ou révoqué');
    }

    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: AuthService.ACCESS_TOKEN_TTL_SECONDS,
      sessionExpiresAt: this.sessionExpiresAt(user),
      idleTimeoutSeconds: AuthService.ACCESS_TOKEN_TTL_SECONDS,
      absoluteExpiresAt: new Date(
        Date.now() + AuthService.REFRESH_TOKEN_TTL_MS,
      ).toISOString(),
      user: this.toSessionUser(user),
    };
  }

  async logout(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);

    return { message: 'Déconnexion réussie' };
  }

  getSessionStatus(exp: number) {
    const expiresAt = new Date(exp * 1000);
    const expiresInSeconds = Math.max(
      0,
      Math.round((expiresAt.getTime() - Date.now()) / 1000),
    );

    return {
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds,
    };
  }

  /**
   * The shape the frontend stores as its session user. `stationName` is
   * resolved through the relation so the header can show the station without
   * a second round-trip.
   */
  private toSessionUser(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    stationId: string | null;
    station?: { name: string } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      stationId: user.stationId,
      stationName: user.station?.name ?? null,
    };
  }

  /** Hard deadline of the current access token, as an ISO string. */
  private sessionExpiresAt(user: { id: string }): string {
    const token = this.issueAccessToken(user as never);
    const decoded = this.jwtService.decode(token);
    const exp =
      decoded?.exp ??
      Math.floor(Date.now() / 1000) + AuthService.ACCESS_TOKEN_TTL_SECONDS;
    return new Date(exp * 1000).toISOString();
  }

  /** Refresh-token cookie name shared with the controller. */
  static readonly REFRESH_COOKIE = 'uswap_refresh';

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      return { message: AuthService.GENERIC_RESET_MESSAGE };
    }

    const resetToken = this.generateOpaqueToken(32);
    const resetTokenHash = this.hashToken(resetToken);
    const resetTokenExpires = new Date(
      Date.now() + AuthService.RESET_TOKEN_TTL_MS,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash, resetTokenExpires },
    });

    const sent = await this.emailService.sendPasswordReset(
      user.email,
      resetToken,
      user.id,
    );
    if (!sent) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { resetTokenHash: null, resetTokenExpires: null },
      });
    }

    return { message: AuthService.GENERIC_RESET_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetTokenHash = this.hashToken(dto.token);
    const user = await this.prisma.user.findFirst({
      where: {
        resetTokenHash,
        resetTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Token invalide ou expiré');
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      AuthService.BCRYPT_ROUNDS,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetTokenHash: null,
          resetTokenExpires: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    return {
      message:
        'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.',
    };
  }

  private issueAccessToken(user: {
    id: string;
    email: string;
    role: string;
    tokenVersion: number;
  }) {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const refreshToken = this.generateOpaqueToken(40);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        userId,
        expiresAt: new Date(Date.now() + AuthService.REFRESH_TOKEN_TTL_MS),
      },
    });
    return refreshToken;
  }

  private async recordLoginAttempt(email: string, success: boolean) {
    await this.prisma.loginAttempt.create({ data: { email, success } });
  }

  private generateOpaqueToken(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private sanitizeUser(user: any) {
    const {
      password,
      resetTokenHash,
      resetTokenExpires,
      invitationTokenHash,
      invitationTokenExpires,
      tokenVersion,
      ...safeUser
    } = user;
    void password;
    void resetTokenHash;
    void resetTokenExpires;
    void invitationTokenHash;
    void invitationTokenExpires;
    void tokenVersion;
    return safeUser;
  }
}
