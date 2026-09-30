import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { Operations, type OperationData } from "../../features/operations/Operations";
import { Building2, LoaderCircle } from "../../ui/icons";

export function OperationsPage() {
  const { session, onAccessLost } = useSession();
  const [data, setData] = useState<OperationData | null>(null);
  const [failure, setFailure] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailure(false);
    api<OperationData>("/workspace")
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && [401, 403].includes(err.status)) onAccessLost();
        else setFailure(true);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id, session?.user.role, revision, onAccessLost]);

  if (!session) return null;

  if (failure)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>Chargement indisponible</h2>
        <button className="admin-button" onClick={() => setRevision((value) => value + 1)}>
          Réessayer
        </button>
      </section>
    );

  if (!data)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement de votre espace…
      </div>
    );

  if (session.user.role === "STATION_CHIEF" && !data.station)
    return (
      <section className="admin-card admin-empty">
        <Building2 size={36} />
        <h2>Aucune station rattachée</h2>
        <p>Votre administrateur doit rattacher votre compte à une station.</p>
      </section>
    );

  return <Operations user={session.user} data={data} onChanged={() => setRevision((value) => value + 1)} />;
}
