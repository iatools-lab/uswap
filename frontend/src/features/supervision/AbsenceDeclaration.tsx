import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { LoaderCircle, UploadSimple, Warning, X } from "../../ui/icons";
import { Select } from "../../ui/Select";
import { enqueue, startOutboxSync } from "../offline/outbox";
import { formatDateTime } from "./format";
import type { OperationShift } from "../operations/types";

export function AbsenceDeclaration({
  shifts,
  onDeclared,
}: {
  shifts: OperationShift[];
  onDeclared: () => void;
}) {
  const eligible = shifts.filter(
    (shift) => shift.publishedAt && Date.parse(shift.endTime) > Date.now(),
  );
  const [open, setOpen] = useState(false);
  const [shiftId, setShiftId] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const sync = () => setOnline(true);
    const drop = () => setOnline(false);
    window.addEventListener("online", sync);
    window.addEventListener("offline", drop);
    const stopSync = startOutboxSync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", drop);
      stopSync();
    };
  }, []);

  useEffect(() => {
    const requestedShift = new URLSearchParams(window.location.search).get(
      "absence",
    );
    if (!requestedShift) return;
    if (eligible.some((shift) => shift.id === requestedShift)) {
      setShiftId(requestedShift);
      setOpen(true);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [eligible]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!shiftId) {
      setError("Sélectionnez le shift concerné par l’absence.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Indiquez un motif.");
      return;
    }
    if (!file) {
      setError("Ajoutez une pièce justificative.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Le justificatif dépasse 5 Mo.");
      return;
    }
    setBusy(true);
    setError("");
    const clientRef =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = { shiftId, reason: reason.trim(), clientRef };
    try {
      if (!navigator.onLine) throw new ApiError(0, "hors connexion");
      const form = new FormData();
      form.append("file", file);
      const attachment = await api<{ id: string }>(
        "/operations/absences/attachments",
        form,
      );
      await api("/operations/absences", {
        ...payload,
        attachmentId: attachment.id,
      });
      reset();
      setOpen(false);
      notify("Absence déclarée.");
      onDeclared();
    } catch (err) {
      const network =
        err instanceof ApiError && (err.status === 0 || err.status >= 500);
      if (network) {
        await enqueue("/operations/absences", "POST", {
          ...payload,
          attachment: file,
        });
        reset();
        setError("");
        setOpen(false);
        notify(
          "Hors connexion : déclaration mise en file, elle sera transmise automatiquement.",
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setShiftId("");
    setReason("");
    setFile(null);
    setError("");
  }

  function close() {
    if (busy) return;
    reset();
    setOpen(false);
  }

  if (!eligible.length) return null;

  return (
    <>
      <section className="admin-card">
        <div className="ops-quick-action">
          <div>
            <h2>Absence imprévue</h2>
            <p>
              Prévenez l’exploitation tout de suite. Cela n’ouvre pas une
              demande de congé.
            </p>
          </div>
          <button
            type="button"
            className="admin-button secondary"
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            Signaler
          </button>
        </div>
      </section>

      <Modal
        open={open}
        onClose={close}
        title="Signaler une absence"
        subtitle="Indiquez le service concerné, le motif et joignez un justificatif."
        footer={
          <>
            <button
              type="button"
              className="admin-button secondary"
              onClick={close}
              disabled={busy}
            >
              Annuler
            </button>
            <button
              type="submit"
              form="absence-declaration"
              className="admin-button primary-cta"
              disabled={busy || !shiftId || !file}
            >
              {busy && <LoaderCircle className="spin" size={16} />}
              Envoyer
            </button>
          </>
        }
      >
        <form id="absence-declaration" onSubmit={submit}>
          {!online && (
            <p className="operations-offline" role="status">
              <Warning size={16} />
              Hors connexion : la déclaration partira dès le retour du réseau.
            </p>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy} className="ops-form">
            <label>
              Shift concerné
              <Select
                ariaLabel="Shift concerné"
                value={shiftId}
                placeholder="Sélectionner"
                onChange={(value) => setShiftId(String(value))}
                options={eligible.map((shift) => ({
                  value: shift.id,
                  label: `${shift.station?.name} · ${formatDateTime(shift.startTime)}`,
                }))}
              />
            </label>
            <label className="ops-field">
              Motif
              <input
                required
                minLength={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Maladie, imprévu personnel…"
              />
            </label>
            <div className="ops-file-row">
              <label className="ops-file">
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <UploadSimple size={22} />
                <span>
                  <strong>{file ? file.name : "Joindre un justificatif"}</strong>
                  <small>PDF ou image · 5 Mo max · obligatoire</small>
                </span>
              </label>
              {file && (
                <button
                  type="button"
                  className="ops-file-remove"
                  aria-label="Retirer le justificatif"
                  title="Retirer le justificatif"
                  onClick={() => setFile(null)}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </Modal>
    </>
  );
}
