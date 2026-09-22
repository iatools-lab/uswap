import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import type { OperationData } from "../../features/operations/types";
import { SwapperPanel } from "../../features/supervision/SwapperPanel";
import { LoaderCircle } from "../../ui/icons";

export function SwapperLeavePage() {
  const { session, onAccessLost } = useSession();
  const [data, setData] = useState<OperationData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api<OperationData>("/workspace")
      .then((value) => active && setData(value))
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
  if (!data)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement de vos congés…
      </div>
    );

  return (
    <SwapperPanel
      user={session.user}
      data={data}
      onChanged={() => setRevision((value) => value + 1)}
    />
  );
}
