import { translate } from "../../app/i18n";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { LoaderCircle, Warning } from "../../ui/icons";
import { formatDateTime } from "./format";
import { ExportExcelButton } from "../../ui/ExportExcelButton";
import { exportToExcel } from "../../utils/excelExport";
import {
  URGENCY_LABEL,
  type Candidate,
  type PendingReplacement,
} from "./types";
import "./supervision.css";

const ORIGIN_LABEL: Record<PendingReplacement["origin"], string> = {
  DECLARATION: "Signalée par le swappeur",
  AUTOMATIC_ABSENCE: "Détectée automatiquement",
  APPROVED_LEAVE: "Déclenchée par un congé approuvé",
};

const cleanReason = (row: PendingReplacement) =>
  (row.reason || "Couverture requise")
    .replace(/^Absence automatique\s*:\s*/i, "")
    .replace(/^./, (letter) => letter.toUpperCase());

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
        <h2>{translate("File indisponible")}</h2>
        <p>{error}</p>
        <button className="admin-button" onClick={load}>
          {translate("Réessayer")}</button>
      </section>
    );

  if (!rows)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        {translate("Chargement de la file…")}</div>
    );

  const queueRows = rows;
  function exportQueue() {
    if (!queueRows.length) return;
    exportToExcel({
      data: queueRows,
      filename: `uswap-shifts-a-couvrir-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "À couvrir",
      columns: [
        { header: translate("Swappeur remplacé"), key: (row) => row.swapper.fullName, width: 24 },
        { header: translate("Station"), key: (row) => row.station.name, width: 24 },
        { header: translate("Shift"), key: (row) => translate(row.template ?? "—"), width: 18 },
        { header: translate("Début"), key: (row) => formatDateTime(row.startTime, row.station.timezone), width: 22 },
        { header: translate("Fin"), key: (row) => formatDateTime(row.endTime, row.station.timezone), width: 22 },
        { header: translate("Urgence"), key: (row) => translate(URGENCY_LABEL[row.urgency]), width: 18 },
        { header: translate("Origine"), key: (row) => translate(ORIGIN_LABEL[row.origin]), width: 30 },
        { header: translate("Motif"), key: (row) => cleanReason(row), width: 40 },
        { header: translate("Signalé le"), key: (row) => row.reportedAt ? formatDateTime(row.reportedAt, row.station.timezone) : "—", width: 22 },
      ],
    });
  }

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>{translate("Shifts à remplacer")}</h2>
          <p className="operations-hint">
            {translate("Absences sans remplaçant, classées par heure de début. Un élément disparaît dès que la couverture est rétablie.")}</p>
        </div>
        {!!rows.length && (
          <div className="replacement-queue__actions">
            <span className="admin-badge draft">{rows.length} {" "}{translate("à couvrir")}</span>
            <ExportExcelButton onClick={exportQueue} />
          </div>
        )}
      </div>

      <details className="coverage-process">
        <summary>{translate("Comment cette file fonctionne-t-elle ?")}</summary>
        <ol>
          <li>
            {translate("Une absence est signalée, détectée après un pointage manquant ou issue d’un congé approuvé.")}</li>
          <li>
            {translate("Le shift rejoint cette file tant qu’aucun remplaçant compatible n’est confirmé.")}</li>
          <li>
            {translate("« Affecter » propose les swappeurs actifs du réseau et vérifie leurs contraintes, y compris pour un renfort entre stations.")}</li>
          <li>
            {translate("Après confirmation, les deux swappeurs sont notifiés et le shift disparaît de la file.")}</li>
        </ol>
      </details>

      {!rows.length ? (
        <div className="admin-empty">
          <h3>{translate("Aucun shift à couvrir")}</h3>
          <p>
            {translate("Toutes les affectations publiées disposent d’un titulaire présent ou remplacé.")}</p>
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
                  <strong>{ORIGIN_LABEL[row.origin]}</strong>
                  <span>{cleanReason(row)}</span>
                </span>
              </div>
              <button
                type="button"
                className="admin-button"
                onClick={() => onSelect(row.shiftId)}
              >
                {translate("Affecter")}</button>
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
      title={translate("Affecter un remplaçant")}
      subtitle={translate("Les contraintes sont contrôlées avant confirmation. Le superviseur décide seul.")}
      footer={
        <>
          <button
            type="button"
            className="admin-button secondary"
            onClick={onClose}
            disabled={busy}
          >
            {translate("Annuler")}</button>
          <button
            type="button"
            className="admin-button primary-cta"
            onClick={() => void submit()}
            disabled={busy || !selected}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {translate("Confirmer")}</button>
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
          {translate("Évaluation des contraintes…")}</div>
      ) : !candidates.length ? (
        <div className="admin-empty">
          <h3>{translate("Aucun swappeur actif disponible")}</h3>
        </div>
      ) : (
        <>
          <label className="coverage-search">
            <span className="sr-only">{translate("Rechercher un swappeur")}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate("Rechercher par nom ou e-mail")}
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
                      {candidate.homeStationName && (
                        <small>
                          {translate("Station de rattachement :")}{" "}{candidate.homeStationName}
                        </small>
                      )}
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
                            <li key={issue.code}>{translate(issue.message)}</li>
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
        {translate("Motif (optionnel)")}<input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={translate("Absence couverte, renfort ponctuel…")}
        />
      </label>
    </Modal>
  );
}
