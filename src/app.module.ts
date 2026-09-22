import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StationsModule } from './stations/stations.module';
import { LeaveModule } from './leave/leave.module';
import { UsersModule } from './users/users.module';
import { ShiftsModule } from './shifts/shifts.module';
import { PlanningModule } from './planning/planning.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
imports: [
ScheduleModule.forRoot(),

PrismaModule,
AuthModule,
StationsModule,
LeaveModule,
UsersModule,
ShiftsModule,
PlanningModule,
SchedulingModule,
AttendanceModule,

],
controllers: [AppController],
providers: [AppService],
})
export class AppModule {}