import { useMemo, useState } from "react";
import {translate,  useI18n } from "../../app/i18n";
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  CaretRightIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PlusIcon,
  LightningIcon,
} from "../../ui/icons";
import { periodDuration } from "./duration";
import { formatDateRange } from "../../utils/french";
import { ExportExcelButton } from "../../ui/ExportExcelButton";
import { exportToExcel } from "../../utils/excelExport";
import "./planning-list.css";

export type PlanningListItem = {
  name?: string;
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  revision: number;
  occurrences: {
    station: { id: string; name: string };
    startTime?: string;
    endTime?: string;
    templateVersion?: { label?: string };
  }[];
  _count?: { occurrences: number };
  /** Stations effectivement visibles dans le périmètre de l'utilisateur. */
  visibleStations?: { id: string; name: string; timezone: string }[];
};

type StatusFilter = "ALL" | "PUBLISHED" | "DRAFT";
type SwapperPeriodFilter = "ALL" | "ACTIVE" | "COMPLETED";

function planningHasEnded(endDate: string, now = Date.now()) {
  const value = endDate.length === 10 ? `${endDate}T23:59:59.999Z` : endDate;
  return Date.parse(value) < now;
}

function periodLabel(startIso: string, endIso: string) {
  return formatDateRange(startIso, endIso);
}

/**
 * Écran d'entrée de la planification : une liste de plannings cliquables.
 *
 * L'utilisateur choisit d'abord **quel** planning l'intéresse, puis entre dans
 * son espace dédié (calendrier + filtres de période). Cet écran évite de tout
 * mélanger dans un calendrier unique.
 */
export function PlanningList({
  plans,
  userRole,
  onOpen,
  onCreate,
  onGenerate,
  busy,
  loading,
  error,
  onRetry,
}: {
  plans: PlanningListItem[];
  userRole: string;
  onOpen: (id: string) => void | Promise<void>;
  onCreate?: () => void;
  onGenerate?: () => void;
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [swapperPeriod, setSwapperPeriod] =
    useState<SwapperPeriodFilter>("ALL");
  const [query, setQuery] = useState("");
  // Planning en cours d'ouverture : sa ligne passe en état « chargement ».
  const [openingId, setOpeningId] = useState<string | null>(null);

  const canCreate = userRole === "ADMIN" || userRole === "SUPERVISOR";
  const isSwapper = userRole === "SWAPPER";

  const counts = useMemo(() => {
    let published = 0;
    let draft = 0;
    for (const plan of plans) {
      if (plan.status === "PUBLISHED") published += 1;
      else draft += 1;
    }
    return { all: plans.length, published, draft };
  }, [plans]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plans
      .filter((plan) => {
        if (status === "ALL") return true;
        if (status === "PUBLISHED") return plan.status === "PUBLISHED";
        return plan.status !== "PUBLISHED";
      })
      .filter((plan) => {
        if (!needle) return true;
        const stationNames = stationNamesOf(plan).join(" ").toLowerCase();
        const period = periodLabel(plan.startDate, plan.endDate).toLowerCase();
        return (
          (plan.name || "").toLowerCase().includes(needle) ||
          stationNames.includes(needle) ||
          period.includes(needle)
        );
      });
  }, [plans, status, query]);

  function exportPlannings() {
    if (!rows.length) return;
    exportToExcel({
      data: rows,
      filename: `uswap-plannings-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "Plannings",
      columns: [
        { header: t("Planning"), key: (plan) => translate(plan.name || periodLabel(plan.startDate, plan.endDate)), width: 32 },
        { header: t("Période"), key: (plan) => periodLabel(plan.startDate, plan.endDate), width: 32 },
        { header: t("Station"), key: (plan) => stationNamesOf(plan).join(", ") || "—", width: 36 },
        { header: t("Shifts inclus"), key: (plan) => plan._count?.occurrences ?? plan.occurrences.length, width: 16 },
        { header: t("Statut"), key: (plan) => t(plan.status === "PUBLISHED" ? "Publié" : "Brouillon"), width: 18 },
        { header: t("Révision"), key: (plan) => plan.revision, width: 12 },
      ],
    });
  }

  // Premier chargement : aucun planning n'est encore connu.
  if (loading && !plans.length)
    return (
      <section className="admin-card admin-empty" role="status">
        <CalendarDotsIcon size={30} weight="regular" />
        <h3>{t("Chargement des plannings…")}</h3>
      </section>
    );

  if (error)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>{t("Chargement indisponible")}</h2>
        <p>{error}</p>
        {onRetry && (
          <button className="admin-button" onClick={onRetry}>
            {t("Réessayer")}
          </button>
        )}
      </section>
    );

  if (isSwapper) {
    const visiblePlans = plans
      .filter(
        (plan) => plan.status === "PUBLISHED" && plan.occurrences.length > 0,
      )
      .filter((plan) => {
        if (swapperPeriod === "ALL") return true;
        const completed = planningHasEnded(plan.endDate);
        return swapperPeriod === "COMPLETED" ? completed : !completed;
      })
      .sort((a, b) => {
        const aCompleted = planningHasEnded(a.endDate);
        const bCompleted = planningHasEnded(b.endDate);
        if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
        return aCompleted
          ? Date.parse(b.endDate) - Date.parse(a.endDate)
          : Date.parse(a.startDate) - Date.parse(b.startDate);
      });
    const publishedPlans = plans.filter(
      (plan) => plan.status === "PUBLISHED" && plan.occurrences.length > 0,
    );
    return (
      <section
        className="swapper-planning-directory"
        aria-label={t("Mes plannings publiés")}
      >
        <header className="swapper-planning-directory__intro">
          <div>
            <span className="admin-eyebrow">{t("Mes affectations")}</span>
            <h2>{t("Mes plannings")}</h2>
            <p>{t("Consultez vos shifts à venir et vos shifts terminés.")}</p>
          </div>
        </header>

        {publishedPlans.length > 0 && (
          <div
            className="swapper-planning-period-filters"
            role="group"
            aria-label={t("Filtrer mes plannings par période")}
          >
            {(
              [
                ["ALL", t("Tous")],
                ["ACTIVE", t("En cours")],
                ["COMPLETED", t("Terminés")],
              ] as [SwapperPeriodFilter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={swapperPeriod === value}
                onClick={() => setSwapperPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!visiblePlans.length ? (
          <section className="admin-card admin-empty">
            <CalendarBlankIcon size={30} />
            <h3>
              {publishedPlans.length > 0
                ? swapperPeriod === "COMPLETED"
                  ? t("Aucun planning terminé")
                  : t("Aucun planning à venir")
                : t("Aucun planning publié")}
            </h3>
            <p>
              {publishedPlans.length > 0
                ? t("Changez de période pour consulter vos autres plannings.")
                : t("Vos plannings apparaîtront ici dès qu’une affectation vous sera publiée.")}
            </p>
          </section>
        ) : (
          <div className="swapper-planning-directory__list">
            {visiblePlans.map((plan) => {
              const stations = stationNamesOf(plan);
              const completed = planningHasEnded(plan.endDate);
              const nextShift = plan.occurrences
                .filter(
                  (occurrence) =>
                    occurrence.startTime &&
                    Date.parse(occurrence.endTime || occurrence.startTime) >=
                      Date.now(),
                )
                .sort(
                  (a, b) =>
                    Date.parse(a.startTime || "") -
                    Date.parse(b.startTime || ""),
                )[0];
              const opening = openingId === plan.id;
              return (
                <button
                  type="button"
                  key={plan.id}
                  className="swapper-planning-entry"
                  disabled={busy || Boolean(openingId)}
                  aria-busy={opening}
                  aria-label={`Ouvrir le planning ${translate(plan.name || periodLabel(plan.startDate, plan.endDate))}`}
                  onClick={async () => {
                    setOpeningId(plan.id);
                    try {
                      await onOpen(plan.id);
                    } finally {
                      setOpeningId(null);
                    }
                  }}
                >
                  <span className="swapper-planning-entry__topline">
                    <span
                      className="swapper-planning-entry__icon"
                      aria-hidden="true"
                    >
                      <CalendarDotsIcon size={20} />
                    </span>
                    <span className="swapper-planning-entry__title">
                      <strong>
                        {translate(plan.name || periodLabel(plan.startDate, plan.endDate))}
                      </strong>
                      <small>{periodLabel(plan.startDate, plan.endDate)}</small>
                    </span>
                    {opening ? (
                      <span
                        className="planner-table__spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <CaretRightIcon
                        size={18}
                        weight="bold"
                        aria-hidden="true"
                      />
                    )}
                  </span>

                  <span className="swapper-planning-entry__meta">
                    <span className="swapper-planning-entry__station">
                      <MapPinIcon size={14} aria-hidden="true" />
                      <span>{stations.join(", ") || "Station"}</span>
                    </span>
                    <span>
                      <CalendarBlankIcon size={14} /> {plan.occurrences.length}{" "}
                      {translate("shift")}{plan.occurrences.length === 1 ? "" : "s"}
                    </span>
                    {completed && (
                      <span className="swapper-planning-entry__complete">
                        {translate("Terminé")}</span>
                    )}
                  </span>

                  {nextShift && !completed ? (
                    <span className="swapper-planning-entry__next">
                      <ClockIcon size={15} />
                      <span>
                        <small>{translate("Prochain shift")}</small>
                        <strong>
                          {new Date(nextShift.startTime || "").toLocaleString(
                            locale,
                            {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                          {nextShift.templateVersion?.label
                            ? ` · ${nextShift.templateVersion.label}`
                            : ""}
                        </strong>
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="planner-listing">
      <div className="admin-card planner-listing__head">
        <div className="planner-listing__actions">
          {plans.length > 0 && (
            <div className="admin-search planner-listing__search">
              <MagnifyingGlassIcon size={18} aria-hidden="true" />
              <input
                aria-label={translate("Rechercher un planning")}
                placeholder={translate("Nom, station ou période…")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          {canCreate && onGenerate && (
            <button
              className="admin-button secondary planner-generate-btn"
              onClick={onGenerate}
              disabled={busy}
              title={translate("Crée les shifts des stations choisies puis répartit les swappeurs de chacune")}
            >
              <LightningIcon size={18} aria-hidden="true" />
              {translate("Générer automatiquement")}</button>
          )}
          {canCreate && onCreate && (
            <button
              className="admin-button primary-cta"
              onClick={onCreate}
              disabled={busy}
              title={translate("Crée un brouillon avec des postes à affecter depuis le calendrier")}
            >
              <PlusIcon size={18} aria-hidden="true" />
              {translate("Créer un brouillon")}</button>
          )}
          {canCreate && plans.length > 0 && (
            <ExportExcelButton onClick={exportPlannings} disabled={!rows.length} />
          )}
        </div>
        {plans.length > 0 && (
          <div
            className="planner-listing__filters"
            role="group"
            aria-label={translate("Statut des plannings")}
          >
            {(
              [
                ["ALL", t("Tous"), counts.all],
                ["PUBLISHED", t("Publiés"), counts.published],
                ["DRAFT", "Brouillons", counts.draft],
              ] as [StatusFilter, string, number][]
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className="planner-listing__chip"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!plans.length ? (
        <section className="admin-card admin-empty">
          <CalendarBlankIcon size={30} weight="regular" />
          <h3>{t("Aucun planning pour le moment")}</h3>
          <p>
            {canCreate
              ? t("Créez votre premier planning pour commencer à affecter des swappeurs.")
              : t("Vos horaires apparaîtront ici dès leur publication.")}
          </p>
          {canCreate && onCreate && (
            <button className="admin-button" onClick={onCreate}>
              {t("Créer un brouillon")}
            </button>
          )}
        </section>
      ) : !rows.length ? (
        <section className="admin-card admin-empty">
          <h3>{t("Aucun planning ne correspond")}</h3>
          <p>{t("Essayez un autre statut ou un autre terme de recherche.")}</p>
        </section>
      ) : (
        <div className="admin-card planner-listing__table-card">
          <div className="admin-table-wrap">
            <table className="admin-table planner-table">
              <thead>
                <tr>
                  <th>{t("Planning")}</th>
                  <th>{t("Période")}</th>
                  <th>{t("Durée")}</th>
                  <th>{t("Station")}</th>
                  <th>{t("Shifts inclus")}</th>
                  <th>{t("Statut")}</th>
                  <th aria-label={translate("Action")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((plan) => {
                  const duration = periodDuration(plan.startDate, plan.endDate);
                  const shiftCount =
                    plan._count?.occurrences ?? plan.occurrences.length;
                  const stations = stationNamesOf(plan);
                  const draft = plan.status !== "PUBLISHED";
                  return (
                    <tr
                      key={plan.id}
                      className={
                        "planner-table__row" +
                        (openingId === plan.id ? " is-opening" : "")
                      }
                      tabIndex={0}
                      role="link"
                      aria-busy={openingId === plan.id}
                      aria-label={`Ouvrir le planning ${translate(plan.name || periodLabel(plan.startDate, plan.endDate))}`}
                      onClick={async () => {
                        if (busy || openingId) return;
                        setOpeningId(plan.id);
                        try {
                          await onOpen(plan.id);
                        } finally {
                          setOpeningId(null);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (busy || openingId) return;
                          setOpeningId(plan.id);
                          void Promise.resolve(onOpen(plan.id)).finally(() =>
                            setOpeningId(null),
                          );
                        }
                      }}
                    >
                      <td>
                        <span className="planner-table__title">
                          <strong>
                            {translate(plan.name ||
                              periodLabel(plan.startDate, plan.endDate))}
                          </strong>
                          <small>{t("Révision")} {plan.revision}</small>
                        </span>
                      </td>
                      <td className="planner-table__dates" data-label={translate("Période")}>
                        <span>{periodLabel(plan.startDate, plan.endDate)}</span>
                      </td>
                      <td data-label={translate("Durée")}>
                        <span className="planner-table__duration">
                          <strong>{translate(duration.label)}</strong>
                          <small>{duration.detail}</small>
                        </span>
                      </td>
                      <td data-label={translate("Station")}>
                        <span className="planner-table__stations">
                          {stations.length === 0 ? (
                            <em className="planner-muted">{translate("—")}</em>
                          ) : (
                            <>
                              <strong>{stations[0]}</strong>
                              {stations.length > 1 && (
                                <small>
                                  {translate("+")}{stations.length - 1} {" "}{translate("autre")}{stations.length > 2 ? "s" : ""}
                                </small>
                              )}
                            </>
                          )}
                        </span>
                      </td>
                      <td data-label={translate("Shifts inclus")}>
                        <span className="planner-table__shifts">
                          <strong>{shiftCount}</strong>
                          <small>{t(shiftCount === 1 ? "shift" : "shifts")}</small>
                        </span>
                      </td>
                      <td data-label={translate("Statut")}>
                        <span
                          className={`admin-badge ${draft ? "draft" : "active"}`}
                        >
                          {t(draft ? "Brouillon" : "Publié")}
                        </span>
                      </td>
                      <td className="planner-table__go">
                        {openingId === plan.id ? (
                          <span
                            className="planner-table__spinner"
                            aria-hidden="true"
                          />
                        ) : (
                          <CaretRightIcon size={16} weight="bold" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!canCreate && (
            <p className="planner-listing__note">
              {t("Consultation seule : vous voyez les plannings publiés de votre station et vos propres shifts.")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Noms des stations visibles d'un planning (dédoublonnés). */
function stationNamesOf(plan: PlanningListItem): string[] {
  if (plan.visibleStations?.length)
    return plan.visibleStations.map((s) => s.name);
  const set = new Set<string>();
  for (const occurrence of plan.occurrences ?? []) {
    if (occurrence?.station?.name) set.add(occurrence.station.name);
  }
  return Array.from(set);
}

export { periodLabel };
