import type { User } from "../../api/auth-api";

export type PendingReplacement = {
  requestId: string;
  shiftId: string;
  station: {
    id: string;
    name: string;
    timezone: string;
  };
  swapper: {
    id: string;
    fullName: string;
  };
  assignedSwapper?: {
    id: string;
    fullName: string;
  } | null;
  startTime: string;
  endTime: string;
  status?: "OPEN" | "ASSIGNED" | "CANCELLED" | "RESOLVED";
  urgency: "CRITICAL" | "HIGH" | "NORMAL";
  hoursUntilStart: number;
  origin: "AUTOMATIC_ABSENCE" | "DECLARATION";
  reason: string | null;
  reportedAt: string | null;
  template?: string | null;
};

export type Candidate = {
id: string;
fullName: string;
email: string;
eligible: boolean;
issues: {
code: string;
message: string;
}[];
};

export type ShiftChange = {
  id: string;
  type:
    | "REPLACEMENT"
    | "SWAP"
    | "REASSIGNMENT";
  rawType?: string;
  initiator: string;
  station: string;
  outSwapper: string | null;
  inSwapper: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
};

export type AttendanceHistoryRow = {
shiftId: string;
station: {
id: string;
name: string;
timezone: string;
};
plannedStart: string;
plannedEnd: string;
plannedHours: number;
checkedInAt: string | null;
checkedOutAt: string | null;
status:
| "EXPECTED"
| "CHECKED_IN"
| "CHECKED_OUT"
| "ABSENT"
| "JUSTIFIED";
isLate: boolean;
absenceReason: string | null;
};

export type SupervisionProps = {
user: User;
onChanged?: () => void;
};

export type SupervisorMonitorRow = {
  id: string;
  station: {
    id: string;
    name: string;
  };
  shift: {
    id: string;
    startTime: string;
    endTime: string;
  };
  swapper: {
    id: string;
    fullName: string;
  };
  attendanceId: string | null;
  status: MonitorStatus;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

export type MonitorStatus =
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "CLOSED"
  | "EXPECTED";

export type MonitorRow = {
  id: string;
  shiftId: string;
  status: MonitorStatus;
  swapper: {
    id: string;
    fullName: string;
  };
  station: {
    id: string;
    name: string;
    timezone: string;
    latenessToleranceMinutes: number;
  };
  startTime: string;
  endTime: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  isLate?: boolean;
};

export type MonitorData = {
  generatedAt: string;
  rows: MonitorRow[];
};

export const STATUS_LABEL = {
EXPECTED: "Attendu",
PRESENT: "À l’heure",
LATE: "En retard",
ABSENT: "Absent",
CLOSED: "Fin de service",
} as const;

export const URGENCY_LABEL: Record<
PendingReplacement["urgency"],
string
> = {
CRITICAL: "Critique",
HIGH: "Élevée",
NORMAL: "Normale",
};