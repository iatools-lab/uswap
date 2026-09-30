import { useEffect, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle } from "../../ui/icons";
import { formatDateTime } from "./format";
import type { AttendanceHistoryRow } from "./types";

type BackendAttendance = {
  id: string;
  shiftId: string;
  stationId: string;
  status:
    | "EXPECTED"
    | "CHECKED_IN"
    | "CHECKED_OUT"
    | "ABSENT"
    | "JUSTIFIED";
  checkInAt: string | null;
  checkOutAt: string | null;
  absenceReason: string | null;
  shift: {
    startTime: string;
    endTime: string;
  };
  station: {
    id: string;
    name: string;
    timezone: string;
  };
};

function mapRow(
  item: BackendAttendance,
): AttendanceHistoryRow {
  const plannedHours =
    (Date.parse(
      item.shift.endTime,
    ) -
      Date.parse(
        item.shift.startTime,
      )) /
    3_600_000;

  return {
    shiftId:
      item.shiftId,
    station:
      item.station,
    plannedStart:
      item.shift.startTime,
    plannedEnd:
      item.shift.endTime,
    plannedHours,
    checkedInAt:
      item.checkInAt,
    checkedOutAt:
      item.checkOutAt,
    status:
      item.status,
    isLate: item.checkInAt
      ? Date.parse(
          item.checkInAt,
        ) >
        Date.parse(
          item.shift.startTime,
        )
      : false,
    absenceReason:
      item.absenceReason,
  };
}

export function MyAttendanceHistory({
  swapperId,
}: {
  swapperId?: string;
}) {
  const [rows, setRows] =
    useState<
      AttendanceHistoryRow[] | null
    >(null);

  const [error, setError] =
    useState("");

  const [from, setFrom] =
    useState("");

  const [to, setTo] =
    useState("");

  useEffect(() => {
    let active = true;

    setRows(null);
    setError("");

    const path =
      swapperId
        ? `/attendance/swapper/${swapperId}`
        : "/attendance/mine";

    api<
      BackendAttendance[]
    >(path)
      .then((data) => {
        if (!active) {
          return;
        }

        const fromTime =
          from
            ? Date.parse(
                `${from}T00:00:00`,
              )
            : Number.NEGATIVE_INFINITY;

        const toTime =
          to
            ? Date.parse(
                `${to}T23:59:59.999`,
              )
            : Number.POSITIVE_INFINITY;

        const mapped =
          data
            .map(mapRow)
            .filter(
              (row) => {
                const time =
                  Date.parse(
                    row.plannedStart,
                  );

                return (
                  time >=
                    fromTime &&
                  time <=
                    toTime
                );
              },
            )
            .sort(
              (a, b) =>
                Date.parse(
                  b.plannedStart,
                ) -
                Date.parse(
                  a.plannedStart,
                ),
            );

        setRows(mapped);
      })
      .catch((err) => {
        if (active) {
          setError(
            (err as Error)
              .message,
          );
        }
      });

    return () => {
      active = false;
    };
  }, [
    from,
    to,
    swapperId,
  ]);

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>
            Mes pointages
          </h2>

          <p className="operations-hint">
            Prises et fins de service enregistrées par le système.
          </p>
        </div>
      </div>

      <div className="supervision-toolbar">
        <label>
          Du

          <input
            type="date"
            value={from}
            onChange={(event) =>
              setFrom(
                event.target
                  .value,
              )
            }
          />
        </label>

        <label>
          Au

          <input
            type="date"
            value={to}
            onChange={(event) =>
              setTo(
                event.target
                  .value,
              )
            }
          />
        </label>
      </div>

      {error && (
        <p
          className="error-message"
          role="alert"
        >
          {error}
        </p>
      )}

      {!rows ? (
        <div
          className="admin-loading"
          role="status"
        >
          <LoaderCircle className="spin" />
          Chargement de votre relevé…
        </div>
      ) : !rows.length ? (
        <div className="admin-empty">
          <h3>
            Aucun pointage sur la période
          </h3>
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
              {rows.map(
                (row) => (
                  <tr
                    key={
                      row.shiftId
                    }
                  >
                    <td>
                      <strong>
                        {formatDateTime(
                          row.plannedStart,
                          row.station
                            .timezone,
                        )}
                      </strong>
                    </td>

                    <td>
                      {
                        row.station
                          .name
                      }
                    </td>

                    <td>
                      8 h
                    </td>

                    <td>
                      {row.plannedHours.toFixed(
                        2,
                      )}{" "}
                      h
                    </td>

                    <td>
                      {row.checkedInAt
                        ? formatDateTime(
                            row.checkedInAt,
                            row.station
                              .timezone,
                          )
                        : "—"}
                    </td>

                    <td>
                      {row.checkedOutAt
                        ? formatDateTime(
                            row.checkedOutAt,
                            row.station
                              .timezone,
                          )
                        : "—"}
                    </td>

                    <td>
                      {row.status ===
                      "ABSENT" ? (
                        <span className="attendance-status attendance-status--absent">
                          Absent
                        </span>
                      ) : row.status ===
                        "CHECKED_OUT" ? (
                        <span className="attendance-status attendance-status--closed">
                          Terminé
                        </span>
                      ) : row.status ===
                        "CHECKED_IN" ? (
                        <span
                          className={`attendance-status ${
                            row.isLate
                              ? "attendance-status--late"
                              : "attendance-status--present"
                          }`}
                        >
                          {row.isLate
                            ? "En retard"
                            : "À l’heure"}
                        </span>
                      ) : (
                        <span className="attendance-status attendance-status--expected">
                          Attendu
                        </span>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}