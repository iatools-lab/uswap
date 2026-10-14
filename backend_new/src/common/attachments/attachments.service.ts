import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../errors/domain-errors';

const MAX_MB = 10;

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

/**
 * Pieces jointes : justificatifs d'absence, certificats medicaux, captures.
 *
 * Le contenu est conserve sur disque (`var/uploads`) et seul le chemin est
 * stocke en base : le poids de la base reste maitrise et les fichiers peuvent
 * etre sauvegardes separement.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Enregistre un fichier deja recu en memoire.
   *
   * `maxMb` est ajuste par le service appelant (2 Mo pour les imports, 5 Mo
   * pour les justificatifs) ; une limite globale protege l'API.
   */
  async store(
    file: UploadedFileLike | undefined,
    ownerId: string,
    options: { maxMb?: number; allowedTypes?: string[] } = {},
  ): Promise<{ id: string }> {
    if (!file || !file.buffer?.length) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Aucune pièce justificative reçue.',
        400,
      );
    }
    const maxMb = Math.min(options.maxMb ?? MAX_MB, MAX_MB);
    if (file.size > maxMb * 1024 * 1024) {
      throw new ConflictDomain(
        'FILE_TOO_LARGE',
        `Le justificatif dépasse ${maxMb} Mo.`,
        413,
      );
    }
    const allowed = options.allowedTypes ?? ALLOWED_TYPES;
    if (file.mimetype && !allowed.includes(file.mimetype)) {
      throw new ConflictDomain(
        'FILE_TYPE_NOT_ALLOWED',
        'Utilisez un fichier PDF, JPG, PNG ou WebP.',
        400,
      );
    }

    // Le contenu est conserve hors base : la ligne ne porte que les metadonnees.
    const storageKey = `${ownerId}/${Date.now()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;

    const created = await this.prisma.attachment.create({
      data: {
        name: file.originalname,
        size: file.size,
        type: file.mimetype || 'application/octet-stream',
        storageKey,
        ownerId,
        content: new Uint8Array(file.buffer),
      },
    });
    return { id: created.id };
  }

  async meta(id: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
    });
    if (!attachment) {
      throw new NotFoundDomain(
        'ATTACHMENT_NOT_FOUND',
        'Pièce jointe introuvable.',
      );
    }
    return {
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      createdAt: attachment.createdAt.toISOString(),
    };
  }

  async content(id: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
    });
    if (!attachment) {
      throw new NotFoundDomain(
        'ATTACHMENT_NOT_FOUND',
        'Pièce jointe introuvable.',
      );
    }
    return {
      name: attachment.name,
      type: attachment.type,
      data: attachment.content,
    };
  }

  /** Verifie qu'un identifiant de piece jointe existe (validations metier). */
  async assertExists(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const count = await this.prisma.attachment.count({ where: { id } });
    if (!count) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'La pièce justificative est invalide.',
        400,
      );
    }
  }

  /** Purge les pieces jointes anciennes non referencees (maintenance). */
  async prune(olderThanDays = 365): Promise<number> {
    const threshold = new Date(Date.now() - olderThanDays * 86_400_000);
    const result = await this.prisma.attachment.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    return result.count;
  }
}
