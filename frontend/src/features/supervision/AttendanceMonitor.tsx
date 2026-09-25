import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { LoaderCircle, RefreshCw } from "../../ui/icons";
import { formatDateTime } from "./format";
import type { User } from "../../api/auth-api";
import type {
  MonitorData as SharedMonitorData,
  MonitorRow as SharedMonitorRow,
  MonitorStatus,
} from "./types";
import "./supervision.css";

const REFRESH_MS = 30_000;

type BackendAttendance = {
id: string;
shiftId: string;
swapperId: string;
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
id: string;
startTime: string;
endTime: string;
station: {
id: string;
name: string;
timezone: string;
latenessToleranceMinutes: number;
};
swapper: {
id: string;
fullName: string;
email?: string;
};
};
station: {
id: string;
name: string;
timezone: string;
latenessToleranceMinutes: number;
};
swapper: {
id: string;
fullName: string;
email?: string;
};
};

type MonitorRow = SharedMonitorRow;

type MonitorData = SharedMonitorData;

type Filter = MonitorStatus | "ALL";

const FILTERS: Filter[] = [
"ALL",
"EXPECTED",
"PRESENT",
"LATE",
"ABSENT",
"CLOSED",
];

const STATUS_LABEL: Record<MonitorStatus, string> = {
PRESENT: "À l’heure",
LATE: "En retard",
ABSENT: "Absent",
CLOSED: "Terminé",
EXPECTED: "Attendu",
};

const STATUS_CLASS: Record<MonitorStatus, string> = {
PRESENT: "attendance-status--present",
LATE: "attendance-status--late",
ABSENT: "attendance-status--absent",
CLOSED: "attendance-status--closed",
EXPECTED: "attendance-status--expected",
};

function calculateStatus(
attendance: BackendAttendance,
): MonitorStatus {
if (attendance.status === "ABSENT") {
return "ABSENT";
}

if (attendance.status === "CHECKED_OUT") {
return "CLOSED";
}

if (attendance.status === "CHECKED_IN") {
if (!attendance.checkInAt) {
return "PRESENT";
}

const toleranceMinutes =
  attendance.station.latenessToleranceMinutes ?? 0;

const checkIn = Date.parse(attendance.checkInAt);
const shiftStart = Date.parse(attendance.shift.startTime);

if (
  checkIn >
  shiftStart + toleranceMinutes * 60 * 1000
) {
  return "LATE";
}

return "PRESENT";

}

return "EXPECTED";
}

function mapAttendance(
attendance: BackendAttendance,
): MonitorRow {
return {
id: attendance.id,
shiftId: attendance.shiftId,
status: calculateStatus(attendance),
swapper: {
id: attendance.swapper.id,
fullName: attendance.swapper.fullName,
},
station: {
id: attendance.station.id,
name: attendance.station.name,
timezone:
attendance.station.timezone ?? "Africa/Douala",
latenessToleranceMinutes:
attendance.station.latenessToleranceMinutes ?? 0,
},
startTime: attendance.shift.startTime,
endTime: attendance.shift.endTime,
checkedInAt: attendance.checkInAt,
checkedOutAt: attendance.checkOutAt,
};
}

export function AttendanceMonitor({
user,
onCorrect,
}: {
user: User;
onCorrect?: (row: MonitorRow) => void;
}) {
const [data, setData] = useState<MonitorData | null>(null);
const [error, setError] = useState("");
const [refreshing, setRefreshing] = useState(false);
const [filter, setFilter] = useState<Filter>("ALL");

const load = useCallback(
async (silent = false) => {
if (!silent) {
setError("");
}

  setRefreshing(true);

  try {
    let response: BackendAttendance[];

    if (user.role === "STATION_CHIEF") {
      const workspace = await api<{
        station: {
          id: string;
          name: string;
          location: string | null;
          timezone?: string;
        } | null;
      }>("/workspace");

      if (!workspace.station) {
        throw new Error(
          "Aucune station n’est rattachée à ce compte.",
        );
      }

      response = await api<BackendAttendance[]>(
        `/attendance/station/${workspace.station.id}`,
      );
    } else {
      response = await api<BackendAttendance[]>(
        "/attendance",
      );
    }

    const rows = response
      .map(mapAttendance)
      .sort(
        (a, b) =>
          Date.parse(a.startTime) -
          Date.parse(b.startTime),
      );

    setData({
      generatedAt: new Date().toISOString(),
      rows,
    });
  } catch (err) {
    if (!silent) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "Impossible de charger le suivi des pointages.",
        );
      }
    }
  } finally {
    setRefreshing(false);
  }
},
[user.role],

);

useEffect(() => {
void load();

const timer = window.setInterval(() => {
  void load(true);
}, REFRESH_MS);

return () => {
  window.clearInterval(timer);
};

}, [load]);

const rows = useMemo(() => {
if (!data) {
return [];
}

if (filter === "ALL") {
  return data.rows;
}

return data.rows.filter(
  (row) => row.status === filter,
);

}, [data, filter]);

const summary = useMemo(() => {
const source = data?.rows ?? [];

return {
  expected: source.filter(
    (row) => row.status === "EXPECTED",
  ).length,
  present: source.filter(
    (row) => row.status === "PRESENT",
  ).length,
  late: source.filter(
    (row) => row.status === "LATE",
  ).length,
  absent: source.filter(
    (row) => row.status === "ABSENT",
  ).length,
  closed: source.filter(
    (row) => row.status === "CLOSED",
  ).length,
};

}, [data]);

if (error) {
return (
<section className="admin-card admin-empty" role="alert" >
<h2>Suivi indisponible</h2>

    <p>{error}</p>

    <button
      type="button"
      className="admin-button"
      onClick={() => void load()}
    >
      Réessayer
    </button>
  </section>
);

}

if (!data) {
return (
<div className="admin-loading" role="status">
<LoaderCircle className="spin" />
Chargement du suivi…
</div>
);
}

return (
<section className="admin-card">
<div className="admin-card-heading">
<div>
<h2>
Pointages
<span className="ops-live" aria-hidden="true" >
Live
</span>
</h2>

      <p className="operations-hint">
        Actualisé toutes les 30 s ·{" "}
        {formatDateTime(data.generatedAt)}
        {user.role === "STATION_CHIEF"
          ? " · votre station"
          : ""}
      </p>
    </div>

    <button
      type="button"
      className="admin-button secondary small"
      disabled={refreshing}
      onClick={() => void load()}
    >
      <RefreshCw
        size={15}
        className={refreshing ? "spin" : undefined}
      />
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
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className="ops-person">
                  <strong>
                    {row.swapper.fullName}
                  </strong>
                </span>
              </td>

              <td>{row.station.name}</td>

              <td>
                {formatDateTime(
                  row.startTime,
                  row.station.timezone,
                )}{" "}
                –{" "}
                {formatDateTime(
                  row.endTime,
                  row.station.timezone,
                )}
              </td>

              <td>
                {row.checkedInAt
                  ? formatDateTime(
                      row.checkedInAt,
                      row.station.timezone,
                    )
                  : "—"}
              </td>

              <td>
                {row.checkedOutAt
                  ? formatDateTime(
                      row.checkedOutAt,
                      row.station.timezone,
                    )
                  : "—"}
              </td>

              <td>
                <span
                  className={`attendance-status ${STATUS_CLASS[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
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