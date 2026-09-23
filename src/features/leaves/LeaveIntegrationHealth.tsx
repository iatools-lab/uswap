import { useEffect, useState } from "react";
import { ArrowsClockwiseIcon, CheckCircleIcon, CloudCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import "./leaves.css";

type Health = {
  status: "OPERATIONAL" | "DEGRADED";
  lastSyncAt: string | null;
  pending: number;
  failed: number;
  successRate: number;
  operations: Array<{ id: string; userName: string; action: string; status: string; queuedAt: string; attempts: number }>;
};

export function LeaveIntegrationHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; api<Health>("/admin/integrations/leaves").then((value) => active && setHealth(value)); return () => { active = false; }; }, [revision]);
  if (!health) return null;
  const ok = health.status === "OPERATIONAL";
  return <section className="leave-integration" aria-label="Santé de la synchronisation des congés">
    <div className="leave-integration-main">
      <span className={`leave-integration-icon ${ok ? "ok" : "warning"}`}>{ok ? <CloudCheckIcon /> : <WarningCircleIcon />}</span>
      <div><span className="leave-integration-eyebrow">Service congés</span><h3>{ok ? "Synchronisation opérationnelle" : "Synchronisation à surveiller"}</h3><p>{health.lastSyncAt ? `Dernier échange réussi ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(health.lastSyncAt))}` : "En attente du premier échange"}</p></div>
    </div>
    <div className="leave-integration-kpis"><span><strong>{health.successRate}%</strong><small>réussite</small></span><span><strong>{health.pending}</strong><small>en attente</small></span><span><strong>{health.failed}</strong><small>en échec</small></span></div>
    <div className="leave-integration-actions"><button onClick={() => setRevision((v) => v + 1)} aria-label="Actualiser"><ArrowsClockwiseIcon /></button><button className="admin-button secondary small" onClick={() => setExpanded((v) => !v)}>{expanded ? "Masquer" : "Voir les échanges"}</button></div>
    {expanded && <div className="leave-integration-history">{health.operations.length === 0 ? <p><CheckCircleIcon /> Aucun échange en anomalie. Les nouvelles demandes apparaîtront ici.</p> : health.operations.map((item) => <div key={item.id}><span>{item.userName}</span><small>{item.action} · {item.attempts} tentative(s)</small><em>{item.status}</em></div>)}</div>}
  </section>;
}
