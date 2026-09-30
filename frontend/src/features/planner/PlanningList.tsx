import { useMemo, useState } from "react";
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  CaretRightIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PlusIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import { periodDuration } from "./duration";
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

const dayShort = (value: string) =>
  new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

/** Libellé de période compact : « Du 15 au 21/09/2025 ». */
function periodLabel(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sd = start.getUTCDate();
  const sm = start.getUTCMonth() + 1;
  const sy = start.getUTCFullYear();
  const ed = end.getUTCDate();
  const em = end.getUTCMonth() + 1;
  const ey = end.getUTCFullYear();
  const two = (n: number) => String(n).padStart(2, "0");
  if (sy === ey && sm === em && sd === ed)
    return `Le ${two(sd)}/${two(sm)}/${sy}`;
  if (sy === ey && sm === em)
    return `Du ${two(sd)} au ${two(ed)}/${two(sm)}/${sy}`;
  if (sy === ey)
    return `Du ${two(sd)}/${two(sm)} au ${two(ed)}/${two(em)}/${sy}`;
  return `Du ${two(sd)}/${two(sm)}/${sy} au ${two(ed)}/${two(em)}/${ey}`;
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
  const [status, setStatus] = useState<StatusFilter>("ALL");
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

  // Premier chargement : aucun planning n'est encore connu.
  if (loading && !plans.length)
    return (
      <section className="admin-card admin-empty" role="status">
        <CalendarDotsIcon size={30} weight="regular" />
        <h3>Chargement des plannings…</h3>
      </section>
    );

  if (error)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>Chargement indisponible</h2>
        <p>{error}</p>
        {onRetry && (
          <button className="admin-button" onClick={onRetry}>
            Réessayer
          </button>
        )}
      </section>
    );

  if (isSwapper) {
    const visiblePlans = plans.filter(
      (plan) => plan.status === "PUBLISHED" && plan.occurrences.length > 0,
    );
    return (
      <section
        className="swapper-planning-directory"
        aria-label="Mes plannings publiés"
      >
        <header className="swapper-planning-directory__intro">
          <div>
            <span className="admin-eyebrow">Mes affectations</span>
            <h2>Plannings publiés</h2>
            <p>
              Retrouvez uniquement les plannings dans lesquels vous avez un
              service.
            </p>
          </div>
          <span className="swapper-planning-directory__count">
            {visiblePlans.length}
          </span>
        </header>

        {!visiblePlans.length ? (
          <section className="admin-card admin-empty">
            <CalendarBlankIcon size={30} />
            <h3>Aucun planning publié</h3>
            <p>
              Vos plannings apparaîtront ici dès qu’une affectation vous sera
              publiée.
            </p>
          </section>
        ) : (
          <div className="swapper-planning-directory__list">
            {visiblePlans.map((plan) => {
              const stations = stationNamesOf(plan);
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
                  aria-label={`Ouvrir le planning ${plan.name || periodLabel(plan.startDate, plan.endDate)}`}
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
                        {plan.name || periodLabel(plan.startDate, plan.endDate)}
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
                    <span>
                      <MapPinIcon size={14} />{" "}
                      {stations.join(", ") || "Station"}
                    </span>
                    <span>
                      <CalendarBlankIcon size={14} /> {plan.occurrences.length}{" "}
                      shift{plan.occurrences.length > 1 ? "s" : ""}
                    </span>
                  </span>

                  {nextShift ? (
                    <span className="swapper-planning-entry__next">
                      <ClockIcon size={15} />
                      <span>
                        <small>Prochain service</small>
                        <strong>
                          {new Date(nextShift.startTime || "").toLocaleString(
                            "fr-FR",
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
                  ) : (
                    <span className="swapper-planning-entry__complete">
                      Période terminée
                    </span>
                  )}
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
                aria-label="Rechercher un planning"
                placeholder="Nom, station ou période…"
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
              title="Crée les shifts puis répartit automatiquement les swappeurs de la station"
            >
              <LightningIcon size={18} aria-hidden="true" />
              Générer automatiquement
            </button>
          )}
          {canCreate && onCreate && (
            <button
              className="admin-button primary-cta"
              onClick={onCreate}
              disabled={busy}
              title="Crée un brouillon avec des postes à affecter depuis le calendrier"
            >
              <PlusIcon size={18} aria-hidden="true" />
              Créer un brouillon
            </button>
          )}
        </div>
        {plans.length > 0 && (
          <div
            className="planner-listing__filters"
            role="group"
            aria-label="Statut des plannings"
          >
            {(
              [
                ["ALL", "Tous", counts.all],
                ["PUBLISHED", "Publiés", counts.published],
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
          <h3>Aucun planning pour le moment</h3>
          <p>
            {canCreate
              ? "Créez votre premier planning pour commencer à affecter des swappeurs."
              : "Vos horaires apparaîtront ici dès leur publication."}
          </p>
          {canCreate && onCreate && (
            <button className="admin-button" onClick={onCreate}>
              Créer un brouillon
            </button>
          )}
        </section>
      ) : !rows.length ? (
        <section className="admin-card admin-empty">
          <h3>Aucun planning ne correspond</h3>
          <p>Essayez un autre statut ou un autre terme de recherche.</p>
        </section>
      ) : (
        <div className="admin-card planner-listing__table-card">
          <div className="admin-table-wrap">
            <table className="admin-table planner-table">
              <thead>
                <tr>
                  <th>Planning</th>
                  <th>Période</th>
                  <th>Durée</th>
                  <th>Station</th>
                  <th>Shifts inclus</th>
                  <th>Statut</th>
                  <th aria-label="Action" />
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
                      aria-label={`Ouvrir le planning ${plan.name || periodLabel(plan.startDate, plan.endDate)}`}
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
                            {plan.name ||
                              periodLabel(plan.startDate, plan.endDate)}
                          </strong>
                          <small>Révision {plan.revision}</small>
                        </span>
                      </td>
                      <td className="planner-table__dates" data-label="Période">
                        <span>{dayShort(plan.startDate)}</span>
                        <span className="planner-table__arrow">→</span>
                        <span>{dayShort(plan.endDate)}</span>
                      </td>
                      <td data-label="Durée">
                        <span className="planner-table__duration">
                          <strong>{duration.label}</strong>
                          <small>{duration.detail}</small>
                        </span>
                      </td>
                      <td data-label="Station">
                        <span className="planner-table__stations">
                          {stations.length === 0 ? (
                            <em className="planner-muted">—</em>
                          ) : (
                            <>
                              <strong>{stations[0]}</strong>
                              {stations.length > 1 && (
                                <small>
                                  +{stations.length - 1} autre
                                  {stations.length > 2 ? "s" : ""}
                                </small>
                              )}
                            </>
                          )}
                        </span>
                      </td>
                      <td data-label="Shifts inclus">
                        <span className="planner-table__shifts">
                          <strong>{shiftCount}</strong>
                          <small>shift{shiftCount > 1 ? "s" : ""}</small>
                        </span>
                      </td>
                      <td data-label="Statut">
                        <span
                          className={`admin-badge ${draft ? "draft" : "active"}`}
                        >
                          {draft ? "Brouillon" : "Publié"}
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
              Consultation seule : vous voyez les plannings publiés de votre
              station et vos propres shifts.
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
