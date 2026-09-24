import { useEffect, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle } from "../../ui/icons";
import { formatDateTime } from "./format";
import type { AttendanceHistoryRow } from "./types";

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
        <div className="admin-table-wrap ops-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Station</th>
                <th>Shift</th>
                <th>Prévu</th>
                <th>Début</th>
                <th>Fin</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.shiftId}>
                  <td>
                    <strong>
                      {formatDateTime(row.plannedStart, row.station.timezone)}
                    </strong>
                  </td>
                  <td>{row.station.name}</td>
                  <td>{row.template ?? "—"}</td>
                  <td>{row.plannedHours.toFixed(2)} h</td>
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
                    {row.corrected ? (
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
                        className={`attendance-status ${
                          row.isLate
                            ? "attendance-status--late"
                            : "attendance-status--present"
                        }`}
                      >
                        {row.isLate ? "En retard" : "À l’heure"}
                      </span>
                    ) : (
                      <span className="attendance-status attendance-status--expected">
                        Attendu
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
