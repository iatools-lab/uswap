import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const ROUNDS = 12;

export interface PasswordPolicyResult {
  valid: boolean;
  issues: string[];
}

@Injectable()
export class PasswordsService {
  private readonly logger = new Logger(PasswordsService.name);

  static readonly MIN_LENGTH = 8;
  static readonly MAX_LENGTH = 128;

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, ROUNDS);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /**
   * Regle de mot de passe affichee par l'ecran d'activation : au moins 8
   * caracteres, une lettre et un chiffre. Les messages sont en francais car
   * ils remontent tels quels dans l'interface.
   */
  static policy(plain: string): PasswordPolicyResult {
    const issues: string[] = [];
    if (plain.length < PasswordsService.MIN_LENGTH) {
      issues.push('Le mot de passe doit contenir 8 caractères minimum.');
    }
    if (plain.length > PasswordsService.MAX_LENGTH) {
      issues.push('Le mot de passe ne peut pas dépasser 128 caractères.');
    }
    if (!/[A-Za-z]/.test(plain)) {
      issues.push('Ajoutez au moins une lettre.');
    }
    if (!/\d/.test(plain)) {
      issues.push('Ajoutez au moins un chiffre.');
    }
    return { valid: issues.length === 0, issues };
  }

  static generateTemporary(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(12);
    let output = '';
    for (const byte of bytes) output += alphabet[byte % alphabet.length];
    return `Usw-${output}`;
  }
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ferme toutes les sessions d'un compte sauf la courante (si fournie). */
  async revokeAllExcept(userId: string, sessionId?: string): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { userId, ...(sessionId ? { id: { not: sessionId } } : {}) },
    });
    if (result.count) {
      this.logger.log(
        `${result.count} session(s) fermée(s) pour l'utilisateur ${userId}.`,
      );
    }
    return result.count;
  }

  /** Sessions actives d'un compte, pour l'ecran de securite. */
  async listActive(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
      },
    });
  }
}
