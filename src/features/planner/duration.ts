/**
 * Formatage lisible d'une période de planification.
 *
 * Objectif : transformer un intervalle de dates en une durée compréhensible
 * d'un coup d'œil — « 7 jours », « 1 semaine et 1 jour », « 1 mois », etc. —
 * sans jamais afficher un nombre de jours brut seul.
 */

const DAY_MS = 86_400_000;

export type PeriodDuration = {
  /** Nombre de jours couverts (bornes incluses). */
  days: number;
  /** Libellé principal (« 2 semaines et 3 jours »). */
  label: string;
  /** Détail compact entre parenthèses (« 17 jours »). */
  detail: string;
};

const plural = (value: number, singular: string) =>
  `${value} ${singular}${value > 1 ? "s" : ""}`;

/** « mois » est invariable : on l'affiche sans « s » au pluriel. */
const monthLabel = (value: number) => `${value} mois`;

/** Nombre de jours entre deux dates ISO, bornes incluses (au moins 1). */
export function inclusiveDayCount(startIso: string, endIso: string): number {
  const start = Date.parse(startIso.slice(0, 10) + "T00:00:00Z");
  const end = Date.parse(endIso.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * Décompose un nombre de jours en mois, semaines et jours.
 *
 * Les mois sont comptés par blocs de 30 jours (convention « mois commercial »),
 * ce qui donne des libellés stables du type « 1 mois et 2 jours » plutôt qu'un
 * décompte dépendant du calendrier réel.
 */
function decompose(days: number) {
  let remaining = days;
  const months = Math.floor(remaining / 30);
  remaining -= months * 30;
  const weeks = Math.floor(remaining / 7);
  remaining -= weeks * 7;
  return { months, weeks, days: remaining };
}

/**
 * Durée lisible d'une période.
 *
 * - 1 à 6 jours  → « 5 jours »
 * - 7 jours      → « 1 semaine »
 * - 8 jours      → « 1 semaine et 1 jour »
 * - 30 jours     → « 1 mois »
 * - 38 jours     → « 1 mois et 1 semaine »
 */
export function periodDuration(
  startIso: string,
  endIso: string,
): PeriodDuration {
  const days = inclusiveDayCount(startIso, endIso);
  const { months, weeks, days: rest } = decompose(days);

  const parts: string[] = [];
  if (months) parts.push(monthLabel(months));
  if (weeks) parts.push(plural(weeks, "semaine"));
  if (rest) parts.push(plural(rest, "jour"));

  // Un intervalle de plusieurs mois n'a pas besoin du détail en jours.
  const label =
    parts.length === 0
      ? plural(days, "jour")
      : parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(" et ")} et ${parts[parts.length - 1]}`;

  return {
    days,
    label,
    detail: plural(days, "jour"),
  };
}
