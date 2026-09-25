import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import type { OperationData } from "../../features/operations/types";
import { SwapperPanel } from "../../features/supervision/SwapperPanel";
import { LeaveWorkspace } from "../../features/leaves/LeaveWorkspace";
import type { LeaveWorkspaceView } from "../../domain/sprint4";
import { LoaderCircle } from "../../ui/icons";

export function SwapperLeavePage() {
  const { session, onAccessLost } = useSession();
  const [data, setData] = useState<OperationData | null>(null);
  const [leaveData, setLeaveData] = useState<LeaveWorkspaceView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    Promise.all([
      api<OperationData>("/workspace"),
      api<LeaveWorkspaceView>("/leaves/workspace"),
    ])
      .then(([value, leaves]) => {
        if (active) {
          setData(value);
          setLeaveData(leaves);
        }
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
  if (!data || !leaveData)
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
      <section
        className="leave-process-guide"
        aria-labelledby="leave-process-title"
      >
        <div>
          <span>Cheminement</span>
          <h2 id="leave-process-title">
            Que se passe-t-il après un signalement ?
          </h2>
          <p>
            Le congé planifié et l’absence liée à un shift suivent deux circuits
            distincts.
          </p>
        </div>
        <div className="leave-process-columns">
          <article>
            <strong>Congé planifié</strong>
            <ol>
              <li>La demande est transmise au service RH avec sa période.</li>
              <li>
                Elle reste modifiable tant qu’aucune décision n’est rendue.
              </li>
              <li>
                Une approbation met à jour le solde et repère les shifts
                concernés.
              </li>
              <li>
                Ces shifts rejoignent la file de remplacement du superviseur.
              </li>
            </ol>
          </article>
          <article>
            <strong>Absence imprévue</strong>
            <ol>
              <li>
                Vous choisissez un shift futur et joignez le justificatif
                demandé.
              </li>
              <li>
                Le chef de station et le superviseur sont prévenus
                immédiatement.
              </li>
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
      </section>
      <details className="leave-unplanned">
        <summary>
          <span>
            <strong role="heading" aria-level={2}>
              Absence imprévue
            </strong>
            <small>
              Signaler une indisponibilité liée à un shift déjà planifié
            </small>
          </span>
        </summary>
        <SwapperPanel
          user={session.user}
          data={data}
          onChanged={() => setRevision((value) => value + 1)}
        />
      </details>
    </div>
  );
}
