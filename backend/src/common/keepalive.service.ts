import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Maintient la connexion PostgreSQL active pendant les périodes de calme.
 *
 * POURQUOI
 * --------
 * Le serveur de base (PostgreSQL, ou le proxy réseau devant lui) ferme les
 * connexions TCP inactives. Prisma détient pourtant ces connexions dans son
 * pool : la PREMIÈRE requête qui suit une période d'inactivité échoue alors
 * avec une erreur de connexion, ce qui remontait côté navigateur sous la forme
 * « Le service est momentanément indisponible » (503) sur des écrans qui
 * interrogent la base — création d'un planning, listes, notifications — de
 * façon intermittente, jamais reproductible à la demande.
 *
 * Un `SELECT 1` toutes les 50 secondes garde le socket chaud. Le coût est
 * négligeable (une ligne, aucune écriture) et l'erreur éventuelle est
 * journalisée sans arrêter l'application : la sonde `/healthz` reste la source
 * de vérité sur la disponibilité réelle.
 */
@Injectable()
export class KeepaliveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeepaliveService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Dernière erreur journalisée : évite de noyer les journaux. */
  private lastError = '';

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.ping(), 50_000);
    // `unref` : le minuteur ne doit pas retenir le processus au moment d'un
    // arrêt (SIGTERM du conteneur).
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async ping(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (this.lastError) {
        this.logger.log('Connexion PostgreSQL rétablie.');
        this.lastError = '';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) {
        this.lastError = message;
        this.logger.warn(`Keepalive PostgreSQL en échec : ${message}`);
      }
    }
  }
}
