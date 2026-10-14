import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { UserCreateModal } from "../../features/users/UserCreateModal";
import { LeaveRequestInbox } from "../../features/leaves/LeaveRequestInbox";
import { ScheduledReports } from "../../features/reports/ScheduledReports";
import { greetingFor } from "../../utils/greeting";
import { interceptNav } from "../../app/spaNav";
import { useSession } from "../../app/session";
import { api, ApiError } from "../../api/auth-api";
import { KpiCard } from "../../ui/KpiCard";
import { Select } from "../../ui/Select";
import {
  ActivityIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  CalendarIcon,
  ChartLineUpIcon,
  CheckIcon,
  CaretLeftIcon,
  CaretRightIcon,
  Clock3,
  CompassIcon,
  GaugeIcon,
  LoaderCircle,
  MapPin,
  PlusIcon,
  RefreshCw,
  RowsIcon,
  UserRound,
  Users,
  WarningCircleIcon,
  XIcon,
} from "../../ui/icons";
import "../../styles/admin-home.css";

type Station = { id: string; name: string; isActive: boolean };
type Planning = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  occurrences: Array<{
    station: { id: string; name: string };
    startTime: string;
  }>;
  visibleStations?: Array<{ id: string; name: string }>;
  _count?: { occurrences: number };
};
type Dashboard = {
  period: { from: string; to: string };
  kpis: {
    shifts: number;
    coverageRate: number;
    attendanceRate: number;
    absences: number;
    late: number;
    totalHours: number;
    futureVacant: number;
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
    risk: "AT_RISK" | "STABLE";
  }>;
  hoursByWeek: Array<{ week: string; hours: number }>;
};
type LeaveRow = { status: string };
type FilterMode = "PERIOD" | "PLANNING";
type PeriodScale = "day" | "week" | "month" | "year" | "custom";

const datePart = (value: string) => value.slice(0, 10);
const localDateKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const addDays = (value: string, amount: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
};
const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;
const shortDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(value)
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
    : "—";

function compactPeriod(from?: string, to?: string) {
  if (!from || !to) return "Période en cours";
  if (datePart(from) === datePart(to)) return dateLabel(datePart(from));
  const start = new Date(`${datePart(from)}T12:00:00`);
  const end = new Date(`${datePart(to)}T12:00:00`);
  const startDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric" }).format(
    start,
  );
  const endLabel = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(end);
  const startMonth = new Intl.DateTimeFormat("fr-FR", {
    month: "short",
  }).format(start);
  return start.getMonth() === end.getMonth()
    ? `${startDay} – ${endLabel}`
    : `${startDay} ${startMonth} – ${endLabel}`;
}

function periodBounds(
  scale: PeriodScale,
  anchor: string,
  customFrom: string,
  customTo: string,
) {
  if (scale === "custom")
    return { from: customFrom || anchor, to: customTo || anchor };
  const date = new Date(`${anchor}T12:00:00`);
  if (scale === "day") return { from: anchor, to: anchor };
  if (scale === "week") {
    const monday = addDays(anchor, -((date.getDay() + 6) % 7));
    return { from: monday, to: addDays(monday, 6) };
  }
  if (scale === "month") {
    return {
      from: localDateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
      to: localDateKey(
        new Date(date.getFullYear(), date.getMonth() + 1, 0, 12),
      ),
    };
  }
  return {
    from: `${date.getFullYear()}-01-01`,
    to: `${date.getFullYear()}-12-31`,
  };
}

function shiftPeriod(anchor: string, scale: PeriodScale, direction: number) {
  const date = new Date(`${anchor}T12:00:00`);
  if (scale === "day") date.setDate(date.getDate() + direction);
  else if (scale === "week") date.setDate(date.getDate() + direction * 7);
  else if (scale === "month") {
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
  } else {
    date.setMonth(0, 1);
    date.setFullYear(date.getFullYear() + direction);
  }
  return localDateKey(date);
}

function periodTitle(scale: PeriodScale, from: string, to: string) {
  if (scale === "day") return dateLabel(from);
  if (scale === "month")
    return new Intl.DateTimeFormat("fr-FR", {
      month: "long",
      year: "numeric",
    }).format(new Date(`${from}T12:00:00`));
  if (scale === "year") return from.slice(0, 4);
  return compactPeriod(from, to);
}

function filterBounds(
  mode: FilterMode,
  scale: PeriodScale,
  anchor: string,
  customFrom: string,
  customTo: string,
  planningId: string,
  plans: Planning[],
) {
  if (mode === "PLANNING") {
    const plan = plans.find((item) => item.id === planningId);
    if (plan)
      return { from: datePart(plan.startDate), to: datePart(plan.endDate) };
  }
  return periodBounds(scale, anchor, customFrom, customTo);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function ActivityTrend({
  data,
}: {
  data: Array<{ week: string; hours: number }>;
}) {
  const [activeIndex, setActiveIndex] = useState(Math.max(0, data.length - 1));
  if (!data.length) {
    return (
      <div className="activity-trend activity-trend--empty" role="status">
        <strong>Aucun service publié</strong>
        <span>
          Il n’y a pas d’activité publiée sur cette période et cette station.
        </span>
      </div>
    );
  }
  const points = data.slice(-7);
  const width = 620;
  const height = 150;
  const paddingX = 25;
  const paddingY = 24;
  const max = Math.max(1, ...points.map((item) => item.hours));
  const x = (index: number) =>
    points.length === 1
      ? width / 2
      : paddingX + (index * (width - paddingX * 2)) / (points.length - 1);
  const y = (value: number) =>
    points.length === 1
      ? height / 2
      : height - paddingY - (value / max) * (height - paddingY * 2);
  const line = points
    .map((item, index) => `${x(index)},${y(item.hours)}`)
    .join(" ");
  const area = `${paddingX},${height - paddingY} ${line} ${x(points.length - 1)},${height - paddingY}`;
  const visibleActiveIndex = Math.min(activeIndex, points.length - 1);
  const active = points[visibleActiveIndex];

  if (points.length === 1) {
    return (
      <div className="activity-trend activity-trend--single">
        <strong>Une seule semaine publiée</strong>
        <span>Semaine du {shortDate(points[0].week)}</span>
        <small>
          Une évolution apparaîtra dès qu’une autre semaine sera disponible dans
          la période.
        </small>
      </div>
    );
  }

  return (
    <div className="activity-trend">
      <div className="activity-trend__summary" aria-live="polite">
        <strong>{active.hours.toLocaleString("fr-FR")} h</strong>
        <span>Semaine du {shortDate(active.week)}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Évolution des heures planifiées par semaine"
      >
        <defs>
          <linearGradient id="admin-activity-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d6cdf" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2d6cdf" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1="25" y1="126" x2="595" y2="126" className="trend-axis" />
        {points.length > 1 && (
          <>
            <polygon points={area} fill="url(#admin-activity-area)" />
            <polyline points={line} className="trend-line" />
          </>
        )}
        {points.map((item, index) => (
          <g key={`${item.week}-${index}`}>
            <circle
              cx={x(index)}
              cy={y(item.hours)}
              r={visibleActiveIndex === index ? 6 : 4}
              className={
                visibleActiveIndex === index
                  ? "trend-dot is-active"
                  : "trend-dot"
              }
            />
            <circle
              cx={x(index)}
              cy={y(item.hours)}
              r="17"
              className="trend-hit"
              tabIndex={0}
              role="button"
              aria-label={`${item.hours} heures, semaine du ${shortDate(item.week)}`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveIndex(index);
                }
              }}
            />
          </g>
        ))}
      </svg>
      <div className="activity-trend__labels" aria-hidden="true">
        {points.map((item) => (
          <span key={item.week}>{shortDate(item.week)}</span>
        ))}
      </div>
    </div>
  );
}

const ATTENDANCE_META: Record<string, { label: string; color: string }> = {
  present: { label: "Présents", color: "#168250" },
  closed: { label: "Services terminés", color: "#2d6cdf" },
  late: { label: "Retards", color: "#e99a16" },
  absent: { label: "Absences", color: "#dc4a43" },
  justified: { label: "Absences justifiées", color: "#7756b5" },
  expected: { label: "À venir", color: "#a8b3c4" },
};

function AttendanceDonut({ data }: { data: Record<string, number> }) {
  const rows = Object.entries(ATTENDANCE_META)
    .map(([key, meta]) => ({ key, ...meta, value: data[key] ?? 0 }))
    .filter((item) => item.value > 0);
  const safeRows = rows.length
    ? rows
    : [{ key: "empty", label: "Aucune donnée", color: "#dfe5ed", value: 1 }];
  const total = rows.reduce((sum, item) => sum + item.value, 0);
  const [activeKey, setActiveKey] = useState(safeRows[0].key);
  const active = safeRows.find((item) => item.key === activeKey) ?? safeRows[0];
  const circumference = 2 * Math.PI * 42;
  let consumed = 0;

  return (
    <div className="attendance-chart">
      <div className="attendance-donut">
        <svg
          viewBox="0 0 112 112"
          role="img"
          aria-label="Répartition des présences"
        >
          <circle cx="56" cy="56" r="42" className="attendance-donut__base" />
          {safeRows.map((item) => {
            const ratio = item.value / Math.max(total, 1);
            const length = ratio * circumference;
            const offset = -consumed * circumference;
            consumed += ratio;
            return (
              <circle
                key={item.key}
                cx="56"
                cy="56"
                r="42"
                className={`attendance-donut__segment${active.key === item.key ? " is-active" : ""}`}
                stroke={item.color}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={offset}
                tabIndex={0}
                onMouseEnter={() => setActiveKey(item.key)}
                onFocus={() => setActiveKey(item.key)}
                onClick={() => setActiveKey(item.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveKey(item.key);
                  }
                }}
              />
            );
          })}
        </svg>
        <div className="attendance-donut__center" aria-live="polite">
          <strong>{rows.length ? active.value : 0}</strong>
          <span>{active.label}</span>
        </div>
      </div>
      <div className="attendance-legend">
        {rows.length ? (
          rows.map((item) => (
            <button
              key={item.key}
              type="button"
              className={active.key === item.key ? "is-active" : ""}
              onMouseEnter={() => setActiveKey(item.key)}
              onFocus={() => setActiveKey(item.key)}
              onClick={() => setActiveKey(item.key)}
            >
              <i style={{ background: item.color }} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          ))
        ) : (
          <p>Aucun pointage sur cette période.</p>
        )}
      </div>
    </div>
  );
}

export function AdminHomePage() {
  const { session, onAccessLost } = useSession();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dismissOnboarding, setDismissOnboarding] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({
    all: 0,
    active: 0,
    pending: 0,
    inactive: 0,
  });
  const [stations, setStations] = useState<Station[]>([]);
  const [plannings, setPlannings] = useState<Planning[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("PERIOD");
  const [periodScale, setPeriodScale] = useState<PeriodScale>("week");
  const [periodAnchor, setPeriodAnchor] = useState(() =>
    localDateKey(new Date()),
  );
  const [customFrom, setCustomFrom] = useState(() =>
    addDays(localDateKey(new Date()), -((new Date().getDay() + 6) % 7)),
  );
  const [customTo, setCustomTo] = useState(() => localDateKey(new Date()));
  const [selectedPlanningId, setSelectedPlanningId] = useState("");
  const [stationFilter, setStationFilter] = useState("ALL");
  const [planningStatus, setPlanningStatus] = useState("ALL");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.all([
      api<{ statusCounts: Record<string, number> }>("/users/page?limit=1"),
      api<Station[]>("/stations"),
      api<Planning[]>("/plannings"),
      api<LeaveRow[]>("/leaves/management"),
    ])
      .then(([membersData, stationsData, planningRows, leaveRows]) => {
        if (!active) return;
        setCounts(membersData.statusCounts);
        setStations(stationsData);
        setPlannings(planningRows);
        setSelectedPlanningId((current) => {
          if (current && planningRows.some((item) => item.id === current))
            return current;
          const today = localDateKey(new Date());
          return (
            planningRows.find(
              (item) =>
                item.status === "PUBLISHED" &&
                datePart(item.startDate) <= today &&
                datePart(item.endDate) >= today,
            )?.id ??
            planningRows[0]?.id ??
            ""
          );
        });
        setPendingLeaves(
          leaveRows.filter((item) => item.status === "PENDING").length,
        );
      })
      .catch((errorData) => {
        if (!active) return;
        if (
          errorData instanceof ApiError &&
          [401, 403].includes(errorData.status)
        )
          onAccessLost();
        else setLoadError("Les données n’ont pas pu être chargées. Réessayez.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onAccessLost, revision]);

  useEffect(() => {
    let active = true;
    const selectedPlanning = plannings.find(
      (item) => item.id === selectedPlanningId,
    );
    const { from: start, to: end } = filterBounds(
      filterMode,
      periodScale,
      periodAnchor,
      customFrom,
      customTo,
      selectedPlanningId,
      plannings,
    );
    const query = new URLSearchParams({ from: start, to: end });
    if (filterMode === "PLANNING" && selectedPlanning)
      query.set("planningId", selectedPlanning.id);
    if (stationFilter !== "ALL") query.set("stationId", stationFilter);
    setDashboardLoading(true);
    api<Dashboard>(`/reports/dashboard?${query.toString()}`)
      .then((dashboardData) => {
        if (!active) return;
        setDashboard(dashboardData);
      })
      .catch((errorData) => {
        if (!active) return;
        if (
          errorData instanceof ApiError &&
          [401, 403].includes(errorData.status)
        )
          onAccessLost();
        else setLoadError("Les indicateurs n’ont pas pu être actualisés.");
      })
      .finally(() => {
        if (active) setDashboardLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    onAccessLost,
    filterMode,
    periodScale,
    periodAnchor,
    customFrom,
    customTo,
    selectedPlanningId,
    plannings,
    stationFilter,
  ]);

  const activeStations = stations.filter((station) => station.isActive).length;
  const planning =
    plannings.find((item) => {
      const today = localDateKey(new Date());
      return (
        item.status === "PUBLISHED" &&
        datePart(item.startDate) <= today &&
        datePart(item.endDate) >= today
      );
    }) ?? null;
  const { from: filteredFrom, to: filteredTo } = filterBounds(
    filterMode,
    periodScale,
    periodAnchor,
    customFrom,
    customTo,
    selectedPlanningId,
    plannings,
  );
  const periodPlannings =
    filterMode === "PLANNING"
      ? plannings.filter((item) => item.id === selectedPlanningId)
      : plannings.filter(
          (item) =>
            datePart(item.startDate) <= filteredTo &&
            datePart(item.endDate) >= filteredFrom,
        );
  const occurrencesInPeriod = (item: Planning) =>
    item.occurrences?.filter((occurrence) => {
      const startsAt = Date.parse(occurrence.startTime);
      return (
        startsAt >= Date.parse(`${filteredFrom}T00:00:00`) &&
        startsAt <= Date.parse(`${filteredTo}T23:59:59.999`) &&
        (stationFilter === "ALL" || occurrence.station.id === stationFilter)
      );
    }) ?? [];
  const stationPlannings = periodPlannings.filter(
    (item) => stationFilter === "ALL" || occurrencesInPeriod(item).length > 0,
  );
  const visiblePlannings = stationPlannings
    .filter(
      (item) =>
        filterMode !== "PLANNING" ||
        planningStatus === "ALL" ||
        item.status === planningStatus,
    )
    .sort((a, b) => datePart(b.startDate).localeCompare(datePart(a.startDate)));
  const summaryPlannings = visiblePlannings;
  const publishedPlanningCount = summaryPlannings.filter(
    (item) => item.status === "PUBLISHED",
  ).length;
  const draftPlanningCount = summaryPlannings.filter(
    (item) => item.status === "DRAFT",
  ).length;
  const summaryShiftCount = summaryPlannings.reduce(
    (sum, item) => sum + occurrencesInPeriod(item).length,
    0,
  );
  const planningStationIds = new Set(
    summaryPlannings.flatMap((item) =>
      occurrencesInPeriod(item)
        .map((occurrence) => occurrence.station)
        .map((station) => station.id),
    ),
  );
  const attentionCount =
    counts.pending + pendingLeaves + (dashboard?.kpis.futureVacant ?? 0);
  const stationRows = useMemo(
    () =>
      [...(dashboard?.stationRows ?? [])].sort(
        (a, b) => a.coverage - b.coverage,
      ),
    [dashboard],
  );
  const onboardingSteps = [
    {
      id: 1,
      title: "Stations configurées",
      completed: stations.length > 0,
      action: () => navigate("/app/admin/stations?tab=list"),
      icon: <MapPin size={15} />,
    },
    {
      id: 2,
      title: "Équipe enregistrée",
      completed: counts.all > 0,
      action: () => setShowCreateModal(true),
      icon: <Users size={15} />,
    },
    {
      id: 3,
      title: "Accès validés",
      completed: counts.pending === 0 && counts.all > 0,
      action: () => navigate("/app/admin/utilisateurs?status=pending"),
      icon: <UserRound size={15} />,
    },
    {
      id: 4,
      title: "Planning publié",
      completed: Boolean(planning),
      action: () => navigate("/app/admin/plannings"),
      icon: <Clock3 size={15} />,
    },
  ];
  const completedCount = onboardingSteps.filter(
    (step) => step.completed,
  ).length;
  const showInsight = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  if (!session) return null;

  function go(event: MouseEvent<HTMLAnchorElement>, target: string) {
    interceptNav(event, navigate, target);
  }
  const link = (target: string) => ({
    href: target,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => go(event, target),
  });

  if (loadError)
    return (
      <div className="admin-card admin-empty" role="alert">
        <RefreshCw size={25} />
        <h2>Chargement indisponible</h2>
        <p>{loadError}</p>
        <button
          className="admin-button"
          onClick={() => setRevision((value) => value + 1)}
        >
          Réessayer
        </button>
      </div>
    );

  if (loading)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" size={24} />
        Chargement de votre espace…
      </div>
    );

  return (
    <div className="admin-home">
      <UserCreateModal
        open={showCreateModal}
        stations={stations}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setRevision((value) => value + 1);
          setShowCreateModal(false);
        }}
      />

      <section className="home-header" aria-labelledby="home-welcome-title">
        <div>
          <span className="home-eyebrow">Pilotage du réseau</span>
          <h2 id="home-welcome-title" className="home-welcome">
            {greetingFor(session.user.fullName)}
          </h2>
          <p className="home-subtitle">
            {planning
              ? `${planning.name} · ${compactPeriod(planning.startDate, planning.endDate)}`
              : "Activité consolidée des six dernières semaines"}
          </p>
        </div>
        <div className="home-actions">
          <a
            className="admin-button secondary small"
            {...link("/app/admin/plannings")}
          >
            Voir le planning
          </a>
          <button
            type="button"
            className="admin-button primary-cta small"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon size={16} weight="bold" />
            Créer un utilisateur
          </button>
        </div>
      </section>

      <section
        className="home-filters"
        aria-label="Filtres du tableau de bord"
        aria-busy={dashboardLoading}
      >
        <label className="home-filter-field home-filter-mode">
          <span>Filtrer par</span>
          <Select
            value={filterMode}
            size="sm"
            width="130px"
            ariaLabel="Filtrer par"
            onChange={(value) => setFilterMode(String(value) as FilterMode)}
            options={[
              { value: "PERIOD", label: "Période" },
              { value: "PLANNING", label: "Planning" },
            ]}
          />
        </label>
        {filterMode === "PERIOD" ? (
          <div className="home-filter-period">
            <span className="home-filter-period__label">Période</span>
            <div className="home-period-controls">
              <div
                className="home-period-tabs"
                role="tablist"
                aria-label="Échelle de période"
              >
                {(
                  [
                    ["day", "Jour", CalendarBlankIcon],
                    ["week", "Semaine", CalendarIcon],
                    ["month", "Mois", CalendarDotsIcon],
                    ["year", "Année", RowsIcon],
                    ["custom", "Dates", CalendarCheckIcon],
                  ] as const
                ).map(([scale, label, Icon]) => (
                  <button
                    key={scale}
                    type="button"
                    role="tab"
                    aria-selected={periodScale === scale}
                    aria-label={
                      scale === "custom"
                        ? "Choisir une période personnalisée"
                        : `Vue ${label.toLowerCase()}`
                    }
                    onClick={() => setPeriodScale(scale)}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {periodScale === "custom" ? (
                <div
                  className="home-filter-dates"
                  aria-label="Dates personnalisées"
                >
                  <label className="home-filter-field">
                    <span>Du</span>
                    <input
                      type="date"
                      aria-label="Date de début"
                      value={customFrom}
                      max={customTo}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) return;
                        setCustomFrom(value);
                        if (value > customTo) setCustomTo(value);
                      }}
                    />
                  </label>
                  <label className="home-filter-field">
                    <span>Au</span>
                    <input
                      type="date"
                      aria-label="Date de fin"
                      value={customTo}
                      min={customFrom}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) return;
                        setCustomTo(value);
                        if (value < customFrom) setCustomFrom(value);
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="home-period-nav">
                  <button
                    type="button"
                    className="home-period-step"
                    aria-label="Période précédente"
                    onClick={() =>
                      setPeriodAnchor((value) =>
                        shiftPeriod(value, periodScale, -1),
                      )
                    }
                  >
                    <CaretLeftIcon size={16} />
                  </button>
                  <div className="home-period-picker">
                    <strong>
                      {periodTitle(periodScale, filteredFrom, filteredTo)}
                    </strong>
                    <input
                      type="date"
                      aria-label="Choisir une date"
                      value={periodAnchor}
                      onChange={(event) =>
                        event.target.value &&
                        setPeriodAnchor(event.target.value)
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="home-period-step"
                    aria-label="Période suivante"
                    onClick={() =>
                      setPeriodAnchor((value) =>
                        shiftPeriod(value, periodScale, 1),
                      )
                    }
                  >
                    <CaretRightIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="home-period-today"
                    onClick={() => {
                      setPeriodScale("day");
                      setPeriodAnchor(localDateKey(new Date()));
                    }}
                  >
                    Aujourd’hui
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <label className="home-filter-field home-filter-planning-select">
            <span>Planning</span>
            <Select
              value={selectedPlanningId}
              size="sm"
              width="280px"
              ariaLabel="Choisir un planning"
              onChange={(value) => setSelectedPlanningId(String(value))}
              options={plannings.map((item) => ({
                value: item.id,
                label: `${item.name || "Planning"} · ${compactPeriod(item.startDate, item.endDate)} · ${item.status === "DRAFT" ? "Brouillon" : "Publié"}`,
              }))}
            />
          </label>
        )}
        <label>
          <span>Station</span>
          <Select
            value={stationFilter}
            size="sm"
            width="180px"
            ariaLabel="Filtrer le tableau de bord par station"
            onChange={(value) => setStationFilter(String(value))}
            options={[
              { value: "ALL", label: "Toutes les stations" },
              ...stations
                .filter((item) => item.isActive)
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
        {filterMode === "PLANNING" && (
          <label>
            <span>Statut des plannings</span>
            <Select
              value={planningStatus}
              size="sm"
              width="165px"
              ariaLabel="Filtrer les plannings par statut"
              onChange={(value) => setPlanningStatus(String(value))}
              options={[
                { value: "ALL", label: "Tous les statuts" },
                { value: "PUBLISHED", label: "Publiés" },
                { value: "DRAFT", label: "Brouillons" },
              ]}
            />
          </label>
        )}
      </section>

      <section
        className="insight-card planning-overview"
        aria-labelledby="planning-overview-title"
      >
        <header className="insight-card__head planning-overview__head">
          <div>
            <span className="insight-kicker">Organisation</span>
            <h3 id="planning-overview-title">Plannings sur la période</h3>
          </div>
          <span className="planning-overview__range">
            {compactPeriod(filteredFrom, filteredTo)}
          </span>
        </header>
        <div
          className="planning-overview__stats"
          aria-label="Résumé des plannings"
        >
          <div>
            <strong>{summaryPlannings.length}</strong>
            <span>{plural(summaryPlannings.length, "planning")}</span>
          </div>
          <div>
            <strong>{summaryShiftCount}</strong>
            <span>
              {plural(
                summaryShiftCount,
                "service planifié",
                "services planifiés",
              )}
            </span>
          </div>
          <div>
            <strong>{planningStationIds.size}</strong>
            <span>{plural(planningStationIds.size, "station")}</span>
          </div>
          <div className="planning-overview__status-summary">
            <span>
              <i className="is-published" />
              {plural(publishedPlanningCount, "publié", "publiés")}
            </span>
            <span>
              <i className="is-draft" />
              {plural(draftPlanningCount, "brouillon")}
            </span>
          </div>
        </div>
        <div
          className="planning-overview__status-bar"
          role="img"
          aria-label={`${publishedPlanningCount} plannings publiés et ${draftPlanningCount} brouillons`}
        >
          {stationPlannings.length > 0 && (
            <>
              <span
                className="is-published"
                style={{
                  width: `${(publishedPlanningCount / stationPlannings.length) * 100}%`,
                }}
              />
              <span
                className="is-draft"
                style={{
                  width: `${(draftPlanningCount / stationPlannings.length) * 100}%`,
                }}
              />
            </>
          )}
        </div>
        <div className="planning-overview__list">
          {visiblePlannings.length ? (
            visiblePlannings.map((item) => {
              const selectedOccurrences = occurrencesInPeriod(item);
              const itemStations = selectedOccurrences
                .map((occurrence) => occurrence.station)
                .filter(
                  (station, index, all) =>
                    all.findIndex(
                      (candidate) => candidate.id === station.id,
                    ) === index,
                );
              const count = selectedOccurrences.length;
              return (
                <a
                  key={item.id}
                  className="planning-overview__row"
                  {...link(
                    `/app/admin/plannings?planning=${encodeURIComponent(item.id)}`,
                  )}
                >
                  <span
                    className={`planning-overview__status ${item.status === "DRAFT" ? "is-draft" : "is-published"}`}
                  >
                    {item.status === "DRAFT" ? "Brouillon" : "Publié"}
                  </span>
                  <span className="planning-overview__details">
                    <strong>{item.name || "Planning sans nom"}</strong>
                    <small>
                      {compactPeriod(item.startDate, item.endDate)} ·{" "}
                      {plural(count, "service")} ·{" "}
                      {itemStations.length
                        ? itemStations.map((station) => station.name).join(", ")
                        : "Aucune station sur ce planning"}
                    </small>
                  </span>
                  <ArrowRightIcon size={16} />
                </a>
              );
            })
          ) : (
            <p className="insight-empty">
              Aucun planning ne correspond à cette période et à ces filtres.
            </p>
          )}
        </div>
        <p className="planning-overview__note">
          Les indicateurs d’activité comptent les services publiés. Le statut
          filtre cette liste lorsque vous choisissez un planning.
        </p>
      </section>

      <section className="executive-kpis" aria-label="Indicateurs clés">
        <button
          type="button"
          className="executive-kpi-link"
          aria-label="Voir les services attribués par station"
          onClick={() => showInsight("admin-coverage-insight")}
        >
          <KpiCard
            compact
            label="Services attribués"
            value={dashboard ? `${dashboard.kpis.coverageRate} %` : "—"}
            detail={
              dashboard
                ? `${dashboard.kpis.shifts} services analysés`
                : "Calcul en cours…"
            }
            progress={dashboard?.kpis.coverageRate}
            icon={<GaugeIcon size={18} />}
            tone={
              dashboard
                ? dashboard.kpis.coverageRate >= 90
                  ? "green"
                  : "amber"
                : "neutral"
            }
          />
        </button>
        <button
          type="button"
          className="executive-kpi-link"
          aria-label="Voir le détail des présences"
          onClick={() => showInsight("admin-attendance-insight")}
        >
          <KpiCard
            compact
            label="Présence des équipes"
            value={dashboard ? `${dashboard.kpis.attendanceRate} %` : "—"}
            detail={
              dashboard
                ? `${plural(dashboard.kpis.absences, "absence")} · ${plural(dashboard.kpis.late, "retard")}`
                : "Chargement des présences…"
            }
            progress={dashboard?.kpis.attendanceRate}
            icon={<CalendarCheckIcon size={18} />}
            tone={
              dashboard
                ? dashboard.kpis.attendanceRate >= 90
                  ? "green"
                  : "red"
                : "neutral"
            }
          />
        </button>
        <button
          type="button"
          className="executive-kpi-link"
          aria-label="Voir l’évolution des heures planifiées"
          onClick={() => showInsight("admin-activity-insight")}
        >
          <KpiCard
            compact
            label="Heures planifiées"
            value={
              dashboard ? (
                <>
                  {dashboard.kpis.totalHours.toLocaleString("fr-FR")}{" "}
                  <small>h</small>
                </>
              ) : (
                "—"
              )
            }
            detail={
              dashboard
                ? `${activeStations} stations actives`
                : "Calcul en cours…"
            }
            icon={<ChartLineUpIcon size={18} />}
            tone={dashboard ? "blue" : "neutral"}
          />
        </button>
        <button
          type="button"
          className="executive-kpi-link"
          aria-label="Voir les actions attendues"
          onClick={() => showInsight("admin-priorities-insight")}
        >
          <KpiCard
            compact
            label="Actions à faire"
            value={dashboard ? attentionCount : "—"}
            detail={
              dashboard
                ? attentionCount
                  ? "Décisions et affectations en attente"
                  : "Aucune action urgente"
                : "Calcul des actions…"
            }
            icon={<WarningCircleIcon size={18} />}
            tone={dashboard ? (attentionCount ? "amber" : "green") : "neutral"}
          />
        </button>
      </section>

      <section className="home-insights" aria-label="Analyse de l’activité">
        <article
          id="admin-activity-insight"
          className="insight-card insight-card--trend"
          tabIndex={-1}
        >
          <header className="insight-card__head">
            <div>
              <span className="insight-kicker">Activité</span>
              <h3>Heures planifiées</h3>
            </div>
            <ChartLineUpIcon size={20} />
          </header>
          <ActivityTrend data={dashboard?.hoursByWeek ?? []} />
        </article>

        <article
          id="admin-priorities-insight"
          className="insight-card attention-card"
          tabIndex={-1}
        >
          <header className="insight-card__head">
            <div>
              <span className="insight-kicker">Priorités</span>
              <h3>Actions attendues</h3>
            </div>
            <WarningCircleIcon size={20} />
          </header>
          <div className="attention-list">
            <a {...link("/app/admin/plannings")}>
              <span className="attention-icon amber">
                <Clock3 size={16} />
              </span>
              <span>
                <strong>
                  {plural(dashboard?.kpis.futureVacant ?? 0, "service")}
                </strong>
                <small>à affecter au planning</small>
              </span>
              <ArrowRightIcon size={15} />
            </a>
            <a {...link("/app/admin/conges")}>
              <span className="attention-icon blue">
                <CalendarCheckIcon size={16} />
              </span>
              <span>
                <strong>{plural(pendingLeaves, "demande")}</strong>
                <small>de congé en attente</small>
              </span>
              <ArrowRightIcon size={15} />
            </a>
            <a {...link("/app/admin/utilisateurs?status=pending")}>
              <span className="attention-icon navy">
                <UserRound size={16} />
              </span>
              <span>
                <strong>{plural(counts.pending, "accès", "accès")}</strong>
                <small>à activer</small>
              </span>
              <ArrowRightIcon size={15} />
            </a>
          </div>
        </article>
      </section>

      <section
        className="home-insights home-insights--secondary"
        aria-label="Santé du réseau"
      >
        <article
          id="admin-coverage-insight"
          className="insight-card coverage-card"
          tabIndex={-1}
        >
          <header className="insight-card__head">
            <div>
              <span className="insight-kicker">Réseau</span>
              <h3>Services attribués par station</h3>
            </div>
            <a {...link("/app/admin/stations?tab=list")}>Gérer les stations</a>
          </header>
          <div className="coverage-list">
            {stationRows.length ? (
              stationRows.slice(0, 6).map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className="coverage-row"
                  onClick={() => setStationFilter(row.id)}
                  aria-label={`Afficher uniquement les données de ${row.name}`}
                >
                  <span className="coverage-row__label">
                    <strong>{row.name}</strong>
                    <small>
                      {row.filled} sur {row.total} attribués
                    </small>
                  </span>
                  <span className="coverage-row__track">
                    <span style={{ width: `${row.coverage}%` }} />
                  </span>
                  <b className={row.coverage < 90 ? "is-alert" : ""}>
                    {row.coverage}%
                  </b>
                </button>
              ))
            ) : (
              <p className="insight-empty">
                Aucune donnée de couverture sur cette période.
              </p>
            )}
          </div>
        </article>

        <article
          id="admin-attendance-insight"
          className="insight-card attendance-card"
          tabIndex={-1}
        >
          <header className="insight-card__head">
            <div>
              <span className="insight-kicker">Présence</span>
              <h3>Répartition des présences</h3>
            </div>
            <ActivityIcon size={20} />
          </header>
          <AttendanceDonut data={dashboard?.attendance ?? {}} />
        </article>
      </section>

      {!dismissOnboarding && completedCount < onboardingSteps.length && (
        <section
          className="onboarding-card"
          aria-label="Progression de la configuration"
        >
          <button
            type="button"
            className="onboarding-dismiss-btn"
            aria-label="Masquer la configuration"
            onClick={() => setDismissOnboarding(true)}
          >
            <XIcon size={17} weight="bold" />
          </button>
          <div className="onboarding-head">
            <div className="onboarding-title-wrap">
              <span className="onboarding-spark-icon">
                <CompassIcon size={19} weight="duotone" />
              </span>
              <div>
                <h3>Configuration du réseau</h3>
                <p>
                  {completedCount} étape{completedCount === 1 ? "" : "s"} sur{" "}
                  {onboardingSteps.length}
                </p>
              </div>
            </div>
            <div className="onboarding-progress-bar">
              <div
                className="onboarding-progress-fill"
                style={{
                  width: `${(completedCount / onboardingSteps.length) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="onboarding-grid">
            {onboardingSteps.map((step) => (
              <button
                key={step.id}
                type="button"
                className={`onboarding-step-item${step.completed ? " is-completed" : ""}`}
                onClick={step.action}
              >
                <span className="step-status-indicator">
                  {step.completed ? (
                    <span className="check-badge">
                      <CheckIcon size={11} weight="bold" />
                    </span>
                  ) : (
                    <span className="radio-badge">{step.id}</span>
                  )}
                </span>
                <span className="step-icon">{step.icon}</span>
                <span>{step.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="home-section" aria-labelledby="services-title">
        <div className="home-section-heading">
          <div>
            <h2 id="services-title">Suivi administratif</h2>
            <p>Demandes de congé et rapports programmés.</p>
          </div>
        </div>
        <div className="home-service-stack">
          <LeaveRequestInbox />
          <ScheduledReports />
        </div>
      </section>
    </div>
  );
}
