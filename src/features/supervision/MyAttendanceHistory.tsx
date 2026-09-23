import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle, Clock3 } from "../../ui/icons";
import { formatDateTime } from "./format";
import type { AttendanceHistoryRow } from "./types";

function renderAttendanceStatus(row: AttendanceHistoryRow) {
  if (row.isJustified) {
    return (
      <span
        className="attendance-status attendance-status--closed"
        title={row.correctionReason ?? undefined}
      >
        Absence justifiée
      </span>
    );
  }
  if (row.corrected) {
    return (
      <span
        className="attendance-status attendance-status--closed"
        title={row.correctionReason ?? undefined}
      >
        Corrigé
      </span>
    );
  }
  if (row.isAbsent) {
    return (
      <span className="attendance-status attendance-status--absent">
        Absent
      </span>
    );
  }
  if (row.checkedOutAt) {
    return (
      <span className="attendance-status attendance-status--present">
        Terminé
      </span>
    );
  }
  if (row.checkedInAt) {
    return (
      <span
        className={`attendance-status ${row.isLate ? "attendance-status--late" : "attendance-status--present"}`}
      >
        {row.isLate ? "En retard" : "À l’heure"}
      </span>
    );
  }
  return (
    <span className="attendance-status attendance-status--expected">
      Attendu
    </span>
  );
}

export function MyAttendanceHistory({ swapperId }: { swapperId?: string }) {
  const [rows, setRows] = useState<AttendanceHistoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

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

  // Filtrage strict : on ne garde que les shifts ayant eu une interaction (pointage ou absence constatée)
  const completedRows = useMemo(() => {
    if (!rows) return null;
    return rows.filter(
      (row) =>
        row.checkedInAt ||
        row.checkedOutAt ||
        row.isAbsent ||
        row.isJustified ||
        row.corrected,
    );
  }, [rows]);

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>Mes pointages</h2>
          <p className="operations-hint">
            Historique de vos prises et fins de service.
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

      {!completedRows ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" />
          Chargement de votre historique…
        </div>
      ) : !completedRows.length ? (
        <div className="admin-empty">
          <Clock3 size={36} />
          <h3>Aucun pointage effectué sur cette période</h3>
        </div>
      ) : (
        <div className="swapper-attendance-cards-list">
          {completedRows.map((row) => (
            <div key={row.shiftId} className="swapper-attendance-card">
              <div className="swapper-attendance-header">
                <div>
                  <span className="swapper-attendance-date">
                    {formatDateTime(row.plannedStart, row.station.timezone)}
                  </span>
                  <div className="swapper-attendance-station">
                    {row.station.name} {row.template ? `· ${row.template}` : ""}
                  </div>
                </div>
                {renderAttendanceStatus(row)}
              </div>

              <div className="swapper-attendance-details">
                <div className="time-block">
                  <small>DÉBUT</small>
                  <strong>
                    {row.checkedInAt
                      ? formatDateTime(row.checkedInAt, row.station.timezone)
                      : "—"}
                  </strong>
                </div>
                <div className="time-separator" aria-hidden="true">
                  →
                </div>
                <div className="time-block">
                  <small>FIN</small>
                  <strong>
                    {row.checkedOutAt
                      ? formatDateTime(row.checkedOutAt, row.station.timezone)
                      : "—"}
                  </strong>
                </div>
                <div className="time-block duration-block">
                  <small>PRÉVU</small>
                  <strong>{row.plannedHours.toFixed(2)} h</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
