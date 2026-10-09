import type { User } from "../../api/auth-api";

export type OperationShift = {
  id: string;
  planningId: string;
  templateId: string;
  label: string;
  startTime: string;
  endTime: string;
  publishedAt: string | null;
  station: {
    id?: string;
    name: string;
    timezone?: string;
    latitude?: number | null;
    longitude?: number | null;
    geofenceRadiusMeters?: number;
    latenessToleranceMinutes?: number;
  };
  swapper: { fullName: string };
  attendance: {
    status: "EXPECTED" | "PRESENT" | "LATE" | "CLOSED" | "JUSTIFIED" | "ABSENT";
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
    latitude?: number | null;
    longitude?: number | null;
    geofenceRadiusMeters?: number;
    latenessToleranceMinutes?: number;
  } | null;
  limit: number;
  shifts: OperationShift[];
};

export type PunchResult = {
  kind: "CHECKIN" | "CHECKOUT";
  status: "PRESENT" | "LATE" | "CLOSED";
  checkedInAt: string;
  checkedOutAt?: string | null;
  toleranceMinutes?: number;
  timezone: string;
  distanceMeters?: number;
};

export type OperationsViewProps = {
  user: User;
  data: OperationData;
  onChanged: () => void;
};
