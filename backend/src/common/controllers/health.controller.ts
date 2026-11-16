import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../guards/roles.guard';

/**
 * Sonde de disponibilité (readiness) — appelée par le conteneur Docker et par
 * le diagnostic de déploiement.
 *
 * POURQUOI ELLE EXISTE
 * --------------------
 * La sonde précédente appelait `/auth/session`, qui ne touche PAS la base de
 * données : un backend dont la connexion PostgreSQL était perdue restait
 * « healthy », était déclaré prêt par Compose, et le proxy continuait de lui
 * router du trafic. Résultat côté utilisateur : des pages qui répondaient
 * `503 Service Unavailable` par intermittence (« le service est momentanément
 * indisponible ») sur des fonctionnalités qui interrogent la base — création
 * de planning, listes, notifications — alors que d'autres semblaient marcher.
 *
 * Cette route exécute `SELECT 1` et renvoie :
 *   200 { status: "ok", database: "up" }        service ET base disponibles
 *   503 { status: "degraded", database: "down" } service debout, base muette
 *
 * Elle est publique (aucune authentification) mais n'expose aucune donnée.
 */
@ApiTags('health')
@Controller('healthz')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'État de l’API et de sa base de données' })
  async health(@Res({ passthrough: true }) response: Response) {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      response.status(HttpStatus.OK);
      return {
        status: 'ok',
        database: 'up',
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      // 503 : le répartiteur sait qu'il ne doit pas envoyer de trafic ici.
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'degraded',
        database: 'down',
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
