import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { LoaderCircle, Warning } from "../../ui/icons";
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
  const [shiftId, setShiftId] = useState(
    eligible.length === 1 ? eligible[0].id : "",
  );
  const [reason, setReason] = useState("");
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
    setBusy(true);
    setError("");
    const clientRef =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = { shiftId, reason: reason.trim(), clientRef };
    try {
      if (!navigator.onLine) throw new ApiError(0, "hors connexion");
      await api("/operations/absences", payload);
      setReason("");
      setOpen(false);
      notify("Absence déclarée.");
      onDeclared();
    } catch (err) {
      const network =
        err instanceof ApiError && (err.status === 0 || err.status >= 500);
      if (network) {
        await enqueue("/operations/absences", "POST", payload);
        setReason("");
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
            onClick={() => setOpen(true)}
          >
            Signaler
          </button>
        </div>
      </section>

      <Modal
        open={open}
        onClose={busy ? () => undefined : () => setOpen(false)}
        title="Signaler une absence"
        subtitle="Shift concerné et motif obligatoires."
        footer={
          <>
            <button
              type="button"
              className="admin-button secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Annuler
            </button>
            <button
              type="submit"
              form="absence-declaration"
              className="admin-button primary-cta"
              disabled={busy || !shiftId}
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
          </fieldset>
        </form>
      </Modal>
    </>
  );
}
