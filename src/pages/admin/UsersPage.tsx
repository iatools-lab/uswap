import {
  CaretDownIcon,
  ListIcon,
  PlusIcon,
  SortAscendingIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Modal } from "../../ui/Modal";
import { UserCreateModal } from "../../features/users/UserCreateModal";
import { notify } from "../../ui/Toast";
import { interceptNav } from "../../app/spaNav";
import { useSession } from "../../app/session";
import { api, ApiError, roles, type User } from "../../api/auth-api";
import { Select } from "../../ui/Select";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Mail,
  PencilSimple,
  RefreshCw,
  Search,
  ShieldCheckIcon,
  Users,
} from "../../ui/icons";

type Member = User & {
  isActive: boolean;
  pendingActivation?: boolean;
  disabledAt?: string | null;
  stationId: string | null;
};

type Station = { id: string; name: string };

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

const statusInfo = (member: Member): { label: string; tone: string } => {
  if (member.disabledAt) return { label: "Inactif", tone: "is-muted" };
  if (member.isActive) return { label: "Actif", tone: "active" };
  if (member.pendingActivation) return { label: "En attente", tone: "pending" };
  return { label: "Invité", tone: "is-muted" };
};

export function UsersPage() {
  const { onAccessLost } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const creating = location.pathname === "/app/admin/utilisateurs/nouveau";
  const [sort, setSort] = useState("recent");
  const [showCreateModal, setShowCreateModal] = useState(creating);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, active: 0, pending: 0, inactive: 0 });
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [stations, setStations] = useState<Station[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState(() => new URLSearchParams(location.search).get("status") || "");
  const [plannedStation, setPlannedStation] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [confirmingMember, setConfirmingMember] = useState<Member | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<null | "role" | "station">(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setShowCreateModal(creating);
  }, [creating]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(members === null);
    setListLoading(true);
    setLoadError("");
    const params = new URLSearchParams({
      page: String(currentPage),
      limit: "8",
      q: debouncedQuery,
      role,
      status,
      stationId: plannedStation,
      sort,
    });
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
        if (!active) return;
        setMembers(membersData.data);
        setCounts(membersData.statusCounts);
        setTotal(membersData.total);
        setLastPage(membersData.totalPages);
        setCurrentPage(membersData.page);
        setStations(stationsData);
      })
      .catch((errorData) => {
        if (!active) return;
        setMembers(null);
        setStations(null);
        if (errorData instanceof ApiError && [401, 403].includes(errorData.status)) onAccessLost();
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
  }, [revision, currentPage, debouncedQuery, role, status, plannedStation, sort, onAccessLost]);

  async function exportUsers() {
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams({ q: query, role, status, stationId: plannedStation });
      const result = await api<{ csv: string; filename: string }>("/users/export?" + params);
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
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

  async function handleToggleStatus() {
    if (!confirmingMember) return;
    setActionBusy(true);
    try {
      const current = await api<{ updatedAt: string; disabledAt: string | null }>("/users/" + confirmingMember.id);
      await api("/users/" + confirmingMember.id + "/status", { enabled: !!current.disabledAt, updatedAt: current.updatedAt }, "PATCH");
      notify(confirmingMember.disabledAt ? "Compte réactivé." : "Compte désactivé.");
      setConfirmingMember(null);
      setRevision((value) => value + 1);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setActionBusy(false);
    }
  }

  function closeCreate() {
    setShowCreateModal(false);
    if (creating) navigate("/app/admin/utilisateurs");
  }

  const visibleMembers = members || [];

  if (loadError)
    return (
      <div className="admin-card admin-empty" role="alert">
        <RefreshCw size={25} />
        <h2>Chargement indisponible</h2>
        <p>{loadError}</p>
        <button className="admin-button" onClick={() => setRevision((value) => value + 1)}>
          Réessayer
        </button>
      </div>
    );

  if (loading)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" size={24} />
        Chargement de votre espace…
      </div>
    );

  return (
    <section className="admin-card users-directory">
      <Modal
        open={!!confirmingMember}
        onClose={() => !actionBusy && setConfirmingMember(null)}
        title={confirmingMember?.disabledAt ? "Réactiver le collaborateur" : "Désactiver le collaborateur"}
      >
        {confirmingMember && (
          <div className="directory-confirm">
            <p>
              {confirmingMember.disabledAt
                ? `Voulez-vous rétablir l'accès de l'utilisateur « ${confirmingMember.fullName} » ?`
                : `Voulez-vous désactiver le compte de « ${confirmingMember.fullName} » ? Ses sessions actives seront fermées.`}
            </p>
            <div className="directory-confirm-actions">
              <button type="button" className="admin-button secondary" disabled={actionBusy} onClick={() => setConfirmingMember(null)}>
                Annuler
              </button>
              <button type="button" className="admin-button" disabled={actionBusy} onClick={handleToggleStatus}>
                {actionBusy && <LoaderCircle className="spin" size={16} />}
                Confirmer
              </button>
            </div>
          </div>
        )}
      </Modal>

      <UserCreateModal
        open={showCreateModal || creating}
        stations={stations || []}
        onClose={closeCreate}
        onCreated={() => {
          setRevision((value) => value + 1);
        }}
      />

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
          <div className="directory-sort">
            <SortAscendingIcon size={18} />
            <Select
              size="sm"
              value={sort}
              ariaLabel="Trier les utilisateurs"
              onChange={(value) => {
                setSort(String(value));
                setCurrentPage(1);
              }}
              options={[
                { label: "Plus récents", value: "recent" },
                { label: "Nom : A à Z", value: "name" },
                { label: "Plus anciens", value: "oldest" },
              ]}
            />
          </div>
          <div className="segmented-control users-view-toggle">
            <button
              type="button"
              aria-pressed={viewMode === "table"}
              aria-label="Vue tableau"
              onClick={() => setViewMode("table")}
              className={`users-view-option${viewMode === "table" ? " is-selected" : ""}`}
            >
              <ListIcon size={14} />
              <span>Tableau</span>
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "grid"}
              aria-label="Vue grille"
              onClick={() => setViewMode("grid")}
              className={`users-view-option${viewMode === "grid" ? " is-selected" : ""}`}
            >
              <SquaresFourIcon size={14} />
              <span>Grille</span>
            </button>
          </div>
          <button
            type="button"
            className="admin-button primary-cta is-compact"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon size={15} weight="bold" />
            <span>Créer un utilisateur</span>
          </button>
          <div ref={actionsRef} className="directory-more">
            <button
              type="button"
              className="admin-button secondary is-compact"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((open) => !open)}
            >
              <span>Actions</span>
              <CaretDownIcon size={13} className={`caret${actionsOpen ? " is-open" : ""}`} />
            </button>
            {actionsOpen && (
              <div className="directory-dropdown-menu" role="menu">
                <a
                  role="menuitem"
                  href="/app/admin/utilisateurs/import"
                  onClick={(event) => {
                    setActionsOpen(false);
                    interceptNav(event, navigate, "/app/admin/utilisateurs/import");
                  }}
                >
                  Importer un fichier (CSV)
                </a>
                <button
                  role="menuitem"
                  disabled={exporting}
                  onClick={() => {
                    setActionsOpen(false);
                    void exportUsers();
                  }}
                >
                  Exporter la liste (CSV)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barre de filtres immersive : statut + rôle + station sur une seule ligne */}
      <div className="users-filterbar" ref={filtersRef}>
        <div className="status-chips" role="group" aria-label="Statut des utilisateurs">
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

        <span className="users-filterbar-sep" aria-hidden="true" />

        <div className="users-filter-dropdown">
          <button
            type="button"
            className={`users-filter-toggle${role ? " is-active" : ""}${openFilter === "role" ? " is-open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={openFilter === "role"}
            onClick={() => setOpenFilter((current) => (current === "role" ? null : "role"))}
          >
            <ShieldCheckIcon size={15} />
            <span>Rôle :</span>
            <strong>{role ? roles[role as keyof typeof roles] || role : "Tous"}</strong>
            <CaretDownIcon size={13} className={`caret${openFilter === "role" ? " is-open" : ""}`} />
          </button>
          {openFilter === "role" && (
            <div className="users-filter-menu" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={role === ""}
                className={`users-filter-option${role === "" ? " is-selected" : ""}`}
                onClick={() => {
                  setRole("");
                  setCurrentPage(1);
                  setOpenFilter(null);
                }}
              >
                Tous les rôles
              </button>
              {Object.entries(roles).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={role === value}
                  className={`users-filter-option${role === value ? " is-selected" : ""}`}
                  onClick={() => {
                    setRole(value);
                    setCurrentPage(1);
                    setOpenFilter(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="users-filter-dropdown">
          <button
            type="button"
            className={`users-filter-toggle${plannedStation ? " is-active" : ""}${openFilter === "station" ? " is-open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={openFilter === "station"}
            onClick={() => setOpenFilter((current) => (current === "station" ? null : "station"))}
          >
            <Building2 size={15} />
            <span>Station :</span>
            <strong>{stations?.find((s) => s.id === plannedStation)?.name || "Toutes"}</strong>
            <CaretDownIcon size={13} className={`caret${openFilter === "station" ? " is-open" : ""}`} />
          </button>
          {openFilter === "station" && (
            <div className="users-filter-menu" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={plannedStation === ""}
                className={`users-filter-option${plannedStation === "" ? " is-selected" : ""}`}
                onClick={() => {
                  setPlannedStation("");
                  setCurrentPage(1);
                  setOpenFilter(null);
                }}
              >
                Toutes les stations
              </button>
              {(stations || []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={plannedStation === s.id}
                  className={`users-filter-option${plannedStation === s.id ? " is-selected" : ""}`}
                  onClick={() => {
                    setPlannedStation(s.id);
                    setCurrentPage(1);
                    setOpenFilter(null);
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {(role || plannedStation) && (
          <button
            type="button"
            className="text-button users-filter-clear"
            onClick={() => {
              setRole("");
              setPlannedStation("");
              setCurrentPage(1);
            }}
          >
            Effacer les filtres
          </button>
        )}
      </div>

      {exportError && (
        <p className="error-message" role="alert">
          {exportError}
        </p>
      )}

      {listLoading || query !== debouncedQuery ? (
        <div className="admin-loading" role="status">
          Chargement des utilisateurs…
        </div>
      ) : visibleMembers.length ? (
        viewMode === "table" ? (
          <div className="admin-table-wrap">
            <table className="admin-table users-table">
              <thead>
                <tr>
                  <th>Collaborateur</th>
                  <th>Rôle</th>
                  <th>Statut</th>
                  <th>Station rattachée</th>
                  <th className="users-cell-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((member) => {
                  const info = statusInfo(member);
                  return (
                    <tr key={member.id}>
                      <td>
                        <a
                          className="admin-person"
                          href={"/app/admin/utilisateurs/" + member.id}
                          onClick={(event) => interceptNav(event, navigate, "/app/admin/utilisateurs/" + member.id)}
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
                      <td>
                        <span className="users-role-chip">{roles[member.role]}</span>
                      </td>
                      <td>
                        <span className={`admin-badge ${info.tone}`}>{info.label}</span>
                      </td>
                      <td>
                        <span className="users-station-name">
                          {stations?.find((station) => station.id === member.stationId)?.name || "Non affecté"}
                        </span>
                      </td>
                      <td className="users-cell-right">
                        <div className="row-actions station-row-actions">
                          <a
                            className="admin-button secondary small"
                            href={"/app/admin/utilisateurs/" + member.id}
                            onClick={(event) => interceptNav(event, navigate, "/app/admin/utilisateurs/" + member.id)}
                          >
                            <PencilSimple size={13} />
                            <span>Modifier</span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-station-grid users-grid">
            {visibleMembers.map((member) => {
              const info = statusInfo(member);
              const stationName = stations?.find((station) => station.id === member.stationId)?.name;
              return (
                <section className="admin-card admin-station users-card" key={member.id}>
                  <div className="admin-station-top">
                    <span className="admin-avatar admin-avatar-lg" aria-hidden="true">
                      {initials(member.fullName)}
                    </span>
                    <span className={`admin-badge ${info.tone}`}>{info.label}</span>
                  </div>

                  <div className="station-main-info">
                    <h2>{member.fullName}</h2>
                    <p className="station-location">
                      <Mail size={14} />
                      <span>{member.email}</span>
                    </p>
                  </div>

                  <div className="station-contact-strip">
                    <div className="contact-item">
                      <ShieldCheckIcon size={14} />
                      <span>{roles[member.role]}</span>
                    </div>
                    <div className="contact-item">
                      <Building2 size={14} />
                      <span>{stationName || "Non affecté"}</span>
                    </div>
                  </div>

                  <div className="station-card-actions">
                    <a
                      className="admin-button secondary small"
                      href={"/app/admin/utilisateurs/" + member.id}
                      onClick={(event) => interceptNav(event, navigate, "/app/admin/utilisateurs/" + member.id)}
                    >
                      <PencilSimple size={15} />
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
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="admin-empty">
          <Users size={26} />
          <h3>{query || role || status ? "Aucun résultat" : "Aucun utilisateur"}</h3>
          <p>{query || role || status ? "Essayez avec d’autres critères." : "Les comptes apparaîtront ici une fois créés."}</p>
        </div>
      )}

      <div className="admin-pagination">
        <span>
          {total} résultat{total === 1 ? "" : "s"}
        </span>
        <div>
          <button aria-label="Page précédente" disabled={listLoading || currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>
            <ChevronLeft size={17} />
          </button>
          <span>
            {currentPage} / {lastPage}
          </span>
          <button aria-label="Page suivante" disabled={listLoading || currentPage === lastPage} onClick={() => setCurrentPage(currentPage + 1)}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
