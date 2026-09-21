import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AccountMenu } from "../features/account/AccountMenu";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { interceptNav } from "../app/spaNav";
import { RouteFallback } from "../app/RouteFallback";
import { useSession } from "../app/session";
import { roles, rolePaths } from "../api/auth-api";
import { Clock3, LayoutDashboard, UserRound, Zap } from "../ui/icons";
import "../styles/admin.css";

export function RoleShell() {
  const { session, busy, warning, error, disconnect, extend } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [planningResetKey, setPlanningResetKey] = useState(0);

  const planning = location.pathname.endsWith("/plannings");
  const account = location.pathname.endsWith("/compte");
  const title =
    session?.user.role === "SUPERVISOR"
      ? "Supervision"
      : session?.user.role === "STATION_CHIEF"
        ? "Ma station"
        : "Mon espace";
  const homePath = session ? rolePaths[session.user.role] : "/auth/login";

  useEffect(() => {
    document.title = `${account ? "Paramètres du compte" : planning ? "Plannings" : title} · uSwap`;
  }, [account, planning, title]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [location.pathname, location.search]);

  if (!session) return null;

  function goHome(event: React.MouseEvent<HTMLAnchorElement>) {
    interceptNav(event, navigate, homePath);
  }

  function goAccount(event: React.MouseEvent<HTMLAnchorElement>) {
    interceptNav(event, navigate, `${homePath}/compte`);
  }

  function goPlannings(event: React.MouseEvent<HTMLAnchorElement>) {
    if (planning) setPlanningResetKey((n) => n + 1);
    interceptNav(event, navigate, `${homePath}/plannings`);
  }

  return (
    <div className="admin-workspace role-workspace">
      <a className="admin-skip" href="#role-main">
        Aller au contenu
      </a>
      <aside className="admin-sidebar">
        <a className="brand" href={homePath} onClick={goHome}>
          <span className="brand-symbol">
            <Zap weight="fill" />
          </span>
          <span className="brand-lockup">
            <span className="brand-name">
              uSwap<span className="brand-dot">.</span>
            </span>
            <span className="brand-endorsement">
              Powered by <strong>uPowa</strong>
            </span>
          </span>
        </a>
        <nav aria-label={`Navigation ${roles[session.user.role]}`}>
          <a
            href={homePath}
            onClick={goHome}
            aria-current={!account && !planning ? "page" : undefined}
          >
            <LayoutDashboard />
            {title}
          </a>
          <a
            href={`${homePath}/plannings`}
            onClick={goPlannings}
            aria-current={planning ? "page" : undefined}
          >
            <Clock3 />
            Plannings
          </a>
          <a
            href={`${homePath}/compte`}
            onClick={goAccount}
            aria-current={account ? "page" : undefined}
          >
            <UserRound />
            Mon compte
          </a>
        </nav>
      </aside>
      <div className="admin-body">
        <header className="admin-topbar">
          <span className="admin-mobile-brand">
            uSwap<span>.</span>
          </span>
          <h1 ref={headingRef} tabIndex={-1} className="admin-breadcrumb">
            {account ? "Paramètres du compte" : planning ? "Plannings" : title}
          </h1>
          <div className="admin-topbar__actions">
            <NotificationBell />
            <AccountMenu
              user={session.user}
              busy={busy}
              onLogout={disconnect}
              settingsPath={`${homePath}/compte`}
            />
          </div>
        </header>
        <main id="role-main" className="admin-content">
          {warning && (
            <div className="session-warning" role="alert">
              <Clock3 />
              <div>
                Votre session va expirer.
                <button
                  className="text-button"
                  onClick={() => void extend()}
                  disabled={busy}
                >
                  Prolonger ma session
                </button>
              </div>
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <Suspense fallback={<RouteFallback label="Chargement de la page…" />}>
            <Outlet context={{ planningResetKey }} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
