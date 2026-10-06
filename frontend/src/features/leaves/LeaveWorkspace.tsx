import { useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarBlankIcon,
  ClockIcon,
  PlusIcon,
  PencilSimpleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { mockLeaveGateway } from "../../api/gateways/mock-leave-gateway";
import type {
  LeaveRequestInput,
  LeaveRequestView,
  LeaveWorkspaceView,
} from "../../domain/sprint4";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import { notify } from "../../ui/Toast";
import "./leaves.css";

const TYPES: Record<LeaveRequestView["type"], string> = {
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

const displayDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

export function LeaveWorkspace({
  data,
  onChanged,
}: {
  data: LeaveWorkspaceView;
  onChanged?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const targetLeaveId = new URLSearchParams(location.search).get("leave");
  const [editing, setEditing] = useState<LeaveRequestView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequestView | null>(
    null,
  );
  const [form, setForm] = useState<LeaveRequestInput>({
    startDate: "",
    endDate: "",
    type: "ANNUAL",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [cancelError, setCancelError] = useState("");
  const balance = data.balance;
  const usedPercent = Math.min(
    100,
    Math.round((balance.usedDays / balance.entitledDays) * 100),
  );
  const pendingRequests = useMemo(
    () => data.requests.filter((item) => item.status === "PENDING"),
    [data.requests],
  );
  const visibleRequests = targetLeaveId
    ? data.requests.filter((request) => request.id === targetLeaveId)
    : data.requests;
  const dayCount = (start: string, end: string) => {
    if (!start || !end || end < start) return 0;
    return (
      Math.round(
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
          86_400_000,
      ) + 1
    );
  };
  const requestedDays = dayCount(form.startDate, form.endDate);
  const editingDays = editing
    ? dayCount(editing.startTime.slice(0, 10), editing.endTime.slice(0, 10))
    : 0;
  const availableForRequest = Math.max(
    0,
    data.balance.remainingDays - data.balance.pendingDays + editingDays,
  );

  function openForm(request?: LeaveRequestView) {
    setEditing(request ?? null);
    setForm(
      request
        ? {
            startDate: request.startTime.slice(0, 10),
            endDate: request.endTime.slice(0, 10),
            type: request.type,
            reason: request.reason,
          }
        : { startDate: "", endDate: "", type: "ANNUAL", reason: "" },
    );
    setFormError("");
    setFormOpen(true);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!form.startDate || !form.endDate || !requestedDays) {
      setFormError("Choisissez une période valide.");
      return;
    }
    if (form.reason.trim().length < 8) {
      setFormError(
        "Précisez le motif de votre demande (8 caractères minimum).",
      );
      return;
    }
    if (requestedDays > availableForRequest) {
      setFormError(
        `Votre solde disponible ne couvre pas cette demande (${availableForRequest} jour${availableForRequest > 1 ? "s" : ""} disponible${availableForRequest > 1 ? "s" : ""}).`,
      );
      return;
    }
    setBusy(true);
    try {
      if (editing) await mockLeaveGateway.updateRequest(editing.id, form);
      else await mockLeaveGateway.submitRequest(form);
      setFormOpen(false);
      setEditing(null);
      notify(
        editing
          ? "Votre demande a été mise à jour."
          : "Votre demande de congé a été envoyée.",
      );
      onChanged?.();
    } catch (error) {
      setFormError(
        (error as Error).message || "La demande n’a pas pu être enregistrée.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!cancelTarget) return;
    setBusy(true);
    setCancelError("");
    try {
      await mockLeaveGateway.cancelRequest(cancelTarget.id);
      setCancelTarget(null);
      onChanged?.();
    } catch (error) {
      setCancelError(
        (error as Error).message || "La demande n’a pas pu être annulée.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leave-workspace">
      <header className="leave-hero">
        <div>
          <span className="leave-eyebrow">Espace congés</span>
          <h2>Solde et suivi de vos congés</h2>
          <p>
            Consultez votre solde, envoyez une demande et suivez sa décision.
          </p>
        </div>
        <button
          type="button"
          className="admin-button primary-cta"
          onClick={() => openForm()}
        >
          <PlusIcon size={17} weight="bold" /> Demander un congé
        </button>
      </header>

      {targetLeaveId && (
        <div className="attendance-target-notice" role="status">
          <span>Demande de congé concernée par la notification</span>
          <button
            type="button"
            className="text-button"
            onClick={() => navigate(location.pathname, { replace: true })}
          >
            Voir toutes les demandes
          </button>
        </div>
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
        <article className="leave-kpi-card blue">
          <CalendarBlankIcon />
          <div>
            <strong>{pendingRequests.length}</strong>
            <span>
              demande{pendingRequests.length === 1 ? "" : "s"} à traiter
            </span>
          </div>
        </article>
      </section>

      <section className="leave-list-card">
        <div className="leave-section-head">
          <div>
            <h3>Suivi des demandes</h3>
            <p>
              Vos demandes, leurs périodes et chaque décision au même endroit.
            </p>
          </div>
          <span className="leave-count">{data.requests.length}</span>
        </div>
        {visibleRequests.length === 0 ? (
          <div className="leave-empty">
            <CalendarBlankIcon />
            <h4>
              {targetLeaveId
                ? "Cette demande n’est plus disponible"
                : "Aucun congé enregistré"}
            </h4>
            {!targetLeaveId && (
              <p>Vos demandes envoyées apparaîtront ici avec leur statut.</p>
            )}
          </div>
        ) : (
          <div className="leave-request-list">
            {visibleRequests.map((request) => {
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
                    {request.decisionReason &&
                      request.status === "REJECTED" && (
                        <p className="leave-decision-note">
                          Motif du refus : {request.decisionReason}
                        </p>
                      )}
                  </div>
                  <div className="leave-request-meta">
                    <small>Mis à jour</small>
                    <span>{displayDate(request.updatedAt)}</span>
                    {request.editable && (
                      <button
                        type="button"
                        className="leave-inline-action"
                        onClick={() => openForm(request)}
                      >
                        <PencilSimpleIcon size={15} /> Modifier
                      </button>
                    )}
                    {request.cancellable && (
                      <button
                        type="button"
                        className="leave-inline-action is-danger"
                        onClick={() => {
                          setCancelError("");
                          setCancelTarget(request);
                        }}
                      >
                        <XCircleIcon size={15} /> Annuler
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={formOpen}
        size="md"
        title={editing ? "Modifier la demande" : "Demander un congé"}
        subtitle="Votre demande sera transmise à l’administration pour décision."
        onClose={() => !busy && setFormOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="admin-button secondary"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              Annuler
            </button>
            <button
              type="submit"
              form="leave-request-form"
              className="admin-button primary-cta"
              disabled={
                busy || !requestedDays || requestedDays > availableForRequest
              }
            >
              {busy
                ? "Enregistrement…"
                : editing
                  ? "Enregistrer"
                  : "Envoyer la demande"}
            </button>
          </>
        }
      >
        <form
          id="leave-request-form"
          className="leave-request-form"
          onSubmit={(event) => void submitRequest(event)}
        >
          <div className="leave-form-field">
            <span>Type de congé</span>
            <Select
              value={form.type}
              ariaLabel="Type de congé"
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  type: String(value) as LeaveRequestInput["type"],
                }))
              }
              options={Object.entries(TYPES).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
          <div className="leave-form-dates">
            <div className="leave-form-field">
              <label htmlFor="leave-start">Du</label>
              <input
                id="leave-start"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                required
                value={form.startDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="leave-form-field">
              <label htmlFor="leave-end">Au</label>
              <input
                id="leave-end"
                type="date"
                min={form.startDate || new Date().toISOString().slice(0, 10)}
                required
                value={form.endDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          {requestedDays > 0 && (
            <p className="leave-days-hint">
              {requestedDays} jour{requestedDays > 1 ? "s" : ""} demandé
              {requestedDays > 1 ? "s" : ""} · {availableForRequest} disponible
              {availableForRequest > 1 ? "s" : ""}
            </p>
          )}
          <div className="leave-form-field">
            <label htmlFor="leave-reason">Motif</label>
            <textarea
              id="leave-reason"
              rows={4}
              minLength={8}
              maxLength={500}
              required
              value={form.reason}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              placeholder="Précisez brièvement le motif de votre demande"
            />
          </div>
          {formError && (
            <p className="error-message" role="alert">
              {formError}
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={!!cancelTarget}
        size="md"
        title="Annuler cette demande ?"
        subtitle="Elle restera visible dans votre historique avec le statut Annulé."
        onClose={() => !busy && setCancelTarget(null)}
        footer={
          <>
            <button
              type="button"
              className="admin-button secondary"
              disabled={busy}
              onClick={() => setCancelTarget(null)}
            >
              Garder la demande
            </button>
            <button
              type="button"
              className="admin-button danger"
              disabled={busy}
              onClick={() => void cancelRequest()}
            >
              {busy ? "Annulation…" : "Confirmer l’annulation"}
            </button>
          </>
        }
      >
        {cancelError && (
          <p className="error-message" role="alert">
            {cancelError}
          </p>
        )}
        {cancelTarget && (
          <p>
            {TYPES[cancelTarget.type]} · du{" "}
            {displayDate(cancelTarget.startTime)} au{" "}
            {displayDate(cancelTarget.endTime)}
          </p>
        )}
      </Modal>
    </div>
  );
}
