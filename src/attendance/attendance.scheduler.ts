import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AttendanceService } from './attendance.service';

@Injectable()
export class AttendanceScheduler {
private readonly logger = new Logger(AttendanceScheduler.name);

constructor(
private readonly attendanceService: AttendanceService,
) {}

@Cron(CronExpression.EVERY_5_MINUTES)
async handleAutomaticAbsence(): Promise<void> {
try {
const result =
await this.attendanceService.markExpectedAsAbsent();

  if (result.updatedCount > 0) {
    this.logger.log(
      `${result.updatedCount} attendance record(s) automatically marked as ABSENT.`,
    );
  }
} catch (error) {
  this.logger.error(
    'Automatic absence check failed.',
    error instanceof Error
      ? error.stack
      : String(error),
  );
}

}
}