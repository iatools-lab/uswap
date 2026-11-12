import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PasswordsService } from '../auth/passwords.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ScopeService } from '../common/scope.service';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import type { AuthenticatedUser } from '../common/guards/roles.guard';

/** Entetes acceptes (accents et variantes) pour chaque colonne du fichier. */
const COLUMN_ALIASES = {
  fullName: ['nom complet', 'nom', 'name', 'fullname', 'agent', 'collaborateur'],
  email: ['adresse e-mail', 'email', 'e-mail', 'mail', 'courriel'],
  role: ['rôle', 'role', 'fonction', 'profil'],
  station: ['station', 'station rattachée', 'station rattachee', 'site', 'agence'],
} as const;

/** Rôles reconnus dans la feuille, avec leurs variantes francaises. */
const ROLE_ALIASES: Record<string, 'ADMIN' | 'SUPERVISOR' | 'SWAPPER'> = {
  admin: 'ADMIN',
  administrateur: 'ADMIN',
  superviseur: 'SUPERVISOR',
  supervisor: 'SUPERVISOR',
  'chef de station': 'SUPERVISOR',
  chef: 'SUPERVISOR',
  station_chief: 'SUPERVISOR',
  swappeur: 'SWAPPER',
  swapper: 'SWAPPER',
  agent: 'SWAPPER',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 2000;
const BATCH_TTL_MINUTES = 30;

export interface PreviewRow {
  line: number;
  fullName: string;
  email: string;
  role: string;
  stationId: string | null;
  stationName: string;
  status: 'READY' | 'IGNORED' | 'REJECTED' | 'CREATED';
  reason: string;
}

/**
 * Import de comptes en masse.
 *
 * Le fichier est **analyse puis presente** avant toute ecriture : seules les
 * lignes en statut `READY` sont creees apres confirmation. Le lot analyse est
 * conserve 30 minutes en base, ce qui empeche de rejouer un import perime et
 * permet a l'administrateur de verifier le bilan.
 */
@Injectable()
export class UserImportService {
  private readonly logger = new Logger(UserImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordsService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  /** Analyse le classeur/CSV sans rien ecrire : renvoie le bilan previsionnel. */
  async preview(
    file: { originalname: string; buffer: Buffer; size: number; mimetype: string },
    actor: AuthenticatedUser,
  ) {
    const maxMb = 2;
    if (!file) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez un fichier CSV ou XLSX.',
        400,
      );
    }
    if (file.size > maxMb * 1024 * 1024) {
      throw new ConflictDomain(
        'FILE_TOO_LARGE',
        `Le fichier dépasse la limite de ${maxMb} Mo.`,
        413,
      );
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.originalname)) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez un fichier CSV ou XLSX.',
        400,
      );
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Le fichier ne contient aucune feuille.',
        400,
      );
    }

    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (!raw.length) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Le fichier ne contient aucune ligne exploitable.',
        400,
      );
    }
    if (raw.length > MAX_ROWS) {
      throw new ConflictDomain(
        'TOO_MANY_ROWS',
        `Limitez l'import à ${MAX_ROWS} lignes par fichier.`,
        413,
      );
    }

    const stations = await this.prisma.station.findMany({
      select: { id: true, name: true },
    });
    const existingUsers = await this.prisma.user.findMany({
      select: { email: true },
    });
    const knownEmails = new Set(
      existingUsers.map((item) => item.email.toLowerCase()),
    );
    const seen = new Set<string>();

    const rows: PreviewRow[] = raw.map((entry, index) => {
      const line = index + 2; // la ligne 1 porte les en-tetes
      const pick = (aliases: readonly string[]): string => {
        for (const alias of aliases) {
          const key = Object.keys(entry).find(
            (header) => header.trim().toLowerCase() === alias,
          );
          if (key) return this.text(entry[key]);
        }
        return '';
      };

      const fullName = pick(COLUMN_ALIASES.fullName);
      const email = pick(COLUMN_ALIASES.email).toLowerCase();
      const roleRaw = pick(COLUMN_ALIASES.role);
      const role = ROLE_ALIASES[roleRaw.toLowerCase()] ?? '';
      const stationRaw = pick(COLUMN_ALIASES.station);
      const station = stations.find(
        (item) =>
          item.id.toLowerCase() === stationRaw.toLowerCase() ||
          item.name.toLowerCase() === stationRaw.toLowerCase(),
      );

      const base = {
        line,
        fullName,
        email,
        role: roleRaw,
        stationId: station?.id ?? null,
        stationName: station?.name ?? stationRaw,
      };

      if (!fullName || !email) {
        return { ...base, status: 'REJECTED', reason: 'Nom ou e-mail manquant.' };
      }
      if (!EMAIL_PATTERN.test(email)) {
        return { ...base, status: 'REJECTED', reason: 'Adresse e-mail invalide.' };
      }
      if (!role) {
        return { ...base, status: 'REJECTED', reason: 'Rôle non reconnu.' };
      }
      if (role === 'SWAPPER' && !stationRaw) {
        return {
          ...base,
          role,
          stationId: null,
          stationName: '',
          status: 'REJECTED',
          reason: 'Station obligatoire pour ce rôle.',
        };
      }
      if (role === 'SWAPPER' && !station) {
        return {
          ...base,
          role,
          stationId: null,
          status: 'REJECTED',
          reason: 'Station inconnue.',
        };
      }
      if (seen.has(email) || knownEmails.has(email)) {
        return { ...base, role, status: 'IGNORED', reason: 'Adresse déjà connue.' };
      }
      seen.add(email);
      return { ...base, role, status: 'READY', reason: '' };
    });

    // Purge des lots perimes avant d'ajouter le nouveau.
    await this.prisma.importBatch.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const expiresAt = new Date(Date.now() + BATCH_TTL_MINUTES * 60_000);
    const batch = await this.prisma.importBatch.create({
      data: {
        actorId: actor.id,
        expiresAt,
        rows: {
          create: rows.map((row) => ({
            line: row.line,
            fullName: row.fullName,
            email: row.email,
            role: row.role,
            stationId: row.stationId,
            stationName: row.stationName,
            status: row.status,
            reason: row.reason,
          })),
        },
      },
      include: { rows: { orderBy: { line: 'asc' } } },
    });

    return this.bilan(batch.id, expiresAt, batch.rows);
  }

  /** Cree les comptes preretires et envoie les invitations. */
  async confirm(batchId: string, actor: AuthenticatedUser) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { rows: { orderBy: { line: 'asc' } } },
    });
    if (!batch) {
      throw new NotFoundDomain(
        'IMPORT_BATCH_NOT_FOUND',
        "Ce lot d'import est introuvable.",
      );
    }
    if (batch.expiresAt.getTime() < Date.now()) {
      throw new ConflictDomain(
        'IMPORT_BATCH_EXPIRED',
        "Ce lot d'import a expiré. Relancez l'analyse.",
        410,
      );
    }

    const ready = batch.rows.filter((row) => row.status === 'READY');
    let created = 0;

    for (const row of ready) {
      const role = (row.role as 'ADMIN' | 'SUPERVISOR' | 'SWAPPER') ?? 'SWAPPER';
      const user = await this.prisma.user.create({
        data: {
          fullName: row.fullName,
          email: row.email.toLowerCase(),
          role,
          stationId: role === 'SWAPPER' ? row.stationId : null,
          isActive: false,
          passwordHash: await this.passwords.hash(
            `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ),
          invitationStatus: 'SENT',
          invitationSentAt: new Date(),
          invitationExpiresAt: new Date(Date.now() + 7 * 86_400_000),
          auditEntries: {
            create: {
              action: 'IMPORTED',
              actorId: actor.id,
              before: JSON.stringify({}),
              after: JSON.stringify({
                fullName: row.fullName,
                email: row.email,
                role,
                stationId: row.stationId,
              }),
            },
          },
        },
      });
      await this.notifications.ensurePreferences(user.id);
      // L'invitation part ligne par ligne : un echec isole ne bloque pas l'import.
      await this.auth
        .sendInvitation(user.id, { resend: true })
        .catch((error: unknown) =>
          this.logger.warn(
            `Invitation non envoyee a ${row.email} : ${
              error instanceof Error ? error.message : error
            }`,
          ),
        );
      await this.prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'CREATED', reason: 'Invitation envoyée.' },
      });
      row.status = 'CREATED';
      row.reason = 'Invitation envoyée.';
      created += 1;
    }

    if (created) {
      await this.notifications.notify({
        userId: actor.id,
        kind: 'ACCESS_IMPORTED',
        title: 'Import de comptes terminé',
        body: `${created} compte${created === 1 ? '' : 's'} créé${created === 1 ? '' : 's'} et invité${created === 1 ? '' : 's'}.`,
        targetUrl: '/app/admin/utilisateurs',
      });
    }

    return this.bilan(batch.id, batch.expiresAt, batch.rows, {
      ready: 0,
      created,
    });
  }

  /** Modele de fichier telechargeable, colonnes pretes a remplir. */
  template(): { buffer: Buffer; filename: string } {
    const sheet = XLSX.utils.json_to_sheet([
      {
        'Nom complet': 'Amina Mballa',
        'Adresse e-mail': 'amina.mballa@uswap.example.com',
        Rôle: 'Swappeur',
        Station: 'Station Bastos',
      },
      {
        'Nom complet': 'Paul Nguema',
        'Adresse e-mail': 'paul.nguema@uswap.example.com',
        Rôle: 'Superviseur',
        Station: '',
      },
      {
        'Nom complet': 'Ariane Tchana',
        'Adresse e-mail': 'ariane.tchana@uswap.example.com',
        Rôle: 'Superviseur',
        Station: '',
      },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Utilisateurs');
    const buffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
    }) as Buffer;
    return { buffer, filename: 'modele-utilisateurs-uswap.xlsx' };
  }

  private bilan(
    batchId: string,
    expiresAt: Date,
    rows: PreviewRow[],
    overrides: { ready?: number; created?: number } = {},
  ) {
    return {
      batchId,
      expiresAt: expiresAt.toISOString(),
      rows: rows.map((row) => ({
        line: row.line,
        fullName: row.fullName,
        email: row.email,
        role: row.role,
        stationId: row.stationId,
        stationName: row.stationName,
        status: row.status,
        reason: row.reason,
      })),
      ready:
        overrides.ready ??
        rows.filter((row) => row.status === 'READY').length,
      created:
        overrides.created ??
        rows.filter((row) => row.status === 'CREATED').length,
      ignored: rows.filter((row) => row.status === 'IGNORED').length,
      rejected: rows.filter((row) => row.status === 'REJECTED').length,
    };
  }

  private text(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return '';
  }
}
