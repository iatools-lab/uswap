import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.role === 'ADMIN') {
      const existingAdmin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (existingAdmin) {
        throw new BadRequestException('Un compte administrateur existe deja');
      }
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Cet email est deja utilise');
    }

    if (dto.sendInvite) {
      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const invitationTokenHash = crypto.createHash('sha256').update(invitationToken).digest('hex');
      const invitationTokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: placeholderPassword,
          fullName: dto.fullName,
          role: dto.role,
          stationId: dto.stationId,
          phoneNumber: dto.phoneNumber,
          address: dto.address,
          isActive: false,
          invitationTokenHash,
          invitationTokenExpires,
        },
      });

      const { password, resetTokenHash, resetTokenExpires, invitationTokenHash: _hash, ...result } = user;
      return { ...result, invitationToken };
    }

    if (!dto.password) {
      throw new BadRequestException('Le mot de passe est requis lorsque sendInvite est desactive');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        fullName: dto.fullName,
        role: dto.role,
        stationId: dto.stationId,
        phoneNumber: dto.phoneNumber,
        address: dto.address,
        isActive: true,
      },
    });

    const { password, resetTokenHash, resetTokenExpires, ...result } = user;
    return result;
  }

  async activateAccount(dto: ActivateAccountDto) {
    const invitationTokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        invitationTokenHash,
        invitationTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Lien invalide ou expire');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isActive: true,
        invitationTokenHash: null,
        invitationTokenExpires: null,
      },
    });

    return { message: 'Compte active avec succes. Vous pouvez vous connecter.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      await this.prisma.loginAttempt.create({
        data: { email: dto.email, success: false },
      });
      throw new UnauthorizedException('Identifiants invalides');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      await this.prisma.loginAttempt.create({
        data: { email: dto.email, success: false },
      });
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Compte inactif. Veuillez contacter votre administrateur.');
    }

    await this.prisma.loginAttempt.create({
      data: { email: dto.email, success: true },
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    const refreshTokenValue = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async refreshAccessToken(dto: RefreshTokenDto) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: dto.refreshToken },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalide ou expire');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: storedToken.userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Compte introuvable ou inactif');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken };
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
    return { message: 'Deconnexion reussie' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      return { message: 'Si cet email existe, un token de reinitialisation a ete genere.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash,
        resetTokenExpires,
      },
    });

    return {
      message: 'Token de reinitialisation genere avec succes',
      resetToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetTokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        resetTokenHash,
        resetTokenExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Token invalide ou expire');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetTokenHash: null,
        resetTokenExpires: null,
      },
    });

    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id },
    });

    return { message: 'Mot de passe reinitialise avec succes. Vous pouvez vous connecter.' };
  }
}