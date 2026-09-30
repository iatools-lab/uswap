import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../auth/email.service';
import { ImportUserRowDto } from './dto/import-user-row.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';

const TEMPLATE_HEADER = 'fullName,email,role,stationId,phoneNumber,address';
const VALID_ROLES = ['SUPERVISOR', 'STATION_CHIEF', 'SWAPPER'];
const INVITATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

const SAFE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  phoneNumber: true,
  address: true,
  isActive: true,
  stationId: true,
  invitationTokenExpires: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async findAll(query: QueryUsersDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.stationId ? { stationId: query.stationId } : {}),
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total, all, active, pending] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
      // Counts are computed over the whole directory, not the filtered page,
      // so the admin home cards stay stable while filters change.
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: false } }),
    ]);

    return {
      data: data.map((user) => this.withInvitationStatus(user)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      statusCounts: {
        all,
        active,
        pending,
        inactive: pending,
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return this.withInvitationStatus(user);
  }

  async update(id: string, dto: UpdateUserDto, changedBy: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    (['fullName', 'role', 'stationId', 'phoneNumber', 'address'] as const).forEach((field) => {
      if (dto[field] !== undefined && dto[field] !== existing[field]) {
        changes[field] = { old: existing[field], new: dto[field] };
      }
    });

    if (Object.keys(changes).length === 0) {
      return this.findOne(id);
    }

    const roleChanged = 'role' in changes;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          ...dto,
          ...(roleChanged ? { tokenVersion: { increment: 1 } } : {}),
        },
      }),
      this.prisma.userAuditLog.create({
        data: { userId: id, changedBy, changes: changes as Prisma.InputJsonValue },
      }),
    ]);

    return this.findOne(id);
  }

  async deactivate(id: string, changedBy: string) {
    return this.setActiveState(id, false, changedBy);
  }

  async reactivate(id: string, changedBy: string) {
    return this.setActiveState(id, true, changedBy);
  }

  private async setActiveState(id: string, isActive: boolean, changedBy: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    if (existing.isActive === isActive) {
      return this.findOne(id);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive, tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
      this.prisma.userAuditLog.create({
        data: {
          userId: id,
          changedBy,
          changes: { isActive: { old: existing.isActive, new: isActive } } as Prisma.InputJsonValue,
        },
      }),
    ]);

    return this.findOne(id);
  }

  async resendInvitation(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (user.isActive) {
      throw new BadRequestException('Ce compte est deja actif');
    }

    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationTokenHash = crypto.createHash('sha256').update(invitationToken).digest('hex');
    const invitationTokenExpires = new Date(Date.now() + INVITATION_TOKEN_TTL_MS);

    await this.prisma.user.update({
      where: { id },
      data: { invitationTokenHash, invitationTokenExpires },
    });

    const sent = await this.emailService.sendInvitation(user.email, invitationToken);

    return {
      message: sent
        ? 'Invitation renvoyee avec succes.'
        : 'Le jeton a ete renouvele, mais le service e-mail n a pas confirme l envoi.',
    };
  }

  generateTemplate(): string {
    return TEMPLATE_HEADER + '\n' + 'Jean Dupont,jean.dupont@upowa.org,SWAPPER,,+237600000000,Douala\n';
  }

  async parseAndPreview(fileBuffer: Buffer) {
    let records: Record<string, string>[];

    try {
      records = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch (error) {
      throw new BadRequestException('Le fichier CSV est illisible ou mal forme');
    }

    const validRows: ImportUserRowDto[] = [];
    const errors: { line: number; reasons: string[] }[] = [];
    const emailsInFile = new Set<string>();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const lineNumber = i + 2;
      const reasons: string[] = [];

      const fullName = (record.fullName || '').trim();
      const email = (record.email || '').trim().toLowerCase();
      const role = (record.role || '').trim().toUpperCase();
      const stationId = (record.stationId || '').trim() || undefined;
      const phoneNumber = (record.phoneNumber || '').trim() || undefined;
      const address = (record.address || '').trim() || undefined;

      if (!fullName) reasons.push('Nom complet manquant');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reasons.push('E-mail manquant ou invalide');
      if (!VALID_ROLES.includes(role)) reasons.push(`Role invalide, attendu parmi ${VALID_ROLES.join(', ')}`);
      if (email && emailsInFile.has(email)) reasons.push('E-mail en double dans le fichier');

      if (email) {
        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        if (existingUser) reasons.push('Un compte avec cet e-mail existe deja en base');
      }

      if (reasons.length > 0) {
        errors.push({ line: lineNumber, reasons });
        continue;
      }

      emailsInFile.add(email);
      validRows.push({ fullName, email, role: role as Role, stationId, phoneNumber, address });
    }

    return { validRows, errors, totalRows: records.length };
  }

  async confirmImport(rows: ImportUserRowDto[]) {
    const created: string[] = [];
    const rejected: { email: string; reason: string }[] = [];

    for (const row of rows) {
      try {
        const existingUser = await this.prisma.user.findUnique({ where: { email: row.email } });
        if (existingUser) {
          rejected.push({ email: row.email, reason: 'E-mail deja utilise' });
          continue;
        }

        const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        const invitationToken = crypto.randomBytes(32).toString('hex');
        const invitationTokenHash = crypto.createHash('sha256').update(invitationToken).digest('hex');
        const invitationTokenExpires = new Date(Date.now() + INVITATION_TOKEN_TTL_MS);

        await this.prisma.user.create({
          data: {
            fullName: row.fullName,
            email: row.email,
            password: placeholderPassword,
            role: row.role,
            stationId: row.stationId,
            phoneNumber: row.phoneNumber,
            address: row.address,
            isActive: false,
            invitationTokenHash,
            invitationTokenExpires,
          },
        });

        await this.emailService.sendInvitation(row.email, invitationToken);
        created.push(row.email);
      } catch (error) {
        rejected.push({ email: row.email, reason: 'Erreur lors de la creation' });
      }
    }

    return { createdCount: created.length, rejectedCount: rejected.length, created, rejected };
  }

  private withInvitationStatus<T extends { isActive: boolean; invitationTokenExpires: Date | null }>(
    user: T,
  ) {
    const { invitationTokenExpires, ...rest } = user;
    let invitationStatus: 'activated' | 'pending' | 'expired' | null = null;

    if (user.isActive) {
      invitationStatus = 'activated';
    } else if (invitationTokenExpires) {
      invitationStatus = invitationTokenExpires > new Date() ? 'pending' : 'expired';
    }

    return { ...rest, invitationStatus };
  }
}