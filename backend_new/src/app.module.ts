import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { configuration } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { ScopeModule } from './common/scope.service';
import { AuditModule } from './audit/audit.service';
import { AttachmentsModule } from './common/attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StationsModule } from './stations/stations.module';
import { ShiftTemplatesModule } from './stations/shift-templates.controller';
import { PlanningModule } from './planning/planning.module';
import { AttendanceModule } from './attendance/attendance.module';
import { OperationsModule } from './operations/operations.module';
import { LeavesModule } from './leaves/leaves.module';
import { IncidentsModule } from './incidents/incidents.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AutomationModule } from './automation/automation.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { RolesGuard } from './common/guards/roles.guard';
import { SessionMiddleware } from './common/middleware/session.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ScopeModule,
    AuditModule,
    AttachmentsModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    StationsModule,
    ShiftTemplatesModule,
    PlanningModule,
    AttendanceModule,
    OperationsModule,
    LeavesModule,
    IncidentsModule,
    ReportsModule,
    AdminModule,
    AutomationModule,
    DashboardModule,
    MaintenanceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Charge l'utilisateur depuis le jeton d'acces sur chaque requete.
   * Sans ce middleware, `request.user` reste vide et toutes les routes
   * protegees repondent 401 alors meme que le jeton est valide.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes('*');
  }
}
