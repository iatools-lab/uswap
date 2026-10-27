import { useEffect, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CloudCheckIcon,
  WarningCircleIcon,
} from "../../ui/icons";
import { api } from "../../api/auth-api";
import { KpiCard } from "../../ui/KpiCard";
import "./leaves.css";

type Health = {
  status: "OPERATIONAL" | "DEGRADED";
  lastSyncAt: string | null;
  pending: number;
  failed: number;
  successRate: number;
  operations: Array<{
    id: string;
    userName: string;
    action: string;
    status: string;
    queuedAt: string;
    attempts: number;
  }>;
};

export function LeaveIntegrationHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<Health>("/admin/integrations/leaves").then(
      (value) => active && setHealth(value),
    );
    return () => {
      active = false;
    };
  }, [revision]);
  if (!health) return null;
  const ok = health.status === "OPERATIONAL";
  return (
    <section
      className="leave-integration"
      aria-label="Synchronisation des congés"
    >
      <div className="leave-integration-main">
        <span className={`leave-integration-icon ${ok ? "ok" : "warning"}`}>
          {ok ? <CloudCheckIcon /> : <WarningCircleIcon />}
        </span>
        <div>
          <span className="leave-integration-eyebrow">Congés synchronisés</span>
          <h3>{ok ? "Demandes à jour" : "Échanges à vérifier"}</h3>
          <p>
            {ok
              ? "Les soldes et demandes reçus du service de congés sont disponibles."
              : "Certaines demandes n’ont pas encore été récupérées correctement."}
          </p>
          {health.lastSyncAt && (
            <small className="leave-integration-date">
              Dernière mise à jour réussie le{" "}
              {new Intl.DateTimeFormat("fr-FR", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Africa/Douala",
              }).format(new Date(health.lastSyncAt))}
            </small>
          )}
        </div>
      </div>
      <div className="leave-integration-kpis">
        <KpiCard
          compact
          label="Traités"
          value={`${health.successRate}%`}
          progress={health.successRate}
          tone="green"
        />
        <KpiCard
          compact
          label="À récupérer"
          value={health.pending}
          tone={health.pending > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label="En erreur"
          value={health.failed}
          tone={health.failed > 0 ? "red" : "neutral"}
        />
      </div>
      <div className="leave-integration-actions">
        <button
          className="admin-button secondary small"
          onClick={() => setRevision((value) => value + 1)}
        >
          <ArrowsClockwiseIcon />
          Actualiser
        </button>
        <button
          className="admin-button secondary small"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Masquer le journal" : "Voir le journal"}
        </button>
      </div>
      {expanded && (
        <div className="leave-integration-history">
          {health.operations.length === 0 ? (
            <p>
              <CheckCircleIcon /> Aucun échange en anomalie. Les nouvelles
              demandes apparaîtront ici.
            </p>
          ) : (
            health.operations.map((item) => (
              <div key={item.id}>
                <span>{item.userName}</span>
                <small>
                  {item.action} · {item.attempts}{" "}
                  {item.attempts === 1 ? "tentative" : "tentatives"}
                </small>
                <em>{item.status}</em>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
