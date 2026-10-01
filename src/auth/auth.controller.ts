import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Roles(Role.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer un nouvel utilisateur (Admin uniquement)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activer un compte invité et définir son mot de passe' })
  activate(@Body() dto: ActivateAccountDto) {
    return this.authService.activateAccount(dto);
  }

  @Post('activate-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activer un compte invité (alias)' })
  activateAlias(@Body() dto: ActivateAccountDto) {
    // Alias: the activation screen posts to /auth/activate-account.
    return this.authService.activateAccount(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion utilisateur (génère Access et Refresh Tokens)' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(dto);
    // The frontend keeps the access token in memory and expects the refresh
    // token in an HttpOnly cookie so JavaScript can never read it.
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouveler les Access et Refresh Tokens' })
  async refresh(
    @Req() req: { cookies?: Record<string, string>; headers?: Record<string, unknown> },
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Cookie first (browser flow, empty body), body second (scripts).
    const fromCookie = req.cookies?.[AuthService.REFRESH_COOKIE];
    const session = await this.authService.refreshAccessToken({
      refreshToken: dto.refreshToken || fromCookie || '',
    });
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verifier le temps restant avant expiration de la session en cours' })
  session(@Req() req: { user: { exp: number } }) {
    return this.authService.getSessionStatus(req.user.exp);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Profil de l'utilisateur connecte" })
  me(@Req() req: { user: { id: string } }) {
    // Called by the session watchdog on every visibility change to refresh
    // the cached role/profile. Returns { user } as the frontend expects.
    return this.authService.me(req.user.id);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Déconnexion et révocation des tokens de la session utilisateur' })
  async logout(
    @Req() req: { user: { id: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(req.user.id);
    // Clearing the cookie is what actually ends the browser session.
    res.clearCookie(AuthService.REFRESH_COOKIE, this.refreshCookieOptions());
    return result;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demande de réinitialisation de mot de passe' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réinitialisation du mot de passe avec le token reçu par e-mail' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('invitations/:id/resend')
  @Roles(Role.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Renvoyer l'invitation d'un compte en attente" })
  resendInvitation(@Param('id') id: string) {
    return this.authService.resendInvitation(id);
  }

  // ============================================================
  // Refresh-token cookie helpers
  // ============================================================

  /** Cookie attributes shared by the set and clear paths. */
  private refreshCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    };
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(AuthService.REFRESH_COOKIE, token, {
      ...this.refreshCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000, // aligns with the 7-day refresh TTL
    });
  }
}