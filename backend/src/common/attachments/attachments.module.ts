import { Global, Module } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';

/**
 * Pieces jointes transverses (justificatifs d'absence, captures d'incident,
 * corrections de pointage). Exporte globalement comme les autres services
 * transverses (audit, notifications, portee) car plusieurs modules metier
 * deposent ou lisent des fichiers.
 */
@Global()
@Module({
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
