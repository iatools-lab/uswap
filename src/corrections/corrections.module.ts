import { Module } from '@nestjs/common';

import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';

import { PrismaModule } from '../prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [PrismaModule, OperationsModule],
  controllers: [CorrectionsController],
  providers: [CorrectionsService],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}