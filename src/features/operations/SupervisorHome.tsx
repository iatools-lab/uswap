import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarIcon, CaretRight, Clock, MapPin } from "@phosphor-icons/react";
import { interceptNav } from "../../app/spaNav";
import {
  ReplacementDialog,
  ReplacementQueue,
} from "../supervision/ReplacementQueue";
import { formatDate } from "./format";
import type { OperationsViewProps } from "./types";

export function SupervisorHome({ data }: OperationsViewProps) {
  const navigate = useNavigate();
  const [replacementShift, setReplacementShift] = useState<string | null>(null);
  const [queueKey, setQueueKey] = useState(0);
  const published = data.shifts.filter((shift) => shift.publishedAt);
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

      <section
        className="supervisor-summary"
        aria-label="Synthèse opérationnelle"
      >
        <article>
          <span>Shifts publiés</span>
          <strong>{published.length}</strong>
          <small>visibles par les équipes</small>
        </article>
        <article>
          <span>Stations suivies</span>
          <strong>
            {
              new Set(
                published.map((shift) => shift.station?.id).filter(Boolean),
              ).size
            }
          </strong>
          <small>dans votre périmètre</small>
        </article>
        <article>
          <span>À venir</span>
          <strong>
            {
              published.filter(
                (shift) => new Date(shift.startTime) > new Date(),
              ).length
            }
          </strong>
          <small>services planifiés</small>
        </article>
      </section>

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
            <span className="admin-badge draft">{published.length}</span>
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
                  <span className="supervisor-shift-list__date">
                    <CalendarIcon size={18} />
                    {formatDate(shift.startTime)}
                  </span>
                  <div>
                    <strong>{shift.station?.name || "Station"}</strong>
                    <span>
                      <Clock size={14} />{" "}
                      {formatDate(
                        shift.startTime,
                        shift.station?.timezone,
                        true,
                      )}
                    </span>
                    <span>
                      <MapPin size={14} /> {shift.station?.name || "Sur site"}
                    </span>
                  </div>
                  <CaretRight size={17} aria-hidden="true" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
