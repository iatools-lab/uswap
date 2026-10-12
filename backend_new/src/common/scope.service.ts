import { Global, Injectable, Module } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './guards/roles.guard';

/**
 * Perimetre de visibilite.
 *
 * Regles metier (US confidentialite) :
 * - **Agent** : uniquement ses propres donnees, les plannings **publies** qui
 *   le concernent, y compris un renfort ponctuel dans une autre station.
 * - **Superviseur** : les stations qu'il couvre, ou l'ensemble du reseau
 *   lorsqu'il n'est rattache a aucune station (superviseur global).
 * - **Administrateur** : tout le reseau.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Stations visibles par l'utilisateur ; `null` = aucune restriction. */
  async stationIdsFor(user: AuthenticatedUser): Promise<string[] | null> {
    if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') return null;
    if (user.role === 'SWAPPER') return null; // filtre par swapperId
    return null;
  }

  /** Filtre Prisma a appliquer sur `stationId`. */
  stationFilter(user: AuthenticatedUser): { id?: string } | Record<string, never> {
    if (user.role === 'SWAPPER' && user.stationId) {
      return { id: user.stationId };
    }
    return {};
  }

  /** Un agent ne voit que ses propres lignes. */
  swapperFilter(user: AuthenticatedUser): string | null {
    return user.role === 'SWAPPER' ? user.id : null;
  }

  /** Les agents ne voient que les plannings publies. */
  publishedOnly(user: AuthenticatedUser): boolean {
    return user.role === 'SWAPPER';
  }

  /** L'utilisateur peut-il modifier les plannings ? (admin et superviseur) */
  canManagePlannings(user: AuthenticatedUser): boolean {
    return user.role === 'ADMIN' || user.role === 'SUPERVISOR';
  }

  /**
   * Peut-il agir sur cette station ? Un superviseur non rattache couvre tout
   * le reseau ; un agent uniquement sa station de rattachement.
   */
  canActOnStation(user: AuthenticatedUser, stationId: string): boolean {
    if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') return true;
    return user.stationId === stationId;
  }

  /**
   * Un agent sert-il cette station (station de rattachement ou poste affecte
   * sur un planning publie) ? Utilise pour ouvrir un signalement d'incident.
   */
  async servesStation(
    userId: string,
    stationId: string,
    userStationId: string | null,
  ): Promise<boolean> {
    if (userStationId === stationId) return true;
    const count = await this.prisma.occurrence.count({
      where: {
        stationId,
        swapperId: userId,
        planning: { status: 'PUBLISHED' },
      },
    });
    return count > 0;
  }

  /** Postes visibles d'un agent : ceux qui lui sont affectes. */
  occurrenceScope(user: AuthenticatedUser): { swapperId?: string } {
    return user.role === 'SWAPPER' ? { swapperId: user.id } : {};
  }

  /**
   * Chargement des libelles partages (noms de station, identites minimales).
   * Evite les requetes N+1 dans les serialiseurs.
   */
  async serializeContext(): Promise<{
    stationNames: Map<string, string>;
    users: Map<
      string,
      { id: string; fullName: string; email: string; phoneNumber: string | null }
    >;
  }> {
    const [stations, users] = await Promise.all([
      this.prisma.station.findMany({ select: { id: true, name: true } }),
      this.prisma.user.findMany({
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
        },
      }),
    ]);
    return {
      stationNames: new Map(stations.map((item) => [item.id, item.name])),
      users: new Map(users.map((item) => [item.id, item])),
    };
  }
}

@Global()
@Module({
  providers: [ScopeService],
  exports: [ScopeService],
})
export class ScopeModule {}
