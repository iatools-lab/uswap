import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CaretDownIcon } from "../ui/icons";
import { AccountMenu } from "../features/account/AccountMenu";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { interceptNav } from "../app/spaNav";
import { RouteFallback } from "../app/RouteFallback";
import { useSession } from "../app/session";
import { appBase } from "../app/appBase";
import { SidebarToggle } from "./SidebarToggle";
import { AppTopbar } from "./AppTopbar";
import { BrandSignature } from "../ui/BrandSignature";
import {
  Building2,
  CalendarBlank,
  Clock3,
  Gear,
  LayoutDashboard,
  History,
  BroomIcon as Broom,
  UserRound,
  Users,
} from "../ui/icons";
import "../styles/admin.css";
import "../styles/shell.css";

/**
 * Sections de l'espace de pilotage. Elles sont les mêmes pour l'administrateur
 * et le super administrateur : seul le préfixe change, et le super
 * administrateur dispose en plus du menu « Nettoyage des données ».
 */
function buildSections(base: string, superAdmin: boolean) {
  const rows = [
    { behind: "", label: "Accueil", Icon: LayoutDashboard },
    { behind: "/utilisateurs", label: "Utilisateurs", Icon: Users },
    { behind: "/stations", label: "Stations", Icon: Building2 },
    { behind: "/plannings", label: "Plannings", Icon: Clock3 },
    { behind: "/conges", label: "Congés", Icon: CalendarBlank },
    { behind: "/audit", label: "Journal d’audit", Icon: History },
    { behind: "/parametres", label: "Réglages globaux", Icon: Gear },
    ...(superAdmin
      ? [
          {
            behind: "/nettoyage",
            label: "Nettoyage des données",
            Icon: Broom,
          },
        ]
      : []),
    { behind: "/compte", label: "Paramètres du compte", Icon: UserRound },
  ];
  return rows.map((row) => ({ ...row, path: `${base}${row.behind}` }));
}

const sectionDescriptions: Record<string, string> = {
  "": "Suivez l’activité du réseau et accédez rapidement aux tâches prioritaires.",
  "/utilisateurs":
    "Gérez les collaborateurs, leurs rôles, leurs stations et leurs accès.",
  "/stations":
    "Configurez les stations, leurs règles, leurs shifts et leur localisation.",
  "/plannings": "Créez, publiez et ajustez les horaires des équipes.",
  "/conges": "Examinez les demandes et suivez les périodes approuvées.",
  "/audit": "Consultez les actions enregistrées et leur contexte.",
  "/parametres": "Définissez les règles communes de la plateforme.",
  "/nettoyage":
    "Supprimez les données de recette pour repartir sur une configuration réelle.",
  "/compte":
    "Mettez à jour vos informations et vos préférences de compte.",
};

export function AdminShell() {
  const { session, busy, warning, error, disconnect, extend } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const title = useRef<HTMLHeadingElement>(null);
  const currentPathOnly = location.pathname;
  const base = appBase(session?.user.role);
  const sections = useMemo(
    () => buildSections(base, session?.user.role === "SUPER_ADMIN"),
    [base, session?.user.role],
  );
  const sectionDescriptionsFor = (path: string) =>
    sectionDescriptions[path.slice(base.length).split("?")[0]] ??
    sectionDescriptions[""];
  const [stationsOpen, setStationsOpen] = useState(
    currentPathOnly.startsWith(`${base}/stations`),
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
      (item) => item.path !== base && currentPathOnly.startsWith(item.path),
    ) ||
    sections[0];

  useEffect(() => {
    setStationsOpen(currentPathOnly.startsWith(`${base}/stations`));
  }, [currentPathOnly, base]);

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
    document.title = `${section.label} · ${
      session?.user.role === "SUPER_ADMIN"
        ? "Super administration uSwap"
        : "Administration uSwap"
    }`;
  }, [section.label, session?.user.role]);

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
        <div className="admin-sidebar-header">
          <a
            className="brand"
            {...link(base)}
            aria-label="uSwap, accueil administrateur"
          >
            <BrandSignature />
          </a>
          <SidebarToggle
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((value) => !value)}
          />
        </div>

        <nav aria-label="Navigation administrateur">
          {sections
            .filter((item) => !item.path.endsWith("compte"))
            .map(({ path: target, label, Icon }) => {
              const isStations = target === `${base}/stations`;
              const isCurrent = currentPathOnly === target;
              const stationsActive = currentPathOnly.startsWith(
                `${base}/stations`,
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
                          navigate(`${base}/stations?tab=list`);
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
                        href={target}
                        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                          setStationsOpen(false);
                          go(event, target);
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
                        {...link(`${base}/stations?tab=list`, "list")}
                        aria-current={
                          currentSubTab === "list" && stationsActive
                            ? "page"
                            : undefined
                        }
                      >
                        Mes stations
                      </a>
                      <a
                        {...link(`${base}/stations?tab=map`, "map")}
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
          description={sectionDescriptionsFor(section.path)}
          headingRef={title}
          actions={
            <>
              <NotificationBell />
              <AccountMenu
                user={session.user}
                busy={busy}
                onLogout={disconnect}
                settingsPath={`${base}/compte`}
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
