import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { PlanningModule } from '../planning/planning.module';

@Module({
  // La validation d'affectation partage les regles metier du planning.
  imports: [PlanningModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
