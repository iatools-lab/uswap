import type { User } from "../../api/auth-api";
import { Clock3, CalendarBlankIcon, MapPinIcon } from "../../ui/icons";
import type { OperationShift } from "./types";
import { formatDate, shiftStatus } from "./format";

function statusClass(shift: OperationShift) {
  if (shift.attendance?.status === "ABSENT") return "attendance-status--absent";
  if (shift.attendance?.checkedOutAt) return "attendance-status--closed";
  if (shift.attendance?.isLate) return "attendance-status--late";
  if (shift.attendance) return "attendance-status--present";
  return "attendance-status--expected";
}

export function ShiftTable({
  user,
  shifts,
  emptyLabel,
  busy,
  onPublish,
}: {
  user: User;
  shifts: OperationShift[];
  emptyLabel: string;
  busy?: boolean;
  onPublish?: (id: string) => void;
}) {
  if (!shifts.length) {
    return (
      <div className="admin-empty">
        <Clock3 size={36} />
        <h3>{emptyLabel}</h3>
      </div>
    );
  }

  return (
    <div className="swapper-shifts-cards-list">
      {shifts.map((shift) => {
        const isSwapper = user.role === "SWAPPER";
        return (
          <div key={shift.id} className="swapper-shift-card">
            <div className="swapper-shift-header">
              <div className="swapper-shift-station">
                <span className="station-name">{shift.station?.name}</span>
              </div>
              <span className={`attendance-status ${statusClass(shift)}`}>
                {shiftStatus(shift)}
              </span>
            </div>

            {!isSwapper && shift.swapper && (
              <div className="swapper-shift-row">
                <span className="label">Swappeur</span>
                <span className="value font-semibold">
                  {shift.swapper.fullName}
                </span>
              </div>
            )}

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

            {onPublish && !shift.publishedAt && (
              <div className="swapper-shift-footer">
                <button
                  type="button"
                  className="admin-button secondary small full-width"
                  disabled={busy}
                  onClick={() => onPublish(shift.id)}
                >
                  Publier ce shift
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
