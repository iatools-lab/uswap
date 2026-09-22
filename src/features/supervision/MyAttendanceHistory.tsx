import { useEffect, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle } from "../../ui/icons";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "../../ui/ResponsiveDataTable";
import { formatDateTime } from "./format";
import type { AttendanceHistoryRow } from "./types";

export function MyAttendanceHistory({ swapperId }: { swapperId?: string }) {
  const [rows, setRows] = useState<AttendanceHistoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const columns: ResponsiveColumn<AttendanceHistoryRow>[] = [
    {
      key: "date",
      header: "Date et heure",
      primary: true,
      render: (row) => (
        <strong>
          {formatDateTime(row.plannedStart, row.station.timezone)}
        </strong>
      ),
    },
    { key: "station", header: "Station", render: (row) => row.station.name },
    { key: "shift", header: "Shift", render: (row) => row.template ?? "—" },
    {
      key: "planned",
      header: "Prévu",
      render: (row) => `${row.plannedHours.toFixed(2)} h`,
    },
    {
      key: "checkin",
      header: "Début",
      render: (row) =>
        row.checkedInAt
          ? formatDateTime(row.checkedInAt, row.station.timezone)
          : "—",
    },
    {
      key: "checkout",
      header: "Fin",
      render: (row) =>
        row.checkedOutAt
          ? formatDateTime(row.checkedOutAt, row.station.timezone)
          : "—",
    },
    {
      key: "status",
      header: "Statut",
      render: (row) =>
        row.isJustified ? (
          <span
            className="attendance-status attendance-status--closed"
            title={row.correctionReason ?? undefined}
          >
            Absence justifiée
          </span>
        ) : row.corrected ? (
          <span
            className="attendance-status attendance-status--closed"
            title={row.correctionReason ?? undefined}
          >
            Corrigé
          </span>
        ) : row.isAbsent ? (
          <span className="attendance-status attendance-status--absent">
            Absent
          </span>
        ) : row.checkedOutAt ? (
          <span className="attendance-status attendance-status--present">
            Terminé
          </span>
        ) : row.checkedInAt ? (
          <span
            className={`attendance-status ${row.isLate ? "attendance-status--late" : "attendance-status--present"}`}
          >
            {row.isLate ? "En retard" : "À l’heure"}
          </span>
        ) : (
          <span className="attendance-status attendance-status--expected">
            Attendu
          </span>
        ),
    },
  ];

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
    if (swapperId) params.set("swapperId", swapperId);
    setRows(null);
    api<AttendanceHistoryRow[]>(`/attendance/history?${params.toString()}`)
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      });
    return () => {
      active = false;
    };
  }, [from, to, swapperId]);

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>Mes pointages</h2>
          <p className="operations-hint">
            Prises et fins de service. Une correction validée est indiquée, sans
            le justificatif.
          </p>
        </div>
      </div>
      <div className="supervision-toolbar">
        <label>
          Du
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Au
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!rows ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" />
          Chargement de votre relevé…
        </div>
      ) : !rows.length ? (
        <div className="admin-empty">
          <h3>Aucun pointage sur la période</h3>
        </div>
      ) : (
        <ResponsiveDataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.shiftId}
          ariaLabel="Historique de mes pointages"
          className="ops-table"
        />
      )}
    </section>
  );
}
