import { translate } from "../../app/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/auth-api";
import { LoaderCircle, Search } from "../../ui/icons";
import { ExportExcelButton } from "../../ui/ExportExcelButton";
import { exportToExcel } from "../../utils/excelExport";
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
  { key: "EXPECTED", label: "Non pointés" },
  { key: "PRESENT", label: "Pointés" },
  { key: "LATE", label: "Retards" },
  { key: "ABSENT", label: "Absences" },
  { key: "JUSTIFIED", label: "Justifiées" },
  { key: "CLOSED", label: "Fins de service" },
];

export function AttendanceMonitor({
  user,
  onCorrect,
}: SupervisionProps & { onCorrect?: (row: MonitorRow) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const targetShiftId = new URLSearchParams(location.search).get("shift");
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<MonitorRow["status"] | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [stationId, setStationId] = useState("ALL");

  const load = useCallback(async (silent = false) => {
    if (!silent) setError("");
    try {
      setData(await api<MonitorData>("/attendance/monitor"));
    } catch (err) {
      if (!silent) setError((err as Error).message);
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
    const now = Date.now();
    return data.rows.filter((row) => {
      // Le suivi direct reste centré sur les postes encore en cours ou à venir.
      if (
        !row.swapper?.id ||
        (!targetShiftId && Date.parse(row.endTime) <= now)
      )
        return false;
      if (targetShiftId && row.shiftId !== targetShiftId) return false;
      if (stationId !== "ALL" && row.station.id !== stationId) return false;
      if (!needle) return true;
      return `${row.swapper.fullName} ${row.station.name} ${row.template || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [data, query, stationId, targetShiftId]);

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
      header: translate("Swappeur"),
      primary: true,
      render: (row: MonitorRow) => (
        <span className="ops-person">
          <strong>{row.swapper.fullName}</strong>
          {row.template && <small>{translate(row.template)}</small>}
        </span>
      ),
    },
    {
      key: "station",
      header: translate("Station"),
      render: (row: MonitorRow) => row.station.name,
    },
    {
      key: "planned",
      header: translate("Shift prévu"),
      render: (row: MonitorRow) =>
        formatDateTime(row.startTime, row.station.timezone),
    },
    {
      key: "checkin",
      header: translate("Début"),
      render: (row: MonitorRow) =>
        row.checkedInAt
          ? formatDateTime(row.checkedInAt, row.station.timezone)
          : "—",
    },
    {
      key: "checkout",
      header: translate("Fin"),
      render: (row: MonitorRow) =>
        row.checkedOutAt
          ? formatDateTime(row.checkedOutAt, row.station.timezone)
          : "—",
    },
    {
      key: "status",
      header: translate("État"),
      render: (row: MonitorRow) => (
        <span className={`attendance-status ${STATUS_CLASS[row.status]}`}>
          {translate(STATUS_LABEL[row.status])}
        </span>
      ),
    },
    ...(onCorrect
      ? [
          {
            key: "action",
            header: translate("Action"),
            className: "responsive-data-card__action",
            render: (row: MonitorRow) => (
              <button
                type="button"
                className="admin-button secondary small"
                onClick={() => onCorrect(row)}
              >
                {translate("Corriger")}</button>
            ),
          },
        ]
      : []),
  ];

  if (error) {
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>{translate("Suivi indisponible")}</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={() => void load()}>
          {translate("Réessayer")}</button>
      </section>
    );
  }

  if (!data) {
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" /> {" "}{translate("Chargement du suivi…")}</div>
    );
  }

  const getCount = (key: string) => {
    if (key === "ALL") return scopedRows.length;
    return scopedRows.filter((row) => row.status === key).length;
  };

  function exportAttendance() {
    if (!rows.length) return;
    exportToExcel({
      data: rows,
      filename: `uswap-pointages-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "Pointages",
      columns: [
        { header: translate("Swappeur"), key: (row) => row.swapper.fullName, width: 24 },
        { header: translate("Station"), key: (row) => row.station.name, width: 24 },
        { header: translate("Shift"), key: (row) => translate(row.template ?? "—"), width: 18 },
        { header: translate("Début prévu"), key: (row) => formatDateTime(row.startTime, row.station.timezone), width: 22 },
        { header: translate("Fin prévue"), key: (row) => formatDateTime(row.endTime, row.station.timezone), width: 22 },
        { header: translate("Début du pointage"), key: (row) => row.checkedInAt ? formatDateTime(row.checkedInAt, row.station.timezone) : "—", width: 22 },
        { header: translate("Fin du pointage"), key: (row) => row.checkedOutAt ? formatDateTime(row.checkedOutAt, row.station.timezone) : "—", width: 22 },
        { header: translate("Retard"), key: (row) => row.isLate ? translate("Oui") : translate("Non"), width: 12 },
        { header: translate("Tolérance (min)"), key: (row) => row.toleranceMinutes ?? "—", width: 16 },
        { header: translate("État"), key: (row) => translate(STATUS_LABEL[row.status]), width: 18 },
      ],
    });
  }

  return (
    <div className="operations-stack" style={{ paddingBottom: "24px" }}>
      <div className="premium-list-header">
        <div>
          <span className="premium-eyebrow">{translate("POINTAGES DU JOUR")}</span>
          <h2>{translate("Suivi des pointages")}</h2>
          <p>
            {translate("Shifts en cours et à venir · Actualisé à")}{" "}
            {formatDateTime(data.generatedAt)}
          </p>
        </div>
        <ExportExcelButton onClick={exportAttendance} disabled={!rows.length} />
      </div>

      {targetShiftId && (
        <div className="attendance-target-notice" role="status">
          <span>{translate("Pointage concerné par la notification")}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => navigate(location.pathname, { replace: true })}
          >
            {translate("Voir tout le suivi")}</button>
        </div>
      )}

      <div className="attendance-smart-filters">
        <label className="attendance-smart-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("Rechercher un swappeur, un shift…")}
          />
        </label>
        <Select
          size="sm"
          value={stationId}
          ariaLabel={translate("Filtrer les pointages par station")}
          width="210px"
          onChange={(value) => setStationId(String(value))}
          options={[
            { value: "ALL", label: translate("Toutes les stations") },
            ...stations.map((station) => ({
              value: station.id,
              label: station.name,
            })),
          ]}
        />
      </div>

      <div className="attendance-status-filters" aria-label={translate("Filtrer par état")}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`admin-button secondary ${filter === f.key ? "active-filter" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {translate(f.label)} <span>{getCount(f.key)}</span>
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
          <h3>
            {targetShiftId
              ? "Ce pointage n’est plus disponible"
              : "Aucun pointage pour ce filtre"}
          </h3>
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
            ariaLabel={translate("Suivi des présences")}
            className="ops-table"
          />
        </div>
      )}
    </div>
  );
}
