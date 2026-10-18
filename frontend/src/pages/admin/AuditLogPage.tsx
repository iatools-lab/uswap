import { currentLocale } from "../../app/i18n";
import { translate } from "../../app/i18n";
import { useEffect, useMemo, useState } from "react";
import { api, usingMock } from "../../api/auth-api";
import { Select } from "../../ui/Select";
import { ExportExcelButton } from "../../ui/ExportExcelButton";
import { exportToExcel } from "../../utils/excelExport";
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
  new Intl.DateTimeFormat(currentLocale(), {
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
    if (!usingMock) return;
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

  function exportAuditLog() {
    if (!filtered.length) return;
    exportToExcel({
      data: filtered,
      filename: `uswap-journal-audit-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "Journal d’audit",
      columns: [
        { header: translate("Date"), key: (event) => formatDateTime(event.createdAt), width: 22 },
        { header: translate("Catégorie"), key: (event) => translate(categoryNames[event.category]), width: 20 },
        { header: translate("Action"), key: (event) => translate(event.action), width: 24 },
        { header: translate("Acteur"), key: (event) => event.actorName ?? "—", width: 24 },
        { header: translate("Objet"), key: (event) => `${event.title} · ${event.objectName}`, width: 36 },
        { header: translate("Station"), key: (event) => event.stationName ?? "—", width: 24 },
        { header: translate("Détail"), key: "description", width: 44 },
        { header: translate("Résultat"), key: (event) => translate(event.result), width: 20 },
      ],
    });
  }

  if (!usingMock) {
    return (
      <section className="audit-log-page">
        <div className="audit-log-notice" role="status">
          <ClockCounterClockwise size={22} />
          <div>
            <strong>
              {translate("Le journal d’audit central n’est pas encore exposé par l’API.")}</strong>
            <p>
              {translate("Cette vue est prête pour les données de démonstration et attend la route backend correspondante.")}</p>
          </div>
        </div>
      </section>
    );
  }

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
            {translate("Événements enregistrés sur les comptes, les incidents, les affectations et les réglages.")}</p>
        </div>
        <div className="audit-log-tools">
          <span className="audit-log-total">
            {`${filtered.length} ${translate(filtered.length === 1 ? "action" : "actions")}`}
          </span>
          <ExportExcelButton onClick={exportAuditLog} disabled={!filtered.length} />
        </div>
      </header>

      <div
        className="audit-log-filters"
        aria-label={translate("Filtres du journal d’audit")}
      >
        <label className="audit-log-search">
          <MagnifyingGlass size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("Rechercher un objet ou un détail")}
            aria-label={translate("Rechercher dans le journal d’audit")}
          />
        </label>
        <Select
          value={userFilter}
          ariaLabel={translate("Filtrer par utilisateur")}
          onChange={(value) => setUserFilter(String(value))}
          options={[
            { value: "", label: translate("Tous les comptes") },
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
          ariaLabel={translate("Filtrer par action")}
          onChange={(value) => setActionFilter(String(value))}
          options={[
            { value: "", label: translate("Toutes les actions") },
            ...actions.map((action) => ({ value: action, label: translate(action) })),
          ]}
          size="sm"
          minWidth="190px"
        />
        <Select
          value={periodFilter}
          ariaLabel={translate("Filtrer par période")}
          onChange={(value) => setPeriodFilter(String(value))}
          options={[
            { value: "7", label: translate("7 derniers jours") },
            { value: "30", label: translate("30 derniers jours") },
            { value: "90", label: translate("90 derniers jours") },
            { value: "ALL", label: translate("Toute la période") },
          ]}
          size="sm"
          minWidth="165px"
        />
      </div>

      {filtered.length ? (
        <ol className="audit-log-list" aria-live="polite">
          {filtered.map((event) => (
            <li className="audit-log-entry" key={event.id}>
              <span
                className={`audit-log-entry__marker ${event.category.toLowerCase()}`}
              />
              <div className="audit-log-entry__main">
                <div className="audit-log-entry__heading">
                  <span
                    className={`audit-log-category ${event.category.toLowerCase()}`}
                  >
                    {translate(categoryNames[event.category])}
                  </span>
                  <time dateTime={event.createdAt}>
                    {formatDateTime(event.createdAt)}
                  </time>
                </div>
                <h3>{translate(event.title)}</h3>
                <p>{translate(event.description)}</p>
                <dl>
                  <div>
                    <dt>{translate("Acteur")}</dt>
                    <dd>
                      {translate(event.actorName ?? "Non renseigné dans cette entrée")}
                    </dd>
                  </div>
                  <div>
                    <dt>{translate("Objet")}</dt>
                    <dd>{translate(event.objectName)}</dd>
                  </div>
                  <div>
                    <dt>{translate("Contexte")}</dt>
                    <dd>{translate(event.stationName ?? "Réseau")}</dd>
                  </div>
                  <div>
                    <dt>{translate("Résultat")}</dt>
                    <dd className="audit-log-result">{translate(event.result)}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="audit-log-empty">
          <ClockCounterClockwise size={28} />
          <strong>{translate("Aucune action pour ces filtres")}</strong>
          <span>{translate("Modifiez la période, l’utilisateur ou votre recherche.")}</span>
        </div>
      )}
    </section>
  );
}
