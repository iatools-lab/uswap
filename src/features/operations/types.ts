import type { User } from "../../api/auth-api";

export type OperationShift = {
  id: string;
  startTime: string;
  endTime: string;
  publishedAt: string | null;
  station: { id?: string; name: string };
  swapper: { fullName: string };
  attendance: {
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
  status: "ON_TIME" | "LATE" | "CLOSED";
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
