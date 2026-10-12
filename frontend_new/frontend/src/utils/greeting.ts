/**
 * Salutations adaptées au moment de la journée.
 *
 * Utilisé uniquement sur les pages d'accueil, pour retrouver le ton chaleureux
 * d'une prise de contact — sans le répéter sur chaque page de l'application.
 */

export type Greeting = string;

/**
 * Retourne une salutation selon l'heure locale.
 *
 * - 05:00 → 11:59 : « Bonjour »
 * - 12:00 → 17:59 : « Bon après-midi »
 * - 18:00 → 04:59 : « Bonsoir »
 *
 * Une période optionnelle (nuit / très tôt) reste naturelle : entre minuit et
 * 5 h, « Bonsoir » convient mieux que « Bonjour ».
 */
export function timeGreeting(now: Date = new Date()): Greeting {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "Bonjour";
  if (hour >= 12 && hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

/** Prénom d'un nom complet, pour un salut personnel. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** Salutation complète : « Bonjour, Léa. » */
export function greetingFor(fullName: string, now: Date = new Date()): string {
  return `${timeGreeting(now)}, ${firstNameOf(fullName)}`;
}
