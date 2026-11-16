import { useCallback, useEffect, useState } from "react";
import {
  BroomIcon,
  WarningIcon,
  ShieldCheckIcon,
  ClockCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
} from "../../ui/icons";
import { api } from "../../api/auth-api";
import { formatDateTime } from "../../utils/datetime";
import { notify } from "../../ui/Toast";
import { Modal } from "../../ui/Modal";
import { KpiCard } from "../../ui/KpiCard";
import "../../styles/data-cleanup.css";

type TargetId =
  | "PLANNINGS"
  | "ATTENDANCE"
  | "LEAVES"
  | "INCIDENTS"
  | "NOTIFICATIONS"
  | "AUDIT"
  | "ACCOUNTS"
  | "STATIONS"
  | "DEMO_ACCOUNTS";

type Target = {
  id: TargetId;
  label: string;
  description: string;
  destructive: boolean;
};

type Overview = {
  counts: Record<TargetId, number>;
  targets: Target[];
  /** Cibles qui suppriment des comptes ou des stations (données réelles). */
  sensitiveTargets?: TargetId[];
};

type Preview = {
  dryRun: boolean;
  executedAt: string;
  targets: {
    id: TargetId;
    label: string;
    affected: number;
    destructive: boolean;
    sensitive?: boolean;
  }[];
  total: number;
  requiresSensitiveConfirmation?: boolean;
  preservedAccount?: string | null;
  message: string;
};

type Result = {
  dryRun: boolean;
  executedAt: string;
  targets: { id: TargetId; label: string; deleted: number }[];
  total: number;
  message: string;
};

/**
 * Nettoyage des données — réservé au super administrateur.
 *
 * Deux familles de cibles cohabitent :
 *  - les **données de recette** (plannings, pointages, congés, incidents,
 *    notifications, journal) : un simple « EFFACER » suffit ;
 *  - les **données réelles** (comptes utilisateurs, stations) : elles existent
 *    en production. Le super administrateur doit pouvoir supprimer un compte
 *    ou une station même en ligne, d'où une confirmation distincte
 *    (« SUPPRIMER ») qui empêche d'effacer le réseau réel par inadvertance en
 *    vidant une recette.
 *
 * Parcours : sélection → simulation chiffrée → confirmation saisie au clavier.
 */
export function DataCleanupPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<TargetId[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [sensitiveConfirmation, setSensitiveConfirmation] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<Overview>("/super-admin/cleanup")
      .then((data) => {
        setOverview(data);
        setError("");
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(load, [load]);

  const sensitiveTargets =
    overview?.sensitiveTargets ?? (["ACCOUNTS", "STATIONS"] as TargetId[]);
  const hasSensitive = selected.some((id) => sensitiveTargets.includes(id));

  function toggle(id: TargetId) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setPreview(null);
  }

  async function simulate() {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await api<Preview>("/super-admin/cleanup/preview", {
          targets: selected,
        }),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setError("");
    try {
      const data = await api<Result>("/super-admin/cleanup", {
        targets: selected,
        dryRun: false,
        confirm: confirmation,
        ...(hasSensitive ? { confirmSensitive: sensitiveConfirmation } : {}),
      });
      setResult(data);
      setConfirmOpen(false);
      setConfirmation("");
      setSensitiveConfirmation("");
      setSelected([]);
      setPreview(null);
      notify("Nettoyage terminé.");
      load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!overview)
    return (
      <div className="admin-loading">
        {error || "Chargement des volumes de données…"}
      </div>
    );

  const totalSelected = selected.reduce(
    (sum, id) => sum + (overview.counts[id] ?? 0),
    0,
  );

  return (
    <div className="data-cleanup">
      <section className="data-cleanup__intro">
        <div>
          <span>Maintenance de la plateforme</span>
          <h2>Nettoyer ou supprimer des données</h2>
          <p>
            Nettoyez les données de recette (plannings, pointages, congés,
            incidents, notifications) pour repartir sur une configuration
            réelle, ou supprimez définitivement un compte ou une station — même
            en production. Une suppression de compte ou de station emporte tout
            ce qui en dépend : plannings, pointages, congés, incidents,
            notifications et journal d’audit. Votre propre compte est toujours
            conservé.
          </p>
        </div>
        <span className="data-cleanup__badge">
          <ShieldCheckIcon /> Super administrateur
        </span>
      </section>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="data-cleanup__kpis">
        <KpiCard
          compact
          label="Données sélectionnées"
          value={totalSelected}
          detail={`${selected.length} catégorie${selected.length === 1 ? "" : "s"}`}
          tone={totalSelected ? "amber" : "neutral"}
        />
        <KpiCard
          compact
          label="Plannings"
          value={overview.counts.PLANNINGS}
          detail="Créneaux et affectations inclus"
          tone="blue"
        />
        <KpiCard
          compact
          label="Comptes"
          value={overview.counts.ACCOUNTS}
          detail="Utilisateurs toutes fonctions"
          tone="neutral"
        />
        <KpiCard
          compact
          label="Stations"
          value={overview.counts.STATIONS}
          detail="Réseau et modèles de shift"
          tone="neutral"
        />
      </div>

      <section className="admin-card data-cleanup__panel">
        <header>
          <h3>Catégories à nettoyer</h3>
          <button
            type="button"
            className="text-button"
            onClick={load}
            disabled={busy}
          >
            <ArrowsClockwiseIcon size={15} /> Rafraîchir les volumes
          </button>
        </header>

        <ul className="data-cleanup__targets">
          {overview.targets.map((target) => (
            <li key={target.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(target.id)}
                  onChange={() => toggle(target.id)}
                  disabled={busy}
                />
                <span>
                  <strong>{target.label}</strong>
                  <small>{target.description}</small>
                </span>
                <span className="data-cleanup__count">
                  {overview.counts[target.id] ?? 0}
                </span>
              </label>
              {target.destructive && (
                <p className="data-cleanup__warning">
                  <WarningIcon size={14} /> Action irréversible
                </p>
              )}
              {sensitiveTargets.includes(target.id) && (
                <p className="data-cleanup__warning">
                  <WarningIcon size={14} /> Données de production : confirmation
                  « SUPPRIMER » requise
                </p>
              )}
            </li>
          ))}
        </ul>

        <footer className="data-cleanup__actions">
          <button
            type="button"
            className="admin-button secondary"
            disabled={busy || !selected.length}
            onClick={() => void simulate()}
          >
            Simuler le nettoyage
          </button>
          <button
            type="button"
            className="admin-button danger"
            disabled={busy || !selected.length}
            onClick={() => {
              setConfirmation("");
              setSensitiveConfirmation("");
              setConfirmOpen(true);
            }}
          >
            <BroomIcon size={16} /> Lancer le nettoyage
          </button>
        </footer>
      </section>

      {preview && (
        <section className="admin-card data-cleanup__preview">
          <header>
            <h3>Résultat de la simulation</h3>
            <span className="admin-badge draft">
              {formatDateTime(preview.executedAt)}
            </span>
          </header>
          <p className="planner-muted">{preview.message}</p>
          <table>
            <thead>
              <tr>
                <th>Catégorie</th>
                <th>Enregistrements concernés</th>
              </tr>
            </thead>
            <tbody>
              {preview.targets.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.label}
                    {row.sensitive ? " (production)" : ""}
                  </td>
                  <td>{row.affected}</td>
                </tr>
              ))}
              <tr className="is-total">
                <td>Total</td>
                <td>{preview.total}</td>
              </tr>
            </tbody>
          </table>
          {preview.preservedAccount && (
            <p className="planner-muted">
              Compte conservé : <strong>{preview.preservedAccount}</strong> (vous
              ne pouvez pas supprimer votre propre accès).
            </p>
          )}
        </section>
      )}

      {result && (
        <section className="admin-card data-cleanup__result" role="status">
          <header>
            <h3>
              <CheckIcon size={16} /> {result.message}
            </h3>
            <span className="admin-badge active">
              Exécuté le {formatDateTime(result.executedAt)}
            </span>
          </header>
          <ul>
            {result.targets.map((row) => (
              <li key={row.id}>
                <span>{row.label}</span>
                <strong>{row.deleted}</strong>
              </li>
            ))}
          </ul>
          <p className="planner-muted">
            <ClockCounterClockwiseIcon size={14} /> L’opération est enregistrée
            dans le journal
            d’audit et notifiée aux autres super administrateurs.
          </p>
        </section>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmer le nettoyage"
        subtitle="Cette action ne peut pas être annulée."
      >
        <div className="data-cleanup__confirm">
          <p>
            <strong>{totalSelected}</strong> enregistrement
            {totalSelected === 1 ? "" : "s"} seront définitivement supprimés
            dans {selected.length} catégorie{selected.length === 1 ? "" : "s"}.
          </p>
          {hasSensitive && (
            <p className="data-cleanup__warning">
              <WarningIcon size={14} /> Vous avez sélectionné une catégorie de
              production (comptes utilisateurs ou stations). Cette suppression
              est définitive et emporte l’historique associé.
            </p>
          )}
          <p>
            Saisissez <strong>EFFACER</strong> pour confirmer. Une sauvegarde de
            la base est recommandée avant de poursuivre.
          </p>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="EFFACER"
            autoFocus
            aria-label="Saisissez EFFACER pour confirmer"
          />
          {hasSensitive && (
            <>
              <p>
                Données de production : saisissez aussi{" "}
                <strong>SUPPRIMER</strong> pour confirmer la suppression des
                comptes et des stations.
              </p>
              <input
                value={sensitiveConfirmation}
                onChange={(event) => setSensitiveConfirmation(event.target.value)}
                placeholder="SUPPRIMER"
                aria-label="Saisissez SUPPRIMER pour confirmer la suppression en production"
              />
            </>
          )}
          <div className="data-cleanup__actions">
            <button
              type="button"
              className="admin-button secondary"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="admin-button danger"
              disabled={
                busy ||
                confirmation.trim().toUpperCase() !== "EFFACER" ||
                (hasSensitive &&
                  sensitiveConfirmation.trim().toUpperCase() !== "SUPPRIMER")
              }
              onClick={() => void execute()}
            >
              {busy ? "Nettoyage…" : "Supprimer définitivement"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
