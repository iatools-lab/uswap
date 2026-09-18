import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { LoaderCircle, Warning } from "../../ui/icons";
import { formatDateTime } from "./format";
import {
  URGENCY_LABEL,
  type Candidate,
  type PendingReplacement,
} from "./types";
import "./supervision.css";

const ORIGIN_LABEL: Record<PendingReplacement["origin"], string> = {
  DECLARATION: "Déclaration du swappeur",
  AUTOMATIC_ABSENCE: "Absence automatique",
};

export function ReplacementQueue({
  onSelect,
}: {
  onSelect: (shiftId: string) => void;
}) {
  const [rows, setRows] = useState<PendingReplacement[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api<PendingReplacement[]>("/operations/replacements/pending")
      .then(setRows)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>File indisponible</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={load}>
          Réessayer
        </button>
      </section>
    );

  if (!rows)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement de la file…
      </div>
    );

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>Shifts à remplacer</h2>
          <p className="operations-hint">
            Absences sans remplaçant, classées par heure de début. Un élément
            disparaît dès que la couverture est rétablie.
          </p>
        </div>
        {!!rows.length && (
          <span className="admin-badge draft">{rows.length} à couvrir</span>
        )}
      </div>

      {!rows.length ? (
        <div className="admin-empty">
          <h3>Aucun shift à couvrir</h3>
          <p>
            Toutes les affectations publiées disposent d’un titulaire présent ou
            remplacé.
          </p>
        </div>
      ) : (
        <ul className="coverage-list">
          {rows.map((row) => (
            <li
              key={row.shiftId}
              className={`coverage-card coverage-card--${row.urgency.toLowerCase()}`}
            >
              <div className="coverage-card__meta">
                <span
                  className={`urgency-flag urgency-flag--${row.urgency.toLowerCase()}`}
                >
                  {row.urgency === "CRITICAL" && <Warning size={13} />}
                  {URGENCY_LABEL[row.urgency]}
                </span>
                <strong>{row.swapper.fullName}</strong>
                <span>
                  {row.station.name}
                  {row.template ? ` · ${row.template}` : ""}
                </span>
                <time dateTime={row.startTime}>
                  {formatDateTime(row.startTime, row.station.timezone)}
                </time>
                <span className="supervision-origin">
                  {ORIGIN_LABEL[row.origin]}
                  {row.reason ? ` · ${row.reason}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="admin-button"
                onClick={() => onSelect(row.shiftId)}
              >
                Affecter
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReplacementDialog({
  shiftId,
  onClose,
  onReplaced,
}: {
  shiftId: string;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCandidates(null);
    api<{ candidates: Candidate[] }>(`/operations/shifts/${shiftId}/candidates`)
      .then((data) => setCandidates(data.candidates ?? []))
      .catch((err) => setError((err as Error).message));
  }, [shiftId]);

  async function submit() {
    if (!selected) {
      setError("Sélectionnez un remplaçant.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/operations/shifts/${shiftId}/replacement`, {
        swapperId: selected,
        reason: reason.trim() || undefined,
      });
      notify("Remplacement confirmé.");
      onReplaced();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={busy ? () => undefined : onClose}
      title="Affecter un remplaçant"
      subtitle="Les contraintes sont contrôlées avant confirmation. Le superviseur décide seul."
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
            disabled={busy || !selected}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            Confirmer
          </button>
        </>
      }
    >
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {!candidates ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" />
          Évaluation des contraintes…
        </div>
      ) : !candidates.length ? (
        <div className="admin-empty">
          <h3>Aucun swappeur actif disponible</h3>
        </div>
      ) : (
        <>
          <label className="coverage-search">
            <span className="sr-only">Rechercher un swappeur</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher par nom ou e-mail"
            />
          </label>
          <div className="supervision-candidate-list" role="radiogroup">
            {candidates
              .filter((candidate) => {
                const haystack =
                  `${candidate.fullName} ${candidate.email}`.toLowerCase();
                return haystack.includes(query.trim().toLowerCase());
              })
              .sort((a, b) => Number(b.eligible) - Number(a.eligible))
              .map((candidate) => {
            const classes = [
              "supervision-candidate",
              candidate.id === selected
                ? "supervision-candidate--selected"
                : "",
              candidate.eligible ? "" : "supervision-candidate--blocked",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <label key={candidate.id} className={classes}>
                <input
                  type="radio"
                  name="replacement"
                  value={candidate.id}
                  checked={selected === candidate.id}
                  disabled={!candidate.eligible}
                  onChange={() => setSelected(candidate.id)}
                />
                <span>
                  <strong>{candidate.fullName}</strong>
                  <small>{candidate.email}</small>
                </span>
                <span>
                  <span
                    className={`attendance-status ${
                      candidate.eligible
                        ? "attendance-status--present"
                        : "attendance-status--absent"
                    }`}
                  >
                    {candidate.eligible ? "Disponible" : "Incompatible"}
                  </span>
                  {!!candidate.issues.length && (
                    <ul className="supervision-candidate__issues">
                      {candidate.issues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  )}
                </span>
              </label>
            );
            })}
          </div>
        </>
      )}

      <label className="ops-field">
        Motif (optionnel)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Absence couverte, renfort ponctuel…"
        />
      </label>
    </Modal>
  );
}
