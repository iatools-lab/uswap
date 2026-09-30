import { useNavigate } from "react-router-dom";
import { CalendarIcon } from "@phosphor-icons/react";
import { interceptNav } from "../../app/spaNav";
import { SupervisionPanel } from "../supervision/SupervisionPanel";
import { ShiftTable } from "./ShiftTable";
import type { OperationsViewProps } from "./types";

/**
 * Le superviseur prepare et publie les affectations **via les plannings**
 * (flux unifie : modeles de shift -> occurrences -> publication).
 * Cet ecran ne fait plus de creation de shift isole : il oriente vers le Planner.
 */

export function SupervisorHome({ user, data }: OperationsViewProps) {
  const navigate = useNavigate();
  const published = data.shifts.filter((shift) => shift.publishedAt);
  const plannerPath = "/app/supervision/plannings";

  return (
    <>
      <section className="admin-card operations-hero">
        <p className="admin-eyebrow">Preparation des affectations</p>
        <h2>Planifiez les shifts et affectez les swappeurs</h2>
        <p>
          Les affectations se preparent desormais dans le planning : choisissez
          une periode libre, generez les shifts a partir des modeles de la
          station, affectez les swappeurs puis publiez. Le systeme controle
          automatiquement les chevauchements, les conges approuves, le repos
          minimal et la limite hebdomadaire.
        </p>
        <div className="operations-hero-actions">
          <a
            className="admin-button primary-cta"
            href={plannerPath}
            onClick={(event) => interceptNav(event, navigate, plannerPath)}
          >
            <CalendarIcon size={16} weight="bold" />
            Ouvrir le planning
          </a>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <h2>Affectations publiées</h2>
        </div>
        <ShiftTable
          user={user}
          shifts={published}
          emptyLabel="Aucune affectation publiée à venir"
        />
        {data.shifts.length === data.limit && (
          <p className="workspace-limit">
            Les {data.limit} prochaines affectations sont affichées.
          </p>
        )}
      </section>

      <SupervisionPanel user={user} />
    </>
  );
}
