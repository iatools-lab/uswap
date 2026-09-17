import { Module } from '@nestjs/common';

import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [
    SchedulingModule,
  ],

  controllers: [
    ShiftsController,
  ],

  providers: [
    ShiftsService,
  ],

  exports: [
    ShiftsService,
  ],
})
export class ShiftsModule {}