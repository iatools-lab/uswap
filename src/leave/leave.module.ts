import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveApiClient } from './leave-api.client';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveApiClient],
  exports: [LeaveService],
})
export class LeaveModule {}