import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainException, ErrorCode } from '../errors/domain-errors';
import {
  CONTROLLER_SPACES,
  ROLE_SPACE,
  SPACE_ALLOWED_ROLES,
  readRoleRoute,
} from '../routing/role-route';
import { AuthenticatedUser } from './roles.guard';

/**
 * Contrôle d'accès des routes métier préfixées par espace de travail.
 *
 * Complète `RolesGuard` sans le remplacer :
 *   - `/pilot/...`       réservé aux administrateurs (et super administrateurs) ;
 *   - `/supervision/...` superviseurs, administrateurs, super administrateurs ;
 *   - `/agent/...`       tous les rôles authentifiés ;
 *   - `/superadmin/...`  super administrateurs.
 *
 * Un agent qui appelle `/pilot/users` reçoit 403 même si la route existe :
 * le préfixe n'est pas décoratif. Le rôle vient de la base (SessionMiddleware),
 * jamais du client.
 *
 * Les routes explicitement `@RoleRoute('PUBLIC')` (connexion, inscription
 * initiale) ne sont pas contrôlées ici : leur logique propre décide.
 */
@Injectable()
export class RoleRouteAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { space, state } = readRoleRoute(this.reflector, context);
    if (!space || state === 'PUBLIC') return true;

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

    const allowed = SPACE_ALLOWED_ROLES[space];
    if (!allowed.includes(user.role)) {
      throw new DomainException(
        ErrorCode.ROLE_NOT_ALLOWED,
        "Cet espace de travail n'est pas accessible avec votre rôle.",
        HttpStatus.FORBIDDEN,
      );
    }

    // Contrôleurs déjà appartenant à cet espace (union des contrôleurs
    // déclarés dans l'espace et de ceux que ses rôles peuvent atteindre) :
    // aucun n'est commun à tous les espaces, la liste est donc complète.
    const owners = CONTROLLER_SPACES[space] ?? [];
    for (const role of allowed) {
      const workspace = ROLE_SPACE[role];
      if (workspace === space) continue;
      for (const controller of CONTROLLER_SPACES[workspace] ?? []) {
        if (!owners.includes(controller)) owners.push(controller);
      }
    }

    // Le contrôleur n'appartient à aucun d'eux : l'URL peut exister
    // techniquement (elle l'est pour toutes les combinaisons espace ×
    // contrôleur), mais la fonction n'y est pas proposée. On répond alors
    // 404 — message neutre, qui ne révèle ni les espaces ni les rôles.
    const controller = context.getClass().name;
    if (owners.length > 0 && !owners.includes(controller)) {
      throw new DomainException(
        ErrorCode.NOT_FOUND,
        'Cette fonctionnalité n’est pas disponible dans cet espace.',
        HttpStatus.NOT_FOUND,
      );
    }
    return true;
  }
}


