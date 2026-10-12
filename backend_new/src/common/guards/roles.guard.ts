import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { HttpStatus } from '@nestjs/common';
import { Role } from '../enums';
import { DomainException, ErrorCode } from '../errors/domain-errors';

export const ROLES_KEY = 'uswap:roles';
export const PUBLIC_KEY = 'uswap:public';

/** Marque une route comme accessible sans session (login, mot de passe oublie). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Restreint une route a certains roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Utilisateur authentifie, expose par le guard d'acces. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  stationId: string | null;
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new DomainException(
        ErrorCode.UNAUTHENTICATED,
        'Session absente ou expirée.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return request.user;
  },
);

export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | null => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user ?? null;
  },
);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new DomainException(
        ErrorCode.UNAUTHENTICATED,
        'Session absente ou expirée.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!required.includes(user.role)) {
      throw new DomainException(
        ErrorCode.ROLE_NOT_ALLOWED,
        'Vous ne disposez pas des droits nécessaires pour cette action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
