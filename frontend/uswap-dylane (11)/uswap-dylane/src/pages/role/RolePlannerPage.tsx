import { useOutletContext } from "react-router-dom";
import { useSession } from "../../app/session";
import { Planner } from "../../features/planner/Planner";

export function RolePlannerPage() {
  const { session } = useSession();
  const { planningResetKey } = useOutletContext<{ planningResetKey: number }>();
  if (!session) return null;
  return <Planner key={planningResetKey} user={session.user} />;
}
