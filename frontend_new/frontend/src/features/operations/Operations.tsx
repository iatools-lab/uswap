import { SwapperHome } from "./SwapperHome";
import { SupervisorHome } from "./SupervisorHome";
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
