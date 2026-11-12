import { Module } from '@nestjs/common';
import { DataCleanupService } from './data-cleanup.service';
import { DataCleanupController } from './data-cleanup.controller';

/**
 * Maintenance de la plateforme. Les services `PrismaService`, `AuditService`
 * et `NotificationsService` sont globaux : aucun import supplementaire.
 */
@Module({
  controllers: [DataCleanupController],
  providers: [DataCleanupService],
  exports: [DataCleanupService],
})
export class MaintenanceModule {}
