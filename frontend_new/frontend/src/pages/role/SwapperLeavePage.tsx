import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { LeaveWorkspace } from "../../features/leaves/LeaveWorkspace";
import type { LeaveWorkspaceView } from "../../domain/sprint4";
import { LoaderCircle } from "../../ui/icons";

export function SwapperLeavePage() {
  const { session, onAccessLost } = useSession();
  const [leaveData, setLeaveData] = useState<LeaveWorkspaceView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [processOpen, setProcessOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setError("");
    api<LeaveWorkspaceView>("/leaves/workspace")
      .then((leaves) => {
        if (active) setLeaveData(leaves);
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiError && [401, 403].includes(reason.status))
          onAccessLost();
        else setError((reason as Error).message);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id, revision, onAccessLost]);

  if (!session || session.user.role !== "SWAPPER") return null;
  if (error)
    return (
      <p className="error-message" role="alert">
        {error}
      </p>
    );
  if (!leaveData)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement de vos congés…
      </div>
    );

  return (
    <div className="leave-page-stack">
      <LeaveWorkspace
        data={leaveData}
        onChanged={() => setRevision((value) => value + 1)}
      />
      <section className="leave-process-guide">
        <button
          type="button"
          className="leave-process-toggle"
          aria-expanded={processOpen}
          aria-controls="leave-process-content"
          onClick={() => setProcessOpen((value) => !value)}
        >
          <span>
            <small>Cheminement</small>
            <strong>Comment votre demande est-elle traitée ?</strong>
          </span>
          <span className="leave-process-toggle__action">
            {processOpen ? "Masquer" : "Afficher"}
          </span>
        </button>
        {processOpen && (
          <div id="leave-process-content" className="leave-process-content">
            <p>
              Les congés planifiés et les absences imprévues suivent deux
              parcours distincts.
            </p>
            <div className="leave-process-columns">
              <article>
                <strong>Congé planifié</strong>
                <ol>
                  <li>
                    Vous envoyez votre demande depuis cette page, en précisant
                    la période et le motif.
                  </li>
                  <li>
                    L’administration l’examine et vous notifie sa décision.
                  </li>
                  <li>
                    Si elle est approuvée, vos shifts concernés sont identifiés.
                  </li>
                  <li>
                    Le superviseur organise leur remplacement et le planning est
                    actualisé.
                  </li>
                </ol>
              </article>
              <article>
                <strong>Absence imprévue</strong>
                <ol>
                  <li>
                    Depuis l’accueil, vous choisissez un shift publié et
                    signalez votre indisponibilité.
                  </li>
                  <li>Le superviseur est prévenu immédiatement.</li>
                  <li>
                    Le superviseur choisit un remplaçant compatible de la même
                    station.
                  </li>
                  <li>
                    Le planning est mis à jour et les personnes concernées sont
                    notifiées.
                  </li>
                </ol>
              </article>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
