import { useSession } from "../../app/session";
import { Planner } from "../../features/planner/Planner";

export function AdminPlannerPage() {
  const { session } = useSession();
  if (!session) return null;
  return <Planner user={session.user} />;
}
