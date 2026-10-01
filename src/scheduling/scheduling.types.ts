export interface ShiftValidationInput {
  swapperId: string;

  stationId: string;

  startTime: Date;

  endTime: Date;

  planningId?: string | null;

  excludeShiftId?: string;
}

export interface ShiftValidationResult {
  valid: boolean;

  errors: string[];

  warnings: string[];
}

export interface ShiftDurationResult {
  valid: boolean;

  durationHours: number;

  message?: string;
}

export interface WeeklyHoursResult {
  totalHours: number;

  weeklyLimit: number;

  remainingHours: number;

  exceedsLimit: boolean;
}

export interface ConflictResult {
  hasConflict: boolean;

  conflictingShiftIds: string[];

  reason?: string;
}