import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Comparaison de secrets en TEMPS CONSTANT.
 *
 * Une comparaison `===` s'arrête au premier caractère différent : la durée de
 * la réponse révèle combien de caractères sont corrects, ce qui permet de
 * reconstituer un secret caractère par caractère. On compare donc des empreintes
 * de longueur fixe avec `timingSafeEqual`.
 *
 * Les secrets attendus sont des chaînes générées (`openssl rand -hex 32`) ; la
 * comparaison n'est volontairement pas insensible à la casse.
 */
export function safeEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
