import type { User } from "../../api/auth-api";
import { Clock3 } from "../../ui/icons";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "../../ui/ResponsiveDataTable";
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

  const columns: ResponsiveColumn<OperationShift>[] = [
    {
      key: "station",
      header: "Station",
      primary: true,
      render: (shift) => <strong>{shift.station?.name}</strong>,
    },
    ...(user.role !== "SWAPPER"
      ? [
          {
            key: "swapper",
            header: "Swappeur",
            render: (shift: OperationShift) => shift.swapper?.fullName,
          },
        ]
      : []),
    {
      key: "start",
      header: "Début",
      render: (shift) => formatDate(shift.startTime),
    },
    { key: "end", header: "Fin", render: (shift) => formatDate(shift.endTime) },
    {
      key: "status",
      header: "Statut",
      render: (shift) => (
                <span className={`attendance-status ${statusClass(shift)}`}>
                  {shiftStatus(shift)}
                </span>
      ),
    },
    ...(onPublish
      ? [
          {
            key: "action",
            header: "Action",
            className: "responsive-data-card__action",
            render: (shift: OperationShift) =>
              !shift.publishedAt ? (
                    <button
                      type="button"
                      className="admin-button secondary small"
                      disabled={busy}
                      onClick={() => onPublish(shift.id)}
                    >
                      Publier
                    </button>
              ) : (
                "—"
              ),
          },
        ]
      : []),
  ];

  return (
    <ResponsiveDataTable
      rows={shifts}
      columns={columns}
      rowKey={(shift) => shift.id}
      ariaLabel="Shifts"
      className="ops-table ops-shift-table"
    />
  );
}
