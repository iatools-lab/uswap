import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

@Module({
  imports: [ShiftsModule],
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}