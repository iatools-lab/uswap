import { useState } from "react";
import type { User } from "../../api/auth-api";
import { AttendanceMonitor } from "./AttendanceMonitor";
import { AttendanceHistory } from "./AttendanceHistory";
import { ChangeHistory } from "./ChangeHistory";
import { CorrectionDialog } from "./CorrectionDialog";
import type { MonitorRow } from "./types";
import "./supervision.css";

type Tab = "live" | "history" | "changes";

export function SupervisionPanel({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("live");
  const [correctionRow, setCorrectionRow] = useState<MonitorRow | null>(null);
  const [monitorKey, setMonitorKey] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);

  return (
    <div className="supervision-stack">
      <div className="supervision-tabs" role="tablist" aria-label="Pointages">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          onClick={() => setTab("live")}
        >
          Suivi en direct
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          Historique des pointages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "changes"}
          onClick={() => setTab("changes")}
        >
          Changement d’affectation
        </button>
      </div>

      {correctionRow && (
        <CorrectionDialog
          user={user}
          row={correctionRow}
          onClose={() => setCorrectionRow(null)}
          onCorrected={() => {
            setCorrectionRow(null);
            setMonitorKey((value) => value + 1);
            setHistoryKey((value) => value + 1);
          }}
        />
      )}

      {tab === "live" && (
        <AttendanceMonitor
          key={monitorKey}
          user={user}
          onCorrect={(row) => setCorrectionRow(row)}
        />
      )}
      {tab === "history" && (
        <AttendanceHistory
          key={historyKey}
          user={user}
          onCorrect={(row) => setCorrectionRow(row)}
        />
      )}
      {tab === "changes" && <ChangeHistory user={user} />}
    </div>
  );
}
