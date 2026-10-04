import { Module } from '@nestjs/common';

import { ShiftsModule } from '../shifts/shifts.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

@Module({
  imports: [ShiftsModule, SchedulingModule, NotificationsModule],
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}
