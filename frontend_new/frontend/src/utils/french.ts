const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
) {
  return count === 1 ? singular : pluralForm;
}

export function countLabel(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

/** Période lisible avec le mois en toutes lettres et l’année écrite une fois. */
export function formatDateRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startMonth = start.getUTCMonth();
  const endMonth = end.getUTCMonth();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear === endYear && startMonth === endMonth && startDay === endDay)
    return `Le ${startDay} ${MONTHS[startMonth]} ${startYear}`;
  if (startYear === endYear && startMonth === endMonth)
    return `Du ${startDay} au ${endDay} ${MONTHS[endMonth]} ${endYear}`;
  if (startYear === endYear)
    return `Du ${startDay} ${MONTHS[startMonth]} au ${endDay} ${MONTHS[endMonth]} ${endYear}`;
  return `Du ${startDay} ${MONTHS[startMonth]} ${startYear} au ${endDay} ${MONTHS[endMonth]} ${endYear}`;
}
