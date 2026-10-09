import { useMemo, useState, type FormEvent } from "react";
import { ShieldWarningIcon } from "@phosphor-icons/react";
import { api, type User } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import { notify } from "../../ui/Toast";
import type { OperationShift } from "../operations/types";
import "./incidents.css";

const incidentCategories = [
  { value: "ATTENDANCE", label: "Présence ou ponctualité" },
  { value: "HEALTH", label: "Santé ou malaise" },
  { value: "SAFETY", label: "Sécurité du swappeur" },
  { value: "BEHAVIOR", label: "Comportement" },
  { value: "SCHEDULING", label: "Difficulté liée au planning" },
  { value: "OTHER", label: "Autre situation concernant un swappeur" },
];
const severities = [
  { value: "LOW", label: "Faible" },
  { value: "MEDIUM", label: "Modérée" },
  { value: "HIGH", label: "Élevée" },
  { value: "CRITICAL", label: "Critique" },
];

export function SwapperIncidentReport({
  user,
  shifts,
}: {
  user: User;
  shifts: OperationShift[];
}) {
  const [open, setOpen] = useState(false);
  const [stationId, setStationId] = useState(user.stationId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ATTENDANCE");
  const [severity, setSeverity] = useState("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stations = useMemo(() => {
    const values = new Map<string, string>();
    shifts.forEach((shift) => {
      if (shift.station.id) values.set(shift.station.id, shift.station.name);
    });
    if (user.stationId && !values.has(user.stationId)) {
      values.set(user.stationId, user.stationName ?? "Ma station");
    }
    return Array.from(values, ([id, label]) => ({ value: id, label }));
  }, [shifts, user.stationId, user.stationName]);
  const selectedStationId = stationId || stations[0]?.value || "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStationId) {
      setError("Choisissez la station concernée.");
      return;
    }
    if (title.trim().length < 5 || description.trim().length < 12) {
      setError("Ajoutez un objet et une description suffisamment précise.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/incidents", {
        stationId: selectedStationId,
        affectedSwapperId: user.id,
        title: title.trim(),
        description: description.trim(),
        category,
        severity,
        occurredAt: new Date().toISOString(),
      });
      notify("Votre signalement a été transmis au superviseur.");
      setOpen(false);
      setTitle("");
      setDescription("");
      setSeverity("MEDIUM");
      setCategory("ATTENDANCE");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="swapper-incident-entry"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <span className="swapper-incident-entry__icon">
          <ShieldWarningIcon size={19} />
        </span>
        <span className="swapper-incident-entry__copy">
          <strong>Signaler un incident</strong>
          <small>Un problème lié à votre service ou à votre sécurité ?</small>
        </span>
        <span className="swapper-incident-entry__action">Déclarer</span>
      </button>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Signaler un incident"
        subtitle="Décrivez une situation qui vous concerne. Votre superviseur pourra en assurer le suivi."
        footer={
          <>
            <button
              type="button"
              className="admin-button secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Annuler
            </button>
            <button
              type="submit"
              form="swapper-incident-report"
              className="admin-button primary-cta"
              disabled={
                busy ||
                !selectedStationId ||
                title.trim().length < 5 ||
                description.trim().length < 12
              }
            >
              {busy ? "Transmission…" : "Envoyer le signalement"}
            </button>
          </>
        }
      >
        <form
          id="swapper-incident-report"
          className="incident-form swapper-incident-form"
          onSubmit={(event) => void submit(event)}
        >
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          {stations.length > 1 ? (
            <label>
              <span>Station concernée</span>
              <Select
                value={selectedStationId}
                ariaLabel="Station concernée"
                onChange={(value) => setStationId(String(value))}
                options={stations}
              />
            </label>
          ) : (
            <div className="swapper-incident-self">
              <span>Déclarant</span>
              <strong>{user.fullName}</strong>
              <small>
                {stations[0]?.label ??
                  user.stationName ??
                  "Station à confirmer"}
              </small>
            </div>
          )}
          <div className="incident-form-row">
            <label>
              <span>Catégorie</span>
              <Select
                value={category}
                ariaLabel="Catégorie d’incident"
                onChange={(value) => setCategory(String(value))}
                options={incidentCategories}
              />
            </label>
            <label>
              <span>Gravité</span>
              <Select
                value={severity}
                ariaLabel="Gravité de l’incident"
                onChange={(value) => setSeverity(String(value))}
                options={severities}
              />
            </label>
          </div>
          <label>
            <span>Objet</span>
            <input
              required
              minLength={5}
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex. Malaise pendant le service"
            />
          </label>
          <label>
            <span>Décrivez la situation</span>
            <textarea
              required
              minLength={12}
              value={description}
              rows={5}
              maxLength={1200}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Précisez ce qui s’est passé et quand…"
            />
          </label>
          <small className="swapper-incident-private">
            Ce signalement concerne votre situation. Les informations seront
            transmises au superviseur.
          </small>
        </form>
      </Modal>
    </>
  );
}
