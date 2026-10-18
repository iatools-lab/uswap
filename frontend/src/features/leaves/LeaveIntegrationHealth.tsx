import { currentLocale } from "../../app/i18n";
import { translate } from "../../app/i18n";
import { useEffect, useState } from "react";
import {
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
  useEffect(() => {
    let active = true;
    const load = () => api<Health>("/admin/integrations/leaves").then(
      (value) => active && setHealth(value),
    ).catch(() => {});
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (!health) return null;
  const ok = health.status === "OPERATIONAL";
  return (
    <section
      className="leave-integration"
      aria-label={translate("Synchronisation des congés")}
    >
      <div className="leave-integration-main">
        <span className={`leave-integration-icon ${ok ? "ok" : "warning"}`}>
          {ok ? <CloudCheckIcon /> : <WarningCircleIcon />}
        </span>
        <div>
          <span className="leave-integration-eyebrow">{translate("Congés synchronisés")}</span>
          <h3>{ok ? "Demandes à jour" : "Échanges à vérifier"}</h3>
          <p>
            {ok
              ? "Les soldes et demandes reçus du service de congés sont disponibles."
              : "Certaines demandes n’ont pas encore été récupérées correctement."}
          </p>
          {health.lastSyncAt && (
            <small className="leave-integration-date">
              {translate("Dernière mise à jour réussie le")}{" "}
              {new Intl.DateTimeFormat(currentLocale(), {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(health.lastSyncAt))}
            </small>
          )}
        </div>
      </div>
      <div className="leave-integration-kpis">
        <KpiCard
          compact
          label={translate("Traités")}
          value={`${health.successRate}%`}
          progress={health.successRate}
          tone="green"
        />
        <KpiCard
          compact
          label={translate("À récupérer")}
          value={health.pending}
          tone={health.pending > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label={translate("En erreur")}
          value={health.failed}
          tone={health.failed > 0 ? "red" : "neutral"}
        />
      </div>
      <div className="leave-integration-actions">
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
              <CheckCircleIcon /> {" "}{translate("Aucun échange en anomalie. Les nouvelles demandes apparaîtront ici.")}</p>
          ) : (
            health.operations.map((item) => (
              <div key={item.id}>
                <span>{item.userName}</span>
                <small>
                  {item.action} {" "}{translate("·")}{" "}{item.attempts}{" "}
                  {item.attempts === 1 ? "tentative" : "tentatives"}
                </small>
                <em>{translate(item.status)}</em>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
