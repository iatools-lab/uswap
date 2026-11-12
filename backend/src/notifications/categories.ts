/**
 * Categories de notification.
 *
 * Elles alimentent les filtres du centre de notifications et la matrice de
 * preferences. Les libelles sont ceux affiches dans l'espace compte.
 */
export const ALL_CATEGORIES = [
  'PLANNING',
  'ATTENDANCE',
  'OPERATIONS',
  'LEAVE',
  'INCIDENT',
  'ACCESS',
  'REPORT',
] as const;

export type NotificationCategory = (typeof ALL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<
  NotificationCategory,
  { title: string; description: string }
> = {
  PLANNING: {
    title: 'Planning',
    description: 'Publications et modifications d’horaires',
  },
  ATTENDANCE: {
    title: 'Presence et pointage',
    description: 'Retards, absences et corrections',
  },
  OPERATIONS: {
    title: 'Operations',
    description: 'Remplacements et changements d’affectation',
  },
  LEAVE: {
    title: 'Conges',
    description: 'Decisions et suivi des demandes',
  },
  INCIDENT: {
    title: 'Incidents',
    description: 'Signalements et avancee du traitement',
  },
  ACCESS: {
    title: 'Acces',
    description: 'Invitations et activations de compte',
  },
  REPORT: {
    title: 'Rapports',
    description: 'Exports et rapports periodiques',
  },
};

/**
 * Rattache un type d'evenement a sa categorie de preference.
 * Miroir de `categoryFor` cote frontend.
 */
export function categoryForKind(kind: string): NotificationCategory {
  if (kind.startsWith('PLANNING_')) return 'PLANNING';
  if (kind.includes('LEAVE')) return 'LEAVE';
  if (kind.includes('INCIDENT')) return 'INCIDENT';
  if (['REPLACEMENT', 'REPLACEMENT_NEEDED', 'ASSIGNMENT'].includes(kind))
    return 'OPERATIONS';
  if (kind === 'ACCESS_PENDING' || kind.startsWith('ACCESS_')) return 'ACCESS';
  if (kind.startsWith('REPORT')) return 'REPORT';
  if (
    [
      'CHECKIN',
      'CHECKOUT',
      'CORRECTION',
      'AUTOMATIC_ABSENCE',
      'ABSENCE_DECLARED',
      'ABSENCE',
      'LATE',
      'CHECKIN_REMINDER',
    ].includes(kind)
  )
    return 'ATTENDANCE';
  return 'OPERATIONS';
}

/** Types d'evenements emis par l'API (documentation + tests). */
export const NotificationKind = {
  ACCESS_PENDING: 'ACCESS_PENDING',
  ACCESS_ACTIVATED: 'ACCESS_ACTIVATED',
  ACCESS_GRANTED: 'ACCESS_GRANTED',
  ACCESS_DISABLED: 'ACCESS_DISABLED',
  DATA_CLEANUP: 'DATA_CLEANUP',
  PLANNING_PUBLISHED: 'PLANNING_PUBLISHED',
  PLANNING_UPDATED: 'PLANNING_UPDATED',
  PLANNING_ASSIGNED: 'PLANNING_ASSIGNED',
  ASSIGNMENT: 'ASSIGNMENT',
  CHECKIN: 'CHECKIN',
  CHECKOUT: 'CHECKOUT',
  CHECKIN_REMINDER: 'CHECKIN_REMINDER',
  LATE: 'LATE',
  ABSENCE_DECLARED: 'ABSENCE_DECLARED',
  AUTOMATIC_ABSENCE: 'AUTOMATIC_ABSENCE',
  CORRECTION: 'CORRECTION',
  REPLACE_EXISTS: 'REPLACEMENT',
  REPLACEMENT_NEEDED: 'REPLACEMENT_NEEDED',
  LEAVE_SUBMITTED: 'LEAVE_SUBMITTED',
  LEAVE_APPROVED: 'LEAVE_APPROVED',
  LEAVE_REJECTED: 'LEAVE_REJECTED',
  LEAVE_CANCELLED: 'LEAVE_CANCELLED',
  LEAVE_SYNC_FAILED: 'LEAVE_SYNC_FAILED',
  INCIDENT: 'INCIDENT',
  REPORT_READY: 'REPORT_READY',
} as const;
