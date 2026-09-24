import { useEffect, useMemo, useState } from "react";
import {
  ChartBarIcon,
  ClockIcon,
  DownloadSimpleIcon,
  GaugeIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import { exportToExcel } from "../../utils/excelExport";
import { Select } from "../../ui/Select";
import "./reports.css";

type Dashboard = {
  period: { from: string; to: string };
  stations: Array<{ id: string; name: string }>;
  kpis: {
    shifts: number;
    coverageRate: number;
    attendanceRate: number;
    absences: number;
    late: number;
    approvedLeaves: number;
    movements: number;
    totalHours: number;
  };
  attendance: Record<string, number>;
  stationRows: Array<{
    id: string;
    name: string;
    total: number;
    filled: number;
    coverage: number;
    incidents: number;
  }>;
  hours: Array<{ name: string; station: string; hours: number }>;
  changes: Array<{
    date: string;
    station: string;
    type: string;
    from: string | null;
    to: string | null;
  }>;
};
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const labels: Record<string, string> = {
  present: "Présents",
  closed: "Terminés",
  late: "Retards",
  absent: "Absences",
  justified: "Justifiés",
  expected: "À venir",
};
const tones: Record<string, string> = {
  present: "#22a06b",
  closed: "#17499f",
  late: "#ed9a16",
  absent: "#d94b42",
  justified: "#7652b5",
  expected: "#a9b4c6",
};

export function OperationsDashboard() {
  const [from, setFrom] = useState(day(-30));
  const [to, setTo] = useState(day(7));
  const [station, setStation] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Dashboard>(
      `/reports/dashboard?from=${from}&to=${to}${station ? `&stationId=${station}` : ""}`,
    )
      .then((v) => active && setData(v))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [from, to, station]);
  const totalAttendance = useMemo(
    () =>
      data ? Object.values(data.attendance).reduce((a, b) => a + b, 0) : 0,
    [data],
  );
  function exportReport() {
    if (!data) return;
    exportToExcel({
      data: data.hours,
      filename: `rapport-uswap-${from}-${to}`,
      sheetName: "Heures",
      columns: [
        { header: "Swappeur", key: "name", width: 25 },
        { header: "Station", key: "station", width: 22 },
        { header: "Heures", key: "hours", width: 12 },
      ],
    });
  }
  return (
    <section className="ops-dashboard">
      <div className="ops-dashboard-head">
        <div>
          <span>Analyse opérationnelle</span>
          <h2>Tableau de bord du réseau</h2>
          <p>
            Présences, couverture, mouvements et charge de travail sur la
            période choisie.
          </p>
        </div>
        <button
          className="admin-button secondary"
          disabled={!data}
          onClick={exportReport}
        >
          <DownloadSimpleIcon />
          Exporter Excel
        </button>
      </div>
      <div className="ops-dashboard-filters">
        <label>
          Du
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Au
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          Station
          <Select
            size="sm"
            value={station}
            ariaLabel="Station du rapport"
            onChange={(value) => setStation(String(value))}
            options={[
              { value: "", label: "Toutes les stations" },
              ...(data?.stations.map((item) => ({
                value: item.id,
                label: item.name,
              })) ?? []),
            ]}
          />
        </label>
        <span>{loading ? "Actualisation…" : "Données à jour"}</span>
      </div>
      {data && (
        <>
          <div className="ops-dashboard-kpis">
            <article>
              <GaugeIcon />
              <div>
                <small>Couverture</small>
                <strong>{data.kpis.coverageRate}%</strong>
                <span>{data.kpis.shifts} shifts analysés</span>
              </div>
            </article>
            <article>
              <UsersThreeIcon />
              <div>
                <small>Assiduité</small>
                <strong>{data.kpis.attendanceRate}%</strong>
                <span>{data.kpis.absences} absence(s)</span>
              </div>
            </article>
            <article>
              <ClockIcon />
              <div>
                <small>Charge planifiée</small>
                <strong>{Math.round(data.kpis.totalHours)} h</strong>
                <span>{data.kpis.approvedLeaves} congé(s) approuvé(s)</span>
              </div>
            </article>
            <article>
              <WarningCircleIcon />
              <div>
                <small>Mouvements</small>
                <strong>{data.kpis.movements}</strong>
                <span>{data.kpis.late} retard(s)</span>
              </div>
            </article>
          </div>
          <div className="ops-dashboard-grid">
            <article className="ops-chart">
              <header>
                <div>
                  <h3>Répartition des présences</h3>
                  <p>État des services sur la période</p>
                </div>
                <ChartBarIcon />
              </header>
              <div className="attendance-bars">
                {Object.entries(data.attendance).map(([key, value]) => (
                  <div key={key}>
                    <span>{labels[key]}</span>
                    <i>
                      <b
                        style={{
                          width: `${totalAttendance ? Math.max(3, (value / totalAttendance) * 100) : 0}%`,
                          background: tones[key],
                        }}
                      />
                    </i>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </article>
            <article className="ops-chart">
              <header>
                <div>
                  <h3>Couverture par station</h3>
                  <p>Postes pourvus et incidents ouverts</p>
                </div>
              </header>
              <div className="station-performance">
                {data.stationRows.map((row) => (
                  <div key={row.id}>
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {row.filled}/{row.total} postes · {row.incidents}{" "}
                        incident(s)
                      </small>
                    </span>
                    <div>
                      <i>
                        <b style={{ width: `${row.coverage}%` }} />
                      </i>
                      <strong>{row.coverage}%</strong>
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className="ops-chart ops-chart-wide">
              <header>
                <div>
                  <h3>Heures planifiées par swappeur</h3>
                  <p>Les charges les plus importantes de la période</p>
                </div>
              </header>
              <div className="hours-chart">
                {data.hours.map((row, index) => (
                  <div key={row.name}>
                    <span className="hours-rank">{index + 1}</span>
                    <span>
                      <strong>{row.name}</strong>
                      <small>{row.station}</small>
                    </span>
                    <i>
                      <b
                        style={{
                          width: `${data.hours[0]?.hours ? (row.hours / data.hours[0].hours) * 100 : 0}%`,
                        }}
                      />
                    </i>
                    <strong>{row.hours} h</strong>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
