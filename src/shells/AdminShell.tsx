import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CaretDownIcon } from "@phosphor-icons/react";
import { AccountMenu } from "../features/account/AccountMenu";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { interceptNav } from "../app/spaNav";
import { RouteFallback } from "../app/RouteFallback";
import { useSession } from "../app/session";
import { SidebarToggle } from "./SidebarToggle";
import { AppTopbar } from "./AppTopbar";
import {
  Building2,
  Clock3,
  LayoutDashboard,
  UserRound,
  Users,
  Zap,
} from "../ui/icons";
import "../styles/admin.css";
import "../styles/shell.css";

const sections = [
  { path: "/app/admin", label: "Accueil", Icon: LayoutDashboard },
  { path: "/app/admin/utilisateurs", label: "Utilisateurs", Icon: Users },
  { path: "/app/admin/stations", label: "Stations", Icon: Building2 },
  { path: "/app/admin/plannings", label: "Plannings", Icon: Clock3 },
  { path: "/app/admin/compte", label: "Paramètres du compte", Icon: UserRound },
];

const sectionDescriptions: Record<string, string> = {
  "/app/admin":
    "Suivez l’activité du réseau et accédez rapidement aux tâches prioritaires.",
  "/app/admin/utilisateurs":
    "Gérez les collaborateurs, leurs rôles, leurs stations et leurs accès.",
  "/app/admin/stations":
    "Configurez les stations, leurs règles, leurs shifts et leur localisation.",
  "/app/admin/plannings": "Créez, publiez et ajustez les horaires des équipes.",
  "/app/admin/compte":
    "Mettez à jour vos informations et vos préférences de compte.",
};

export function AdminShell() {
  const { session, busy, warning, error, disconnect, extend } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const title = useRef<HTMLHeadingElement>(null);
  const currentPathOnly = location.pathname;
  const [stationsOpen, setStationsOpen] = useState(
    currentPathOnly.startsWith("/app/admin/stations"),
  );
  const [currentSubTab, setCurrentSubTab] = useState<"list" | "map">(() =>
    new URLSearchParams(location.search).get("tab") === "map" ? "map" : "list",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("uswap:sidebar-collapsed") === "true",
  );

  const section =
    sections.find((item) => item.path === currentPathOnly) ||
    sections.find(
      (item) =>
        item.path !== "/app/admin" && currentPathOnly.startsWith(item.path),
    ) ||
    sections[0];

  useEffect(() => {
    setStationsOpen(currentPathOnly.startsWith("/app/admin/stations"));
  }, [currentPathOnly]);

  useEffect(() => {
    setCurrentSubTab(
      new URLSearchParams(location.search).get("tab") === "map"
        ? "map"
        : "list",
    );
  }, [location.pathname, location.search]);

  useEffect(() => {
    localStorage.setItem("uswap:sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.title = `${section.label} · Administration uSwap`;
  }, [section.label]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    requestAnimationFrame(() => title.current?.focus());
  }, [location.pathname, location.search]);

  function go(
    event: MouseEvent<HTMLAnchorElement>,
    target: string,
    subTab?: "list" | "map",
  ) {
    if (!interceptNav(event, navigate, target)) return;
    if (subTab) setCurrentSubTab(subTab);
  }

  const link = (target: string, subTab?: "list" | "map") => ({
    href: target,
    onClick: (event: MouseEvent<HTMLAnchorElement>) =>
      go(event, target, subTab),
  });

  if (!session) return null;

  return (
    <div
      className={`admin-workspace${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
    >
      <a className="admin-skip" href="#admin-main">
        Aller au contenu
      </a>
      <aside className="admin-sidebar">
        <SidebarToggle
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
        />
        <a
          className="brand"
          {...link("/app/admin")}
          aria-label="uSwap, accueil administrateur"
        >
          <span className="brand-symbol">
            <Zap fill="currentColor" />
          </span>
          <span className="brand-lockup">
            <span className="brand-name">
              u<span className="brand-swap">Swap</span>
              <span className="brand-dot">.</span>
            </span>
            <span className="brand-endorsement">
              Powered by <strong>uPowa</strong>
            </span>
          </span>
        </a>

        <nav aria-label="Navigation administrateur">
          {sections
            .filter((item) => !item.path.endsWith("compte"))
            .map(({ path: target, label, Icon }) => {
              const isStations = target === "/app/admin/stations";
              const isCurrent = currentPathOnly === target;
              const stationsActive = currentPathOnly.startsWith(
                "/app/admin/stations",
              );

              return (
                <div key={target} className="admin-nav-group">
                  <div className="admin-nav-row">
                    {isStations ? (
                      <button
                        type="button"
                        aria-current={stationsActive ? "page" : undefined}
                        onClick={() => {
                          setStationsOpen(true);
                          setCurrentSubTab("list");
                          navigate("/app/admin/stations?tab=list");
                        }}
                      >
                        <Icon size={19} />
                        <span>{label}</span>
                        <CaretDownIcon
                          size={14}
                          className={`admin-nav-caret${stationsOpen ? " is-open" : ""}`}
                        />
                      </button>
                    ) : (
                      <a
                        {...link(target)}
                        onClick={(e) => {
                          setStationsOpen(false);
                          go(e, target);
                        }}
                        aria-current={isCurrent ? "page" : undefined}
                      >
                        <Icon size={19} />
                        <span>{label}</span>
                        {isCurrent && <i />}
                      </a>
                    )}
                  </div>

                  {isStations && stationsOpen && (
                    <div className="admin-station-subnav">
                      <a
                        {...link("/app/admin/stations?tab=list", "list")}
                        aria-current={
                          currentSubTab === "list" && stationsActive
                            ? "page"
                            : undefined
                        }
                      >
                        Mes stations
                      </a>
                      <a
                        {...link("/app/admin/stations?tab=map", "map")}
                        aria-current={
                          currentSubTab === "map" && stationsActive
                            ? "page"
                            : undefined
                        }
                      >
                        Carte des stations
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
        </nav>
      </aside>

      <div className="admin-body">
        <AppTopbar
          title={section.label}
          description={sectionDescriptions[section.path]}
          headingRef={title}
          actions={
            <>
              <NotificationBell />
              <AccountMenu
                user={session.user}
                busy={busy}
                onLogout={disconnect}
                settingsPath="/app/admin/compte"
              />
            </>
          }
        />

        <main id="admin-main" className="admin-content">
          {warning && (
            <div className="session-warning" role="alert">
              <Clock3 size={18} />
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
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
