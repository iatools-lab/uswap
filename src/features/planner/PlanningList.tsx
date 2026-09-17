import { useMemo, useState } from "react";
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
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
  busy,
  loading,
  error,
  onRetry,
}: {
  plans: PlanningListItem[];
  userRole: string;
  onOpen: (id: string) => void;
  onCreate?: () => void;
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
        return (plan.name || "").toLowerCase().includes(needle) || stationNames.includes(needle) || period.includes(needle);
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
          {canCreate && onCreate && (
            <button
              className="admin-button primary-cta"
              onClick={onCreate}
              disabled={busy}
            >
              <PlusIcon size={18} aria-hidden="true" />
              Nouveau planning
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
              Créer un planning
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
                      onClick={() => {
                        if (busy || openingId) return;
                        setOpeningId(plan.id);
                        onOpen(plan.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (busy || openingId) return;
                          setOpeningId(plan.id);
                          onOpen(plan.id);
                        }
                      }}
                    >
                      <td>
                        <span className="planner-table__title">
                          <strong>
                            {plan.name || periodLabel(plan.startDate, plan.endDate)}
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
