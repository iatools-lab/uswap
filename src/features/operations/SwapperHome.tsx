import { useEffect, useState, useMemo, type FormEvent } from "react";
import { notify } from "../../ui/Toast";
import { api } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { CheckCircle, Scan, Warning, Clock3 } from "../../ui/icons";
import { QrScanner } from "./QrScanner";
import {
  captureQrToken,
  clearQrToken,
  isValidQrToken,
  parseQrToken,
} from "./qrToken";
import { formatDate, isInWindow, isOpenShift, pickNextShift } from "./format";
import type { OperationsViewProps, ScanResult } from "./types";

export function SwapperHome({ user, data, onChanged }: OperationsViewProps) {
  const openShifts = data.shifts.filter(isOpenShift);
  const liveShifts = openShifts.filter((shift) => isInWindow(shift));
  const next = pickNextShift(data.shifts);

  // Détermination automatique du shift le plus proche (en cours ou prochain)
  const targetShift = liveShifts[0] || next;

  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(() => captureQrToken());
  const [scanning, setScanning] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<
    "ALL" | "PRESENT" | "LATE" | "ABSENT"
  >("ALL");

  useEffect(() => {
    const receive = () => {
      const nextToken = captureQrToken();
      if (nextToken && targetShift) {
        setToken(nextToken);
        void executePunch(nextToken, targetShift.id);
      }
    };
    receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, [targetShift]);

  // Calcul des KPI détaillés pour le diagramme circulaire
  const kpiStats = useMemo(() => {
    const evaluatedShifts = data.shifts.filter(
      (s) => s.attendance || new Date(s.endTime).getTime() < Date.now(),
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
  }, [data.shifts]);

  const completedShifts = useMemo(() => {
    return data.shifts.filter(
      (s) => s.attendance || new Date(s.endTime).getTime() < Date.now(),
    );
  }, [data.shifts]);

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
            s.attendance.status !== "ABSENT"
          );
        if (historyFilter === "LATE") return s.attendance?.isLate;
        if (historyFilter === "ABSENT")
          return (
            s.attendance?.status === "ABSENT" ||
            (!s.attendance && new Date(s.endTime).getTime() < Date.now())
          );
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      );
  }, [completedShifts, historyFilter]);

  async function executePunch(rawToken: string, shiftToPunchId: string) {
    const raw = parseQrToken(rawToken) || rawToken.trim();
    if (!isValidQrToken(raw)) {
      setError(
        "Scannez le QR ou collez le lien fourni par le chef de station.",
      );
      return;
    }
    if (!targetShift) {
      setError("Aucun shift éligible pour le pointage actuellement.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const scan = await api<ScanResult>("/attendance", {
        shiftId: shiftToPunchId,
        token: raw,
      });
      setToken("");
      clearQrToken();
      setError("");
      setResult(scan);
      notify(
        scan.kind === "CHECKIN"
          ? scan.status === "LATE"
            ? "Prise de service enregistrée (En retard)."
            : "Prise de service enregistrée avec succès."
          : "Fin de service enregistrée avec succès.",
      );
      setScanning(false);
      onChanged();
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const handleDirectAction = () => {
    if (!targetShift) {
      setError("Aucun shift disponible pour l'action de pointage.");
      return;
    }
    setError("");
    setScanning(true);
  };

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
      {targetShift && (
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
            <button
              type="button"
              className="admin-button primary-cta"
              onClick={handleDirectAction}
            >
              <Scan size={18} /> Prise de service
            </button>
            <button
              type="button"
              className="admin-button secondary"
              onClick={handleDirectAction}
            >
              <CheckCircle size={18} /> Fin de service
            </button>
          </div>
        </section>
      )}

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

        {!recentPointages.length ? (
          <div className="admin-empty">
            <Clock3 size={36} />
            <h3>Aucun pointage effectué</h3>
          </div>
        ) : (
          <div className="swapper-shifts-cards-list">
            {recentPointages.map((shift) => (
              <div key={shift.id} className="swapper-shift-card">
                <div className="swapper-shift-header">
                  <div className="swapper-shift-station">
                    <span className="station-name">{shift.station?.name}</span>
                  </div>
                  <span
                    className={`attendance-status ${shift.attendance?.checkedOutAt ? "attendance-status--closed" : shift.attendance?.status === "ABSENT" || (!shift.attendance && new Date(shift.endTime).getTime() < Date.now()) ? "attendance-status--absent" : "attendance-status--present"}`}
                  >
                    {shift.attendance?.checkedOutAt
                      ? "Terminé"
                      : shift.attendance?.status === "ABSENT" ||
                          (!shift.attendance &&
                            new Date(shift.endTime).getTime() < Date.now())
                        ? "Absent"
                        : shift.attendance
                          ? "En cours"
                          : "Non pointé"}
                  </span>
                </div>
                <div className="swapper-shift-details">
                  <div className="time-block">
                    <small>DÉBUT</small>
                    <strong>{formatDate(shift.startTime)}</strong>
                  </div>
                  <div className="time-separator" aria-hidden="true">
                    →
                  </div>
                  <div className="time-block">
                    <small>FIN</small>
                    <strong>{formatDate(shift.endTime)}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal "Voir plus" avec Filtre Intelligent */}
      <Modal
        open={historyModalOpen}
        size="lg"
        title="Historique de pointage complet"
        subtitle="Retrouvez l'ensemble de vos pointages avec filtres intelligents."
        onClose={() => setHistoryModalOpen(false)}
      >
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

        <div style={{ maxHeight: "55vh", overflowY: "auto", padding: "4px" }}>
          {!filteredModalShifts.length ? (
            <div className="admin-empty">
              <h3>Aucun résultat pour ce filtre</h3>
            </div>
          ) : (
            <div className="swapper-shifts-cards-list">
              {filteredModalShifts.map((shift) => (
                <div key={shift.id} className="swapper-shift-card">
                  <div className="swapper-shift-header">
                    <div className="swapper-shift-station">
                      <span className="station-name">
                        {shift.station?.name}
                      </span>
                    </div>
                    <span
                      className={`attendance-status ${shift.attendance?.status === "ABSENT" || (!shift.attendance && new Date(shift.endTime).getTime() < Date.now()) ? "attendance-status--absent" : "attendance-status--present"}`}
                    >
                      {shift.attendance?.status === "ABSENT" ||
                      (!shift.attendance &&
                        new Date(shift.endTime).getTime() < Date.now())
                        ? "Absent"
                        : shift.attendance?.isLate
                          ? "En retard"
                          : "Validé"}
                    </span>
                  </div>
                  <div className="swapper-shift-details">
                    <div className="time-block">
                      <small>DÉBUT</small>
                      <strong>{formatDate(shift.startTime)}</strong>
                    </div>
                    <div className="time-separator" aria-hidden="true">
                      →
                    </div>
                    <div className="time-block">
                      <small>FIN</small>
                      <strong>{formatDate(shift.endTime)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Scanner QR direct */}
      <QrScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={(detectedToken) => {
          if (targetShift) {
            void executePunch(detectedToken, targetShift.id);
          }
        }}
      />
    </>
  );
}
