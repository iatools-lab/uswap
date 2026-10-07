import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle, Search } from "../../ui/icons";
import { Select } from "../../ui/Select";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "../../ui/ResponsiveDataTable";
import { formatDateTime } from "./format";
import { STATUS_LABEL, type MonitorRow, type SupervisionProps } from "./types";

type ShiftRecord = {
  id: string;
  startTime: string;
  endTime: string;
  publishedAt?: string | null;
  station?: {
    id: string;
    name: string;
    timezone?: string;
    latenessToleranceMinutes?: number;
  };
  swapper?: { id: string; fullName: string } | null;
  templateVersion?: { label: string } | null;
  attendance?: {
    checkedInAt?: string | null;
    checkedOutAt?: string | null;
    isLate?: boolean;
    isAbsent?: boolean;
  } | null;
};

type HistoryStatus = {
  shiftId: string;
  isAbsent?: boolean;
  isJustified?: boolean;
  corrected?: boolean;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  isLate?: boolean;
  station?: {
    id: string;
    name: string;
    timezone?: string;
    latenessToleranceMinutes?: number;
  };
  template?: string | null;
};

const STATUS_FILTERS: Array<{
  value: MonitorRow["status"] | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Tous les statuts" },
  { value: "PRESENT", label: "Pointé" },
  { value: "LATE", label: "En retard" },
  { value: "ABSENT", label: "Absent" },
  { value: "JUSTIFIED", label: "Absence justifiée" },
  { value: "CLOSED", label: "Service terminé" },
  { value: "EXPECTED", label: "Non pointé" },
];

function adaptRecord(shift: ShiftRecord, history?: HistoryStatus): MonitorRow {
  const checkedInAt = history?.checkedInAt ?? shift.attendance?.checkedInAt;
  const checkedOutAt = history?.checkedOutAt ?? shift.attendance?.checkedOutAt;
  const isLate = Boolean(history?.isLate ?? shift.attendance?.isLate);
  const mappedStatus: MonitorRow["status"] = history?.isJustified
    ? "JUSTIFIED"
    : history?.isAbsent || shift.attendance?.isAbsent
      ? "ABSENT"
      : checkedOutAt
        ? "CLOSED"
        : checkedInAt
          ? isLate
            ? "LATE"
            : "PRESENT"
          : "EXPECTED";
  return {
    shiftId: shift.id,
    station: {
      id: shift.station?.id ?? "unknown",
      name: shift.station?.name ?? "Station inconnue",
      timezone: shift.station?.timezone ?? "Africa/Douala",
    },
    swapper: {
      id: shift.swapper?.id ?? "unknown",
      fullName: shift.swapper?.fullName ?? "Swappeur inconnu",
    },
    template: shift.templateVersion?.label ?? history?.template ?? null,
    startTime: shift.startTime,
    endTime: shift.endTime,
    status: mappedStatus,
    checkedInAt: checkedInAt ?? null,
    checkedOutAt: checkedOutAt ?? null,
    isLate,
    toleranceMinutes: shift.station?.latenessToleranceMinutes ?? null,
  };
}

const toDateKey = (value: string) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

export function AttendanceHistory({
  user,
  onCorrect,
}: SupervisionProps & { onCorrect?: (row: MonitorRow) => void }) {
  const [records, setRecords] = useState<MonitorRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stationId, setStationId] = useState("ALL");
  const [status, setStatus] = useState<MonitorRow["status"] | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let active = true;
    setRecords(null);
    setError("");
    Promise.all([
      api<ShiftRecord[]>("/shifts"),
      api<HistoryStatus[]>("/attendance/history"),
    ])
      .then(([shifts, items]) => {
        if (!active) return;
        const now = Date.now();
        const byShiftId = new Map(items.map((item) => [item.shiftId, item]));
        setRecords(
          shifts
            .filter(
              (shift) =>
                shift.publishedAt &&
                shift.swapper &&
                Date.parse(shift.endTime) <= now,
            )
            .map((shift) => adaptRecord(shift, byShiftId.get(shift.id)))
            .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)),
        );
      })
      .catch((reason) => {
        if (active) setError((reason as Error).message);
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  const stations = useMemo(() => {
    const unique = new Map<string, string>();
    records?.forEach((row) => unique.set(row.station.id, row.station.name));
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
  }, [records]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return (records ?? []).filter((row) => {
      if (stationId !== "ALL" && row.station.id !== stationId) return false;
      if (status !== "ALL" && row.status !== status) return false;
      const day = toDateKey(row.startTime);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return (
        !needle ||
        `${row.swapper.fullName} ${row.station.name} ${row.template ?? ""}`
          .toLocaleLowerCase("fr")
          .includes(needle)
      );
    });
  }, [records, query, stationId, status, from, to]);

  const columns: ResponsiveColumn<MonitorRow>[] = [
    {
      key: "swapper",
      header: "Swappeur",
      primary: true,
      render: (row) => (
        <span className="ops-person">
          <strong>{row.swapper.fullName}</strong>
          {row.template && <small>{row.template}</small>}
        </span>
      ),
    },
    { key: "station", header: "Station", render: (row) => row.station.name },
    {
      key: "planned",
      header: "Shift prévu",
      render: (row) => formatDateTime(row.startTime, row.station.timezone),
    },
    {
      key: "checkin",
      header: "Prise de service",
      render: (row) =>
        row.checkedInAt
          ? formatDateTime(row.checkedInAt, row.station.timezone)
          : "—",
    },
    {
      key: "checkout",
      header: "Fin de service",
      render: (row) =>
        row.checkedOutAt
          ? formatDateTime(row.checkedOutAt, row.station.timezone)
          : "—",
    },
    {
      key: "status",
      header: "Statut",
      render: (row) => (
        <span
          className={`attendance-status attendance-status--${row.status.toLowerCase()}`}
        >
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

  return (
    <section className="admin-card attendance-history">
      <div className="admin-card-heading">
        <div>
          <h2>Historique complet des pointages</h2>
          <p className="operations-hint">
            Tous les shifts commencés, avec les prises, fins de service et
            statuts constatés.
          </p>
        </div>
        <span className="admin-badge">
          {visibleRows.length} résultat{visibleRows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="attendance-history-filters">
        <label className="attendance-smart-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Swappeur, station ou shift…"
            aria-label="Rechercher dans l’historique"
          />
        </label>
        <Select
          value={stationId}
          size="sm"
          ariaLabel="Filtrer par station"
          onChange={(value) => setStationId(String(value))}
          options={[
            { value: "ALL", label: "Toutes les stations" },
            ...stations.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
        <Select
          value={status}
          size="sm"
          ariaLabel="Filtrer par statut"
          onChange={(value) =>
            setStatus(String(value) as MonitorRow["status"] | "ALL")
          }
          options={STATUS_FILTERS}
        />
        <label className="attendance-history-date">
          Du
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="attendance-history-date">
          Au
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <div className="admin-empty" role="alert">
          <h3>Historique indisponible</h3>
          <p>{error}</p>
        </div>
      ) : !records ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" /> Chargement de l’historique…
        </div>
      ) : visibleRows.length ? (
        <ResponsiveDataTable
          rows={visibleRows}
          columns={columns}
          rowKey={(row) => row.shiftId}
          ariaLabel="Historique complet des pointages"
          className="ops-table"
        />
      ) : (
        <div className="admin-empty">
          <h3>
            {records.length
              ? "Aucun pointage ne correspond aux filtres"
              : "Aucun pointage enregistré"}
          </h3>
          <p>Modifiez les filtres ou consultez les autres périodes.</p>
        </div>
      )}
    </section>
  );
}
