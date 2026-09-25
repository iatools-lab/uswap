import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarIcon, CaretRight, Clock, MapPin } from "@phosphor-icons/react";
import { interceptNav } from "../../app/spaNav";
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
  const [queueKey, setQueueKey] = useState(0);
  const published = data.shifts
    .filter(
      (shift) => shift.publishedAt && Date.parse(shift.endTime) >= Date.now(),
    )
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const plannerPath = "/app/supervision/plannings";
  const pointagesPath = "/app/supervision/pointages";

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
                Les affectations publiées les plus proches.
              </p>
            </div>
            <span className="admin-badge draft">
              {published.length} à venir
            </span>
          </div>
          {!published.length ? (
            <div className="admin-empty">
              <h3>Aucun shift publié</h3>
              <p>Les prochains services apparaîtront ici après publication.</p>
            </div>
          ) : (
            <ul className="supervisor-shift-list">
              {published.slice(0, 5).map((shift) => (
                <li key={shift.id}>
                  <button
                    type="button"
                    aria-label={`Ouvrir ${shift.label} à ${shift.station?.name || "la station"}`}
                    onClick={() =>
                      navigate(
                        `${plannerPath}?planning=${encodeURIComponent(shift.planningId)}`,
                      )
                    }
                  >
                    <span className="supervisor-shift-list__date">
                      <CalendarIcon size={18} />
                      {new Intl.DateTimeFormat("fr-CM", {
                        day: "2-digit",
                        month: "short",
                        timeZone: shift.station?.timezone || "Africa/Douala",
                      }).format(new Date(shift.startTime))}
                    </span>
                    <div>
                      <strong>{shift.label}</strong>
                      <span>
                        <Clock size={14} />
                        {new Intl.DateTimeFormat("fr-CM", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: shift.station?.timezone || "Africa/Douala",
                        }).format(new Date(shift.startTime))}
                        {" – "}
                        {new Intl.DateTimeFormat("fr-CM", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: shift.station?.timezone || "Africa/Douala",
                        }).format(new Date(shift.endTime))}
                      </span>
                      <span>
                        <MapPin size={14} /> {shift.station?.name || "Sur site"}
                        {" · "}
                        {shift.swapper.fullName}
                      </span>
                    </div>
                    <CaretRight size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <IncidentCenter canManage />
    </div>
  );
}
