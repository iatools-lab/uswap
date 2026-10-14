import type { Request } from 'express';

/** Extrait le jeton d'acces d'un en-tete `Authorization: Bearer ...`. */
export function extractBearerToken(
  authorization: string | undefined,
): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return undefined;
  return token;
}

/** Lit une valeur scalaire d'une query string (Express 5 peut renvoyer un tableau). */
export function queryString(
  request: Request,
  key: string,
): string | undefined {
  const value = request.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Parse un entier avec repli sur une valeur par defaut. */
export function parseIntOrDefault(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
