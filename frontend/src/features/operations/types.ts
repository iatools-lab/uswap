import type { User } from "../../api/auth-api";

export type OperationAttendance = {
  id: string;
  status: "EXPECTED" | "CHECKED_IN" | "CHECKED_OUT" | "ABSENT" | "JUSTIFIED";
  checkInAt: string | null;
  checkOutAt: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  isLate: boolean;
  absenceReason?: string | null;
};

export type OperationShift = {
id: string;
startTime: string;
endTime: string;
publishedAt: string | null;
station: {
id?: string;
name: string;
timezone?: string;
latenessToleranceMinutes?: number;
};
swapper: {
fullName: string;
};
attendance: OperationAttendance | null;
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
checkedInAt: string | null;
checkedOutAt: string | null;
toleranceMinutes: number;
timezone: string;
};

export type Qr = {
  id: string;
  token: string;
  type: "START" | "END";
  kind?: "CHECKIN" | "CHECKOUT";
  shiftId: string;
  stationId: string;
  stationName?: string;
  timezone?: string;
  expiresAt: string;
  ttlSeconds: number;
};

export type OperationsViewProps = {
user: User;
data: OperationData;
onChanged: () => void;
};
