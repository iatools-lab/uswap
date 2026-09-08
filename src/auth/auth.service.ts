import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
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
      const existingAdmin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (existingAdmin) {
        throw new BadRequestException('Un compte administrateur existe déjà');
      }
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('Cet e-mail est déjà utilisé');
    }

    if (dto.sendInvite) {
      const placeholderPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        AuthService.BCRYPT_ROUNDS,
      );
      const invitationToken = this.generateOpaqueToken(32);
      const invitationTokenHash = this.hashToken(invitationToken);
      const invitationTokenExpires = new Date(Date.now() + AuthService.INVITATION_TOKEN_TTL_MS);

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

      const invitationSent = await this.emailService.sendInvitation(user.email, invitationToken);
      return {
        ...this.sanitizeUser(user),
        invitationSent,
        message: invitationSent
          ? 'Utilisateur créé. Une invitation lui a été envoyée.'
          : 'Utilisateur créé, mais le service e-mail n’est pas configuré ou l’envoi a échoué.',
      };
    }

    if (!dto.password) {
      throw new BadRequestException('Le mot de passe est requis lorsque sendInvite est désactivé');
    }

    const hashedPassword = await bcrypt.hash(dto.password, AuthService.BCRYPT_ROUNDS);
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

    const hashedPassword = await bcrypt.hash(dto.password, AuthService.BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          isActive: true,
          invitationTokenHash: null,
          invitationTokenExpires: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    return { message: 'Compte activé avec succès. Vous pouvez vous connecter.' };
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

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
      throw new UnauthorizedException('Compte inactif. Veuillez contacter votre administrateur.');
    }

    await this.recordLoginAttempt(email, true);
    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async refreshAccessToken(dto: RefreshTokenDto) {
    const tokenHash = this.hashToken(dto.refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!storedToken || storedToken.expiresAt <= new Date()) {
      if (storedToken) {
        await this.prisma.refreshToken.delete({ where: { id: storedToken.id } }).catch(() => undefined);
      }
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    const user = await this.prisma.user.findUnique({ where: { id: storedToken.userId } });
    if (!user || !user.isActive) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: storedToken.userId } });
      throw new UnauthorizedException('Compte introuvable ou inactif');
    }

    // Rotation : un refresh token ne peut être utilisé qu'une seule fois.
    const deleted = await this.prisma.refreshToken.deleteMany({
      where: { id: storedToken.id, tokenHash },
    });
    if (deleted.count !== 1) {
      throw new UnauthorizedException('Refresh token déjà utilisé ou révoqué');
    }

    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return { accessToken, refreshToken };
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

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Toujours la même réponse afin de ne pas permettre l'énumération des comptes.
    if (!user || !user.isActive) {
      return { message: AuthService.GENERIC_RESET_MESSAGE };
    }

    const resetToken = this.generateOpaqueToken(32);
    const resetTokenHash = this.hashToken(resetToken);
    const resetTokenExpires = new Date(Date.now() + AuthService.RESET_TOKEN_TTL_MS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash, resetTokenExpires },
    });

    const sent = await this.emailService.sendPasswordReset(user.email, resetToken);
    if (!sent) {
      // Ne laisse pas un token actif si sa livraison a échoué.
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

    const hashedPassword = await bcrypt.hash(dto.password, AuthService.BCRYPT_ROUNDS);

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

    return { message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.' };
  }

  private issueAccessToken(user: { id: string; email: string; role: string; tokenVersion: number }) {
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
