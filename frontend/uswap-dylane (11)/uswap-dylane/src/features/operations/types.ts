import type { User } from "../../api/auth-api";

export type OperationShift = {
  id: string;
  planningId: string;
  templateId: string;
  label: string;
  startTime: string;
  endTime: string;
  publishedAt: string | null;
  station: { id?: string; name: string; timezone?: string };
  swapper: { fullName: string };
  attendance: {
    status: "PRESENT" | "LATE" | "CLOSED" | "JUSTIFIED" | "ABSENT";
    checkedInAt: string;
    checkedOutAt: string | null;
    isLate: boolean;
  } | null;
};

export type OperationData = {
  station: {
    id: string;
    name: string;
    location: string | null;
    timezone?: string;
  } | null;
  limit: number;
  shifts: OperationShift[];
};

export type ScanResult = {
  kind: "CHECKIN" | "CHECKOUT";
  status: "PRESENT" | "LATE" | "CLOSED";
  checkedInAt: string;
  checkedOutAt?: string | null;
  toleranceMinutes?: number;
  timezone: string;
};

export type Qr = {
  token: string;
  kind: string;
  shiftId: string;
  stationName: string;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
  timezone: string;
};

export type OperationsViewProps = {
  user: User;
  data: OperationData;
  onChanged: () => void;
};
