import { Module } from '@nestjs/common';
import { PlanningsController } from './plannings.controller';
import { PlanningService } from './planning.service';
import { ConstraintsService } from './constraints.service';

@Module({
  controllers: [PlanningsController],
  providers: [PlanningService, ConstraintsService],
  exports: [PlanningService, ConstraintsService],
})
export class PlanningModule {}
