import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { LoaderCircle, UploadSimple } from "../../ui/icons";
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

export function CorrectionDialog({ row, onCorrected, onClose }: Props) {
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [checkedIn, setCheckedIn] = useState(toLocalInput(row.checkedInAt));
  const [checkedOut, setCheckedOut] = useState(toLocalInput(row.checkedOutAt));
  const [isLate, setIsLate] = useState(row.isLate);
  const [isAbsent, setIsAbsent] = useState(row.status === "ABSENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAbsent) {
      setCheckedIn("");
      setCheckedOut("");
      setIsLate(false);
    }
  }, [isAbsent]);

  async function submit() {
    if (reason.trim().length < 5) {
      setError(
        "Le motif de correction est obligatoire (5 caractères minimum).",
      );
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
          checkedInAt: checkedIn ? new Date(checkedIn).toISOString() : null,
          checkedOutAt: checkedOut ? new Date(checkedOut).toISOString() : null,
          isLate,
          isAbsent,
          isJustified: isAbsent,
        },
        "PATCH",
      );
      notify("Pointage corrigé.");
      onCorrected();
    } catch (err) {
      setError(
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
      subtitle={`${row.swapper.fullName} · ${formatDateTime(row.startTime, row.station.timezone)}`}
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
      <p className="operations-hint">
        Le motif est obligatoire. Vous pouvez joindre un justificatif si la
        correction en nécessite un. L’ancienne valeur reste dans l’audit ; le
        swappeur et le chef de station sont notifiés.
      </p>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <fieldset disabled={busy} className="ops-form">
        <div className="user-form-grid">
          <label>
            Début de service
            <input
              type="datetime-local"
              value={checkedIn}
              onChange={(event) => setCheckedIn(event.target.value)}
            />
          </label>
          <label>
            Fin de service
            <input
              type="datetime-local"
              value={checkedOut}
              onChange={(event) => setCheckedOut(event.target.value)}
            />
          </label>
        </div>

        <label className="ops-file">
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <UploadSimple size={22} />
          <span>
            <strong>{file ? file.name : "Joindre un justificatif"}</strong>
            <small>PDF ou image · 5 Mo max · facultatif</small>
          </span>
        </label>

        <label className="ops-field">
          Motif <span className="supervision-required">*</span>
          <textarea
            required
            minLength={5}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Pointage oublié, présence confirmée par le chef de station…"
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
              <small>Conserver le statut de retard</small>
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
              <small>Remplace le statut automatique</small>
            </span>
          </label>
        </div>
      </fieldset>
    </Modal>
  );
}
