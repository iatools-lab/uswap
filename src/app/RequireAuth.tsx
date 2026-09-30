import { Navigate } from "react-router-dom";
import { rolePaths, type Role } from "../api/auth-api";
import { captureQrToken, qrHomePath } from "../features/operations/qrToken";
import { RouteFallback } from "./RouteFallback";
import { useSession } from "./session";

export function RequireAuth({ role, children }: { role: Role; children: React.ReactNode }) {
  const { session, checking } = useSession();
  captureQrToken();
  if (checking) return <RouteFallback />;
  if (!session) return <Navigate to="/auth/login" replace />;
  if (session.user.role !== role) {
    return <Navigate to={qrHomePath(rolePaths[session.user.role], session.user.role)} replace />;
  }
  return <>{children}</>;
}
