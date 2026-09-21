import { dayKey, isInWindow } from "./format";
import { QrManagement } from "./QrManagement";
import { ShiftTable } from "./ShiftTable";
import type { OperationsViewProps } from "./types";

/**
 * Le chef consulte l'exploitation de sa station et génère les QR de service
 * (RM-08). Les corrections restent exclusivement réservées au superviseur.
 */
export function ChiefHome({ user, data }: OperationsViewProps) {
  const now = Date.now();
  const zone = data.station?.timezone || "Africa/Douala";
  const today = dayKey(new Date(now).toISOString(), zone);
  const published = data.shifts.filter((shift) => shift.publishedAt);
  const live = published.filter(
    (shift) =>
      dayKey(shift.startTime, zone) === today || isInWindow(shift, now),
  );
  const liveIds = new Set(live.map((shift) => shift.id));
  const history = published.filter((shift) => !liveIds.has(shift.id));
  const notCheckedIn = live.filter(
    (shift) => !shift.attendance && Date.parse(shift.startTime) <= now,
  );
  const pendingCheckout = live.filter(
    (shift) =>
      Boolean(shift.attendance?.checkedInAt) &&
      !shift.attendance?.checkedOutAt &&
      Date.parse(shift.endTime) <= now,
  );

  return (
    <>
      <QrManagement data={data} />

      {(notCheckedIn.length > 0 || pendingCheckout.length > 0) && (
        <div className="ops-callout-row" aria-label="Alertes de présence">
          {notCheckedIn.length > 0 && (
            <div className="ops-callout ops-callout--warn" role="status">
              <strong>{notCheckedIn.length} sans prise de service</strong>
              <span>Le superviseur a été informé pour assurer le suivi.</span>
            </div>
          )}
          {pendingCheckout.length > 0 && (
            <div className="ops-callout" role="status">
              <strong>{pendingCheckout.length} fin de service attendue</strong>
              <span>Ces swappeurs n’ont pas encore clôturé leur pointage.</span>
            </div>
          )}
        </div>
      )}

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>Présence du jour · {data.station?.name}</h2>
            <p className="operations-hint">
              Consultation limitée aux affectations de votre station.
            </p>
          </div>
        </div>
        <ShiftTable
          user={user}
          shifts={live}
          emptyLabel="Aucun shift publié aujourd’hui"
        />
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <h2>Autres affectations publiées</h2>
        </div>
        <ShiftTable
          user={user}
          shifts={history}
          emptyLabel="Aucune autre affectation publiée"
        />
        {data.shifts.length === data.limit && (
          <p className="workspace-limit">
            Les {data.limit} prochaines affectations sont affichées.
          </p>
        )}
      </section>
    </>
  );
}
