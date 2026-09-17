import { Module } from '@nestjs/common';
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
import { ScheduleModule } from '@nestjs/schedule';
@Module({
  imports: [PrismaModule, AuthModule, StationsModule, LeaveModule, UsersModule, ShiftsModule, PlanningModule,SchedulingModule, AttendanceModule,AttendanceModule, ScheduleModule,ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}