import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { UserDetail } from "../../features/users/UserDetail";
import { LoaderCircle, RefreshCw } from "../../ui/icons";

export function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { onAccessLost } = useSession();
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoadError("");
    api<{ id: string; name: string }[]>("/stations")
      .then((data) => {
        if (!active) return;
        setStations(data);
        setReady(true);
      })
      .catch((errorData) => {
        if (!active) return;
        if (errorData instanceof ApiError && [401, 403].includes(errorData.status)) onAccessLost();
        else setLoadError("Les stations n’ont pas pu être chargées. Réessayez.");
      });
    return () => {
      active = false;
    };
  }, [onAccessLost, revision]);

  if (!id) return null;
  if (loadError)
    return (
      <div className="admin-card admin-empty" role="alert">
        <RefreshCw size={25} />
        <h2>Chargement indisponible</h2>
        <p>{loadError}</p>
        <button className="admin-button" onClick={() => setRevision((value) => value + 1)}>
          Réessayer
        </button>
      </div>
    );

  if (!ready)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" size={24} />
        Chargement de la fiche…
      </div>
    );

  return (
    <UserDetail
      key={id}
      id={id}
      stations={stations}
      onBack={() => navigate("/app/admin/utilisateurs")}
      onChanged={() => {}}
    />
  );
}
