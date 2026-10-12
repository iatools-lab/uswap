import {
  Injectable,
  NestMiddleware,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainException, ErrorCode } from '../errors/domain-errors';
import {
  AuthenticatedUser,
  PUBLIC_KEY,
} from '../guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../../config/configuration';

interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: string;
}

/**
 * Lit le jeton d'acces (Authorization: Bearer) et charge l'utilisateur.
 *
 * Le middleware ne rejette pas les requetes non authentifiees : ce sont les
 * guards `RolesGuard` / `SessionGuard` qui decident, afin que les routes
 * publiques restent accessibles et que le client recoive un 401 homogene.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly reflector: Reflector,
  ) {}

  async use(
    request: Request & {
      user?: AuthenticatedUser;
      __publicRoute?: boolean;
    },
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();

    const token = header.slice('Bearer '.length).trim();
    if (!token) return next();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('jwtSecret', { infer: true }),
      });
    } catch {
      throw new DomainException(
        ErrorCode.SESSION_EXPIRED,
        'Votre session a expiré. Veuillez vous reconnecter.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        stationId: true,
        isActive: true,
        disabledAt: true,
      },
    });

    if (!user) {
      throw new DomainException(
        ErrorCode.SESSION_REVOKED,
        'Votre session a été fermée. Veuillez vous reconnecter.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.disabledAt) {
      throw new DomainException(
        ErrorCode.ACCOUNT_DISABLED,
        'Ce compte est désactivé. Contactez votre administrateur.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!user.isActive) {
      throw new DomainException(
        ErrorCode.ACCOUNT_DISABLED,
        "Ce compte n'est pas encore activé. Ouvrez le lien reçu par e-mail.",
        HttpStatus.FORBIDDEN,
      );
    }

    request.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as AuthenticatedUser['role'],
      stationId: user.stationId,
      sessionId: payload.sid,
    };
    next();
  }
}
