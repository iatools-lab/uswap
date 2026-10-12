import { useEffect, useState, useMemo, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { notify } from "../../ui/Toast";
import { api, usingMock } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { KpiCard } from "../../ui/KpiCard";
import { SwapperIncidentReport } from "../incidents/SwapperIncidentReport";
import { SwapperPanel } from "../supervision/SwapperPanel";
import {
  CheckCircle,
  Clock3,
  GaugeIcon,
  LogIn,
  LogOut,
  MapPin,
  Warning,
} from "../../ui/icons";
import { formatDate, isInWindow, isOpenShift, pickNextShift } from "./format";
import type { OperationShift, OperationsViewProps, PunchResult } from "./types";
import type { AttendanceHistoryRow } from "../supervision/types";

function attendanceShiftFromHistory(row: AttendanceHistoryRow): OperationShift {
  const status: NonNullable<OperationShift["attendance"]>["status"] =
    row.isJustified
      ? "JUSTIFIED"
      : row.isAbsent
        ? "ABSENT"
        : row.checkedOutAt
          ? "CLOSED"
          : row.isLate
            ? "LATE"
            : "PRESENT";
  return {
    id: row.shiftId,
    planningId: "",
    templateId: row.shiftId,
    label: row.template || "Service",
    startTime: row.plannedStart,
    endTime: row.plannedEnd,
    publishedAt: "history",
    station: row.station,
    swapper: { fullName: "" },
    attendance:
      row.checkedInAt ||
      row.checkedOutAt ||
      row.isAbsent ||
      row.isJustified ||
      row.corrected
        ? {
            status,
            checkedInAt: row.checkedInAt ?? "",
            checkedOutAt: row.checkedOutAt,
            isLate: row.isLate,
          }
        : null,
  };
}

function belongsInHistory(shift: OperationShift, now = Date.now()) {
  return (
    Date.parse(shift.endTime) < now ||
    Boolean(
      shift.attendance &&
      (shift.attendance.checkedInAt ||
        shift.attendance.checkedOutAt ||
        shift.attendance.status === "ABSENT" ||
        shift.attendance.status === "JUSTIFIED"),
    )
  );
}

function historyStatusLabel(shift: OperationShift) {
  if (shift.attendance?.status === "JUSTIFIED") return "Absence justifiée";
  if (
    shift.attendance?.status === "ABSENT" ||
    (!shift.attendance && Date.parse(shift.endTime) < Date.now())
  )
    return "Absent";
  if (shift.attendance?.checkedOutAt) return "Terminé";
  if (shift.attendance?.isLate) return "En retard";
  return shift.attendance ? "À l’heure" : "Non pointé";
}

function historyStatusClass(shift: OperationShift) {
  if (
    shift.attendance?.status === "JUSTIFIED" ||
    shift.attendance?.checkedOutAt
  )
    return "attendance-status--closed";
  if (
    shift.attendance?.status === "ABSENT" ||
    (!shift.attendance && Date.parse(shift.endTime) < Date.now())
  )
    return "attendance-status--absent";
  if (shift.attendance?.isLate) return "attendance-status--late";
  return "attendance-status--present";
}

function historyGroups(shifts: OperationShift[]) {
  const groups = new Map<
    string,
    { id: string; name: string; shifts: OperationShift[] }
  >();
  shifts.forEach((shift) => {
    const id = shift.station?.id || shift.station?.name || "station";
    const group = groups.get(id) ?? {
      id,
      name: shift.station?.name || "Station",
      shifts: [],
    };
    group.shifts.push(shift);
    groups.set(id, group);
  });
  return Array.from(groups.values());
}

function historyDate(shift: OperationShift) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: shift.station?.timezone || "Africa/Douala",
  }).format(new Date(shift.startTime));
}

function historyTime(shift: OperationShift, value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: shift.station?.timezone || "Africa/Douala",
  }).format(new Date(value));
}

function sameStationDay(shift: OperationShift) {
  const timeZone = shift.station?.timezone || "Africa/Douala";
  const day = (value: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(value));
  return day(shift.startTime) === day(shift.endTime);
}

function shiftPeriod(shift: OperationShift) {
  const timeZone = shift.station?.timezone || "Africa/Douala";
  const date = (value: string) =>
    new Intl.DateTimeFormat("fr-CM", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(new Date(value));
  const time = (value: string) =>
    new Intl.DateTimeFormat("fr-CM", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));

  return sameStationDay(shift)
    ? `${date(shift.startTime)} · ${time(shift.startTime)} – ${time(shift.endTime)}`
    : `${date(shift.startTime)}, ${time(shift.startTime)} – ${date(shift.endTime)}, ${time(shift.endTime)}`;
}

function compactDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} h ${remainder}` : `${hours} h`;
}

function clockMinutes(value: string, timeZone: string) {
  const direct = value.match(/^(\d{1,2}):(\d{2})/);
  if (direct) return Number(direct[1]) * 60 + Number(direct[2]);
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hour * 60 + minute;
}

function shiftBreakRange(shift: OperationShift) {
  if (!shift.breakStart || !shift.breakEnd) return null;
  const timeZone = shift.station?.timezone || "Africa/Douala";
  const shiftStart = Date.parse(shift.startTime);
  const shiftEnd = Date.parse(shift.endTime);
  const startClock = clockMinutes(shift.startTime, timeZone);
  let pauseStartClock = clockMinutes(shift.breakStart, timeZone);
  let pauseEndClock = clockMinutes(shift.breakEnd, timeZone);
  while (pauseStartClock < startClock) pauseStartClock += 24 * 60;
  while (pauseEndClock <= pauseStartClock) pauseEndClock += 24 * 60;
  const start = shiftStart + (pauseStartClock - startClock) * 60_000;
  const end = shiftStart + (pauseEndClock - startClock) * 60_000;
  if (start < shiftStart || end > shiftEnd || end <= start) return null;
  return { start, end };
}

function HistoryRows({
  shifts,
  targetId,
}: {
  shifts: OperationShift[];
  targetId?: string | null;
}) {
  return (
    <div className="swapper-history-groups">
      {historyGroups(shifts).map((group) => (
        <section className="swapper-history-group" key={group.id}>
          <header className="swapper-history-group__heading">
            <strong>{group.name}</strong>
            <span>
              {group.shifts.length} shift{group.shifts.length === 1 ? "" : "s"}
            </span>
          </header>
          <div className="swapper-history-group__rows">
            {group.shifts.map((shift) => (
              <article
                key={shift.id}
                data-attendance-id={shift.id}
                className={
                  "swapper-history-row" +
                  (shift.id === targetId ? " is-notification-target" : "")
                }
              >
                <time dateTime={shift.startTime}>{historyDate(shift)}</time>
                <span className="swapper-history-row__hours">
                  {historyTime(shift, shift.startTime)}
                  <span aria-hidden="true">→</span>
                  {historyTime(shift, shift.endTime)}
                  {!sameStationDay(shift) && <small>lendemain</small>}
                </span>
                <span
                  className={`attendance-status ${historyStatusClass(shift)}`}
                >
                  {historyStatusLabel(shift)}
                </span>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function SwapperHome({ user, data, onChanged }: OperationsViewProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const openShifts = data.shifts.filter(isOpenShift);
  const liveShifts = openShifts.filter((shift) => isInWindow(shift));
  const next = pickNextShift(data.shifts);
  const searchParams = new URLSearchParams(location.search);
  const requestedPunchShiftId = searchParams.get("shift");
  const requestedHistoryId = searchParams.get("pointage");
  const shouldOpenHistory =
    searchParams.get("historique") === "pointages" || !!requestedHistoryId;

  // Détermination automatique du shift le plus proche (en cours ou prochain)
  const requestedPunchShift = data.shifts.find(
    (shift) => shift.id === requestedPunchShiftId && isOpenShift(shift),
  );
  const targetShift = requestedPunchShift || liveShifts[0] || next;

  const [error, setError] = useState("");
  const [result, setResult] = useState<PunchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [punchKind, setPunchKind] = useState<"CHECKIN" | "CHECKOUT" | null>(
    null,
  );
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<OperationShift[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyFilter, setHistoryFilter] = useState<
    "ALL" | "PRESENT" | "LATE" | "ABSENT"
  >("ALL");
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const serviceProgress = useMemo(() => {
    if (!targetShift) return null;
    const start = Date.parse(targetShift.startTime);
    const end = Date.parse(targetShift.endTime);
    const span = Math.max(0, end - start);
    const elapsed = Math.min(span, Math.max(0, clockNow - start));
    const pause = shiftBreakRange(targetShift);
    const pauseDuration = pause ? pause.end - pause.start : 0;
    const elapsedPause = pause
      ? Math.min(pauseDuration, Math.max(0, clockNow - pause.start))
      : 0;
    const effectiveTotal = Math.max(0, span - pauseDuration);
    const effectiveElapsed = Math.max(0, elapsed - elapsedPause);
    return {
      percent: span ? Math.round((elapsed / span) * 100) : 0,
      elapsed: compactDuration(effectiveElapsed),
      total: compactDuration(effectiveTotal),
      live: start <= clockNow && clockNow <= end,
      startLabel: historyTime(targetShift, targetShift.startTime),
      endLabel: historyTime(targetShift, targetShift.endTime),
      pause: pause
        ? {
            startLabel: historyTime(
              targetShift,
              new Date(pause.start).toISOString(),
            ),
            endLabel: historyTime(
              targetShift,
              new Date(pause.end).toISOString(),
            ),
            left: span ? ((pause.start - start) / span) * 100 : 0,
            width: span ? (pauseDuration / span) * 100 : 0,
            center: span
              ? (((pause.start + pause.end) / 2 - start) / span) * 100
              : 50,
          }
        : null,
    };
  }, [clockNow, targetShift]);

  useEffect(() => {
    if (!shouldOpenHistory || historyRows === null) return;
    setHistoryFilter("ALL");
    setHistoryModalOpen(true);
  }, [historyRows, shouldOpenHistory]);

  useEffect(() => {
    if (!requestedPunchShift) return;
    setPunchKind(
      requestedPunchShift.attendance?.checkedInAt ? "CHECKOUT" : "CHECKIN",
    );
  }, [requestedPunchShift]);

  useEffect(() => {
    let active = true;
    setHistoryRows(null);
    setHistoryError("");
    const load = async () => {
      const rows = await api<AttendanceHistoryRow[]>("/attendance/history");
      return rows.map(attendanceShiftFromHistory);
    };
    void load()
      .then((rows) => {
        if (active) setHistoryRows(rows);
      })
      .catch((reason) => {
        if (active) {
          setHistoryRows([]);
          setHistoryError((reason as Error).message);
        }
      });
    return () => {
      active = false;
    };
  }, [user.id, data.shifts]);

  // Calcul des KPI détaillés pour le diagramme circulaire
  const kpiStats = useMemo(() => {
    const evaluatedShifts = Array.from(
      new Map(
        [...data.shifts, ...(historyRows ?? [])]
          .filter((shift) => belongsInHistory(shift))
          .map((shift) => [shift.id, shift]),
      ).values(),
    );
    const total = evaluatedShifts.length;

    if (total === 0)
      return {
        onTime: 0,
        late: 0,
        absent: 0,
        total: 0,
        onTimePct: 0,
        latePct: 0,
        absentPct: 0,
        presenceRate: 0,
      };

    let onTime = 0;
    let late = 0;
    let absent = 0;

    evaluatedShifts.forEach((s) => {
      if (
        s.attendance?.status === "ABSENT" ||
        (!s.attendance && new Date(s.endTime).getTime() < Date.now())
      ) {
        absent++;
      } else if (s.attendance?.isLate) {
        late++;
      } else {
        onTime++;
      }
    });

    return {
      onTime,
      late,
      absent,
      total,
      onTimePct: Math.round((onTime / total) * 100),
      latePct: Math.round((late / total) * 100),
      absentPct: Math.round((absent / total) * 100),
      presenceRate: Math.round(((onTime + late) / total) * 100),
    };
  }, [data.shifts, historyRows]);

  const completedShifts = useMemo(() => {
    return Array.from(
      new Map(
        [...data.shifts, ...(historyRows ?? [])]
          .filter((shift) => belongsInHistory(shift))
          .map((shift) => [shift.id, shift]),
      ).values(),
    );
  }, [data.shifts, historyRows]);

  const recentPointages = useMemo(() => {
    return [...completedShifts]
      .sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      )
      .slice(0, 5);
  }, [completedShifts]);

  const filteredModalShifts = useMemo(() => {
    return completedShifts
      .filter((s) => {
        if (historyFilter === "PRESENT")
          return (
            s.attendance &&
            !s.attendance.isLate &&
            s.attendance.status !== "ABSENT" &&
            s.attendance.status !== "JUSTIFIED"
          );
        if (historyFilter === "LATE") return s.attendance?.isLate;
        if (historyFilter === "ABSENT")
          return (
            s.attendance?.status === "ABSENT" ||
            s.attendance?.status === "JUSTIFIED" ||
            (!s.attendance && new Date(s.endTime).getTime() < Date.now())
          );
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      );
  }, [completedShifts, historyFilter]);

  useEffect(() => {
    if (!historyModalOpen || !requestedHistoryId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".modal-panel .modal-body [data-attendance-id]",
        ),
      ).find((element) => element.dataset.attendanceId === requestedHistoryId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filteredModalShifts, historyModalOpen, requestedHistoryId]);

  async function executePunch() {
    if (!targetShift || !punchKind) return;
    if (!usingMock) {
      setError(
        "Le pointage par géolocalisation attend la prise en charge de cette règle par l’API.",
      );
      return;
    }
    if (!navigator.geolocation) {
      setError("La géolocalisation n’est pas disponible sur cet appareil.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 0,
          });
        },
      );
      const response = await api<PunchResult>("/attendance", {
        shiftId: targetShift.id,
        kind: punchKind,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: Math.round(position.coords.accuracy),
      });
      const scan: PunchResult = {
        ...response,
      };
      setError("");
      setResult(scan);
      notify(
        scan.kind === "CHECKIN"
          ? scan.status === "LATE"
            ? "Prise de service enregistrée (En retard)."
            : "Prise de service enregistrée avec succès."
          : "Fin de service enregistrée avec succès.",
      );
      setPunchKind(null);
      onChanged();
    } catch (err) {
      setResult(null);
      const positionError = err as GeolocationPositionError;
      setError(
        positionError.code
          ? positionError.code === 1
            ? "Autorisez la localisation dans votre navigateur pour pointer."
            : positionError.code === 3
              ? "La localisation prend trop de temps. Réessayez dans un endroit dégagé."
              : "Votre position n’a pas pu être déterminée. Vérifiez les réglages de localisation."
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const handleDirectAction = (kind: "CHECKIN" | "CHECKOUT") => {
    if (!targetShift) {
      setError("Aucun shift disponible pour l'action de pointage.");
      return;
    }
    setError("");
    setPunchKind(kind);
  };

  const shiftNow = clockNow;
  const checkoutAvailableAt = targetShift
    ? Date.parse(targetShift.endTime) - 15 * 60_000
    : Number.POSITIVE_INFINITY;
  const canCheckIn = Boolean(
    targetShift &&
    !targetShift.attendance?.checkedInAt &&
    shiftNow >= Date.parse(targetShift.startTime) &&
    shiftNow <= Date.parse(targetShift.endTime),
  );
  const canCheckOut = Boolean(
    targetShift?.attendance?.checkedInAt &&
    !targetShift.attendance.checkedOutAt &&
    shiftNow >= checkoutAvailableAt &&
    shiftNow <= Date.parse(targetShift.endTime) + 5 * 60_000,
  );
  const hourInDouala = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Africa/Douala",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "hour")?.value ?? 12,
  );
  const greeting =
    hourInDouala < 12
      ? "Bonjour"
      : hourInDouala < 18
        ? "Bon après-midi"
        : "Bonsoir";
  const firstName = user.fullName.trim().split(/\s+/)[0] || "";

  return (
    <>
      {result && (
        <p
          className={`ops-result ${
            result.status === "LATE" ? "ops-result--late" : "ops-result--ok"
          }`}
          role="status"
        >
          {result.status === "LATE" ? (
            <Warning size={22} />
          ) : (
            <CheckCircle size={22} />
          )}
          <span>
            {result.kind === "CHECKIN"
              ? result.status === "LATE"
                ? `Prise de service à ${formatDate(result.checkedInAt, result.timezone, true)} · En retard.`
                : `Prise de service à ${formatDate(result.checkedInAt, result.timezone, true)} · À l’heure.`
              : `Fin de service à ${formatDate(result.checkedOutAt || result.checkedInAt, result.timezone, true)}.`}
          </span>
          {typeof result.distanceMeters === "number" && (
            <small className="ops-location-confirmation">
              <MapPin size={14} /> Vérifié à {result.distanceMeters} m de la
              station
            </small>
          )}
        </p>
      )}

      {error && (
        <p
          className="error-message"
          role="alert"
          style={{ margin: "0 0 16px" }}
        >
          {error}
        </p>
      )}

      <section className="admin-card swapper-welcome">
        <span className="admin-eyebrow">Espace personnel</span>
        <h2>
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h2>
        <p>Retrouvez ici votre présence et vos prochains services.</p>
      </section>

      <section aria-label="Votre présence">
        {kpiStats.total > 0 ? (
          <KpiCard
            className="swapper-performance"
            label="Votre présence"
            value={`${kpiStats.presenceRate}%`}
            detail={`Sur ${kpiStats.total} shift${kpiStats.total === 1 ? " terminé" : "s terminés"}`}
            icon={<GaugeIcon size={18} aria-hidden="true" />}
            tone={
              kpiStats.presenceRate >= 80
                ? "green"
                : kpiStats.presenceRate >= 60
                  ? "amber"
                  : "red"
            }
            progress={kpiStats.presenceRate}
          >
            <div className="swapper-performance__legend">
              <div>
                <span>
                  <i className="is-present" />À l’heure
                </span>
                <strong>
                  {kpiStats.onTime}
                  <small>{kpiStats.onTimePct}%</small>
                </strong>
              </div>
              <div>
                <span>
                  <i className="is-late" />
                  En retard
                </span>
                <strong>
                  {kpiStats.late}
                  <small>{kpiStats.latePct}%</small>
                </strong>
              </div>
              <div>
                <span>
                  <i className="is-absent" />
                  Absent
                </span>
                <strong>
                  {kpiStats.absent}
                  <small>{kpiStats.absentPct}%</small>
                </strong>
              </div>
            </div>
          </KpiCard>
        ) : (
          <KpiCard
            className="swapper-performance"
            label="Votre présence"
            value="—"
            detail="Vos indicateurs apparaîtront après votre premier shift terminé."
            icon={<GaugeIcon size={18} />}
            tone="neutral"
          />
        )}
      </section>

      {/* --- CARTE UNIQUE UNIFIÉE : Shift Cible & Actions de Service --- */}
      {targetShift ? (
        <section className="admin-card operations-unified-card">
          <div className="operations-unified-header">
            <div>
              <span className="admin-eyebrow">
                {isInWindow(targetShift) ? "Shift en cours" : "Prochain shift"}
              </span>
              <h2>{targetShift.station?.name}</h2>
              <p className="operations-unified-time">
                {shiftPeriod(targetShift)}
              </p>
            </div>
            <span
              className={`attendance-status ${
                targetShift.attendance?.checkedOutAt
                  ? "attendance-status--closed"
                  : targetShift.attendance
                    ? targetShift.attendance.isLate
                      ? "attendance-status--late"
                      : "attendance-status--present"
                    : isInWindow(targetShift)
                      ? "attendance-status--present"
                      : "attendance-status--expected"
              }`}
            >
              {targetShift.attendance?.checkedOutAt
                ? "Terminé"
                : targetShift.attendance
                  ? targetShift.attendance.isLate
                    ? "Présent · en retard"
                    : "Début déjà pointé"
                  : isInWindow(targetShift)
                    ? "Créneau en cours"
                    : "Accessible"}
            </span>
          </div>

          {serviceProgress && (
            <div className="operations-timeline">
              <div className="operations-timeline__summary">
                <span>
                  {serviceProgress.live ? "Temps effectué" : "Durée prévue"}
                </span>
                <strong>
                  {serviceProgress.live
                    ? `${serviceProgress.elapsed} sur ${serviceProgress.total}`
                    : serviceProgress.total}
                </strong>
              </div>
              <div className="operations-timeline__rail" aria-hidden="true">
                <span
                  className="operations-timeline__fill"
                  style={{ width: `${serviceProgress.percent}%` }}
                />
                {serviceProgress.pause && (
                  <span
                    className="operations-timeline__pause"
                    style={{
                      left: `${serviceProgress.pause.left}%`,
                      width: `${serviceProgress.pause.width}%`,
                    }}
                  />
                )}
                {serviceProgress.live && (
                  <span
                    className="operations-timeline__now"
                    style={{ left: `${serviceProgress.percent}%` }}
                  />
                )}
              </div>
              <div className="operations-timeline__labels">
                <span className="is-start">
                  <small>Début</small>
                  <strong>{serviceProgress.startLabel}</strong>
                </span>
                {serviceProgress.pause && (
                  <span
                    className="is-pause"
                    style={{
                      left: `${Math.min(74, Math.max(26, serviceProgress.pause.center))}%`,
                    }}
                  >
                    <small>Pause</small>
                    <strong>
                      {serviceProgress.pause.startLabel}–
                      {serviceProgress.pause.endLabel}
                    </strong>
                  </span>
                )}
                <span className="is-end">
                  <small>Fin</small>
                  <strong>{serviceProgress.endLabel}</strong>
                </span>
              </div>
            </div>
          )}

          <div className="operations-unified-divider" />

          <div className="operations-unified-actions">
            {canCheckIn && (
              <button
                type="button"
                className="admin-button primary-cta"
                onClick={() => handleDirectAction("CHECKIN")}
              >
                <LogIn size={18} /> Prendre mon service
              </button>
            )}
            {canCheckOut && (
              <button
                type="button"
                className="admin-button secondary"
                onClick={() => handleDirectAction("CHECKOUT")}
              >
                <LogOut size={18} /> Terminer mon service
              </button>
            )}
            {!canCheckIn && !canCheckOut && (
              <p className="operations-hint">
                {targetShift.attendance?.checkedOutAt
                  ? "Ce shift est clôturé."
                  : targetShift.attendance?.checkedInAt &&
                      shiftNow < checkoutAvailableAt
                    ? `La fin de service sera disponible à ${historyTime(targetShift, new Date(checkoutAvailableAt).toISOString())}.`
                    : shiftNow < Date.parse(targetShift.startTime)
                      ? "Le pointage sera disponible 15 minutes avant le début du shift."
                      : "Le pointage de ce shift n’est plus disponible. Contactez le superviseur en cas de correction nécessaire."}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section
          className="admin-card operations-unified-card operations-unified-card--empty"
          role="status"
          aria-live="polite"
        >
          <span className="operations-unified-empty-icon" aria-hidden="true">
            <Clock3 size={20} />
          </span>
          <div>
            <span className="admin-eyebrow">Pointage</span>
            <h2>Aucun shift à venir</h2>
            <p>
              Les prochains shifts publiés et affectés à votre compte
              apparaîtront ici. Vos anciens services restent consultables dans
              l’historique.
            </p>
          </div>
        </section>
      )}

      <SwapperPanel data={data} onChanged={onChanged} />

      <SwapperIncidentReport user={user} shifts={data.shifts} />

      {/* Historique de pointage (Top 5) */}
      <section className="admin-card">
        <div
          className="admin-card-heading"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2>Historique de pointage</h2>
          {completedShifts.length > 5 && (
            <button
              type="button"
              className="admin-button secondary small"
              onClick={() => setHistoryModalOpen(true)}
            >
              Voir plus
            </button>
          )}
        </div>

        {historyError && (
          <p className="error-message" role="alert">
            {historyError}
          </p>
        )}
        {historyRows === null ? (
          <div className="admin-loading" role="status">
            <Clock3 size={18} /> Chargement de votre historique…
          </div>
        ) : !recentPointages.length ? (
          <div className="admin-empty">
            <Clock3 size={36} />
            <h3>Aucun pointage antérieur sur cette période</h3>
          </div>
        ) : (
          <HistoryRows shifts={recentPointages} />
        )}
      </section>

      {/* Modal "Voir plus" avec Filtre Intelligent */}
      <Modal
        open={historyModalOpen}
        size="lg"
        title="Historique de pointage complet"
        subtitle={
          requestedHistoryId
            ? "Le pointage concerné par la notification est mis en évidence."
            : "Retrouvez l'ensemble de vos pointages."
        }
        onClose={() => {
          setHistoryModalOpen(false);
          if (shouldOpenHistory) navigate(location.pathname, { replace: true });
        }}
      >
        {requestedHistoryId &&
          !completedShifts.some((shift) => shift.id === requestedHistoryId) && (
            <p className="attendance-target-notice" role="status">
              Ce pointage n’est plus présent dans l’historique chargé. Les
              autres pointages restent consultables ci-dessous.
            </p>
          )}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "14px",
            flexWrap: "wrap",
          }}
        >
          {(["ALL", "PRESENT", "LATE", "ABSENT"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={`admin-button secondary ${historyFilter === filter ? "active-filter" : ""}`}
              onClick={() => setHistoryFilter(filter)}
              style={{
                fontSize: "12px",
                minHeight: "32px",
                padding: "4px 10px",
              }}
            >
              {filter === "ALL"
                ? "Tous"
                : filter === "PRESENT"
                  ? "À l'heure"
                  : filter === "LATE"
                    ? "En retard"
                    : "Absences"}
            </button>
          ))}
        </div>

        {!filteredModalShifts.length ? (
          <div className="admin-empty">
            <h3>Aucun résultat pour ce filtre</h3>
          </div>
        ) : (
          <HistoryRows
            shifts={filteredModalShifts}
            targetId={requestedHistoryId}
          />
        )}
      </Modal>

      <Modal
        open={punchKind !== null}
        size="md"
        title={
          punchKind === "CHECKOUT"
            ? "Terminer le service"
            : "Prendre le service"
        }
        onClose={() => !busy && setPunchKind(null)}
        footer={
          <>
            <button
              className="admin-button secondary"
              type="button"
              disabled={busy}
              onClick={() => setPunchKind(null)}
            >
              Annuler
            </button>
            <button
              className="admin-button primary-cta"
              type="button"
              disabled={busy || !usingMock}
              onClick={() => void executePunch()}
            >
              {busy ? "Confirmation…" : usingMock ? "Confirmer" : "API requise"}
            </button>
          </>
        }
      >
        {targetShift && (
          <div className="ops-punch-summary">
            <div>
              <span>{targetShift.station.name}</span>
              <strong>{shiftPeriod(targetShift)}</strong>
            </div>
            {serviceProgress && (
              <div className="ops-punch-summary__duration">
                <span>
                  {serviceProgress.live ? "Temps effectué" : "Durée prévue"}
                </span>
                <strong>
                  {serviceProgress.live
                    ? `${serviceProgress.elapsed} / ${serviceProgress.total}`
                    : serviceProgress.total}
                </strong>
              </div>
            )}
          </div>
        )}
        {usingMock ? (
          <p className="ops-location-note">
            Il vous sera demandé de partager votre position.
          </p>
        ) : (
          <p className="operations-hint">
            Le pointage géolocalisé attend sa prise en charge par l’API.
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
