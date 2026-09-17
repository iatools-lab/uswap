import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle, RefreshCw } from "../../ui/icons";
import { formatDateTime } from "./format";
import {
  STATUS_LABEL,
  type MonitorData,
  type MonitorRow,
  type SupervisionProps,
} from "./types";
import "./supervision.css";

const REFRESH_MS = 30_000;

const STATUS_CLASS: Record<MonitorRow["status"], string> = {
  PRESENT: "attendance-status--present",
  LATE: "attendance-status--late",
  ABSENT: "attendance-status--absent",
  CLOSED: "attendance-status--closed",
  EXPECTED: "attendance-status--expected",
};

const FILTERS: Array<MonitorRow["status"] | "ALL"> = [
  "ALL",
  "EXPECTED",
  "PRESENT",
  "LATE",
  "ABSENT",
  "CLOSED",
];

export function AttendanceMonitor({
  user,
  onCorrect,
}: SupervisionProps & { onCorrect?: (row: MonitorRow) => void }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");

  const load = useCallback(async (silent = false) => {
    if (!silent) setError("");
    setRefreshing(true);
    try {
      setData(await api<MonitorData>("/attendance/monitor"));
    } catch (err) {
      if (!silent) setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === "ALL") return data.rows;
    return data.rows.filter((row) => row.status === filter);
  }, [data, filter]);

  if (error)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>Suivi indisponible</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={() => void load()}>
          Réessayer
        </button>
      </section>
    );

  if (!data)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement du suivi…
      </div>
    );

  const { summary } = data;

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>
            Pointages
            <span className="ops-live" aria-hidden="true">
              Live
            </span>
          </h2>
          <p className="operations-hint">
            Actualisé toutes les 30 s · {formatDateTime(data.generatedAt)}
            {user.role === "STATION_CHIEF" ? " · votre station" : ""}
          </p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          disabled={refreshing}
          onClick={() => void load()}
        >
          <RefreshCw size={15} className={refreshing ? "spin" : undefined} />
          Rafraîchir
        </button>
      </div>

      <div className="supervision-metrics">
        <button
          type="button"
          className="supervision-metric"
          aria-pressed={filter === "ALL"}
          onClick={() => setFilter("ALL")}
        >
          <strong>{data.rows.length}</strong>
          <span>Tous</span>
        </button>
        <button
          type="button"
          className="supervision-metric"
          aria-pressed={filter === "EXPECTED"}
          onClick={() => setFilter("EXPECTED")}
        >
          <strong>{summary.expected}</strong>
          <span>Attendus</span>
        </button>
        <button
          type="button"
          className="supervision-metric supervision-metric--live"
          aria-pressed={filter === "PRESENT"}
          onClick={() => setFilter("PRESENT")}
        >
          <strong>{summary.present}</strong>
          <span>À l’heure</span>
        </button>
        <button
          type="button"
          className="supervision-metric supervision-metric--late"
          aria-pressed={filter === "LATE"}
          onClick={() => setFilter("LATE")}
        >
          <strong>{summary.late}</strong>
          <span>Retards</span>
        </button>
        <button
          type="button"
          className="supervision-metric supervision-metric--alert"
          aria-pressed={filter === "ABSENT"}
          onClick={() => setFilter("ABSENT")}
        >
          <strong>{summary.absent}</strong>
          <span>Absences</span>
        </button>
        <button
          type="button"
          className="supervision-metric"
          aria-pressed={filter === "CLOSED"}
          onClick={() => setFilter("CLOSED")}
        >
          <strong>{summary.closed}</strong>
          <span>Fins de service</span>
        </button>
      </div>

      {!rows.length ? (
        <div className="admin-empty">
          <h3>
            {data.rows.length
              ? "Aucun pointage pour ce filtre"
              : "Aucune affectation publiée sur la période"}
          </h3>
        </div>
      ) : (
        <div className="admin-table-wrap ops-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Swappeur</th>
                <th>Station</th>
                <th>Shift prévu</th>
                <th>Début</th>
                <th>Fin</th>
                <th>État</th>
                {onCorrect && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.shiftId}>
                  <td>
                    <span className="ops-person">
                      <strong>{row.swapper.fullName}</strong>
                      {row.template && <small>{row.template}</small>}
                    </span>
                  </td>
                  <td>{row.station.name}</td>
                  <td>{formatDateTime(row.startTime, row.station.timezone)}</td>
                  <td>
                    {row.checkedInAt
                      ? formatDateTime(row.checkedInAt, row.station.timezone)
                      : "—"}
                  </td>
                  <td>
                    {row.checkedOutAt
                      ? formatDateTime(row.checkedOutAt, row.station.timezone)
                      : "—"}
                  </td>
                  <td>
                    <span
                      className={`attendance-status ${STATUS_CLASS[row.status]}`}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  {onCorrect && (
                    <td>
                      <button
                        type="button"
                        className="admin-button secondary small"
                        onClick={() => onCorrect(row)}
                      >
                        Corriger
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
