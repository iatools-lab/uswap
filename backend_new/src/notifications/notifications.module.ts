import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notifications transverses : exportees globalement car la quasi-totalite des
 * modules metier emet des evenements (pointage, conge, incident, remplacement,
 * publication de planning, securite des comptes).
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
