import { Injectable } from '@nestjs/common';
import type { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { PasswordsService } from '../auth/passwords.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  serializeDetail,
  serializeMember,
  serializeUser,
  memberStatus,
} from '../common/serializers';
import {
  ConflictDomain,
  ErrorCode,
  ForbiddenDomain,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import {
  roleSatisfies,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Roles principaux de la plateforme. */
const ROLE_NAMES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SWAPPER'];

/**
 * Qui peut attribuer quel role ?
 *
 * - **Super administrateur** : tous les roles, y compris le sien.
 * - **Administrateur** : administrateurs, superviseurs et agents — jamais de
 *   super administrateur.
 * - **Superviseur** : tous les roles (il gere les comptes), y compris le
 *   super administrateur, avec les memes controles que l'administrateur sur
 *   les comptes de niveau superieur.
 */
function canAssignRole(actorRole: Role, target: Role): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  if (actorRole === 'ADMIN') return target !== 'SUPER_ADMIN';
  if (actorRole === 'SUPERVISOR') return true;
  return false;
}

/** Valeur de statut acceptee par l'API (`StatusDto.enabled`). */
function readEnabled(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  // Le DTO de statut n'est pas type : un client peut envoyer
  // `{"enabled": "false"}` ou `{"enabled": 0}`. On refuse uniquement ce qui
  // n'est pas interpretable — jamais transformer un "false" en activation.
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['true', '1', 'on', 'enabled', 'active'].includes(value)) return true;
    if (['false', '0', 'off', 'disabled', 'inactive'].includes(value))
      return false;
  }
  if (typeof raw === 'number') return raw !== 0;
  // Toute autre valeur (« peut-être », objet, tableau…) est refusee : une
  // activation ne doit jamais découler d'une saisie mal formée.
  return null;
}

export interface MemberFilters {
  q?: string;
  role?: string;
  status?: string;
  stationId?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Lecture                                                           */
  /* ---------------------------------------------------------------- */

  /** Liste simple utilisee par les listes deroulantes (affectation, filtres). */
  async list(options: { role?: string } = {}) {
    const roleMap: Record<string, Role> = {
      SUPER_ADMIN: 'SUPER_ADMIN',
      SUPERADMIN: 'SUPER_ADMIN',
      ADMIN: 'ADMIN',
      SUPERVISOR: 'SUPERVISOR',
      SWAPPER: 'SWAPPER',
    };
    // Plusieurs roles peuvent etre demandes (« SUPER_ADMIN,ADMIN ») : les
    // listes deroulantes de pilotage melangent l'encadrement et les agents.
    const roles = (options.role ?? '')
      .split(',')
      .map((value) => roleMap[value.trim().toUpperCase()])
      .filter((value): value is Role => Boolean(value));
    const users = await this.prisma.user.findMany({
      where: roles.length ? { role: { in: roles } } : {},
      orderBy: { fullName: 'asc' },
    });
    const ctx = await this.scope.serializeContext();
    return users.map((user) => ({
      ...serializeUser(user, ctx),
      isActive: user.isActive,
      disabledAt: user.disabledAt ? user.disabledAt.toISOString() : null,
      phoneNumber: user.phoneNumber,
      email: user.email,
    }));
  }

  /** Liste paginee : consommee par l'ecran d'administration des comptes. */
  async page(filters: MemberFilters) {
    const where = this.buildWhere(filters);
    const sort = filters.sort ?? 'recent';
    const limit = Math.max(1, filters.limit ?? 8);
    const total = await this.prisma.user.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(1, filters.page ?? 1), totalPages);

    const users = await this.prisma.user.findMany({
      where,
      orderBy: this.orderBy(sort),
      skip: (page - 1) * limit,
      take: limit,
    });

    const [all, active, pending, inactive] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true, disabledAt: null } }),
      this.prisma.user.count({
        where: { isActive: false, disabledAt: null },
      }),
      this.prisma.user.count({ where: { disabledAt: { not: null } } }),
    ]);

    const ctx = await this.scope.serializeContext();
    return {
      data: users.map((user) => serializeMember(user, ctx)),
      total,
      page,
      totalPages,
      statusCounts: { all, active, pending, inactive },
    };
  }

  /** Export brut : le frontend construit le classeur (xlsx) cote navigateur. */
  async exportRows(filters: MemberFilters) {
    const where = this.buildWhere(filters);
    const users = await this.prisma.user.findMany({
      where,
      orderBy: this.orderBy(filters.sort ?? 'name'),
    });
    const stations = await this.prisma.station.findMany({
      select: { id: true, name: true },
    });
    const stationNames = new Map(stations.map((item) => [item.id, item.name]));
    return {
      rows: users.map((user) => ({
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        station: user.stationId
          ? (stationNames.get(user.stationId) ?? '—')
          : '—',
        status: memberStatus(user),
        phoneNumber: user.phoneNumber ?? '—',
        address: user.address ?? '—',
      })),
      filename: 'utilisateurs_uswap',
    };
  }

  /** Fiche detaillee : admin, superviseur, ou titulaire du compte. */
  async detail(id: string, viewer: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        auditEntries: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!user) throw this.notFound();
    // Roles de pilotage : on interroge la hierarchie plutot qu'une liste
    // fermee, sinon un nouveau role (SUPER_ADMIN) se retrouve enferme dans une
    // interface ou il ne peut plus ouvrir aucune fiche.
    const allowed =
      roleSatisfies(viewer.role, ['SUPERVISOR']) || viewer.id === user.id;
    if (!allowed) {
      throw new ForbiddenDomain(
        'ACCESS_DENIED',
        'Vous ne disposez pas des droits nécessaires.',
      );
    }
    const ctx = await this.scope.serializeContext();
    return serializeDetail(user, ctx);
  }

  /* ---------------------------------------------------------------- */
  /* Ecriture                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Creation d'un compte par un administrateur.
   *
   * Deux politiques :
   * - `accountStatus = ACTIVE` : l'administrateur definit un mot de passe, le
   *   compte est immediatement utilisable.
   * - sinon : un lien d'invitation est envoye, le compte attend l'activation.
   */
  async create(
    input: {
      fullName: string;
      email: string;
      role: string;
      stationId?: string | null;
      phoneNumber?: string | null;
      address?: string | null;
      password?: string;
      accountStatus?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const fullName = input.fullName?.trim() ?? '';
    const email = (input.email ?? '').trim().toLowerCase();
    const role = (input.role ?? '').toUpperCase() as Role;
    const stationId = input.stationId?.trim() || null;
    const active = (input.accountStatus ?? '').toUpperCase() === 'ACTIVE';

    if (!fullName || !EMAIL_PATTERN.test(email)) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Nom complet et adresse e-mail valides requis.',
        400,
      );
    }
    if (!ROLE_NAMES.includes(role)) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez un rôle valide.',
        400,
      );
    }
    if (!canAssignRole(actor.role, role)) {
      throw new ForbiddenDomain(
        'ROLE_NOT_ALLOWED',
        'Vous ne pouvez pas attribuer ce rôle.',
      );
    }
    if (role !== 'SWAPPER' && stationId) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Ce rôle ne se rattache pas à une station.',
        400,
      );
    }
    if (role === 'SWAPPER' && !stationId) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Sélectionnez la station rattachée à ce collaborateur.',
        400,
      );
    }
    if (stationId) {
      const station = await this.prisma.station.findUnique({
        where: { id: stationId },
        select: { id: true },
      });
      if (!station) {
        throw new ConflictDomain(
          ErrorCode.VALIDATION,
          'La station sélectionnée est introuvable.',
          400,
        );
      }
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictDomain(
        'EMAIL_ALREADY_USED',
        'Un compte utilise déjà cette adresse e-mail.',
      );
    }
    if (active) {
      const policy = PasswordsService.policy(input.password ?? '');
      if (!policy.valid) {
        throw new ConflictDomain(
          ErrorCode.PASSWORD_POLICY,
          policy.issues[0] ?? 'Mot de passe trop faible.',
          400,
        );
      }
    }

    const created = await this.prisma.user.create({
      data: {
        fullName,
        email,
        role,
        stationId: role === 'SWAPPER' ? stationId : null,
        phoneNumber: input.phoneNumber?.trim() || null,
        address: input.address?.trim() || null,
        isActive: active,
        passwordHash: await this.passwords.hash(
          active
            ? (input.password ?? '')
            : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ),
        invitationStatus: active ? 'ACTIVATED' : 'SENT',
        invitationSentAt: active ? null : new Date(),
        invitationExpiresAt: active
          ? null
          : new Date(Date.now() + 7 * 86_400_000),
        auditEntries: {
          create: {
            action: 'CREATED',
            actorId: actor.id,
            before: JSON.stringify({}),
            after: JSON.stringify({
              fullName,
              email,
              role,
              stationId,
              phoneNumber: input.phoneNumber ?? null,
              address: input.address ?? null,
            }),
          },
        },
      },
    });

    await this.notifications.ensurePreferences(created.id);

    if (!active) {
      // L'invitation est best-effort : un SMTP indisponible ne doit pas faire
      // echouer la creation du compte. Le statut `invitationStatus` et le
      // journal e-mail disent si le lien est reellement parti.
      const invitation = await this.auth
        .sendInvitation(created.id)
        .catch(() => ({ invitationStatus: 'FAILED' as const }));
      // Le suivi d'invitation figure au centre de notifications admin.
      await this.notifications.notify({
        userId: actor.id,
        kind: NotificationKind.ACCESS_PENDING,
        title:
          invitation.invitationStatus === 'FAILED'
            ? 'Invitation non envoyée'
            : 'Invitation envoyée',
        body:
          invitation.invitationStatus === 'FAILED'
            ? `Le compte de ${fullName} est créé, mais l'e-mail n'a pas pu partir. Renvoyez l'invitation depuis sa fiche.`
            : `${fullName} recevra un lien pour activer son accès.`,
        targetId: created.id,
        targetUrl: `/app/admin/utilisateurs/${created.id}`,
      });
    }

    return {
      id: created.id,
      invitationStatus: created.invitationStatus,
      isActive: created.isActive,
      author: actor.id,
    };
  }

  /** Mise a jour d'une fiche (controle de concurrence optimiste sur updatedAt). */
  async update(
    id: string,
    input: Record<string, unknown>,
    actor: AuthenticatedUser,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw this.notFound();

    const expected = this.text(input.updatedAt);
    if (expected && expected !== target.updatedAt.toISOString()) {
      throw new ConflictDomain(
        'STALE_WRITE',
        'Ces informations ont été modifiées entre-temps. Rechargez la fiche.',
      );
    }

    const email = this.text(input.email).toLowerCase();
    if (email && email !== target.email) {
      if (!EMAIL_PATTERN.test(email)) {
        throw new ConflictDomain(
          ErrorCode.VALIDATION,
          'Adresse e-mail invalide.',
          400,
        );
      }
      const clash = await this.prisma.user.findUnique({ where: { email } });
      if (clash) {
        throw new ConflictDomain(
          'EMAIL_ALREADY_USED',
          'Un autre compte utilise déjà cette adresse.',
        );
      }
    }

    const role = (this.text(input.role).toUpperCase() as Role) || target.role;
    if (!ROLE_NAMES.includes(role)) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez un rôle valide.',
        400,
      );
    }
    if (role !== target.role && !canAssignRole(actor.role, role)) {
      throw new ForbiddenDomain(
        'ROLE_NOT_ALLOWED',
        'Vous ne pouvez pas attribuer ce rôle.',
      );
    }
    if (
      target.role !== 'SWAPPER' &&
      role === 'SWAPPER' &&
      actor.id === target.id
    ) {
      throw new ForbiddenDomain(
        'ROLE_NOT_ALLOWED',
        'Vous ne pouvez pas retirer vos propres droits.',
      );
    }
    const stationId = this.text(input.stationId) || null;
    if (role === 'SWAPPER' && !stationId) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Sélectionnez la station rattachée à ce collaborateur.',
        400,
      );
    }
    if (stationId) {
      const station = await this.prisma.station.findUnique({
        where: { id: stationId },
        select: { id: true },
      });
      if (!station) {
        throw new ConflictDomain(
          ErrorCode.VALIDATION,
          'La station sélectionnée est introuvable.',
          400,
        );
      }
    }

    const before = {
      fullName: target.fullName,
      email: target.email,
      role: target.role,
      phoneNumber: target.phoneNumber,
      address: target.address,
      stationId: target.stationId,
    };
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: this.text(input.fullName) || target.fullName,
        email: email || target.email,
        role,
        phoneNumber: this.text(input.phoneNumber) || null,
        address: this.text(input.address) || null,
        stationId: role === 'SWAPPER' ? stationId : null,
        auditEntries: {
          create: {
            action: 'UPDATED',
            actorId: actor.id,
            before: JSON.stringify(before),
            after: JSON.stringify({
              fullName: this.text(input.fullName) || target.fullName,
              email: email || target.email,
              role,
              phoneNumber: this.text(input.phoneNumber) || null,
              address: this.text(input.address) || null,
              stationId: role === 'SWAPPER' ? stationId : null,
            }),
          },
        },
      },
      include: { auditEntries: { orderBy: { createdAt: 'desc' }, take: 100 } },
    });
    const ctx = await this.scope.serializeContext();
    return { ...serializeDetail(updated, ctx), author: actor.id };
  }

  /**
   * Active / desactive un compte. La desactivation ferme toutes ses sessions.
   *
   * La reactivation remet le compte en service **sans exiger de mot de passe** :
   * le mot de passe conserve avant la desactivation reste valable. Le message
   * de confirmation renvoye au client precise ce qui s'est passe, afin que
   * l'interface ne laisse pas croire a un nouvel envoi de lien.
   */
  async setStatus(
    id: string,
    rawEnabled: unknown,
    actor: AuthenticatedUser,
    expectedUpdatedAt?: string,
  ) {
    // Un statut non interpretable est refuse tel quel : il ne doit jamais
    // devenir « true » par accident (cela reactiverait un compte sans que
    // l'administrateur l'ait demande).
    const enabled = readEnabled(rawEnabled);
    if (enabled === null) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Indiquez le statut souhaité : true (activer) ou false (désactiver).',
        400,
      );
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw this.notFound();
    if (expectedUpdatedAt && expectedUpdatedAt !== target.updatedAt.toISOString()) {
      throw new ConflictDomain(
        'STALE_WRITE',
        'Le statut a changé entre-temps. Fermez ce menu puis rouvrez la liste.',
      );
    }
    if (!enabled && actor.id === target.id) {
      throw new ForbiddenDomain(
        'SELF_DISABLE',
        'Vous ne pouvez pas désactiver votre propre compte.',
      );
    }

    const before = {
      isActive: target.isActive,
      disabledAt: target.disabledAt ? target.disabledAt.toISOString() : null,
    };
    // `disabledAt` est le seul marqueur fiable de la desactivation : un compte
    // reactive doit avoir `isActive: true` ET `disabledAt: null`, sinon le
    // garde d'acces (middleware de session) refuse de nouveau la connexion.
    const nextDisabledAt = enabled ? null : new Date();
    await this.prisma.user.update({
      where: { id },
      data: {
        isActive: enabled,
        disabledAt: nextDisabledAt,
        ...(enabled
          ? { invitationStatus: 'ACTIVATED' as const, invitationExpiresAt: null }
          : {}),
        auditEntries: {
          create: {
            action: enabled ? 'REACTIVATED' : 'DISABLED',
            actorId: actor.id,
            before: JSON.stringify(before),
            after: JSON.stringify({
              isActive: enabled,
              disabledAt: nextDisabledAt ? nextDisabledAt.toISOString() : null,
            }),
          },
        },
      },
    });

    if (!enabled) {
      // Un compte desactive ne doit plus pouvoir utiliser de jeton.
      await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
      await this.notifications.notify({
        userId: id,
        kind: 'ACCESS_DISABLED',
        title: 'Accès suspendu',
        body: 'Votre accès a été désactivé. Contactez votre administrateur.',
        critical: true,
      });
      return {
        ok: true,
        enabled: false,
        message:
          'Compte désactivé. Les sessions ouvertes ont été fermées ; son historique est conservé.',
      };
    }

    // Le compte etait deja actif mais sans invitation exploitable : on n'ecrit
    // rien de plus, la reactivation est idempotente.
    await this.notifications.notify({
      userId: id,
      kind: 'ACCESS_GRANTED',
      title: 'Accès rétabli',
      body: 'Votre accès uSwap a été réactivé. Vous pouvez vous connecter avec votre mot de passe habituel.',
      critical: true,
    });
    return {
      ok: true,
      enabled: true,
      message: target.isActive
        ? 'Compte déjà actif : rien à modifier.'
        : 'Compte réactivé. Le collaborateur se connecte avec son mot de passe habituel (ou demande un nouveau lien depuis « Mot de passe oublié »).',
      invitationStatus: 'ACTIVATED',
    };
  }

  /** Active un compte en attente et (re)envoie l'invitation. */
  async activate(id: string, actor: AuthenticatedUser) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw this.notFound();
    if (target.isActive && !target.disabledAt) {
      throw new ConflictDomain(
        'ALREADY_ACTIVE',
        'Ce compte est déjà activé.',
      );
    }
    const before = {
      isActive: target.isActive,
      invitationStatus: target.invitationStatus,
    };
    // Un compte reactive reste utilisable avec son mot de passe existant :
    // imposer un nouvel envoi de lien n'a de sens que si aucun mot de passe
    // exploitable n'existe (compte jamais active).
    await this.prisma.user.update({
      where: { id },
      data: {
        isActive: true,
        disabledAt: null,
        invitationStatus: 'SENT',
        invitationSentAt: new Date(),
        invitationExpiresAt: new Date(Date.now() + 7 * 86_400_000),
        auditEntries: {
          create: {
            action: 'ACTIVATED',
            actorId: actor.id,
            before: JSON.stringify(before),
            after: JSON.stringify({
              isActive: true,
              invitationStatus: 'SENT',
            }),
          },
        },
      },
    });
    await this.auth.sendInvitation(id);
    return { ok: true };
  }

  /** Renvoie une invitation : nouveau lien, nouvelle echeance. */
  async resendInvitation(id: string, actor: AuthenticatedUser) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw this.notFound();
    if (target.isActive) {
      throw new ConflictDomain(
        'ALREADY_ACTIVE',
        'Ce compte est déjà activé.',
      );
    }
    await this.auth.sendInvitation(id, { resend: true });
    await this.prisma.accountAudit.create({
      data: {
        userId: id,
        actorId: actor.id,
        action: 'INVITATION_RESENT',
        message: 'Invitation renvoyée par un administrateur.',
      },
    });
    return { ok: true };
  }

  /** Demande d'activation depuis l'ecran de connexion. */
  async requestAccess(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) return { ok: true }; // reponse uniforme
    await this.notifications.notifyStaff([], {
      kind: NotificationKind.ACCESS_PENDING,
      title: "Demande d'accès",
      body: `${user.fullName} demande l'activation de son compte.`,
      targetId: user.id,
      targetUrl: `/app/admin/utilisateurs/${user.id}`,
    });
    return { ok: true };
  }

  /** Comptes en attente d'activation (centre d'actions de l'accueil admin). */
  async pending() {
    const users = await this.prisma.user.findMany({
      where: { isActive: false, disabledAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const ctx = await this.scope.serializeContext();
    return users.map((user) => serializeMember(user, ctx));
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private buildWhere(filters: MemberFilters): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    const search = filters.q?.trim().toLowerCase();
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.role) {
      where.role = filters.role.toUpperCase() as Role;
    }
    if (filters.stationId) where.stationId = filters.stationId;
    switch (filters.status?.toLowerCase()) {
      case 'active':
        where.isActive = true;
        where.disabledAt = null;
        break;
      case 'pending':
        where.isActive = false;
        where.disabledAt = null;
        break;
      case 'inactive':
        where.disabledAt = { not: null };
        break;
      default:
        break;
    }
    return where;
  }

  private orderBy(sort: string): Prisma.UserOrderByWithRelationInput {
    switch (sort) {
      case 'name':
        return { fullName: 'asc' };
      case 'role':
        return { role: 'asc' };
      case 'oldest':
        return { updatedAt: 'asc' };
      default:
        return { updatedAt: 'desc' };
    }
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private notFound(): NotFoundDomain {
    return new NotFoundDomain(ErrorCode.NOT_FOUND, 'Compte introuvable.');
  }

  /** Recherche d'un compte par e-mail : utilise par les autres services. */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }
}
