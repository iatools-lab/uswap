import { useSession } from "../../app/session";
import { SupervisionPanel } from "../../features/supervision/SupervisionPanel";

export function SupervisorAttendancePage() {
  const { session } = useSession();

  if (!session || session.user.role !== "SUPERVISOR") return null;

  return <SupervisionPanel user={session.user} />;
}
