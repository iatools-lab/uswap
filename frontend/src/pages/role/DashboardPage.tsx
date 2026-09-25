import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { notify } from "../../ui/Toast";
import { LoaderCircle, RefreshCw } from "../../ui/icons";
import { formatDateTime } from "../../features/supervision/format";
import "./dashboard.css";

type TimelineRow = {
  shiftId: string;
  station: string;
  timezone: string;
  swapper: string;
  startTime: string;
  endTime: string;
  status: "EXPECTED" | "PRESENT" | "LATE" | "ABSENT" | "CLOSED";
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

type DashboardStats = {
  generatedAt: string;
  businessDate: string;
  scope: {
    unrestricted: boolean;
    stationIds: string[];
  };
  today: {
    total: number;
    expected: number;
    present: number;
    late: number;
    absent: number;
    completed: number;
  };
  replacements: {
    open: number;
    assignedToday: number;
  };
  hours: {
    weekly: number;
    weeklyLimit: number;
    remaining: number;
  };
  workforce: {
    totalSwappers: number;
    activeSwappers: number;
  } | null;
  timeline: TimelineRow[];
};

const STATUS_LABEL: Record<TimelineRow["status"], string> = {
  EXPECTED: "Attendu",
  PRESENT: "Présent",
  LATE: "En retard",
  ABSENT: "Absent",
  CLOSED: "Terminé",
};

const STATUS_CLASS: Record<TimelineRow["status"], string> = {
  EXPECTED: "dashboard-pill dashboard-pill--expected",
  PRESENT: "dashboard-pill dashboard-pill--present",
  LATE: "dashboard-pill dashboard-pill--late",
  ABSENT: "dashboard-pill dashboard-pill--absent",
  CLOSED: "dashboard-pill dashboard-pill--closed",
};

const REFRESH_MS = 60_000;

export function DashboardPage() {
  const { session, onAccessLost } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<TimelineRow["status"] | "ALL">("ALL");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setError("");

      try {
        const result = await api<DashboardStats>("/dashboard/stats");
        setStats(result);
      } catch (err) {
        if (err instanceof ApiError && [401, 403].includes(err.status)) {
          onAccessLost();
          return;
        }
        if (!silent) setError((err as Error).message);
      }
    },
    [onAccessLost],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (error)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>Tableau de bord indisponible</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={() => void load()}>
          <RefreshCw size={16} /> Réessayer
        </button>
      </section>
    );

  if (!stats)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement du tableau de bord…
      </div>
    );

  const { today, replacements, hours, workforce, timeline } = stats;
  const rows =
    filter === "ALL"
      ? timeline
      : timeline.filter((row) => row.status === filter);

  const coverage =
    today.total === 0
      ? 0
      : Math.round(
          ((today.present + today.late + today.completed) / today.total) * 100,
        );

  const limitExceeded = hours.weekly > hours.weeklyLimit;

  async function refreshNow() {
    await load();
    notify("Tableau de bord actualisé.");
  }

  return (
    <div className="dashboard">
      <div className="dashboard-head">
        <div>
          <h1>Tableau de bord</h1>
          <p className="operations-hint">
            Journée opérationnelle du {stats.businessDate} (heure de Douala).
          </p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          onClick={() => void refreshNow()}
        >
          <RefreshCw size={16} />
          Actualiser
        </button>
      </div>

      <section className="dashboard-grid" aria-label="Indicateurs du jour">
        <article className="dashboard-card">
          <span className="dashboard-card__label">Shifts du jour</span>
          <strong className="dashboard-card__value">{today.total}</strong>
          <span className="dashboard-card__hint">
            {coverage}% de couverture
          </span>
        </article>

        <article className="dashboard-card dashboard-card--present">
          <span className="dashboard-card__label">Présents</span>
          <strong className="dashboard-card__value">{today.present}</strong>
          <span className="dashboard-card__hint">À l’heure</span>
        </article>

        <article className="dashboard-card dashboard-card--late">
          <span className="dashboard-card__label">En retard</span>
          <strong className="dashboard-card__value">{today.late}</strong>
          <span className="dashboard-card__hint">
            Au-delà de la tolérance
          </span>
        </article>

        <article className="dashboard-card dashboard-card--absent">
          <span className="dashboard-card__label">Absents</span>
          <strong className="dashboard-card__value">{today.absent}</strong>
          <span className="dashboard-card__hint">Sans pointage valide</span>
        </article>

        <article className="dashboard-card dashboard-card--closed">
          <span className="dashboard-card__label">Shifts terminés</span>
          <strong className="dashboard-card__value">{today.completed}</strong>
          <span className="dashboard-card__hint">Pointage clôturé</span>
        </article>

        <article
          className={`dashboard-card ${
            replacements.open > 0 ? "dashboard-card--alert" : ""
          }`}
        >
          <span className="dashboard-card__label">
            Demandes de remplacement
          </span>
          <strong className="dashboard-card__value">{replacements.open}</strong>
          <span className="dashboard-card__hint">
            {replacements.assignedToday} traitée(s) aujourd’hui
          </span>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid--secondary">
        <article className="dashboard-card">
          <span className="dashboard-card__label">Attendus</span>
          <strong className="dashboard-card__value">{today.expected}</strong>
          <span className="dashboard-card__hint">
            Shift en cours, pas encore pointé
          </span>
        </article>

        <article
          className={`dashboard-card ${
            limitExceeded ? "dashboard-card--alert" : ""
          }`}
        >
          <span className="dashboard-card__label">
            Heures de la semaine
          </span>
          <strong className="dashboard-card__value">
            {hours.weekly}h
            <small> / {hours.weeklyLimit}h</small>
          </strong>
          <span className="dashboard-card__hint">
            {limitExceeded
              ? `Limite dépassée de ${(hours.weekly - hours.weeklyLimit).toFixed(1)}h`
              : `${hours.remaining}h restantes`}
          </span>
        </article>

        {workforce && (
          <article className="dashboard-card">
            <span className="dashboard-card__label">Swappeurs</span>
            <strong className="dashboard-card__value">
              {workforce.activeSwappers}
              <small> / {workforce.totalSwappers}</small>
            </strong>
            <span className="dashboard-card__hint">
              Comptes actifs sur le périmètre
            </span>
          </article>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>Shifts du jour</h2>
            <p className="operations-hint">
              Vue chronologique des affectations publiées.
            </p>
          </div>
          <div className="dashboard-filters" role="group" aria-label="Filtrer">
            {(
              [
                "ALL",
                "EXPECTED",
                "PRESENT",
                "LATE",
                "ABSENT",
                "CLOSED",
              ] as const
            ).map((value) => (
              <button
                key={value}
                type="button"
                className={`dashboard-filter ${
                  filter === value ? "is-active" : ""
                }`}
                onClick={() => setFilter(value)}
              >
                {value === "ALL" ? "Tous" : STATUS_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {!rows.length ? (
          <div className="admin-empty">
            <h3>Aucun shift sur cette période</h3>
            <p>
              {today.total === 0
                ? "Aucune affectation publiée pour aujourd’hui."
                : "Aucun shift ne correspond à ce filtre."}
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap ops-table">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Horaire</th>
                  <th>Swappeur</th>
                  <th>Station</th>
                  <th>Statut</th>
                  <th>Pointage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.shiftId}>
                    <td>
                      {formatDateTime(row.startTime, row.timezone)} →{" "}
                      {formatDateTime(row.endTime, row.timezone)}
                    </td>
                    <td>{row.swapper}</td>
                    <td>{row.station}</td>
                    <td>
                      <span className={STATUS_CLASS[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td>
                      {row.checkedInAt
                        ? `Entrée ${formatDateTime(row.checkedInAt, row.timezone)}`
                        : "—"}
                      {row.checkedOutAt
                        ? ` · Sortie ${formatDateTime(row.checkedOutAt, row.timezone)}`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {session?.user.role === "SWAPPER" && (
        <p className="operations-hint">
          Ces chiffres concernent vos propres shifts.
        </p>
      )}
    </div>
  );
}