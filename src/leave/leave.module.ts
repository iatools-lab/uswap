import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveApiClient } from './leave-api.client';

@Module({
  controllers: [LeaveController],
  providers: [LeaveService, LeaveApiClient],
})
export class LeaveModule {}