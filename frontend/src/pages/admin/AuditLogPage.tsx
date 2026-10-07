import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { Select } from "../../ui/Select";
import { ClockCounterClockwise, MagnifyingGlass } from "../../ui/icons";
import "./audit-log.css";

type AuditCategory = "ACCOUNT" | "INCIDENT" | "ASSIGNMENT" | "SETTINGS";
type AuditEvent = {
  id: string;
  category: AuditCategory;
  action: string;
  title: string;
  objectName: string;
  actorId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  stationId: string | null;
  stationName: string | null;
  description: string;
  result: string;
  createdAt: string;
};
type AuditData = {
  events: AuditEvent[];
  people: Array<{ id: string; fullName: string }>;
};

const categoryNames: Record<AuditCategory, string> = {
  ACCOUNT: "Comptes",
  INCIDENT: "Incidents",
  ASSIGNMENT: "Affectations",
  SETTINGS: "Réglages",
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function AuditLogPage() {
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("30");

  useEffect(() => {
    let active = true;
    api<AuditData>("/admin/audit")
      .then((result) => active && setData(result))
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, []);

  const actions = useMemo(
    () =>
      [...new Set(data?.events.map((event) => event.action) ?? [])].sort(
        (a, b) => a.localeCompare(b, "fr"),
      ),
    [data],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const cutoff =
      periodFilter === "ALL"
        ? null
        : Date.now() - Number(periodFilter) * 86400000;
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    return data.events.filter((event) => {
      const matchesUser =
        !userFilter ||
        event.actorId === userFilter ||
        event.targetUserId === userFilter;
      const matchesAction = !actionFilter || event.action === actionFilter;
      const matchesPeriod =
        cutoff === null || Date.parse(event.createdAt) >= cutoff;
      const searchable = [
        event.title,
        event.objectName,
        event.description,
        event.actorName ?? "",
        event.stationName ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("fr");
      return (
        matchesUser &&
        matchesAction &&
        matchesPeriod &&
        (!normalizedQuery || searchable.includes(normalizedQuery))
      );
    });
  }, [actionFilter, data, periodFilter, query, userFilter]);

  if (!data)
    return (
      <div className="admin-loading">
        {error || "Chargement du journal d’audit…"}
      </div>
    );

  return (
    <section className="audit-log-page">
      <header className="audit-log-intro">
        <div className="audit-log-intro__icon">
          <ClockCounterClockwise size={22} />
        </div>
        <div>
          <p>
            Événements enregistrés sur les comptes, les incidents, les
            affectations et les réglages.
          </p>
        </div>
        <span className="audit-log-total">
          {`${filtered.length} action${filtered.length > 1 ? "s" : ""}`}
        </span>
      </header>

      <div className="audit-log-filters" aria-label="Filtres du journal d’audit">
        <label className="audit-log-search">
          <MagnifyingGlass size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un objet ou un détail"
            aria-label="Rechercher dans le journal d’audit"
          />
        </label>
        <Select
          value={userFilter}
          ariaLabel="Filtrer par utilisateur"
          onChange={(value) => setUserFilter(String(value))}
          options={[
            { value: "", label: "Tous les comptes" },
            ...data.people.map((person) => ({
              value: person.id,
              label: person.fullName,
            })),
          ]}
          size="sm"
          minWidth="190px"
        />
        <Select
          value={actionFilter}
          ariaLabel="Filtrer par action"
          onChange={(value) => setActionFilter(String(value))}
          options={[
            { value: "", label: "Toutes les actions" },
            ...actions.map((action) => ({ value: action, label: action })),
          ]}
          size="sm"
          minWidth="190px"
        />
        <Select
          value={periodFilter}
          ariaLabel="Filtrer par période"
          onChange={(value) => setPeriodFilter(String(value))}
          options={[
            { value: "7", label: "7 derniers jours" },
            { value: "30", label: "30 derniers jours" },
            { value: "90", label: "90 derniers jours" },
            { value: "ALL", label: "Toute la période" },
          ]}
          size="sm"
          minWidth="165px"
        />
      </div>

      {filtered.length ? (
        <ol className="audit-log-list" aria-live="polite">
          {filtered.map((event) => (
            <li className="audit-log-entry" key={event.id}>
              <span className={`audit-log-entry__marker ${event.category.toLowerCase()}`} />
              <div className="audit-log-entry__main">
                <div className="audit-log-entry__heading">
                  <span className={`audit-log-category ${event.category.toLowerCase()}`}>
                    {categoryNames[event.category]}
                  </span>
                  <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                </div>
                <h3>{event.title}</h3>
                <p>{event.description}</p>
                <dl>
                  <div>
                    <dt>Acteur</dt>
                    <dd>{event.actorName ?? "Non renseigné dans cette entrée"}</dd>
                  </div>
                  <div>
                    <dt>Objet</dt>
                    <dd>{event.objectName}</dd>
                  </div>
                  <div>
                    <dt>Contexte</dt>
                    <dd>{event.stationName ?? "Réseau"}</dd>
                  </div>
                  <div>
                    <dt>Résultat</dt>
                    <dd className="audit-log-result">{event.result}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="audit-log-empty">
          <ClockCounterClockwise size={28} />
          <strong>Aucune action pour ces filtres</strong>
          <span>Modifiez la période, l’utilisateur ou votre recherche.</span>
        </div>
      )}
    </section>
  );
}
