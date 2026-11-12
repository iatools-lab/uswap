import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AutomationService } from './automation.service';
import { ReportsService } from '../reports/reports.service';

/**
 * Horloge de la plateforme.
 *
 * Les frequences suivent l'usage reel :
 * - absences automatiques : toutes les 5 minutes (une tolerance de retard peut
 *   expirer a tout moment) ;
 * - rappels de pointage : toutes les 5 minutes aussi, le dedoublonnage se
 *   faisant sur la notification elle-meme ;
 * - rapports programmes : toutes les heures, pour rester proche de l'heure
 *   d'envoi demandee sans surcharger la base ;
 * - retention : une fois par nuit.
 */
@Injectable()
export class AutomationScheduler {
  private readonly logger = new Logger(AutomationScheduler.name);
  private running = false;

  constructor(
    private readonly automation: AutomationService,
    private readonly reports: ReportsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAttendanceAutomation(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const absences = await this.automation.runAutomaticAbsences();
      const reminders = await this.automation.runCheckinReminders();
      if (absences.created || reminders.sent) {
        this.logger.log(
          `Automatisation pointage : ${absences.created} absence(s), ${reminders.sent} rappel(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Automatisation pointage en échec : ${
          error instanceof Error ? error.message : error
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledReports(): Promise<void> {
    try {
      const result = await this.reports.runDueReports();
      if (result.executed || result.failed) {
        this.logger.log(
          `Rapports programmés : ${result.executed} envoyé(s), ${result.failed} en échec.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Rapports programmés en échec : ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleLeaveSync(): Promise<void> {
    try {
      const result = await this.automation.runLeaveSync();
      if (result.processed) {
        this.logger.log(
          `Intégration RH : ${result.processed} opération(s) traitée(s), ${result.remaining} en attente.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Intégration RH en échec : ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  @Cron('0 30 2 * * *')
  async handleRetention(): Promise<void> {
    try {
      const result = await this.automation.runRetention();
      this.logger.log(
        `Purge nocturne : ${result.notifications} notification(s), ${result.tokens} jeton(s), ${result.attempts} tentative(s).`,
      );
    } catch (error) {
      this.logger.error(
        `Purge en échec : ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
