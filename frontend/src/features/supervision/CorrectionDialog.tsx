import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { LoaderCircle, UploadSimple, X } from "../../ui/icons";
import { formatDateTime } from "./format";
import type { MonitorRow, SupervisionProps } from "./types";
import "./supervision.css";

type Props = SupervisionProps & {
  row: MonitorRow;
  onCorrected: () => void;
  onClose: () => void;
};

const toLocalInput = (value: string | null) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function CorrectionDialog({ row, onCorrected, onClose }: Props) {
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [checkedIn, setCheckedIn] = useState(
    toLocalInput(row.checkedInAt ?? row.startTime),
  );
  const [checkedOut, setCheckedOut] = useState(
    toLocalInput(row.checkedOutAt ?? row.endTime),
  );
  const [isLate, setIsLate] = useState(row.isLate);
  const [isAbsent, setIsAbsent] = useState(row.status === "ABSENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);

  function showError(message: string) {
    setErrorKey((current) => current + 1);
    setError(message);
  }

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 3200);
    return () => window.clearTimeout(timer);
  }, [error]);

  function selectAttachment(nextFile: File | null) {
    setError("");
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!ALLOWED_ATTACHMENT_TYPES.has(nextFile.type)) {
      setFile(null);
      showError("Format non accepté. Choisissez un PDF, JPG, PNG ou WebP.");
      return;
    }
    if (nextFile.size > MAX_ATTACHMENT_SIZE) {
      setFile(null);
      showError("Le justificatif dépasse 5 Mo.");
      return;
    }
    setFile(nextFile);
  }

  useEffect(() => {
    if (isAbsent) setIsLate(false);
  }, [isAbsent]);

  async function submit() {
    if (reason.trim().length < 5) {
      showError(
        "Le motif de correction est obligatoire (5 caractères minimum).",
      );
      return;
    }
    if (!isAbsent && !checkedIn) {
      showError(
        "Indiquez l’heure de prise de service ou cochez « Absence justifiée ».",
      );
      return;
    }
    if (
      !isAbsent &&
      checkedOut &&
      checkedIn &&
      new Date(checkedOut).getTime() <= new Date(checkedIn).getTime()
    ) {
      showError("La fin de service doit suivre la prise de service.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let attachmentId: string | null = null;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const attachment = await api<{ id: string }>(
          "/corrections/attachments",
          form,
        );
        attachmentId = attachment.id;
      }
      await api(
        `/corrections/shifts/${row.shiftId}`,
        {
          reason: reason.trim(),
          attachmentId,
          checkedInAt: !isAbsent && checkedIn ? new Date(checkedIn).toISOString() : null,
          checkedOutAt: !isAbsent && checkedOut ? new Date(checkedOut).toISOString() : null,
          isLate,
          isAbsent,
          isJustified: isAbsent,
        },
        "PATCH",
      );
      notify("Pointage corrigé.");
      onCorrected();
    } catch (err) {
      showError(
        err instanceof ApiError && err.status === 413
          ? "Le justificatif dépasse 5 Mo."
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={busy ? () => undefined : onClose}
      title="Corriger le pointage"
      footer={
        <>
          <button
            type="button"
            className="admin-button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            type="button"
            className="admin-button primary-cta"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="correction-identity">
        <span className="correction-identity__eyebrow">Pointage concerné</span>
        <div className="correction-identity__main">
          <strong>{row.swapper.fullName}</strong>
          <time>{formatDateTime(row.startTime, row.station.timezone)}</time>
        </div>
      </div>

      <p className="operations-hint correction-hint">
        Les horaires reprennent automatiquement la période du shift. Le motif
        et le justificatif restent obligatoires.
      </p>

      {error && (
        <p key={errorKey} className="error-message" role="alert">
          {error}
        </p>
      )}

      <fieldset disabled={busy} className="ops-form correction-form">
        <div className="user-form-grid">
          <label>
            Début du shift
            <input
              type="datetime-local"
              value={checkedIn}
              onChange={(event) => setCheckedIn(event.target.value)}
            />
          </label>
          <label>
            Fin du shift
            <input
              type="datetime-local"
              value={checkedOut}
              onChange={(event) => setCheckedOut(event.target.value)}
            />
          </label>
        </div>

        <div className="supervision-attachment-row">
          <label className="ops-file correction-attachment">
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => {
                selectAttachment(event.currentTarget.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            <UploadSimple size={22} />
            <span>
              <strong>{file ? file.name : "Joindre un justificatif"}</strong>
              <small>PDF ou image · 5 Mo max · facultatif</small>
            </span>
          </label>
          {file && (
            <button
              type="button"
              className="supervision-attachment-remove"
              aria-label="Retirer le justificatif"
              title="Retirer le justificatif"
              onClick={() => {
                setFile(null);
                setError("");
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <label className="ops-field">
          Motif <span className="supervision-required">*</span>
          <textarea
            required
            minLength={5}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Pointage oublié, présence confirmée par le superviseur…"
          />
        </label>

        <div className="ops-toggles">
          <label className={isLate && !isAbsent ? "is-on" : ""}>
            <input
              type="checkbox"
              checked={isLate}
              onChange={(event) => setIsLate(event.target.checked)}
              disabled={isAbsent}
            />
            <span>
              <strong>En retard</strong>
            </span>
          </label>
          <label className={isAbsent ? "is-on is-alert" : ""}>
            <input
              type="checkbox"
              checked={isAbsent}
              onChange={(event) => setIsAbsent(event.target.checked)}
            />
            <span>
              <strong>Absence justifiée</strong>
            </span>
          </label>
        </div>
      </fieldset>
    </Modal>
  );
}
