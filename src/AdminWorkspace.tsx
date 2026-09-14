import { Modal } from "./modal";
import { Planner } from "./Planner";
import {
  FunnelIcon,
  SortAscendingIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { AccountMenu } from "./AccountMenu";
import { AccountSettings } from "./AccountSettings";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  UserRound,
  Users,
  Zap,
} from "./icons";
import { api, ApiError, roles, type User } from "./auth-api";
import "./admin.css";
import { UserCreateModal } from "./UserCreateModal";
import { UserImport } from "./UserImport";
import { UserDetail } from "./UserDetail";
import { StationManager, type StationData } from "./StationManager";
import { CaretDownIcon } from "@phosphor-icons/react";
import { notify } from "./Notifications";

type Member = User & {
  isActive: boolean;
  pendingActivation?: boolean;
  disabledAt?: string | null;
  plannedStationIds?: string[];
  stationId: string | null;
  createdAt: string;
};

type Station = {
  id: string;
  name: string;
  isActive: boolean;
  location: string | null;
  timezone: string;
  contactName: string | null;
  contactPhone: string | null;
};

const sections = [
  { path: "/app/admin", label: "Accueil", Icon: LayoutDashboard },
  { path: "/app/admin/utilisateurs", label: "Utilisateurs", Icon: Users },
  { path: "/app/admin/stations", label: "Stations", Icon: Building2 },
  { path: "/app/admin/plannings", label: "Plannings", Icon: Clock3 },
  { path: "/app/admin/compte", label: "Paramètres du compte", Icon: UserRound },
];

export const isAdminPath = (path: string) =>
  sections.some((section) => section.path === path) ||
  [
    "/app/admin/utilisateurs/nouveau",
    "/app/admin/utilisateurs/import",
  ].includes(path) ||
  /^\/app\/admin\/utilisateurs\/[a-f0-9-]{36}$/.test(path);

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

function CustomSelect({
  value,
  options,
  onChange,
  placeholder = "Sélectionner",
  width = "auto",
}: {
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (val: any) => void;
  placeholder?: string;
  width?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick as EventListener);
    return () => document.removeEventListener("mousedown", handleOutsideClick as EventListener);
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative", width, minWidth: "160px" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          height: "36px",
          background: "#fff",
          border: "1px solid #dfe5ef",
          borderRadius: "8px",
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12.5px",
          color: "#18243e",
          cursor: "pointer",
          boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <CaretDownIcon
          size={14}
          style={{
            color: "#64748b",
            marginLeft: "8px",
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "100%",
            minWidth: "180px",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.12)",
            padding: "4px",
            zIndex: 50,
            display: "grid",
            gap: "2px",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                fontSize: "12.5px",
                background: value === opt.value ? "#f1f5f9" : "transparent",
                color: "#0f172a",
                fontWeight: value === opt.value ? 600 : 400,
                border: 0,
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminWorkspace({
  user,
  busy,
  warning,
  error,
  onLogout,
  onExtend,
  onAccessLost,
}: {
  user: User;
  busy: boolean;
  warning: boolean;
  error: string;
  onLogout: () => void;
  onExtend: () => void;
  onAccessLost: () => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState("recent");
  const [currentSubTab, setCurrentSubTab] = useState<"list" | "map">(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("tab") === "map" ? "map" : "list";
  });
  const [path, setPath] = useState(location.pathname + location.search);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dismissOnboarding, setDismissOnboarding] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({
    all: 0,
    active: 0,
    pending: 0,
    inactive: 0,
  });
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [stations, setStations] = useState<Station[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [stationsOpen, setStationsOpen] = useState(false);

  // État pour gérer la modale de confirmation utilisateur
  const [confirmingMember, setConfirmingMember] = useState<Member | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [plannedStation, setPlannedStation] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  async function exportUsers() {
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams({
        q: query,
        role,
        status,
        stationId: plannedStation,
      });
      const result = await api<{ csv: string; filename: string }>(
        "/users/export?" + params,
      );
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const title = useRef<HTMLHeadingElement>(null);
  const currentPathOnly = location.pathname;
  const section =
    sections.find((section) => section.path === currentPathOnly) ||
    (currentPathOnly.startsWith("/app/admin/utilisateurs/") ? sections[1] : sections[0]);
  const creating = currentPathOnly === "/app/admin/utilisateurs/nouveau";
  const importing = currentPathOnly === "/app/admin/utilisateurs/import";
  const memberId = currentPathOnly.match(
    /^\/app\/admin\/utilisateurs\/([a-f0-9-]{36})$/,
  )?.[1];

  function backToUsers() {
    history.pushState(null, "", "/app/admin/utilisateurs");
    setPath("/app/admin/utilisateurs");
  }

  const home = section.path === "/app/admin";

  // Synchronisation automatique de l'état ouvert/fermé du sous-menu Stations selon l'URL active
  useEffect(() => {
    if (currentPathOnly.startsWith("/app/admin/stations")) {
      setStationsOpen(true);
    } else {
      setStationsOpen(false);
    }
  }, [currentPathOnly]);

  useEffect(() => {
    const navigate = () => {
      const p = new URLSearchParams(window.location.search);
      setCurrentSubTab(p.get("tab") === "map" ? "map" : "list");
      setPath(location.pathname + location.search);
      setQuery("");
      setRole("");
      setStatus("");
      setCurrentPage(1);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);

  useEffect(() => {
    document.title = `${section.label} · Administration uSwap`;
  }, [section.label]);

  useEffect(() => {
    let active = true;
    setLoading(members === null);
    setListLoading(true);
    setLoadError("");
    const params = new URLSearchParams(
      home
        ? { limit: "1" }
        : {
            page: String(currentPage),
            limit: "8",
            q: debouncedQuery,
            role,
            status,
            stationId: plannedStation,
            sort,
          },
    );
    Promise.all([
      api<{
        data: Member[];
        total: number;
        page: number;
        totalPages: number;
        statusCounts: Record<string, number>;
      }>("/users/page?" + params),
      api<Station[]>("/stations"),
    ])
      .then(([membersData, stationsData]) => {
        if (active) {
          setMembers(membersData.data);
          setCounts(membersData.statusCounts);
          setTotal(membersData.total);
          setLastPage(membersData.totalPages);
          setCurrentPage(membersData.page);
          setStations(stationsData);
        }
      })
      .catch((errorData) => {
        if (!active) return;
        setMembers(null);
        setStations(null);
        if (errorData instanceof ApiError && [401, 403].includes(errorData.status))
          onAccessLost();
        else setLoadError("Les données n’ont pas pu être chargées. Réessayez.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setListLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    user.id,
    revision,
    currentPathOnly,
    currentPage,
    debouncedQuery,
    role,
    status,
    plannedStation,
    sort,
    home,
    onAccessLost,
  ]);

  function go(event: MouseEvent<HTMLAnchorElement>, target: string, subTab?: "list" | "map") {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    if (subTab) setCurrentSubTab(subTab);
    history.pushState(null, "", target);
    setPath(target);
    setQuery("");
    setRole("");
    setStatus("");
    setPlannedStation("");
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => title.current?.focus());
  }

  const link = (target: string, subTab?: "list" | "map") => ({
    href: target,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => go(event, target, subTab),
  });

  const visibleMembers = members || [];
  const activeMembers = counts.active;
  const activeStations = stations?.filter((station) => station.isActive).length || 0;

  const onboardingSteps = [
    {
      id: 1,
      title: "Configurez vos stations",
      description: "Enregistrez les emplacements physiques de votre réseau uSwap.",
      completed: (stations?.length || 0) > 0,
      ctaLabel: "Créer une station",
      action: () => {
        history.pushState(null, "", "/app/admin/stations?tab=list");
        setCurrentSubTab("list");
        setPath("/app/admin/stations?tab=list");
      },
    },
    {
      id: 2,
      title: "Ajoutez vos collaborateurs",
      description: "Invitez les chefs de station et vos swappeurs terrain.",
      completed: counts.all > 0,
      ctaLabel: "Créer un utilisateur",
      action: () => setShowCreateModal(true),
    },
    {
      id: 3,
      title: "Validez les accès en attente",
      description: "Activez les comptes en attente de confirmation.",
      completed: counts.pending === 0 && counts.all > 0,
      ctaLabel: "Vérifier les accès",
      action: (e: MouseEvent<HTMLAnchorElement>) => {
        go(e, "/app/admin/utilisateurs");
        setStatus("pending");
      },
      href: "/app/admin/utilisateurs",
    },
    {
      id: 4,
      title: "Publiez votre premier planning",
      description: "Affectez les shifts de la semaine sur vos stations actives.",
      completed: false,
      ctaLabel: "Ouvrir le planning",
      action: () => {
        history.pushState(null, "", "/app/admin/plannings");
        setPath("/app/admin/plannings");
      },
    },
  ];

  const completedCount = onboardingSteps.filter((s) => s.completed).length;

  async function handleToggleStatus() {
    if (!confirmingMember) return;
    setActionBusy(true);
    try {
      const current = await api<{ updatedAt: string; disabledAt: string | null }>('/users/' + confirmingMember.id);
      await api('/users/' + confirmingMember.id + '/status', { enabled: !!current.disabledAt, updatedAt: current.updatedAt }, 'PATCH');
      notify(confirmingMember.disabledAt ? "Compte réactivé." : "Compte désactivé.");
      setConfirmingMember(null);
      setRevision((value) => value + 1);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setActionBusy(false);
    }
  }

  function memberList() {
    return visibleMembers.length ? (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Collaborateur</th>
              <th>Rôle</th>
              <th>Statut</th>
              {!home && <th>Station rattachée</th>}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((member) => (
              <tr key={member.id}>
                <td>
                  <a
                    className="admin-person"
                    {...link("/app/admin/utilisateurs/" + member.id)}
                  >
                    <span className="admin-avatar" aria-hidden="true">
                      {initials(member.fullName)}
                    </span>
                    <div>
                      <strong>{member.fullName}</strong>
                      <span>{member.email}</span>
                    </div>
                  </a>
                </td>
                <td>{roles[member.role]}</td>
                <td>
                  <span
                    className={`admin-badge ${member.disabledAt ? "" : member.isActive ? "active" : ""}`}
                    style={member.disabledAt ? { background: "#f1f5f9", color: "#64748b", border: "1px solid #cbd5e1" } : {}}
                  >
                    {member.disabledAt
                      ? "Inactif"
                      : member.isActive
                        ? "Actif"
                        : member.pendingActivation
                          ? "En attente"
                          : "Inactif"}
                  </span>
                </td>
                {!home && (
                  <td>
                    {stations?.find(
                      (station) => station.id === member.stationId,
                    )?.name || "—"}
                  </td>
                )}
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <a
                      className="admin-button secondary small"
                      {...link("/app/admin/utilisateurs/" + member.id)}
                      style={{ textDecoration: "none" }}
                    >
                      Modifier
                    </a>
                    <button
                      type="button"
                      className={`station-toggle-btn ${member.disabledAt ? "success" : "danger"}`}
                      onClick={() => setConfirmingMember(member)}
                    >
                      {member.disabledAt ? "Réactiver" : "Désactiver"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="admin-empty">
        <Users size={26} />
        <h3>
          {query || role || status ? "Aucun résultat" : "Aucun utilisateur"}
        </h3>
        <p>
          {query || role || status
            ? "Essayez avec d’autres critères."
            : "Les comptes apparaîtront ici une fois créés."}
        </p>
      </div>
    );
  }

  const isCreatingUser = creating || showCreateModal;

  return (
    <div className="admin-workspace">
      {/* Fenêtre modale de confirmation pour activer/désactiver un utilisateur */}
      <Modal
        open={!!confirmingMember}
        onClose={() => !actionBusy && setConfirmingMember(null)}
        title={confirmingMember?.disabledAt ? "Réactiver le collaborateur" : "Désactiver le collaborateur"}
      >
        {confirmingMember && (
          <div style={{ display: "grid", gap: "16px" }}>
            <p style={{ margin: 0, color: "#475569", fontSize: "14px", lineHeight: "1.5" }}>
              {confirmingMember.disabledAt
                ? `Voulez-vous rétablir l'accès de l'utilisateur « ${confirmingMember.fullName} » ?`
                : `Voulez-vous désactiver le compte de « ${confirmingMember.fullName} » ? Ses sessions actives seront fermées.`}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                className="admin-button secondary"
                disabled={actionBusy}
                onClick={() => setConfirmingMember(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="admin-button"
                disabled={actionBusy}
                onClick={handleToggleStatus}
              >
                {actionBusy && <LoaderCircle className="spin" size={16} />}
                Confirmer
              </button>
            </div>
          </div>
        )}
      </Modal>

      <a className="admin-skip" href="#admin-main">
        Aller au contenu
      </a>
      <aside className="admin-sidebar">
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

              return (
                <div key={target} style={{ display: "grid", gap: "2px" }}>
                  <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
                    {isStations ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!stationsOpen) {
                            // Si fermé, on l'ouvre et on navigue vers la liste des stations par défaut
                            setStationsOpen(true);
                            history.pushState(null, "", "/app/admin/stations?tab=list");
                            setPath("/app/admin/stations?tab=list");
                            setCurrentSubTab("list");
                          } else {
                            // Si déjà ouvert et qu'on clique sur Stations, on réinitialise vers la liste principale
                            history.pushState(null, "", "/app/admin/stations?tab=list");
                            setPath("/app/admin/stations?tab=list");
                            setCurrentSubTab("list");
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "11px 14px",
                          borderRadius: "8px",
                          color: isCurrent || currentPathOnly.startsWith("/app/admin/stations") ? "#fff" : "#c6d2ed",
                          background: isCurrent || currentPathOnly.startsWith("/app/admin/stations") ? "#ffffff13" : "transparent",
                          fontSize: "14px",
                          minHeight: "44px",
                          width: "100%",
                          border: 0,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <Icon size={19} />
                        <span style={{ flex: 1 }}>{label}</span>
                        <CaretDownIcon
                          size={14}
                          style={{
                            transform: stationsOpen ? "rotate(0deg)" : "rotate(-90deg)",
                            transition: "transform 0.2s ease",
                            color: "#c6d2ed",
                          }}
                        />
                      </button>
                    ) : (
                      <a
                        {...link(target)}
                        onClick={(e) => {
                          // Fermeture automatique des sous-menus des autres sections (ex: Stations)
                          setStationsOpen(false);
                          go(e, target);
                        }}
                        aria-current={isCurrent ? "page" : undefined}
                        style={{ flex: 1 }}
                      >
                        <Icon size={19} />
                        <span>{label}</span>
                        {isCurrent && <i />}
                      </a>
                    )}
                  </div>

                  {isStations && stationsOpen && (
                    <div style={{ display: "grid", gap: "2px", paddingLeft: "26px", margin: "2px 0 4px 0" }}>
                      <a
                        {...link("/app/admin/stations?tab=list", "list")}
                        aria-current={currentSubTab === "list" && currentPathOnly.startsWith("/app/admin/stations") ? "page" : undefined}
                        style={{
                          fontSize: "13px",
                          padding: "6px 10px",
                          minHeight: "32px",
                          color: currentSubTab === "list" && currentPathOnly.startsWith("/app/admin/stations") ? "#fff" : "#9aadd3",
                          background: currentSubTab === "list" && currentPathOnly.startsWith("/app/admin/stations") ? "rgba(255, 255, 255, 0.08)" : "transparent",
                          borderRadius: "6px",
                          textDecoration: "none",
                        }}
                      >
                        Mes stations
                      </a>
                      <a
                        {...link("/app/admin/stations?tab=map", "map")}
                        aria-current={currentSubTab === "map" && currentPathOnly.startsWith("/app/admin/stations") ? "page" : undefined}
                        style={{
                          fontSize: "13px",
                          padding: "6px 10px",
                          minHeight: "32px",
                          color: currentSubTab === "map" && currentPathOnly.startsWith("/app/admin/stations") ? "#fff" : "#9aadd3",
                          background: currentSubTab === "map" && currentPathOnly.startsWith("/app/admin/stations") ? "rgba(255, 255, 255, 0.08)" : "transparent",
                          borderRadius: "6px",
                          textDecoration: "none",
                        }}
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
        <header className="admin-topbar">
          <div>
            <span className="admin-mobile-brand">
              uSwap<span>.</span>
            </span>
            <span className="admin-breadcrumb">{section.label}</span>
          </div>
          <AccountMenu
            user={user}
            busy={busy}
            onLogout={onLogout}
            settingsPath="/app/admin/compte"
          />
        </header>

        <main id="admin-main" className="admin-content">
          {warning && (
            <div className="session-warning" role="alert">
              <Clock3 size={18} />
              <div>
                Votre session va expirer.
                <button
                  className="text-button"
                  onClick={onExtend}
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

          <h1 ref={title} tabIndex={-1} className="sr-only">
            {section.label}
          </h1>

          <UserCreateModal
            open={isCreatingUser}
            stations={stations || []}
            onClose={() => {
              setShowCreateModal(false);
              if (creating) backToUsers();
            }}
            onCreated={() => {
              setRevision((value) => value + 1);
              setShowCreateModal(false);
              if (creating) backToUsers();
            }}
          />

          {currentPathOnly.endsWith("compte") ? (
            <AccountSettings user={user} />
          ) : memberId ? (
            <UserDetail
              key={memberId}
              id={memberId}
              stations={stations || []}
              onBack={backToUsers}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ) : importing ? (
            <UserImport
              onBack={backToUsers}
              onCreated={() => setRevision((value) => value + 1)}
            />
          ) : loadError ? (
            <div className="admin-card admin-empty" role="alert">
              <RefreshCw size={25} />
              <h2>Chargement indisponible</h2>
              <p>{loadError}</p>
              <button
                className="admin-button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Réessayer
              </button>
            </div>
          ) : loading ? (
            <div className="admin-loading" role="status">
              <LoaderCircle className="spin" size={24} />
              Chargement de votre espace…
            </div>
          ) : currentPathOnly.endsWith("plannings") ? (
            <Planner user={user} />
          ) : currentPathOnly.endsWith("stations") ? (
            <StationManager
              activeTab={currentSubTab}
              stations={(stations || []) as StationData[]}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ) : home ? (
            <div className="admin-home">
              <div className="home-header">
                <div>
                  <p className="home-welcome">Bonjour, {user.fullName.split(" ")[0]} 👋</p>
                  <p className="home-subtitle">Aperçu général et configuration de votre réseau uSwap</p>
                </div>
                <div className="home-actions">
                  <a
                    className="admin-button secondary small"
                    {...link("/app/admin/stations?tab=list", "list")}
                  >
                    Gérer les stations
                  </a>
                  <button
                    type="button"
                    className="admin-button primary-cta small"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <PlusIcon size={16} weight="bold" />
                    Créer un utilisateur
                  </button>
                </div>
              </div>

              <section className="network-overview" aria-label="Gestion du réseau">
                <a
                  className="network-card card-accent-navy"
                  {...link("/app/admin/utilisateurs")}
                  aria-label="Gérer les utilisateurs"
                >
                  <div className="network-card-head">
                    <span className="network-card-label">Utilisateurs</span>
                    <span className="network-icon-wrap navy">
                      <Users size={18} />
                    </span>
                  </div>
                  <div className="network-card-body">
                    <strong className="network-card-value" data-testid="user-count">
                      {counts.all}
                    </strong>
                    <span className="network-badge active">
                      <i className="dot" /> {activeMembers} actifs
                    </span>
                  </div>
                </a>

                <a
                  className="network-card card-accent-blue"
                  {...link("/app/admin/stations?tab=list", "list")}
                  aria-label="Consulter les stations"
                >
                  <div className="network-card-head">
                    <span className="network-card-label">Stations</span>
                    <span className="network-icon-wrap blue">
                      <Building2 size={18} />
                    </span>
                  </div>
                  <div className="network-card-body">
                    <strong className="network-card-value" data-testid="station-count">
                      {stations?.length || 0}
                    </strong>
                    <span className="network-badge active">
                      <i className="dot" /> {activeStations} actives
                    </span>
                  </div>
                </a>

                <a
                  className={`network-card ${counts.pending > 0 ? "card-accent-amber warning" : "card-accent-neutral"}`}
                  href="/app/admin/utilisateurs"
                  onClick={(event) => {
                    go(event, "/app/admin/utilisateurs");
                    if (event.defaultPrevented) setStatus("pending");
                  }}
                >
                  <div className="network-card-head">
                    <span className="network-card-label">Accès à activer</span>
                    <span className={`network-icon-wrap ${counts.pending > 0 ? "amber" : "neutral"}`}>
                      <UserRound size={18} />
                    </span>
                  </div>
                  <div className="network-card-body">
                    <strong className="network-card-value">{counts.pending}</strong>
                    <span className={`network-badge ${counts.pending > 0 ? "warning" : "neutral"}`}>
                      {counts.pending === 0 ? "À jour" : "Comptes en attente"}
                    </span>
                  </div>
                </a>
              </section>

              {!dismissOnboarding && (
                <section className="onboarding-card" aria-label="Progression de la configuration">
                  <button 
                    type="button" 
                    className="onboarding-dismiss-btn" 
                    aria-label="Masquer l'onboarding"
                    onClick={() => setDismissOnboarding(true)}
                  >
                    ✕
                  </button>

                  <div className="onboarding-head">
                    <div className="onboarding-title-wrap">
                      <span className="onboarding-spark-icon">✨</span>
                      <div>
                        <h3>Bienvenue sur uSwap 👋</h3>
                        <p>Encore quelques étapes pour opérationnaliser complètement votre réseau.</p>
                      </div>
                    </div>
                    
                    <div className="onboarding-progress-wrap">
                      <span className="onboarding-progress-text">
                        <strong>{completedCount} SUR {onboardingSteps.length}</strong> TERMINÉ
                      </span>
                      <div className="onboarding-progress-bar">
                        <div
                          className="onboarding-progress-fill"
                          style={{ width: `${(completedCount / onboardingSteps.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="onboarding-grid">
                    {onboardingSteps.map((step) => {
                      const stepIcons: Record<number, React.ReactNode> = {
                        1: <MapPin size={15} />,
                        2: <Users size={15} />,
                        3: <UserRound size={15} />,
                        4: <Clock3 size={15} />,
                      };

                      return (
                        <div
                          key={step.id}
                          className={`onboarding-step-item ${step.completed ? "is-completed" : "is-active"}`}
                        >
                          <div className="step-header-line">
                            <span className="step-status-indicator">
                              {step.completed ? (
                                <span className="check-badge">✓</span>
                              ) : (
                                <span className="radio-badge">{step.id}</span>
                              )}
                            </span>

                            <h4 className="step-title">
                              {step.completed && <span className="step-num">{step.id}</span>}
                              <span className="step-icon">{stepIcons[step.id]}</span>
                              <span>{step.title}</span>
                            </h4>
                          </div>

                          <p className="step-desc">{step.description}</p>

                          {!step.completed && (
                            step.href ? (
                              <a
                                className="admin-button secondary small step-btn"
                                href={step.href}
                                onClick={step.action as (e: MouseEvent<HTMLAnchorElement>) => void}
                              >
                                {step.ctaLabel}
                              </a>
                            ) : (
                              <button
                                type="button"
                                className="admin-button secondary small step-btn"
                                onClick={step.action as () => void}
                              >
                                {step.ctaLabel}
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {counts.pending > 0 && (
                <section className="pending-alert-banner">
                  <div>
                    <strong data-testid="pending-count">{counts.pending}</strong> compte(s) en attente d’activation uSwap.
                  </div>
                  <a
                    className="admin-button secondary small"
                    href="/app/admin/utilisateurs"
                    onClick={(event) => {
                      go(event, "/app/admin/utilisateurs");
                      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
                        setStatus("pending");
                      }
                    }}
                  >
                    Activer les accès
                  </a>
                </section>
              )}
            </div>
          ) : currentPathOnly.endsWith("utilisateurs") ? (
            <section className="admin-card users-directory">
              <div className="directory-toolbar">
                <div className="admin-search">
                  <Search size={18} />
                  <input
                    aria-label="Rechercher un utilisateur"
                    placeholder="Rechercher un nom ou un e-mail"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setCurrentPage(1);
                    }}
                  />
                </div>

                <div className="directory-toolbar-actions">
                  <button
                    type="button"
                    className={`admin-button secondary ${filterOpen || role || plannedStation ? "active-filter" : ""}`}
                    aria-expanded={filterOpen}
                    aria-controls="user-filters"
                    onClick={() => setFilterOpen(!filterOpen)}
                  >
                    <FunnelIcon size={18} />
                    Filtrer{role || plannedStation ? " (actif)" : ""}
                  </button>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <SortAscendingIcon size={18} style={{ color: "var(--muted)" }} />
                    <CustomSelect
                      value={sort}
                      onChange={(val) => {
                        setSort(val);
                        setCurrentPage(1);
                      }}
                      options={[
                        { label: "Plus récents", value: "recent" },
                        { label: "Nom : A à Z", value: "name" },
                        { label: "Plus anciens", value: "oldest" },
                      ]}
                    />
                  </div>

                  <button
                    type="button"
                    className="admin-button primary-cta"
                    onClick={() => setShowCreateModal(true)}
                    style={{ height: "36px", minHeight: "36px", padding: "0 14px", borderRadius: "8px" }}
                  >
                    <PlusIcon size={15} weight="bold" />
                    <span>Créer un utilisateur</span>
                  </button>

                  <details className="directory-more">
                    <summary className="admin-button secondary" style={{ height: "36px", minHeight: "36px" }}>
                      <span>Actions</span>
                    </summary>
                    <div className="directory-dropdown-menu">
                      <a {...link("/app/admin/utilisateurs/import")}>
                        Importer un fichier (CSV)
                      </a>
                      <button disabled={exporting} onClick={exportUsers}>
                        Exporter la liste (CSV)
                      </button>
                    </div>
                  </details>
                </div>
              </div>

              <div className="status-chips" aria-label="Statut des utilisateurs">
                {[
                  ["", "Tous"],
                  ["active", "Actifs"],
                  ["pending", "En attente"],
                  ["inactive", "Inactifs"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={"status-chip " + value}
                    aria-pressed={status === value}
                    onClick={() => {
                      setStatus(value);
                      setCurrentPage(1);
                    }}
                  >
                    {value && <i aria-hidden="true" />}
                    {label}
                    <span>{counts[value || "all"]}</span>
                  </button>
                ))}
              </div>

              {filterOpen && (
                <div id="user-filters" className="directory-filter-panel">
                  <div className="filter-panel-fields" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                    <div style={{ display: "grid", gap: "4px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569" }}>RÔLE</span>
                      <CustomSelect
                        value={role}
                        onChange={(val) => {
                          setRole(val);
                          setCurrentPage(1);
                        }}
                        placeholder="Tous les rôles"
                        width="100%"
                        options={[
                          { label: "Tous les rôles", value: "" },
                          ...Object.entries(roles).map(([value, label]) => ({
                            label,
                            value,
                          })),
                        ]}
                      />
                    </div>

                    <div style={{ display: "grid", gap: "4px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569" }}>STATION RATTACHÉE</span>
                      <CustomSelect
                        value={plannedStation}
                        onChange={(val) => {
                          setPlannedStation(val);
                          setCurrentPage(1);
                        }}
                        placeholder="Toutes les stations"
                        width="100%"
                        options={[
                          { label: "Toutes les stations", value: "" },
                          ...(stations?.map((s) => ({
                            label: s.name,
                            value: s.id,
                          })) || []),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="filter-panel-actions" style={{ marginTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {(role || plannedStation) ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setRole("");
                          setPlannedStation("");
                          setCurrentPage(1);
                        }}
                      >
                        Effacer les filtres
                      </button>
                    ) : <div />}
                    <button
                      type="button"
                      className="admin-button secondary small"
                      onClick={() => setFilterOpen(false)}
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              )}

              {exportError && (
                <p className="error-message" role="alert">
                  {exportError}
                </p>
              )}

              {listLoading || query !== debouncedQuery ? (
                <div className="admin-loading" role="status">
                  Chargement des utilisateurs…
                </div>
              ) : (
                memberList()
              )}

              <div className="admin-pagination">
                <span>
                  {total} résultat{total === 1 ? "" : "s"}
                </span>
                <div>
                  <button
                    aria-label="Page précédente"
                    disabled={listLoading || currentPage === 1}
                    onClick={() => setCurrentPage(currentPage - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    {currentPage} / {lastPage}
                  </span>
                  <button
                    aria-label="Page suivante"
                    disabled={listLoading || currentPage === lastPage}
                    onClick={() => setCurrentPage(currentPage + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}