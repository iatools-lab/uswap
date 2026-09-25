import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { SchedulingEngineService } from './scheduling-engine.service';

@Module({
  imports: [
    PrismaModule,
  ],

  providers: [
    SchedulingEngineService,
  ],

  exports: [
    SchedulingEngineService,
  ],
})
export class SchedulingModule {}