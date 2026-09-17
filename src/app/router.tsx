import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { rolePaths, type Role } from "../api/auth-api";
import { captureQrToken, qrHomePath } from "../features/operations/qrToken";
import { RequireAuth } from "./RequireAuth";
import { RouteFallback } from "./RouteFallback";
import { useSession } from "./session";
import { LoginPage } from "../pages/LoginPage";

const AdminShell = lazy(() => import("../shells/AdminShell").then((m) => ({ default: m.AdminShell })));
const RoleShell = lazy(() => import("../shells/RoleShell").then((m) => ({ default: m.RoleShell })));

const AccountAccessPage = lazy(() =>
  import("../pages/AccountAccessPage").then((m) => ({ default: m.AccountAccessPage })),
);
const AccountPage = lazy(() => import("../pages/AccountPage").then((m) => ({ default: m.AccountPage })));

const AdminHomePage = lazy(() =>
  import("../pages/admin/AdminHomePage").then((m) => ({ default: m.AdminHomePage })),
);
const UsersPage = lazy(() => import("../pages/admin/UsersPage").then((m) => ({ default: m.UsersPage })));
const UserImportPage = lazy(() =>
  import("../pages/admin/UserImportPage").then((m) => ({ default: m.UserImportPage })),
);
const UserDetailPage = lazy(() =>
  import("../pages/admin/UserDetailPage").then((m) => ({ default: m.UserDetailPage })),
);
const StationsPage = lazy(() =>
  import("../pages/admin/StationsPage").then((m) => ({ default: m.StationsPage })),
);
const AdminPlannerPage = lazy(() =>
  import("../pages/admin/AdminPlannerPage").then((m) => ({ default: m.AdminPlannerPage })),
);

const OperationsPage = lazy(() =>
  import("../pages/role/OperationsPage").then((m) => ({ default: m.OperationsPage })),
);
const RolePlannerPage = lazy(() =>
  import("../pages/role/RolePlannerPage").then((m) => ({ default: m.RolePlannerPage })),
);

function page(node: ReactNode) {
  return <Suspense fallback={<RouteFallback label="Chargement de la page…" />}>{node}</Suspense>;
}

const ROLE_SPACES: Role[] = ["SUPERVISOR", "STATION_CHIEF", "SWAPPER"];

function AccountRoute({ mode }: { mode: "forgot" | "activate" | "reset" }) {
  return (
    <Suspense fallback={<RouteFallback label="Chargement…" />}>
      <AccountAccessPage mode={mode} />
    </Suspense>
  );
}

function CatchAll() {
  const { session, checking } = useSession();
  captureQrToken();
  if (checking) return <RouteFallback />;
  if (session) return <Navigate to={qrHomePath(rolePaths[session.user.role], session.user.role)} replace />;
  return <Navigate to="/auth/login" replace />;
}

function RoleCatchAll({ role }: { role: Role }) {
  captureQrToken();
  return <Navigate to={qrHomePath(rolePaths[role], role)} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/forgot-password" element={<AccountRoute mode="forgot" />} />
      <Route path="/auth/activate" element={<AccountRoute mode="activate" />} />
      <Route path="/auth/reset-password" element={<AccountRoute mode="reset" />} />

      <Route path={rolePaths.ADMIN} element={<RequireAuth role="ADMIN">{page(<AdminShell />)}</RequireAuth>}>
        <Route index element={page(<AdminHomePage />)} />
        <Route path="utilisateurs" element={page(<UsersPage />)} />
        <Route path="utilisateurs/nouveau" element={page(<UsersPage />)} />
        <Route path="utilisateurs/import" element={page(<UserImportPage />)} />
        <Route path="utilisateurs/:id" element={page(<UserDetailPage />)} />
        <Route path="stations" element={page(<StationsPage />)} />
        <Route path="plannings" element={page(<AdminPlannerPage />)} />
        <Route path="compte" element={page(<AccountPage />)} />
        <Route path="*" element={<Navigate to={rolePaths.ADMIN} replace />} />
      </Route>

      {ROLE_SPACES.map((role) => (
        <Route
          key={role}
          path={rolePaths[role]}
          element={<RequireAuth role={role}>{page(<RoleShell />)}</RequireAuth>}
        >
          <Route index element={page(<OperationsPage />)} />
          <Route path="plannings" element={page(<RolePlannerPage />)} />
          <Route path="compte" element={page(<AccountPage />)} />
          <Route path="*" element={<RoleCatchAll role={role} />} />
        </Route>
      ))}

      <Route path="*" element={<CatchAll />} />
    </Routes>
  );
}
