import { useEffect, useState, useMemo, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { notify } from "../../ui/Toast";
import { api, usingMock } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { SwapperIncidentReport } from "../incidents/SwapperIncidentReport";
import { SwapperPanel } from "../supervision/SwapperPanel";
import { CheckCircle, MapPin, Warning, Clock3 } from "../../ui/icons";
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

  const shiftNow = Date.now();
  const canCheckIn = Boolean(
    targetShift &&
    !targetShift.attendance?.checkedInAt &&
    shiftNow >= Date.parse(targetShift.startTime) &&
    shiftNow <= Date.parse(targetShift.endTime),
  );
  const canCheckOut = Boolean(
    targetShift?.attendance?.checkedInAt &&
    !targetShift.attendance.checkedOutAt &&
    shiftNow <= Date.parse(targetShift.endTime) + 5 * 60_000,
  );

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

      {/* KPI Interactifs & Diagramme Circulaire */}
      <section className="admin-card" style={{ padding: "20px" }}>
        <h3
          style={{
            margin: "0 0 16px",
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--navy)",
          }}
        >
          Indicateurs de performance
        </h3>

        {kpiStats.total > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <div
              style={{
                position: "relative",
                width: "110px",
                height: "110px",
                borderRadius: "50%",
                background: `conic-gradient(
                  #10b981 0% ${kpiStats.onTimePct}%,
                  #f59e0b ${kpiStats.onTimePct}% ${kpiStats.onTimePct + kpiStats.latePct}%,
                  #ef4444 ${kpiStats.onTimePct + kpiStats.latePct}% 100%
                )`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
            >
              <div
                style={{
                  width: "82px",
                  height: "82px",
                  backgroundColor: "#ffffff",
                  borderRadius: "50%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.04)",
                }}
              >
                <span
                  style={{
                    fontSize: "18px",
                    fontWeight: 800,
                    color: "var(--navy)",
                    lineHeight: "1.1",
                  }}
                >
                  {kpiStats.presenceRate}%
                </span>
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 600,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Présence
                </span>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "13px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#10b981",
                    }}
                  />
                  À l'heure
                </span>
                <strong style={{ color: "var(--ink)" }}>
                  {kpiStats.onTime}{" "}
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: "11px",
                      marginLeft: "4px",
                    }}
                  >
                    ({kpiStats.onTimePct}%)
                  </span>
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "13px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#f59e0b",
                    }}
                  />
                  En retard
                </span>
                <strong style={{ color: "var(--ink)" }}>
                  {kpiStats.late}{" "}
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: "11px",
                      marginLeft: "4px",
                    }}
                  >
                    ({kpiStats.latePct}%)
                  </span>
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "13px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#ef4444",
                    }}
                  />
                  Absent
                </span>
                <strong style={{ color: "var(--ink)" }}>
                  {kpiStats.absent}{" "}
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: "11px",
                      marginLeft: "4px",
                    }}
                  >
                    ({kpiStats.absentPct}%)
                  </span>
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
            Aucune donnée de performance disponible pour le moment.
          </p>
        )}
      </section>

      {/* --- CARTE UNIQUE UNIFIÉE : Shift Cible & Actions de Service --- */}
      {targetShift ? (
        <section className="admin-card operations-unified-card">
          <div className="operations-unified-header">
            <div>
              <span className="admin-eyebrow">
                {isInWindow(targetShift)
                  ? "Shift en cours (Live)"
                  : "Prochain shift cible"}
              </span>
              <h2>{targetShift.station?.name}</h2>
              <p className="operations-unified-time">
                {formatDate(targetShift.startTime)} –{" "}
                {formatDate(targetShift.endTime)}
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

          <div className="operations-unified-divider" />

          <div className="operations-unified-actions">
            {canCheckIn && (
              <button
                type="button"
                className="admin-button primary-cta"
                onClick={() => handleDirectAction("CHECKIN")}
              >
                <MapPin size={18} /> Prendre mon service
              </button>
            )}
            {canCheckOut && (
              <button
                type="button"
                className="admin-button secondary"
                onClick={() => handleDirectAction("CHECKOUT")}
              >
                <CheckCircle size={18} /> Terminer mon service
              </button>
            )}
            {!canCheckIn && !canCheckOut && (
              <p className="operations-hint">
                {targetShift.attendance?.checkedOutAt
                  ? "Ce shift est clôturé."
                  : Date.now() < Date.parse(targetShift.startTime)
                    ? "Le pointage sera disponible à l’heure de début du shift."
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
        subtitle={targetShift?.station.name ?? "Station du shift"}
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
              {busy
                ? "Vérification…"
                : usingMock
                  ? "Vérifier ma position et pointer"
                  : "API requise"}
            </button>
          </>
        }
      >
        <div className="ops-geolocation-prompt">
          <span className="ops-geolocation-prompt__icon">
            <MapPin size={22} />
          </span>
          <div>
            {usingMock ? (
              <>
                <strong>
                  Votre position sera vérifiée au moment du pointage.
                </strong>
                <p>
                  Vous devez être à moins{" "}
                  {targetShift?.station.geofenceRadiusMeters ??
                    data.station?.geofenceRadiusMeters ??
                    150}{" "}
                  m de {targetShift?.station.name ?? "la station"}. Le pointage
                  est refusé hors de ce périmètre.{" "}
                  {punchKind === "CHECKIN" ? (
                    <>
                      Sans prise de service après{" "}
                      {targetShift?.station.latenessToleranceMinutes ??
                        data.station?.latenessToleranceMinutes ??
                        5}{" "}
                      min de tolérance, l’absence est enregistrée
                      automatiquement.
                    </>
                  ) : (
                    "Votre position sera vérifiée à nouveau pour enregistrer la fin du service."
                  )}
                </p>
              </>
            ) : (
              <>
                <strong>
                  Le pointage géolocalisé n’est pas encore disponible.
                </strong>
                <p>
                  L’API actuellement branchée ne vérifie pas encore la distance
                  à la station. Aucun pointage n’a été transmis.
                </p>
              </>
            )}
          </div>
        </div>
        {usingMock && (
          <p className="operations-hint">
            La localisation est demandée uniquement pour cette action. Si elle
            est refusée, aucun pointage n’est enregistré.
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
