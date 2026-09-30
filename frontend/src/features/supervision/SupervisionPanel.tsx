import { useState } from "react";
import type { User } from "../../api/auth-api";
import { AttendanceMonitor } from "./AttendanceMonitor";
import { ChangeHistory } from "./ChangeHistory";
import { CorrectionDialog } from "./CorrectionDialog";
import { ReplacementDialog, ReplacementQueue } from "./ReplacementQueue";
import type { MonitorRow } from "./types";
import "./supervision.css";

type Tab = "presence" | "coverage" | "history";

export function SupervisionPanel({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("presence");
  const [replacementShift, setReplacementShift] = useState<string | null>(null);
  const [correctionRow, setCorrectionRow] = useState<MonitorRow | null>(null);
  const [monitorKey, setMonitorKey] = useState(0);
  const [queueKey, setQueueKey] = useState(0);

  return (
    <div className="supervision-stack">
      <div className="supervision-tabs" role="tablist" aria-label="Supervision">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "presence"}
          onClick={() => setTab("presence")}
        >
          Présence
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "coverage"}
          onClick={() => setTab("coverage")}
        >
          À remplacer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          Historique
        </button>
      </div>

      {replacementShift && (
        <ReplacementDialog
          shiftId={replacementShift}
          onClose={() => setReplacementShift(null)}
          onReplaced={() => {
            setReplacementShift(null);
            setQueueKey((value) => value + 1);
            setMonitorKey((value) => value + 1);
          }}
        />
      )}
      {correctionRow && (
        <CorrectionDialog
          user={user}
          row={correctionRow}
          onClose={() => setCorrectionRow(null)}
          onCorrected={() => {
            setCorrectionRow(null);
            setMonitorKey((value) => value + 1);
          }}
        />
      )}

      {tab === "presence" && (
        <AttendanceMonitor
          key={monitorKey}
          user={user}
          onCorrect={(row) => setCorrectionRow(row)}
        />
      )}
      {tab === "coverage" && (
        <div key={queueKey}>
          <ReplacementQueue
            onSelect={(shiftId) => setReplacementShift(shiftId)}
          />
        </div>
      )}
      {tab === "history" && <ChangeHistory user={user} />}
    </div>
  );
}
