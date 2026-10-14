import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import {translate,  useI18n } from "../../app/i18n";
import { notify } from "../../ui/Toast";
import { LoaderCircle, RefreshCw } from "../../ui/icons";
import { KpiCard } from "../../ui/KpiCard";
import { formatDateTime } from "../../features/supervision/format";
import "./dashboard.css";

type TimelineRow = {
  shiftId: string;
  station: string;
  timezone: string;
  swapper: string;
  startTime: string;
  endTime: string;
  status: "EXPECTED" | "PRESENT" | "LATE" | "ABSENT" | "CLOSED";
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

type DashboardStats = {
  generatedAt: string;
  businessDate: string;
  scope: {
    unrestricted: boolean;
    stationIds: string[];
  };
  today: {
    total: number;
    expected: number;
    present: number;
    late: number;
    absent: number;
    completed: number;
  };
  replacements: {
    open: number;
    assignedToday: number;
  };
  hours: {
    weekly: number;
    weeklyLimit: number;
    remaining: number;
  };
  workforce: {
    totalSwappers: number;
    activeSwappers: number;
  } | null;
  timeline: TimelineRow[];
};

const STATUS_LABEL: Record<TimelineRow["status"], string> = {
  EXPECTED: "Attendu",
  PRESENT: "Présent",
  LATE: "En retard",
  ABSENT: "Absent",
  CLOSED: "Terminé",
};

const STATUS_CLASS: Record<TimelineRow["status"], string> = {
  EXPECTED: "dashboard-pill dashboard-pill--expected",
  PRESENT: "dashboard-pill dashboard-pill--present",
  LATE: "dashboard-pill dashboard-pill--late",
  ABSENT: "dashboard-pill dashboard-pill--absent",
  CLOSED: "dashboard-pill dashboard-pill--closed",
};

const REFRESH_MS = 60_000;

export function DashboardPage() {
  const { session, onAccessLost } = useSession();
  const { t, locale } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<TimelineRow["status"] | "ALL">("ALL");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setError("");

      try {
        const result = await api<DashboardStats>("/dashboard/stats");
        setStats(result);
      } catch (err) {
        if (err instanceof ApiError && [401, 403].includes(err.status)) {
          onAccessLost();
          return;
        }
        if (!silent) setError((err as Error).message);
      }
    },
    [onAccessLost],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (error)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>{t("Tableau de bord indisponible")}</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={() => void load()}>
          <RefreshCw size={16} /> {t("Réessayer")}
        </button>
      </section>
    );

  if (!stats)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        {t("Chargement du tableau de bord…")}
      </div>
    );

  const { today, replacements, hours, workforce, timeline } = stats;
  const rows =
    filter === "ALL"
      ? timeline
      : timeline.filter((row) => row.status === filter);

  const coverage =
    today.total === 0
      ? 0
      : Math.round(
          ((today.present + today.late + today.completed) / today.total) * 100,
        );

  const limitExceeded = hours.weekly > hours.weeklyLimit;

  async function refreshNow() {
    await load();
    notify(t("Tableau de bord actualisé."));
  }

  return (
    <div className="dashboard">
      <div className="dashboard-head">
        <div>
          <h1>{t("Tableau de bord")}</h1>
          <p className="operations-hint">
            {t("Journée opérationnelle du")} {stats.businessDate} {" "}{translate("(")}{t("heure de Douala")}{translate(").")}</p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          onClick={() => void refreshNow()}
        >
          <RefreshCw size={16} />
          {t("Actualiser")}
        </button>
      </div>

      <section className="dashboard-grid" aria-label={t("Indicateurs du jour")}>
        <KpiCard
          compact
          label={t("Shifts du jour")}
          value={today.total}
          detail={`${coverage}% ${t("de couverture")}`}
          progress={coverage}
          tone={coverage === 100 ? "green" : "amber"}
        />
        <KpiCard
          compact
          label={t("Présents")}
          value={today.present}
          detail={t("À l’heure")}
          tone="green"
        />
        <KpiCard
          compact
          label={t("En retard")}
          value={today.late}
          detail={t("Au-delà de la tolérance")}
          tone={today.late > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label={t("Absents")}
          value={today.absent}
          detail={t("Sans pointage valide")}
          tone={today.absent > 0 ? "red" : "neutral"}
        />
        <KpiCard
          compact
          label={t("Shifts terminés")}
          value={today.completed}
          detail={t("Pointage clôturé")}
          tone="blue"
        />
        <KpiCard
          compact
          label={t("Remplacements")}
          value={replacements.open}
          detail={`${replacements.assignedToday} ${replacements.assignedToday === 1 ? "traité aujourd’hui" : "traités aujourd’hui"}`}
          tone={replacements.open > 0 ? "amber" : "neutral"}
        />
      </section>

      <section className="dashboard-grid dashboard-grid--secondary">
        <KpiCard
          compact
          label={t("Attendus")}
          value={today.expected}
          detail={t("Shift en cours, sans pointage")}
          tone={today.expected > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label={t("Heures de la semaine")}
          value={
            <>
              {hours.weekly} {" "}{translate("h")}{" "}<small>{translate("/")}{" "}{hours.weeklyLimit} {" "}{translate("h")}</small>
            </>
          }
          detail={
            limitExceeded
              ? `${t("Limite dépassée de")} ${(hours.weekly - hours.weeklyLimit).toFixed(1)} h`
              : `${hours.remaining} ${t("h restantes")}`
          }
          progress={(hours.weekly / hours.weeklyLimit) * 100}
          tone={limitExceeded ? "red" : "blue"}
        />

        {workforce && (
          <KpiCard
            compact
            label={t("Swappeurs")}
            value={
              <>
                {workforce.activeSwappers}
                <small> {" "}{translate("/")}{" "}{workforce.totalSwappers}</small>
              </>
            }
            detail={t("Comptes actifs sur le périmètre")}
            progress={
              (workforce.activeSwappers /
                Math.max(1, workforce.totalSwappers)) *
              100
            }
            tone="navy"
          />
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>{t("Shifts du jour")}</h2>
            <p className="operations-hint">
              {t("Vue chronologique des affectations publiées.")}
            </p>
          </div>
          <div className="dashboard-filters" role="group" aria-label={t("Filtrer")}>
            {(
              [
                "ALL",
                "EXPECTED",
                "PRESENT",
                "LATE",
                "ABSENT",
                "CLOSED",
              ] as const
            ).map((value) => (
              <button
                key={value}
                type="button"
                className={`dashboard-filter ${
                  filter === value ? "is-active" : ""
                }`}
                onClick={() => setFilter(value)}
              >
                {value === "ALL" ? t("Tous") : t(STATUS_LABEL[value])}
              </button>
            ))}
          </div>
        </div>

        {!rows.length ? (
          <div className="admin-empty">
            <h3>{t("Aucun shift sur cette période")}</h3>
            <p>
              {today.total === 0
                ? t("Aucune affectation publiée pour aujourd’hui.")
                : t("Aucun shift ne correspond à ce filtre.")}
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap ops-table">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Horaire")}</th>
                  <th>{t("Swappeur")}</th>
                  <th>{t("Station")}</th>
                  <th>{t("Statut")}</th>
                  <th>{t("Pointage")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.shiftId}>
                    <td>
                      {formatDateTime(row.startTime, row.timezone, locale)} {" "}{translate("→")}{" "}
                      {formatDateTime(row.endTime, row.timezone, locale)}
                    </td>
                    <td>{row.swapper}</td>
                    <td>{row.station}</td>
                    <td>
                      <span className={STATUS_CLASS[row.status]}>
                        {t(STATUS_LABEL[row.status])}
                      </span>
                    </td>
                    <td>
                      {row.checkedInAt
                        ? `${t("Entrée")} ${formatDateTime(row.checkedInAt, row.timezone, locale)}`
                        : "—"}
                      {row.checkedOutAt
                        ? ` · ${t("Sortie")} ${formatDateTime(row.checkedOutAt, row.timezone, locale)}`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {session?.user.role === "SWAPPER" && (
        <p className="operations-hint">
          {t("Ces chiffres concernent vos propres shifts.")}
        </p>
      )}
    </div>
  );
}
