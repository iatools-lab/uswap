import type { User } from "../../api/auth-api";

export type PendingReplacement = {
  shiftId: string;
  station: { id: string; name: string; timezone: string };
  swapper: { id: string; fullName: string };
  template: string | null;
  startTime: string;
  endTime: string;
  urgency: "CRITICAL" | "HIGH" | "NORMAL";
  hoursUntilStart: number;
  origin: "DECLARATION" | "AUTOMATIC_ABSENCE";
  reason: string | null;
  reportedAt: string | null;
};

export type Candidate = {
  id: string;
  fullName: string;
  email: string;
  eligible: boolean;
  issues: { code: string; message: string }[];
};

export type ShiftChange = {
  id: string;
  type: "REPLACEMENT" | "PERMUTATION" | "REASSIGNMENT";
  initiator: string;
  station: string;
  outSwapper: string | null;
  inSwapper: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
};

export type MonitorRow = {
  shiftId: string;
  station: { id: string; name: string; timezone: string };
  swapper: { id: string; fullName: string };
  template: string | null;
  startTime: string;
  endTime: string;
  status: "PRESENT" | "LATE" | "ABSENT" | "CLOSED" | "EXPECTED";
  checkedInAt: string | null;
  checkedOutAt: string | null;
  isLate: boolean;
  toleranceMinutes: number | null;
};

export type MonitorData = {
  generatedAt: string;
  stationId: string | null;
  summary: {
    expected: number;
    present: number;
    late: number;
    absent: number;
    closed: number;
  };
  rows: MonitorRow[];
};

export type AttendanceHistoryRow = {
  shiftId: string;
  station: { id: string; name: string; timezone: string };
  template: string | null;
  plannedStart: string;
  plannedEnd: string;
  plannedHours: number;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  isLate: boolean;
  isAbsent: boolean;
  corrected: boolean;
  correctedAt: string | null;
  correctionReason: string | null;
};

export type SupervisionProps = {
  user: User;
  onChanged?: () => void;
};

export const STATUS_LABEL: Record<MonitorRow["status"], string> = {
  EXPECTED: "Attendu",
  PRESENT: "Présent",
  LATE: "En retard",
  ABSENT: "Absent",
  CLOSED: "Fin de service",
};

export const URGENCY_LABEL: Record<PendingReplacement["urgency"], string> = {
  CRITICAL: "Critique",
  HIGH: "Élevée",
  NORMAL: "Normale",
};
