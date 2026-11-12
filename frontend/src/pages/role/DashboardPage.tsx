import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { notify } from "../../ui/Toast";
import { LoaderCircle, RefreshCw } from "../../ui/icons";
import { KpiCard } from "../../ui/KpiCard";
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
        <KpiCard
          compact
          label="Shifts du jour"
          value={today.total}
          detail={`${coverage}% de couverture`}
          progress={coverage}
          tone={coverage === 100 ? "green" : "amber"}
        />
        <KpiCard
          compact
          label="Présents"
          value={today.present}
          detail="À l’heure"
          tone="green"
        />
        <KpiCard
          compact
          label="En retard"
          value={today.late}
          detail="Au-delà de la tolérance"
          tone={today.late > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label="Absents"
          value={today.absent}
          detail="Sans pointage valide"
          tone={today.absent > 0 ? "red" : "neutral"}
        />
        <KpiCard
          compact
          label="Shifts terminés"
          value={today.completed}
          detail="Pointage clôturé"
          tone="blue"
        />
        <KpiCard
          compact
          label="Remplacements"
          value={replacements.open}
          detail={`${replacements.assignedToday} ${replacements.assignedToday === 1 ? "traité aujourd’hui" : "traités aujourd’hui"}`}
          tone={replacements.open > 0 ? "amber" : "neutral"}
        />
      </section>

      <section className="dashboard-grid dashboard-grid--secondary">
        <KpiCard
          compact
          label="Attendus"
          value={today.expected}
          detail="Shift en cours, sans pointage"
          tone={today.expected > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label="Heures de la semaine"
          value={
            <>
              {hours.weekly} h <small>/ {hours.weeklyLimit} h</small>
            </>
          }
          detail={
            limitExceeded
              ? `Limite dépassée de ${(hours.weekly - hours.weeklyLimit).toFixed(1)} h`
              : `${hours.remaining} h restantes`
          }
          progress={(hours.weekly / hours.weeklyLimit) * 100}
          tone={limitExceeded ? "red" : "blue"}
        />

        {workforce && (
          <KpiCard
            compact
            label="Swappeurs"
            value={
              <>
                {workforce.activeSwappers}
                <small> / {workforce.totalSwappers}</small>
              </>
            }
            detail="Comptes actifs sur le périmètre"
            progress={
              (workforce.activeSwappers /
                Math.max(1, workforce.totalSwappers)) *
              100
            }
            tone="navy"
          />
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
