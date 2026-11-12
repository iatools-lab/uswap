import { AbsenceApprovalPanel } from "../../features/supervision/AbsenceApprovalPanel";

/**
 * Écran « Absences » de la supervision.
 *
 * Permet au superviseur, à l'administrateur ou au super administrateur
 * d'approuver ou de refuser les absences déclarées par les agents. La décision
 * pilote directement la disponibilité vue dans l'affectation des shifts.
 */
export function AbsenceValidationPage() {
  return (
    <div className="page-stack">
      <AbsenceApprovalPanel />
    </div>
  );
}
