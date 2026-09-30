import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

import { PrismaModule } from '../prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [PrismaModule, OperationsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}