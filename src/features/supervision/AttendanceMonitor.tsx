import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle, RefreshCw } from "../../ui/icons";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "../../ui/ResponsiveDataTable";
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
  JUSTIFIED: "attendance-status--closed",
  CLOSED: "attendance-status--closed",
  EXPECTED: "attendance-status--expected",
};

const FILTERS: Array<{ key: MonitorRow["status"] | "ALL"; label: string }> = [
  { key: "ALL", label: "Tous" },
  { key: "EXPECTED", label: "Attendus" },
  { key: "PRESENT", label: "À l'heure" },
  { key: "LATE", label: "Retards" },
  { key: "ABSENT", label: "Absences" },
  { key: "JUSTIFIED", label: "Justifiées" },
  { key: "CLOSED", label: "Fins de service" },
];

export function AttendanceMonitor({
  user,
  onCorrect,
}: SupervisionProps & { onCorrect?: (row: MonitorRow) => void }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<MonitorRow["status"] | "ALL">("ALL");

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
    return data.rows.filter((row: MonitorRow) => row.status === filter);
  }, [data, filter]);

  const columns: ResponsiveColumn<MonitorRow>[] = [
    {
      key: "swapper",
      header: "Swappeur",
      primary: true,
      render: (row: MonitorRow) => (
        <span className="ops-person">
          <strong>{row.swapper.fullName}</strong>
          {row.template && <small>{row.template}</small>}
        </span>
      ),
    },
    {
      key: "station",
      header: "Station",
      render: (row: MonitorRow) => row.station.name,
    },
    {
      key: "planned",
      header: "Shift prévu",
      render: (row: MonitorRow) =>
        formatDateTime(row.startTime, row.station.timezone),
    },
    {
      key: "checkin",
      header: "Début",
      render: (row: MonitorRow) =>
        row.checkedInAt
          ? formatDateTime(row.checkedInAt, row.station.timezone)
          : "—",
    },
    {
      key: "checkout",
      header: "Fin",
      render: (row: MonitorRow) =>
        row.checkedOutAt
          ? formatDateTime(row.checkedOutAt, row.station.timezone)
          : "—",
    },
    {
      key: "status",
      header: "État",
      render: (row: MonitorRow) => (
        <span className={`attendance-status ${STATUS_CLASS[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      ),
    },
    ...(onCorrect
      ? [
          {
            key: "action",
            header: "Action",
            className: "responsive-data-card__action",
            render: (row: MonitorRow) => (
              <button
                type="button"
                className="admin-button secondary small"
                onClick={() => onCorrect(row)}
              >
                Corriger
              </button>
            ),
          },
        ]
      : []),
  ];

  if (error) {
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>Suivi indisponible</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={() => void load()}>
          Réessayer
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" /> Chargement du suivi…
      </div>
    );
  }

  const getCount = (key: string) => {
    if (key === "ALL") return data.rows.length;
    if (key === "EXPECTED") return data.summary.expected;
    if (key === "PRESENT") return data.summary.present;
    if (key === "LATE") return data.summary.late;
    if (key === "ABSENT") return data.summary.absent;
    if (key === "JUSTIFIED") return data.summary.justified;
    if (key === "CLOSED") return data.summary.closed;
    return 0;
  };

  return (
    <div className="operations-stack" style={{ paddingBottom: "24px" }}>
      <div className="premium-list-header">
        <div>
          <span className="premium-eyebrow">MONITORING</span>
          <h2>Suivi des pointages</h2>
          <p>Actualisé toutes les 30s · {formatDateTime(data.generatedAt)}</p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          style={{
            width: "34px",
            height: "34px",
            padding: 0,
            borderRadius: "10px",
            flexShrink: 0,
          }}
          disabled={refreshing}
          onClick={() => void load()}
        >
          <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          overflowX: "auto",
          paddingBottom: "12px",
          margin: "0 4px 8px",
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`admin-button secondary ${filter === f.key ? "active-filter" : ""}`}
            onClick={() => setFilter(f.key as any)}
            style={{
              fontSize: "12.5px",
              minHeight: "32px",
              padding: "4px 14px",
              borderRadius: "20px",
              whiteSpace: "nowrap",
              border: filter === f.key ? "none" : "1px solid var(--line)",
            }}
          >
            {f.label}{" "}
            <span style={{ opacity: 0.6, marginLeft: "4px" }}>
              ({getCount(f.key)})
            </span>
          </button>
        ))}
      </div>

      {!rows.length ? (
        <div
          className="admin-empty"
          style={{
            background: "#fff",
            borderRadius: "16px",
            border: "1px solid var(--line)",
          }}
        >
          <h3>Aucun pointage pour ce filtre</h3>
        </div>
      ) : (
        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            border: "1px solid var(--line)",
            padding: "4px",
            overflow: "hidden",
          }}
        >
          <ResponsiveDataTable
            rows={rows}
            columns={columns}
            rowKey={(row: MonitorRow) => row.shiftId}
            ariaLabel="Suivi des présences"
            className="ops-table"
          />
        </div>
      )}
    </div>
  );
}
