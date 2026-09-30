import { Module } from '@nestjs/common';

import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

import { PrismaModule } from '../prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [PrismaModule, OperationsModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}