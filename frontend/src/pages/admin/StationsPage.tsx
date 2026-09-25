import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { StationManager, type StationData } from "../../features/stations/StationManager";
import { LoaderCircle, RefreshCw } from "../../ui/icons";

export function StationsPage() {
  const { onAccessLost } = useSession();
  const location = useLocation();
  const activeTab = new URLSearchParams(location.search).get("tab") === "map" ? "map" : "list";
  const [stations, setStations] = useState<StationData[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError("");
    api<StationData[]>("/stations")
      .then((data) => {
        if (active) setStations(data);
      })
      .catch((errorData) => {
        if (!active) return;
        if (errorData instanceof ApiError && [401, 403].includes(errorData.status)) onAccessLost();
        else setLoadError("Les données n’ont pas pu être chargées. Réessayez.");
      });
    return () => {
      active = false;
    };
  }, [onAccessLost, revision]);

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

  if (!stations)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" size={24} />
        Chargement des stations…
      </div>
    );

  return (
    <StationManager
      activeTab={activeTab}
      stations={stations}
      onChanged={() => setRevision((value) => value + 1)}
    />
  );
}
