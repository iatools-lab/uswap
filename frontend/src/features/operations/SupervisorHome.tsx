import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarIcon,
  CaretRight,
  Clock,
  MapPin,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { interceptNav } from "../../app/spaNav";
import { Modal } from "../../ui/Modal";
import {
  ReplacementDialog,
  ReplacementQueue,
} from "../supervision/ReplacementQueue";
import type { OperationsViewProps } from "./types";
import { IncidentCenter } from "../incidents/IncidentCenter";
import { OperationsDashboard } from "../reports/OperationsDashboard";

export function SupervisorHome({ data }: OperationsViewProps) {
  const navigate = useNavigate();
  const [replacementShift, setReplacementShift] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [queueKey, setQueueKey] = useState(0);
  const published = data.shifts
    .filter(
      (shift) => shift.publishedAt && Date.parse(shift.endTime) >= Date.now(),
    )
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const plannerPath = "/app/supervision/plannings";
  const pointagesPath = "/app/supervision/pointages";
  const stationGroups = useMemo(() => {
    const groups = new Map<string, typeof published>();
    published.forEach((shift) => {
      const key = shift.station.id || shift.station.name;
      groups.set(key, [...(groups.get(key) ?? []), shift]);
    });
    return [...groups.entries()].map(([key, shifts]) => ({
      key,
      station: shifts[0].station,
      shifts,
    }));
  }, [published]);
  const activeGroup = stationGroups.find(
    (group) => group.key === selectedStation,
  );

  const formatDate = (value: string, timezone?: string) =>
    new Intl.DateTimeFormat("fr-CM", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: timezone || "Africa/Douala",
    }).format(new Date(value));
  const formatTime = (value: string, timezone?: string) =>
    new Intl.DateTimeFormat("fr-CM", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || "Africa/Douala",
    }).format(new Date(value));

  return (
    <div className="operations-stack supervisor-dashboard">
      {replacementShift && (
        <ReplacementDialog
          shiftId={replacementShift}
          onClose={() => setReplacementShift(null)}
          onReplaced={() => {
            setReplacementShift(null);
            setQueueKey((value) => value + 1);
          }}
        />
      )}

      {activeGroup && (
        <Modal
          open
          size="lg"
          title={`Prochains shifts · ${activeGroup.station.name}`}
          subtitle={`${activeGroup.shifts.length} service${activeGroup.shifts.length > 1 ? "s" : ""} publié${activeGroup.shifts.length > 1 ? "s" : ""}`}
          onClose={() => setSelectedStation(null)}
          footer={
            <>
              <button
                type="button"
                className="admin-button secondary"
                onClick={() => setSelectedStation(null)}
              >
                Fermer
              </button>
              <button
                type="button"
                className="admin-button primary-cta"
                onClick={() =>
                  navigate(
                    `${plannerPath}?planning=${encodeURIComponent(activeGroup.shifts[0].planningId)}`,
                  )
                }
              >
                Ouvrir dans le planning
              </button>
            </>
          }
        >
          <div className="supervisor-upcoming-dialog">
            <div className="supervisor-upcoming-dialog__summary">
              <span className="supervisor-upcoming-dialog__icon">
                <MapPin size={20} weight="duotone" aria-hidden="true" />
              </span>
              <div>
                <strong>{activeGroup.station.name}</strong>
                <span>Affectations publiées, classées par heure de début</span>
              </div>
            </div>
            <div className="supervisor-upcoming-dialog__list">
              {activeGroup.shifts.map((shift) => {
                const inProgress = Date.parse(shift.startTime) <= Date.now();
                return (
                  <article key={shift.id}>
                    <div className="supervisor-upcoming-dialog__date">
                      <CalendarIcon size={17} weight="duotone" />
                      <span>
                        {formatDate(shift.startTime, shift.station.timezone)}
                      </span>
                    </div>
                    <div className="supervisor-upcoming-dialog__shift">
                      <div>
                        <strong>{shift.label}</strong>
                        <span>
                          <Clock size={15} aria-hidden="true" />
                          {formatTime(
                            shift.startTime,
                            shift.station.timezone,
                          )}{" "}
                          – {formatTime(shift.endTime, shift.station.timezone)}
                        </span>
                      </div>
                      <span
                        className={`supervisor-upcoming-dialog__state${inProgress ? " is-live" : ""}`}
                      >
                        {inProgress ? "En cours" : "À venir"}
                      </span>
                    </div>
                    <div className="supervisor-upcoming-dialog__person">
                      <UsersThreeIcon size={16} aria-hidden="true" />
                      <span>{shift.swapper.fullName}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      <section
        className="supervisor-overview"
        aria-labelledby="supervisor-overview-title"
      >
        <div>
          <span className="premium-eyebrow">Vue réseau</span>
          <h2 id="supervisor-overview-title">
            Les opérations essentielles, au même endroit
          </h2>
          <p>
            Surveillez les besoins de couverture, puis accédez directement aux
            pointages ou aux plannings de votre périmètre.
          </p>
        </div>
        <div className="supervisor-overview__actions">
          <a
            className="admin-button primary-cta"
            href={pointagesPath}
            onClick={(event) => interceptNav(event, navigate, pointagesPath)}
          >
            Voir les pointages
          </a>
          <a
            className="admin-button secondary"
            href={plannerPath}
            onClick={(event) => interceptNav(event, navigate, plannerPath)}
          >
            Ouvrir le planning
          </a>
        </div>
      </section>

      <OperationsDashboard />

      <div className="supervisor-dashboard__grid">
        <div key={queueKey} className="supervisor-dashboard__coverage">
          <ReplacementQueue onSelect={setReplacementShift} />
        </div>

        <section className="admin-card supervisor-upcoming">
          <div className="admin-card-heading">
            <div>
              <h2>Prochains shifts</h2>
              <p className="operations-hint">
                Les services publiés, regroupés par station.
              </p>
            </div>
          </div>
          {!published.length ? (
            <div className="admin-empty">
              <h3>Aucun shift publié</h3>
              <p>Les prochains services apparaîtront ici après publication.</p>
            </div>
          ) : (
            <ul
              className="supervisor-shift-list"
              aria-label="Shifts regroupés par station"
            >
              {stationGroups.map((group) => {
                const next = group.shifts[0];
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      aria-label={`Voir les prochains shifts de ${group.station.name}`}
                      onClick={() => setSelectedStation(group.key)}
                    >
                      <span className="supervisor-shift-list__icon">
                        <MapPin size={20} weight="duotone" aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{group.station.name}</strong>
                        <span>
                          <CalendarIcon size={15} aria-hidden="true" />
                          Prochain :{" "}
                          {formatDate(
                            next.startTime,
                            next.station.timezone,
                          )} à{" "}
                          {formatTime(next.startTime, next.station.timezone)}
                        </span>
                        <span>
                          <UsersThreeIcon size={15} aria-hidden="true" />
                          {group.shifts.length} service
                          {group.shifts.length > 1 ? "s" : ""} programmé
                          {group.shifts.length > 1 ? "s" : ""}
                        </span>
                      </div>
                      <CaretRight size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <IncidentCenter canManage />
    </div>
  );
}
