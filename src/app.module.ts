import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StationsModule } from './stations/stations.module';
import { LeaveModule } from './leave/leave.module';
import { UsersModule } from './users/users.module';
import { ShiftsModule } from './shifts/shifts.module';

@Module({
  imports: [PrismaModule, AuthModule, StationsModule, LeaveModule, UsersModule, ShiftsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}