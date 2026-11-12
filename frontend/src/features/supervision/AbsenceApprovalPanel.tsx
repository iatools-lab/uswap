import { useEffect, useState } from "react";
import { api } from "../../api/auth-api";
import {
  CheckCircle as CheckCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "../../ui/icons";

/**
 * File de validation des absences déclarées par les agents.
 *
 * L'agent DÉCLARE (statut « en attente »), un supérieur DÉCIDE. Tant qu'aucune
 * décision n'est prise, l'agent est déjà retiré des affectations possibles sur
 * ce créneau ; l'approbation confirme cette indisponibilité.
 *
 * Visible pour le superviseur, l'administrateur et le super administrateur.
 */
type PendingAbsence = {
  id: string;
  reason: string;
  reportedAt: string;
  swapperName: string;
  shiftLabel: string;
  startTime: string | null;
  stationName: string | null;
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AbsenceApprovalPanel({
  onCount,
}: {
  onCount?: (n: number) => void;
}) {
  const [rows, setRows] = useState<PendingAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api<PendingAbsence[]>("/operations/absences/pending");
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      onCount?.(list.length);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible de charger les absences.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Volontairement exécuté une seule fois : `load` est stable en pratique et
    // le rappel `onCount` ne doit pas relancer un chargement en boucle.
  }, []);

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setError("");
    try {
      await api(`/operations/absences/${id}/decision`, {
        method: "PATCH",
        body: {
          decision,
          reason:
            decision === "REJECTED"
              ? "Refusée par la supervision."
              : "Validée par la supervision.",
        },
      });
      // Retrait immédiat de la liste : la demande est traitée.
      setRows((current) => {
        const next = current.filter((row) => row.id !== id);
        onCount?.(next.length);
        return next;
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "La décision n'a pas été prise.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-panel approval-panel">
      <header className="approval-panel__head">
        <div>
          <span className="settings-eyebrow">Validation</span>
          <h2>Absences à traiter</h2>
          <p className="settings-note">
            Un agent déclaré absent n’est plus proposé pour ce créneau.
            L’approbation confirme son indisponibilité ; le refus le rend de
            nouveau disponible.
          </p>
        </div>
        <button
          type="button"
          className="admin-button secondary"
          onClick={() => void load()}
        >
          Actualiser
        </button>
      </header>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="settings-note">Chargement des demandes…</p>
      ) : rows.length === 0 ? (
        <div className="approval-empty">
          <CheckCircleIcon size={22} />
          <span>Aucune absence en attente.</span>
        </div>
      ) : (
        <ul className="approval-list">
          {rows.map((row) => (
            <li key={row.id} className="approval-row">
              <div className="approval-row__main">
                <strong>{row.swapperName}</strong>
                <span className="approval-row__shift">
                  <WarningCircleIcon size={16} />
                  {row.shiftLabel}
                  {row.startTime
                    ? ` · ${dateFormat.format(new Date(row.startTime))}`
                    : ""}
                  {row.stationName ? ` · ${row.stationName}` : ""}
                </span>
                <span className="approval-row__reason">
                  Motif : {row.reason}
                </span>
                <span className="approval-row__meta">
                  Déclarée le {dateFormat.format(new Date(row.reportedAt))}
                </span>
              </div>
              <div className="approval-row__actions">
                <button
                  type="button"
                  className="admin-button primary-cta"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, "APPROVED")}
                >
                  <CheckCircleIcon size={16} /> Approuver
                </button>
                <button
                  type="button"
                  className="admin-button secondary"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, "REJECTED")}
                >
                  <XCircleIcon size={16} /> Refuser
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
