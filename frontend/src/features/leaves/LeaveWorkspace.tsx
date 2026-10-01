import { useMemo, useState } from "react";
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type {
  LeaveRequestView,
  LeaveType,
  LeaveWorkspaceView,
} from "../../domain/sprint4";
import { createIdempotencyKey } from "../../domain/idempotency";
import { mockLeaveGateway } from "../../api/gateways/mock-leave-gateway";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import "./leaves.css";

const TYPES: Record<LeaveType, string> = {
  ANNUAL: "Congé annuel",
  SICK: "Congé maladie",
  FAMILY: "Événement familial",
  UNPAID: "Congé sans solde",
  OTHER: "Autre absence planifiée",
};
const STATUS: Record<
  LeaveRequestView["status"],
  { label: string; tone: string }
> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  QUEUED: { label: "À synchroniser", tone: "warning" },
  SYNCING: { label: "Synchronisation", tone: "info" },
  PENDING: { label: "En attente", tone: "warning" },
  APPROVED: { label: "Approuvé", tone: "success" },
  REJECTED: { label: "Refusé", tone: "danger" },
  CANCELLED: { label: "Annulé", tone: "neutral" },
  SYNC_FAILED: { label: "Échec de synchronisation", tone: "danger" },
};

const dateValue = (iso: string) => iso.slice(0, 10);
const displayDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

export function LeaveWorkspace({
  data,
  onChanged,
}: {
  data: LeaveWorkspaceView;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<LeaveRequestView | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState<LeaveRequestView | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const balance = data.balance;
  const usedPercent = Math.min(
    100,
    Math.round((balance.usedDays / balance.entitledDays) * 100),
  );
  const active = useMemo(
    () =>
      data.requests.filter(
        (item) => !["CANCELLED", "REJECTED"].includes(item.status),
      ),
    [data.requests],
  );

  async function cancel(request: LeaveRequestView) {
    setBusy(true);
    setError("");
    try {
      await mockLeaveGateway.cancel(
        request.id,
        createIdempotencyKey("leave-cancel"),
      );
      setCancelTarget(null);
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leave-workspace">
      <header className="leave-hero">
        <div>
          <span className="leave-eyebrow">Espace congés</span>
          <h2>Organisez vos absences sereinement</h2>
          <p>
            Consultez votre solde synchronisé, transmettez une demande et suivez
            chaque décision au même endroit.
          </p>
        </div>
        <button className="leave-primary" onClick={() => setEditing(null)}>
          <PlusIcon weight="bold" /> Nouvelle demande
        </button>
      </header>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <section className="leave-kpis" aria-label="Synthèse de vos congés">
        <article className="leave-balance-card">
          <div
            className="leave-donut"
            style={
              { "--progress": `${usedPercent * 3.6}deg` } as React.CSSProperties
            }
          >
            <div>
              <strong>{balance.remainingDays}</strong>
              <span>jours</span>
            </div>
          </div>
          <div>
            <span className="leave-kpi-label">Solde disponible</span>
            <h3>
              {balance.remainingDays} jours sur {balance.entitledDays}
            </h3>
            <p>{balance.usedDays} jours consommés cette année</p>
          </div>
        </article>
        <article className="leave-kpi-card amber">
          <ClockIcon />
          <div>
            <strong>{balance.pendingDays}</strong>
            <span>jours en attente de décision</span>
          </div>
        </article>
        <article
          className={`leave-kpi-card ${data.integration.available ? "green" : "red"}`}
        >
          {data.integration.available ? (
            <CheckCircleIcon />
          ) : (
            <WarningCircleIcon />
          )}
          <div>
            <strong>
              {data.integration.available ? "À jour" : "Action requise"}
            </strong>
            <span>
              {data.integration.pendingOperations
                ? `${data.integration.pendingOperations} opération(s) à reprendre`
                : `Synchronisé à ${new Date(data.integration.lastSuccessfulSyncAt ?? Date.now()).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
            </span>
          </div>
        </article>
      </section>

      <section className="leave-list-card">
        <div className="leave-section-head">
          <div>
            <h3>Mes demandes</h3>
            <p>{active.length} demande(s) active(s) · historique conservé</p>
          </div>
          <span className="leave-count">{data.requests.length}</span>
        </div>
        {data.requests.length === 0 ? (
          <div className="leave-empty">
            <CalendarBlankIcon />
            <h4>Aucune demande</h4>
            <p>Votre prochaine demande apparaîtra ici.</p>
          </div>
        ) : (
          <div className="leave-request-list">
            {data.requests.map((request) => {
              const status = STATUS[request.status];
              return (
                <article className="leave-request" key={request.id}>
                  <div className={`leave-status-rail ${status.tone}`} />
                  <div className="leave-request-main">
                    <div className="leave-request-title">
                      <strong>{TYPES[request.type]}</strong>
                      <span className={`leave-status ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <p>{request.reason}</p>
                    <div className="leave-period">
                      <CalendarBlankIcon /> Du {displayDate(request.startTime)}{" "}
                      au {displayDate(request.endTime)}
                    </div>
                  </div>
                  <div className="leave-request-meta">
                    <small>Mis à jour</small>
                    <span>{displayDate(request.updatedAt)}</span>
                    {request.syncStatus === "SYNCED" && (
                      <em>
                        <CheckCircleIcon /> Synchronisé
                      </em>
                    )}
                  </div>
                  {(request.editable || request.cancellable) && (
                    <div className="leave-actions">
                      {request.editable && (
                        <button
                          onClick={() => setEditing(request)}
                          aria-label="Modifier la demande"
                        >
                          <PencilSimpleIcon /> Modifier
                        </button>
                      )}
                      {request.cancellable && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => setCancelTarget(request)}
                        >
                          <XCircleIcon /> Annuler
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <LeaveEditor
        key={editing?.id ?? (editing === null ? "new" : "closed")}
        open={editing !== undefined}
        request={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          onChanged();
        }}
      />
      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => !busy && setCancelTarget(null)}
        title="Annuler cette demande ?"
        subtitle={
          cancelTarget
            ? `${TYPES[cancelTarget.type]} · du ${displayDate(cancelTarget.startTime)} au ${displayDate(cancelTarget.endTime)}`
            : undefined
        }
        footer={
          <>
            <button
              className="admin-button secondary"
              disabled={busy}
              onClick={() => setCancelTarget(null)}
            >
              Conserver la demande
            </button>
            <button
              className="admin-button danger"
              disabled={busy || !cancelTarget}
              onClick={() => cancelTarget && void cancel(cancelTarget)}
            >
              {busy && <SpinnerGapIcon className="spin" />}
              Confirmer l’annulation
            </button>
          </>
        }
      >
        <div className="leave-cancel-confirmation">
          <WarningCircleIcon aria-hidden="true" />
          <p>
            La demande sera marquée comme annulée et votre disponibilité sera
            resynchronisée avec le planning. Cette action restera visible dans
            votre historique.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function LeaveEditor({
  open,
  request,
  onClose,
  onSaved,
}: {
  open: boolean;
  request: LeaveRequestView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [type, setType] = useState<LeaveType>(request?.type ?? "ANNUAL");
  const [start, setStart] = useState(
    request ? dateValue(request.startTime) : "",
  );
  const [end, setEnd] = useState(request ? dateValue(request.endTime) : "");
  const [reason, setReason] = useState(request?.reason ?? "");
  // Le composant est remonté à chaque ouverture : aucun formulaire neuf n'est prérempli.
  async function submit() {
    setBusy(true);
    setError("");
    const command = {
      type,
      startTime: `${start}T00:00:00.000Z`,
      endTime: `${end}T23:59:59.000Z`,
      reason,
      attachmentId: null,
      idempotencyKey: createIdempotencyKey(
        request ? "leave-update" : "leave-create",
      ),
    };
    try {
      request
        ? await mockLeaveGateway.update(request.id, command)
        : await mockLeaveGateway.create(command);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={request ? "Modifier ma demande" : "Nouvelle demande de congé"}
      subtitle="La demande sera synchronisée avec le service RH et prise en compte dans le planning."
      footer={
        <>
          <button className="admin-button secondary" onClick={onClose}>
            Fermer
          </button>
          <button
            className="admin-button primary-cta"
            disabled={busy || !start || !end || reason.trim().length < 8}
            onClick={() => void submit()}
          >
            {busy && <SpinnerGapIcon className="spin" />}{" "}
            {request ? "Enregistrer" : "Transmettre la demande"}
          </button>
        </>
      }
    >
      <div className="leave-form">
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <label>
          <span>Type de congé</span>
          <Select
            value={type}
            ariaLabel="Type de congé"
            onChange={(value) => setType(value as LeaveType)}
            options={Object.entries(TYPES).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </label>
        <div className="leave-form-row">
          <label>
            <span>Premier jour</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            <span>Dernier jour</span>
            <input
              type="date"
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label>
          <span>Motif</span>
          <textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Expliquez brièvement le contexte de votre demande…"
          />
        </label>
        <div className="leave-form-note">
          <CheckCircleIcon />
          <p>
            <strong>Contrôle automatique</strong>
            <br />
            Les chevauchements sont vérifiés et un congé approuvé bloque toute
            nouvelle affectation sur la période.
          </p>
        </div>
      </div>
    </Modal>
  );
}
