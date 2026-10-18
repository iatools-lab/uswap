import { translate } from "../../app/i18n";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/auth-api";
import type { LeaveReviewItem } from "../../domain/sprint4";
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from "../../ui/icons";
import { Modal } from "../../ui/Modal";
import { formatDateRange } from "../../utils/french";
import "./leaves.css";

type Decision = "APPROVED" | "REJECTED";

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
          <span className="leave-eyebrow">{translate("À traiter")}</span>
          <h3 id="leave-review-title">{translate("Demandes de congé")}</h3>
          <p>
            {translate("Les périodes approuvées alimentent ensuite le suivi des remplacements.")}</p>
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
            {translate("Réessayer")}</button>
        </div>
      ) : requests === null ? (
        <div className="leave-review-empty" role="status">
          <ClockIcon size={19} /> {" "}{translate("Chargement des demandes…")}</div>
      ) : !requests.length ? (
        <div className="leave-review-empty">
          <CheckCircleIcon size={20} /> {" "}{translate("Aucune demande en attente.")}</div>
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
                  {translate(leaveTypeLabel[request.type])} {" "}{translate("·")}{" "}
                  {formatDateRange(request.startTime, request.endTime)}
                </span>
                <p>{translate(request.reason)}</p>
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
                {translate("Examiner")}</button>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!selected}
        size="md"
        title={translate("Décider de la demande")}
        subtitle={
          selected
            ? `${selected.swapperName} · ${translate(leaveTypeLabel[selected.type])}`
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
              {translate("Retour")}</button>
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
                {formatDateRange(selected.startTime, selected.endTime)}
              </span>
            </div>
            <p className="leave-review-reason">{translate(selected.reason)}</p>
            <div
              className="leave-decision-options"
              role="group"
              aria-label={translate("Décision")}
            >
              <button
                type="button"
                aria-pressed={decision === "APPROVED"}
                onClick={() => setDecision("APPROVED")}
              >
                <CheckCircleIcon size={17} /> {" "}{translate("Approuver")}</button>
              <button
                type="button"
                aria-pressed={decision === "REJECTED"}
                onClick={() => setDecision("REJECTED")}
              >
                <XCircleIcon size={17} /> {" "}{translate("Refuser")}</button>
            </div>
            {decision === "REJECTED" && (
              <div className="leave-form-field">
                <label htmlFor="leave-rejection-reason">{translate("Motif du refus")}</label>
                <textarea
                  id="leave-rejection-reason"
                  rows={3}
                  minLength={5}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={translate("Expliquez brièvement la décision")}
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
