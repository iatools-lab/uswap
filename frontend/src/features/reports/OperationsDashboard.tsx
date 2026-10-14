import { currentLocale } from "../../app/i18n";
import { translate } from "../../app/i18n";
import { useEffect, useMemo, useState } from "react";
import {
  ChartBarIcon,
  ClockIcon,
  DownloadSimpleIcon,
  GaugeIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "../../ui/icons";
import { api, download } from "../../api/auth-api";
import { Select } from "../../ui/Select";
import { Modal } from "../../ui/Modal";
import { KpiCard } from "../../ui/KpiCard";
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
    leavesSynced: number;
    leavesPendingSync: number;
    leavesFailedSync: number;
    movements: number;
    totalHours: number;
    futureVacant: number;
    pastVacant: number;
  };
  attendance: Record<string, number>;
  stationRows: Array<{
    id: string;
    name: string;
    total: number;
    filled: number;
    coverage: number;
    incidents: number;
    futureVacant: number;
    pastVacant: number;
    risk: "AT_RISK" | "STABLE";
  }>;
  swappers: Array<{ id: string; name: string }>;
  details: Array<{
    id: string;
    startTime: string;
    station: string;
    swapper: string;
    status: string;
    label: string;
  }>;
  hours: Array<{ name: string; station: string; hours: number }>;
  hoursByStation: Array<{ station: string; hours: number }>;
  hoursByWeek: Array<{ week: string; hours: number }>;
  hoursByMonth: Array<{ month: string; hours: number }>;
  changes: Array<{
    date: string;
    station: string;
    type: string;
    from: string | null;
    to: string | null;
  }>;
};
type PublishedPlanning = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
};

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const datePart = (value: string) => value.slice(0, 10);
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

export function OperationsDashboard({
  refreshKey = "",
}: {
  refreshKey?: string;
}) {
  const [from, setFrom] = useState(day(-30));
  const [to, setTo] = useState(day(7));
  const [planningId, setPlanningId] = useState("");
  const [plannings, setPlannings] = useState<PublishedPlanning[]>([]);
  const [planningReady, setPlanningReady] = useState(false);
  const [station, setStation] = useState("");
  const [swapper, setSwapper] = useState("");
  const [detail, setDetail] = useState<
    "coverage" | "attendance" | "hours" | "movements" | null
  >(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    api<PublishedPlanning[]>("/plannings")
      .then((items) => {
        if (!active) return;
        const publishedItems = items
          .filter((item) => item.status === "PUBLISHED")
          .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
        setPlannings(publishedItems);
        const today = day(0);
        const current = publishedItems.find(
          (item) =>
            datePart(item.startDate) <= today &&
            datePart(item.endDate) >= today,
        );
        const next = publishedItems.find(
          (item) => datePart(item.startDate) > today,
        );
        const selected = current ?? next ?? publishedItems.at(-1);
        if (selected) {
          setPlanningId(selected.id);
          setFrom(datePart(selected.startDate));
          setTo(datePart(selected.endDate));
        } else {
          setPlanningId("ALL");
        }
      })
      .catch(() => {
        if (active) setPlanningId("ALL");
      })
      .finally(() => {
        if (active) setPlanningReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!planningReady) return;
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ from, to });
    if (planningId && planningId !== "ALL") query.set("planningId", planningId);
    if (station) query.set("stationId", station);
    if (swapper) query.set("swapperId", swapper);
    api<Dashboard>(`/reports/dashboard?${query.toString()}`)
      .then((v) => active && setData(v))
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [
    from,
    to,
    planningId,
    planningReady,
    station,
    swapper,
    reload,
    refreshKey,
  ]);
  const totalAttendance = useMemo(
    () =>
      data ? Object.values(data.attendance).reduce((a, b) => a + b, 0) : 0,
    [data],
  );
  async function exportReport(format: "CSV" | "XLSX") {
    if (!data) return;
    const query = new URLSearchParams({ from, to, format });
    if (planningId && planningId !== "ALL") query.set("planningId", planningId);
    if (station) query.set("stationId", station);
    if (swapper) query.set("swapperId", swapper);
    await download(
      `/reports/export?${query.toString()}`,
      `rapport-uswap-${from}-${to}.${format === "CSV" ? "csv" : "xlsx"}`,
    );
  }
  return (
    <section className="ops-dashboard" aria-busy={loading}>
      <div className="ops-dashboard-head">
        <div>
          <span>{translate("Analyse opérationnelle")}</span>
          <h2>{translate("Tableau de bord du réseau")}</h2>
          <p>
            {translate("Les indicateurs suivent la période et les filtres sélectionnés. Ouvrez un indicateur pour consulter les détails.")}</p>
        </div>
        <div className="ops-dashboard-export-actions">
          <button
            className="admin-button secondary"
            disabled={!data}
            onClick={() => void exportReport("XLSX")}
          >
            <DownloadSimpleIcon />
            {translate("Exporter Excel")}</button>
          <button
            className="admin-button secondary"
            disabled={!data}
            onClick={() => void exportReport("CSV")}
          >
            {translate("CSV")}</button>
        </div>
      </div>
      <div className="ops-dashboard-filters">
        <label>
          {translate("Du")}<input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {translate("Au")}<input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          {translate("Planning")}<Select
            size="sm"
            value={planningId || "ALL"}
            ariaLabel={translate("Planning publié du rapport")}
            onChange={(value) => {
              const selectedId = String(value);
              setPlanningId(selectedId);
              const selected = plannings.find((item) => item.id === selectedId);
              if (selected) {
                setFrom(datePart(selected.startDate));
                setTo(datePart(selected.endDate));
              } else if (plannings.length) {
                setFrom(
                  plannings.reduce(
                    (earliest, item) =>
                      datePart(item.startDate) < earliest
                        ? datePart(item.startDate)
                        : earliest,
                    datePart(plannings[0].startDate),
                  ),
                );
                setTo(
                  plannings.reduce(
                    (latest, item) =>
                      datePart(item.endDate) > latest
                        ? datePart(item.endDate)
                        : latest,
                    datePart(plannings[0].endDate),
                  ),
                );
              }
            }}
            options={[
              { value: "ALL", label: translate("Tous les plannings publiés") },
              ...plannings.map((item) => ({
                value: item.id,
                label: translate(item.name),
              })),
            ]}
          />
        </label>
        <label>
          {translate("Station")}<Select
            size="sm"
            value={station}
            ariaLabel={translate("Station du rapport")}
            onChange={(value) => {
              setStation(String(value));
              setSwapper("");
            }}
            options={[
              { value: "", label: translate("Toutes les stations") },
              ...(data?.stations.map((item) => ({
                value: item.id,
                label: translate(item.name),
              })) ?? []),
            ]}
          />
        </label>
        <label>
          {translate("Swappeur")}<Select
            size="sm"
            value={swapper}
            ariaLabel={translate("Swappeur du rapport")}
            onChange={(value) => setSwapper(String(value))}
            options={[
              { value: "", label: translate("Tous les swappeurs") },
              ...(data?.swappers.map((item) => ({
                value: item.id,
                label: translate(item.name),
              })) ?? []),
            ]}
          />
        </label>
      </div>
      {error && (
        <div className="ops-dashboard-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="admin-button secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            {translate("Réessayer")}</button>
        </div>
      )}
      {data && (
        <>
          <Modal
            open={detail !== null}
            size="lg"
            title={
              detail === "coverage"
                ? "Détail de la couverture"
                : detail === "attendance"
                  ? "Détail de l’assiduité"
                  : detail === "hours"
                    ? "Détail de la charge planifiée"
                    : "Détail des mouvements"
            }
            subtitle={`${from} au ${to}`}
            onClose={() => setDetail(null)}
          >
            {detail === "coverage" ? (
              <div className="kpi-detail-list">
                {data.stationRows.map((row) => (
                  <article key={row.id}>
                    <strong>{row.name}</strong>
                    <span>
                      {row.filled}{translate("/")}{row.total} {" "}{translate("postes couverts")}</span>
                    <span className={row.risk === "AT_RISK" ? "is-risk" : ""}>
                      {row.futureVacant}{" "}
                      {row.futureVacant === 1
                        ? "poste vacant à venir"
                        : "postes vacants à venir"}{" "}
                      {translate("·")}{" "}{row.pastVacant}{" "}
                      {row.pastVacant === 1
                        ? "poste vacant passé"
                        : "postes vacants passés"}
                    </span>
                  </article>
                ))}
              </div>
            ) : detail === "hours" ? (
              <div className="kpi-detail-list">
                <article>
                  <strong>{translate("Par semaine")}</strong>
                  <span>
                    {data.hoursByWeek
                      .map((row) => `${row.week}: ${row.hours} h`)
                      .join(" · ") || "Aucune donnée"}
                  </span>
                </article>
                <article>
                  <strong>{translate("Par mois")}</strong>
                  <span>
                    {data.hoursByMonth
                      .map((row) => `${row.month}: ${row.hours} h`)
                      .join(" · ") || "Aucune donnée"}
                  </span>
                </article>
                {data.hoursByStation.map((row) => (
                  <article key={row.station}>
                    <strong>{row.station}</strong>
                    <span>{row.hours} {" "}{translate("h planifiées")}</span>
                  </article>
                ))}
                {data.hours.map((row) => (
                  <article key={`${row.name}-${row.station}`}>
                    <strong>{row.name}</strong>
                    <span>{row.station}</span>
                    <span>{row.hours} {" "}{translate("h planifiées")}</span>
                  </article>
                ))}
              </div>
            ) : detail === "movements" ? (
              <div className="kpi-detail-list">
                {data.changes.map((row, index) => (
                  <article key={`${row.date}-${index}`}>
                    <strong>{row.station}</strong>
                    <span>{new Date(row.date).toLocaleString(currentLocale())}</span>
                    <span>
                      {row.from || "Poste vacant"} {" "}{translate("→")}{" "}{row.to || "Poste vacant"}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="kpi-detail-list">
                {data.details.map((row) => (
                  <article key={row.id}>
                    <strong>{row.swapper}</strong>
                    <span>
                      {row.station} {" "}{translate("·")}{" "}{translate(row.label)}
                    </span>
                    <span>
                      {labels[row.status] || row.status} {" "}{translate("·")}{" "}
                      {new Date(row.startTime).toLocaleString(currentLocale())}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </Modal>
          <div className="ops-dashboard-kpis">
            <button
              type="button"
              onClick={() => setDetail("coverage")}
              title={translate("Taux de postes affectés sur tous les postes planifiés. Ouvrir le détail.")}
            >
              <KpiCard
                label={translate("Couverture")}
                value={`${data.kpis.coverageRate}%`}
                detail={`${data.kpis.shifts} ${data.kpis.shifts === 1 ? "shift analysé" : "shifts analysés"}`}
                hint={`${data.kpis.futureVacant} à couvrir · ${data.kpis.pastVacant} passé${data.kpis.pastVacant === 1 ? "" : "s"}`}
                icon={<GaugeIcon />}
                tone={data.kpis.futureVacant > 0 ? "amber" : "green"}
                progress={data.kpis.coverageRate}
                compact
              />
            </button>
            <button
              type="button"
              onClick={() => setDetail("attendance")}
              title={translate("Part des affectations avec une présence, un retard ou une fin de service enregistrée.")}
            >
              <KpiCard
                label={translate("Assiduité")}
                value={`${data.kpis.attendanceRate}%`}
                detail={`${data.kpis.absences} ${data.kpis.absences === 1 ? "absence" : "absences"}`}
                icon={<UsersThreeIcon />}
                tone={data.kpis.absences > 0 ? "amber" : "green"}
                progress={data.kpis.attendanceRate}
                compact
              />
            </button>
            <button
              type="button"
              onClick={() => setDetail("hours")}
              title={translate("Somme des heures prévues pour les swappeurs du périmètre.")}
            >
              <KpiCard
                label={translate("Charge planifiée")}
                value={`${Math.round(data.kpis.totalHours)} h`}
                detail={`${data.kpis.approvedLeaves} ${data.kpis.approvedLeaves === 1 ? "congé approuvé" : "congés approuvés"}`}
                icon={<ClockIcon />}
                tone="blue"
                compact
              />
            </button>
            <button
              type="button"
              onClick={() => setDetail("movements")}
              title={translate("Remplacements, permutations et réaffectations enregistrés sur la période.")}
            >
              <KpiCard
                label={translate("Mouvements")}
                value={data.kpis.movements}
                detail={`${data.kpis.late} ${data.kpis.late === 1 ? "retard" : "retards"}`}
                icon={<WarningCircleIcon />}
                tone={data.kpis.late > 0 ? "amber" : "neutral"}
                compact
              />
            </button>
          </div>
          <div className="ops-dashboard-grid">
            <article className="ops-chart">
              <header>
                <div>
                  <h3>{translate("Répartition des présences")}</h3>
                  <p>{translate("État des services sur la période")}</p>
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
                  <h3>{translate("Couverture par station")}</h3>
                  <p>{translate("Postes pourvus et incidents ouverts")}</p>
                </div>
              </header>
              <div className="station-performance">
                {data.stationRows.map((row) => (
                  <div key={row.id}>
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {row.filled}{translate("/")}{row.total} {" "}{translate("postes ·")}{" "}{row.incidents}{" "}
                        {row.incidents === 1 ? "incident" : "incidents"}
                        {row.futureVacant > 0
                          ? ` · ${row.futureVacant} à couvrir`
                          : ""}
                      </small>
                    </span>
                    <div>
                      <i>
                        <b style={{ width: `${row.coverage}%` }} />
                      </i>
                      <strong>{row.coverage}{translate("%")}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className="ops-chart ops-chart-wide">
              <header>
                <div>
                  <h3>{translate("Heures planifiées par swappeur")}</h3>
                  <p>{translate("Les charges les plus importantes de la période")}</p>
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
                    <strong>{row.hours} {" "}{translate("h")}</strong>
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
