import { Module } from '@nestjs/common';

import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

import { PrismaModule } from '../prisma/prisma.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [PrismaModule, SchedulingModule],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}