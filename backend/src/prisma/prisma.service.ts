import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma unique pour toute l'application.
 *
 * En mode `$transaction` interactif, les services metier composent plusieurs
 * ecritures atomiques : une erreur de validation ne peut donc jamais laisser
 * une mutation partielle (meme garantie que `replaceDb` cote frontend).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion a la base etablie.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
