import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle, RefreshCw, Search } from "../../ui/icons";
import { Select } from "../../ui/Select";
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
  const [query, setQuery] = useState("");
  const [stationId, setStationId] = useState("ALL");

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

  const stations = useMemo(() => {
    const values = new Map<string, string>();
    data?.rows.forEach((row) => values.set(row.station.id, row.station.name));
    return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
  }, [data]);

  const scopedRows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (stationId !== "ALL" && row.station.id !== stationId) return false;
      if (!needle) return true;
      return `${row.swapper.fullName} ${row.station.name} ${row.template || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [data, query, stationId]);

  const rows = useMemo(
    () =>
      filter === "ALL"
        ? scopedRows
        : scopedRows.filter((row) => row.status === filter),
    [filter, scopedRows],
  );

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
    if (key === "ALL") return scopedRows.length;
    return scopedRows.filter((row) => row.status === key).length;
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

      <div className="attendance-smart-filters">
        <label className="attendance-smart-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un swappeur, un shift…"
          />
        </label>
        <Select
          size="sm"
          value={stationId}
          ariaLabel="Filtrer les pointages par station"
          width="210px"
          onChange={(value) => setStationId(String(value))}
          options={[
            { value: "ALL", label: "Toutes les stations" },
            ...stations.map((station) => ({
              value: station.id,
              label: station.name,
            })),
          ]}
        />
      </div>

      <div className="attendance-status-filters" aria-label="Filtrer par état">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`admin-button secondary ${filter === f.key ? "active-filter" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span>{getCount(f.key)}</span>
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
