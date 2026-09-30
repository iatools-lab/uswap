import type { User } from "../../api/auth-api";
import { Clock3 } from "../../ui/icons";
import type { OperationShift } from "./types";
import { formatDate, shiftStatus } from "./format";

function statusClass(shift: OperationShift) {
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
    <div className="admin-table-wrap ops-table">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Station</th>
            {user.role !== "SWAPPER" && <th>Swappeur</th>}
            <th>Début</th>
            <th>Fin</th>
            <th>Statut</th>
            {onPublish && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <tr key={shift.id}>
              <td>
                <strong>{shift.station?.name}</strong>
              </td>
              {user.role !== "SWAPPER" && <td>{shift.swapper?.fullName}</td>}
              <td>{formatDate(shift.startTime)}</td>
              <td>{formatDate(shift.endTime)}</td>
              <td>
                <span className={`attendance-status ${statusClass(shift)}`}>
                  {shiftStatus(shift)}
                </span>
              </td>
              {onPublish && (
                <td>
                  {!shift.publishedAt && (
                    <button
                      type="button"
                      className="admin-button secondary small"
                      disabled={busy}
                      onClick={() => onPublish(shift.id)}
                    >
                      Publier
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
