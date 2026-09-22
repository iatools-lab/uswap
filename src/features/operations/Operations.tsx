import { SwapperHome } from "./SwapperHome";
import { ChiefHome } from "./ChiefHome";
import { SupervisorHome } from "./SupervisorHome";
import { AttendanceMonitor } from "../supervision/AttendanceMonitor";
import { MyAttendanceHistory } from "../supervision/MyAttendanceHistory";
import type { OperationData } from "./types";
import type { User } from "../../api/auth-api";
import "./operations.css";

export type { OperationData };

export function Operations({
  user,
  data,
  onChanged,
}: {
  user: User;
  data: OperationData;
  onChanged: () => void;
}) {
  if (user.role === "SWAPPER")
    return (
      <div className="operations-stack">
        <SwapperHome user={user} data={data} onChanged={onChanged} />
        <MyAttendanceHistory swapperId={user.id} />
      </div>
    );
  if (user.role === "STATION_CHIEF")
    return (
      <div className="operations-stack">
        <ChiefHome user={user} data={data} onChanged={onChanged} />
        <AttendanceMonitor user={user} />
      </div>
    );
  if (user.role === "SUPERVISOR")
    return (
      <div className="operations-stack">
        <SupervisorHome user={user} data={data} onChanged={onChanged} />
      </div>
    );
  return null;
}
