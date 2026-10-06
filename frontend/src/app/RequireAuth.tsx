import { Navigate } from "react-router-dom";
import { rolePaths, type Role } from "../api/auth-api";
import { RouteFallback } from "./RouteFallback";
import { useSession } from "./session";

export function RequireAuth({ role, children }: { role: Role; children: React.ReactNode }) {
  const { session, checking } = useSession();
  if (checking) return <RouteFallback />;
  if (!session) return <Navigate to="/auth/login" replace />;
  if (session.user.role !== role) {
    return <Navigate to={rolePaths[session.user.role]} replace />;
  }
  return <>{children}</>;
}
