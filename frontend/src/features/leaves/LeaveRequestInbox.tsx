import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/auth-api";
import type { LeaveReviewItem } from "../../domain/sprint4";
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Modal } from "../../ui/Modal";
import "./leaves.css";

type Decision = "APPROVED" | "REJECTED";

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

const leaveTypeLabel: Record<LeaveReviewItem["type"], string> = {
  ANNUAL: "Congé annuel",
  SICK: "Congé maladie",
  FAMILY: "Événement familial",
  UNPAID: "Congé sans solde",
  OTHER: "Autre absence planifiée",
};

export function LeaveRequestInbox() {
  const location = useLocation();
  const navigate = useNavigate();
  const targetId = new URLSearchParams(location.search).get("leave");
  const [requests, setRequests] = useState<LeaveReviewItem[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<LeaveReviewItem | null>(null);
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  const load = useCallback(() => {
    setError("");
    api<LeaveReviewItem[]>("/admin/leaves/pending")
      .then(setRequests)
      .catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => load(), [load, revision]);
  useEffect(() => {
    if (!requests || !targetId) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-leave-request-id="${CSS.escape(targetId)}"]`,
        )
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [requests, targetId]);

  async function submitDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setDecisionError("");
    try {
      await api(
        `/admin/leaves/${encodeURIComponent(selected.id)}/decision`,
        { decision, reason },
        "PATCH",
      );
      setSelected(null);
      setRevision((value) => value + 1);
      if (targetId) navigate(location.pathname, { replace: true });
    } catch (cause) {
      setDecisionError(
        (cause as Error).message || "La décision n’a pas pu être enregistrée.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="leave-review" aria-labelledby="leave-review-title">
      <div className="leave-review-heading">
        <div>
          <span className="leave-eyebrow">À traiter</span>
          <h3 id="leave-review-title">Demandes de congé</h3>
          <p>
            Les périodes approuvées alimentent ensuite le suivi des
            remplacements.
          </p>
        </div>
        <span className="leave-count">{requests?.length ?? "—"}</span>
      </div>
      {error ? (
        <div className="leave-review-empty" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="admin-button secondary small"
            onClick={() => setRevision((value) => value + 1)}
          >
            Réessayer
          </button>
        </div>
      ) : requests === null ? (
        <div className="leave-review-empty" role="status">
          <ClockIcon size={19} /> Chargement des demandes…
        </div>
      ) : !requests.length ? (
        <div className="leave-review-empty">
          <CheckCircleIcon size={20} /> Aucune demande en attente.
        </div>
      ) : (
        <div className="leave-review-list">
          {requests.map((request) => (
            <article
              key={request.id}
              data-leave-request-id={request.id}
              className={`leave-review-item${request.id === targetId ? " is-target" : ""}`}
            >
              <div className="leave-review-person">
                <strong>{request.swapperName}</strong>
                <span>
                  {leaveTypeLabel[request.type]} ·{" "}
                  {dateLabel(request.startTime)} – {dateLabel(request.endTime)}
                </span>
                <p>{request.reason}</p>
              </div>
              <button
                type="button"
                className="admin-button secondary small"
                onClick={() => {
                  setSelected(request);
                  setDecision("APPROVED");
                  setReason("");
                  setDecisionError("");
                }}
              >
                Examiner
              </button>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!selected}
        size="md"
        title="Décider de la demande"
        subtitle={
          selected
            ? `${selected.swapperName} · ${leaveTypeLabel[selected.type]}`
            : undefined
        }
        onClose={() => !busy && setSelected(null)}
        footer={
          <>
            <button
              type="button"
              className="admin-button secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Retour
            </button>
            <button
              type="submit"
              form="leave-decision-form"
              className={`admin-button ${decision === "APPROVED" ? "primary-cta" : "danger"}`}
              disabled={busy}
            >
              {busy
                ? "Enregistrement…"
                : decision === "APPROVED"
                  ? "Approuver le congé"
                  : "Refuser la demande"}
            </button>
          </>
        }
      >
        {selected && (
          <form
            id="leave-decision-form"
            className="leave-request-form"
            onSubmit={(event) => void submitDecision(event)}
          >
            <div className="leave-review-summary">
              <CalendarBlankIcon size={18} />
              <span>
                Du {dateLabel(selected.startTime)} au{" "}
                {dateLabel(selected.endTime)}
              </span>
            </div>
            <p className="leave-review-reason">{selected.reason}</p>
            <div
              className="leave-decision-options"
              role="group"
              aria-label="Décision"
            >
              <button
                type="button"
                aria-pressed={decision === "APPROVED"}
                onClick={() => setDecision("APPROVED")}
              >
                <CheckCircleIcon size={17} /> Approuver
              </button>
              <button
                type="button"
                aria-pressed={decision === "REJECTED"}
                onClick={() => setDecision("REJECTED")}
              >
                <XCircleIcon size={17} /> Refuser
              </button>
            </div>
            {decision === "REJECTED" && (
              <div className="leave-form-field">
                <label htmlFor="leave-rejection-reason">Motif du refus</label>
                <textarea
                  id="leave-rejection-reason"
                  rows={3}
                  minLength={5}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Expliquez brièvement la décision"
                />
              </div>
            )}
            {decisionError && (
              <p className="error-message" role="alert">
                {decisionError}
              </p>
            )}
          </form>
        )}
      </Modal>
    </section>
  );
}
