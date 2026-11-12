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
};

type Preview = {
  dryRun: boolean;
  executedAt: string;
  targets: { id: TargetId; label: string; affected: number; destructive: boolean }[];
  total: number;
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
 * Nettoyage des données de recette — réservé au super administrateur.
 *
 * Le parcours est volontairement en trois temps : sélection → simulation
 * chiffrée → confirmation saisie au clavier. Rien n'est supprimé tant que le
 * mot « EFFACER » n'a pas été tapé, et les comptes réels ne sont jamais touchés.
 */
export function DataCleanupPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<TargetId[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
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
      });
      setResult(data);
      setConfirmOpen(false);
      setConfirmation("");
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
          <h2>Nettoyer les données de test</h2>
          <p>
            Supprimez les plannings, pointages et opérations de recette pour
            repartir sur une exploitation réelle. Les comptes, les stations, les
            modèles de shift et les réglages globaux ne sont jamais supprimés.
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
          label="Pointages"
          value={overview.counts.ATTENDANCE}
          detail="Présences et absences"
          tone="neutral"
        />
        <KpiCard
          compact
          label="Congés"
          value={overview.counts.LEAVES}
          detail="Demandes et justificatifs"
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
                  <td>{row.label}</td>
                  <td>{row.affected}</td>
                </tr>
              ))}
              <tr className="is-total">
                <td>Total</td>
                <td>{preview.total}</td>
              </tr>
            </tbody>
          </table>
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
                busy || confirmation.trim().toUpperCase() !== "EFFACER"
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
