import { Module } from '@nestjs/common';

import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceScheduler } from './attendance.scheduler';

import { PrismaModule } from '../prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';

@Module({
imports: [PrismaModule, OperationsModule],
controllers: [AttendanceController],
providers: [
AttendanceService,
AttendanceScheduler,
],
exports: [AttendanceService],
})
export class AttendanceModule {}