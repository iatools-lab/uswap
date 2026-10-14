import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { PlanningModule } from '../planning/planning.module';

@Module({
  imports: [
    PlanningModule,
    MulterModule.register({
      // Les justificatifs sont analyses en memoire puis stockes via le service
      // de pieces jointes : aucun fichier temporaire sur disque.
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  ],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
