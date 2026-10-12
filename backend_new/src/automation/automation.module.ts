import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AutomationScheduler } from './automation.scheduler';
import { ReportsModule } from '../reports/reports.module';

@Module({
  // Le planificateur declenche aussi les rapports programmes.
  imports: [ReportsModule],
  providers: [AutomationService, AutomationScheduler],
  exports: [AutomationService],
})
export class AutomationModule {}
