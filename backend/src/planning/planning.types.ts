/**
 * Types partages du domaine planification.
 *
 * Ils vivent dans un module a part pour eviter un import circulaire entre le
 * service et le calcul de couverture.
 */

export interface AssignmentInput {
  stationId: string;
  day: string;
  shiftTemplateId?: string | null;
  shiftLabel?: string | null;
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  breakMinutes?: number;
  requiredStaff: number;
  assignedUserIds: string[];
  notes?: string | null;
  _occurrenceId?: string;
}

export interface CoverageMatrix {
  days: string[];
  stations: string[];
  totals: {
    shifts: number;
    required: number;
    assigned: number;
    vacancies: number;
    coverageRate: number;
  };
  perStation: {
    stationId: string;
    days: Record<string, { required: number; assigned: number; shifts: number }>;
    required: number;
    assigned: number;
    vacancies: number;
    coverageRate: number;
  }[];
  gaps: {
    stationId: string;
    day: string;
    shiftLabel: string | null;
    startTime: string;
    endTime: string;
    missing: number;
  }[];
}
