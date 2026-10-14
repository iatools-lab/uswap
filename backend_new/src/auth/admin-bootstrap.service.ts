import { Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Retablit l'acces administrateur au demarrage.
 *
 * Aligne sur `restoreAdminAccess` cote frontend : un compte administrateur ne
 * doit jamais rester bloque par accident lors d'une remise a zero de la base.
 * Le mot de passe n'est reinitialise que si le compte est desactive, et le
 * changement est journalise.
 */
@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const settings = await this.prisma.globalSettings.findUnique({
      where: { id: 'global' },
    });
    if (!settings) {
      await this.prisma.globalSettings.create({
        data: {
          id: 'global',
          supportEmail: 'support@uswap.local',
        },
      });
    }

    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? 'AdminUswap';
    await this.auth.ensureAdminAccess(password);
    await this.notifications.ensureAllPreferences();
  }
}
