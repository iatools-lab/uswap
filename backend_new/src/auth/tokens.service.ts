import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

const TOKEN_BYTES = 32;
const MAX_SESSIONS = 5;
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const LOCK_DURATION_MS = 30 * 60_000;

export interface IssuedToken {
  token: string;
  session: {
    id: string;
    createdAt: Date;
    lastUsedAt: Date;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  };
}

/**
 * Jetons opaques (32 octets) stockes **hashes** en base.
 *
 * Un jeton n'est jamais reutilise : chaque renouvellement revoque la ligne
 * courante et en cree une nouvelle (rotation), ce qui limite la fenetre de
 * rejeu si le cookie venait a fuir. La revocation en masse permet de fermer
 * toutes les sessions d'un compte apres un changement de mot de passe ou une
 * desactivation.
 */
@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  static tokenMatches(candidate: string, hash: string): boolean {
    const candidateHash = TokensService.hash(candidate);
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async issue(
    userId: string,
    ttlSeconds: number,
    metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<IssuedToken> {
    await this.pruneExpired(userId);
    await this.enforceLimit(userId);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const session = await this.prisma.refreshToken.create({
      data: {
        tokenHash: TokensService.hash(token),
        userId,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        userAgent: metadata.userAgent ?? null,
        ipAddress: metadata.ipAddress ?? null,
      },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        userAgent: true,
        ipAddress: true,
      },
    });
    return { token, session };
  }

  async find(token: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash: TokensService.hash(token) },
      include: { user: true },
    });
  }

  async touch(id: string) {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async revoke(token: string) {
    await this.prisma.refreshToken
      .delete({ where: { tokenHash: TokensService.hash(token) } })
      .catch(() => undefined);
  }

  async revokeById(id: string) {
    await this.prisma.refreshToken
      .delete({ where: { id } })
      .catch(() => undefined);
  }

  async revokeAllForUser(userId: string, exceptId?: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
  }

  /** Alias attendu par le module auth (`revokeAll`). */
  async revokeAll(userId: string, exceptId?: string) {
    await this.revokeAllForUser(userId, exceptId);
  }

  private async pruneExpired(userId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  }

  private async enforceLimit(userId: string) {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const excess = tokens.length - (MAX_SESSIONS - 1);
    if (excess > 0) {
      await this.prisma.refreshToken.deleteMany({
        where: { id: { in: tokens.slice(0, excess).map((item) => item.id) } },
      });
    }
  }

  /**
   * Anti-brute-force : 5 echecs sur 15 minutes bloquent le compte 30 minutes.
   * Le suivi se fait en base pour resister aux redemarrages du serveur.
   */
  async registerFailedAttempt(
    userId: string,
  ): Promise<{ locked: boolean; retryAfterSeconds: number }> {
    const now = Date.now();
    await this.prisma.loginAttempt.create({
      data: { userId, attemptedAt: new Date(now) },
    });
    await this.prisma.loginAttempt.deleteMany({
      where: { userId, attemptedAt: { lt: new Date(now - 24 * 3_600_000) } },
    });
    const recent = await this.prisma.loginAttempt.count({
      where: { userId, attemptedAt: { gt: new Date(now - ATTEMPT_WINDOW_MS) } },
    });
    if (recent >= MAX_FAILED_ATTEMPTS) {
      const until = new Date(now + LOCK_DURATION_MS);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: until },
      });
      return { locked: true, retryAfterSeconds: Math.ceil(LOCK_DURATION_MS / 1000) };
    }
    return {
      locked: false,
      retryAfterSeconds: Math.max(
        0,
        Math.ceil(
          (ATTEMPT_WINDOW_MS - (now - now)) / 1000,
        ),
      ),
    };
  }

  async clearFailedAttempts(userId: string) {
    await this.prisma.loginAttempt.deleteMany({ where: { userId } });
  }

  static generateCode(digits = 6): string {
    return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
  }
}
