import type {
  IncidentSeverity,
  IncidentStatus,
  LeaveRequestStatus,
  SyncOperationStatus,
} from "../api/mock/types";
import type { Role } from "../api/auth-api";

export type LeaveType = "ANNUAL" | "SICK" | "FAMILY" | "UNPAID" | "OTHER";

export type LeaveRequestView = {
  id: string;
  startTime: string;
  endTime: string;
  type: LeaveType;
  status: LeaveRequestStatus;
  reason: string;
  attachmentName: string | null;
  editable: boolean;
  cancellable: boolean;
  syncStatus: SyncOperationStatus | null;
  updatedAt: string;
};

export type LeaveBalanceView = {
  year: number;
  entitledDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  syncedAt: string;
};

export type LeaveWorkspaceView = {
  balance: LeaveBalanceView;
  requests: LeaveRequestView[];
  integration: {
    available: boolean;
    lastSuccessfulSyncAt: string | null;
    pendingOperations: number;
  };
};

export type IncidentView = {
  id: string;
  stationId: string;
  stationName: string;
  category: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  reporterName: string;
  assigneeName: string | null;
  occurredAt: string;
  updatedAt: string;
};

export type DashboardFilters = {
  startDate: string;
  endDate: string;
  stationId?: string;
  swapperId?: string;
};

export type DashboardKpi = {
  key: string;
  label: string;
  value: number;
  unit: "COUNT" | "PERCENT" | "HOURS" | "DAYS";
  trend: number | null;
  tone: "NEUTRAL" | "SUCCESS" | "WARNING" | "DANGER";
};

export const sprint4Permissions: Record<
  Role,
  ReadonlyArray<
    | "LEAVE_SELF"
    | "INCIDENT_REPORT"
    | "INCIDENT_MANAGE"
    | "DASHBOARD_SCOPE"
    | "INTEGRATION_HEALTH"
    | "SCHEDULE_REPORT"
  >
> = {
  SWAPPER: ["LEAVE_SELF"],
  STATION_CHIEF: ["INCIDENT_REPORT", "DASHBOARD_SCOPE"],
  SUPERVISOR: ["INCIDENT_MANAGE", "DASHBOARD_SCOPE"],
  ADMIN: ["INTEGRATION_HEALTH", "SCHEDULE_REPORT"],
};

export function canUseSprint4(
  role: Role,
  permission: (typeof sprint4Permissions)[Role][number],
) {
  return sprint4Permissions[role].includes(permission);
}
