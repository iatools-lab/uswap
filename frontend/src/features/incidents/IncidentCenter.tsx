import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  ChartLineUpIcon,
  ClockCountdownIcon,
  PlusIcon,
  ShieldWarningIcon,
  SpinnerGapIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import type { IncidentSeverity, IncidentStatus } from "../../api/mock/types";
import type { IncidentView } from "../../domain/sprint4";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import "./incidents.css";

type Incident = IncidentView & {
  category: string;
  description: string;
  actions: Array<{
    id: string;
    comment: string;
    createdAt: string;
    fromStatus: IncidentStatus | null;
    toStatus: IncidentStatus;
  }>;
  resolution: string | null;
};
type Data = {
  incidents: Incident[];
  metrics: {
    total: number;
    open: number;
    critical: number;
    meanResolutionHours: number;
  };
  stations: Array<{ id: string; name: string }>;
  swappers: Array<{ id: string; fullName: string; stationId: string | null }>;
};
const statusLabels: Record<IncidentStatus, string> = {
  REPORTED: "Signalé",
  TO_REVIEW: "À analyser",
  ACKNOWLEDGED: "Pris en charge",
  IN_PROGRESS: "En traitement",
  RESOLVED: "Résolu",
  CLOSED: "Clôturé",
};
const severityLabels: Record<IncidentSeverity, string> = {
  LOW: "Faible",
  MEDIUM: "Modérée",
  HIGH: "Élevée",
  CRITICAL: "Critique",
};
const categories = {
  ATTENDANCE: "Présence ou ponctualité",
  HEALTH: "Santé ou malaise",
  SAFETY: "Sécurité du swappeur",
  BEHAVIOR: "Comportement",
  SCHEDULING: "Difficulté liée au planning",
  OTHER: "Autre",
};
const nextStatuses: Record<IncidentStatus, IncidentStatus[]> = {
  REPORTED: ["REPORTED", "TO_REVIEW", "ACKNOWLEDGED"],
  TO_REVIEW: ["TO_REVIEW", "ACKNOWLEDGED"],
  ACKNOWLEDGED: ["ACKNOWLEDGED", "IN_PROGRESS"],
  IN_PROGRESS: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["RESOLVED", "IN_PROGRESS", "CLOSED"],
  CLOSED: ["CLOSED"],
};
const date = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function IncidentCenter({
  canManage,
  canReport = false,
  stationId,
}: {
  canManage: boolean;
  canReport?: boolean;
  stationId?: string | null;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [filter, setFilter] = useState("OPEN");
  useEffect(() => {
    let active = true;
    api<Data>(`/incidents${stationId ? `?stationId=${stationId}` : ""}`).then(
      (v) => active && setData(v),
    );
    return () => {
      active = false;
    };
  }, [revision, stationId]);
  const rows = useMemo(
    () =>
      data?.incidents.filter(
        (i) =>
          filter === "ALL" ||
          (filter === "OPEN"
            ? !["RESOLVED", "CLOSED"].includes(i.status)
            : i.severity === "CRITICAL"),
      ) ?? [],
    [data, filter],
  );
  if (!data)
    return (
      <div className="incident-loading">
        <SpinnerGapIcon className="spin" /> Chargement des incidents…
      </div>
    );
  return (
    <section className="incident-center">
      <div className="incident-heading">
        <div>
          <span className="incident-eyebrow">Pilotage opérationnel</span>
          <h2>Incidents concernant les swappeurs</h2>
          <p>
            {canReport
              ? "Déclarez les situations constatées dans votre station et suivez leur prise en charge."
              : "Analysez les signalements des stations, documentez les actions menées et clôturez leur traitement."}
          </p>
        </div>
        {canReport && (
          <button
            className="admin-button primary-cta"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon />
            Déclarer un incident
          </button>
        )}
      </div>
      <div className="incident-kpis">
        <article>
          <ActivityIcon />
          <span>
            <strong>{data.metrics.open}</strong>
            <small>incidents ouverts</small>
          </span>
          <i style={{ width: `${Math.min(100, data.metrics.open * 16)}%` }} />
        </article>
        <article className="danger">
          <WarningDiamondIcon />
          <span>
            <strong>{data.metrics.critical}</strong>
            <small>priorités critiques</small>
          </span>
        </article>
        <article>
          <ClockCountdownIcon />
          <span>
            <strong>
              {data.metrics.meanResolutionHours || "—"}
              {data.metrics.meanResolutionHours ? " h" : ""}
            </strong>
            <small>délai moyen de résolution</small>
          </span>
        </article>
        <article>
          <ChartLineUpIcon />
          <span>
            <strong>{data.metrics.total}</strong>
            <small>événements historisés</small>
          </span>
        </article>
      </div>
      <div className="incident-toolbar">
        <div className="incident-filters">
          {[
            ["OPEN", "En cours"],
            ["CRITICAL", "Critiques"],
            ["ALL", "Tous"],
          ].map(([v, l]) => (
            <button
              key={v}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <span>{rows.length} résultat(s)</span>
      </div>
      <div className="incident-grid">
        {rows.length ? (
          rows.map((item) => (
            <button
              className="incident-card"
              key={item.id}
              onClick={() => setSelected(item)}
            >
              <span
                className={`incident-severity ${item.severity.toLowerCase()}`}
              >
                {severityLabels[item.severity]}
              </span>
              <div className="incident-card-title">
                <strong>{item.title}</strong>
                <ArrowRightIcon />
              </div>
              <p>{item.description}</p>
              <dl>
                <div>
                  <dt>Swappeur</dt>
                  <dd>{item.affectedSwapperName}</dd>
                </div>
                <div>
                  <dt>Station</dt>
                  <dd>{item.stationName}</dd>
                </div>
                <div>
                  <dt>Catégorie</dt>
                  <dd>
                    {categories[item.category as keyof typeof categories] ??
                      item.category}
                  </dd>
                </div>
              </dl>
              <footer>
                <span
                  className={`incident-status ${item.status.toLowerCase()}`}
                >
                  {statusLabels[item.status]}
                </span>
                <time>{date(item.updatedAt)}</time>
              </footer>
            </button>
          ))
        ) : (
          <div className="incident-empty">
            <ShieldWarningIcon />
            <h3>Aucun incident dans cette vue</h3>
            <p>Les événements correspondant au filtre apparaîtront ici.</p>
          </div>
        )}
      </div>
      {canReport && (
        <IncidentCreate
          open={createOpen}
          stations={data.stations}
          swappers={data.swappers}
          fixedStationId={stationId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
      <IncidentDetail
        key={selected?.id}
        incident={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onSaved={() => {
          setSelected(null);
          setRevision((v) => v + 1);
        }}
      />
    </section>
  );
}

function IncidentCreate({
  open,
  stations,
  swappers,
  fixedStationId,
  onClose,
  onSaved,
}: {
  open: boolean;
  stations: Data["stations"];
  swappers: Data["swappers"];
  fixedStationId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [station, setStation] = useState(fixedStationId ?? "");
  const [affectedSwapper, setAffectedSwapper] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("MEDIUM");
  const [category, setCategory] = useState("ATTENDANCE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/incidents", {
        stationId: station,
        affectedSwapperId: affectedSwapper,
        title,
        description,
        severity,
        category,
        occurredAt: new Date().toISOString(),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Déclarer un incident"
      subtitle="Choisissez le swappeur concerné, puis décrivez les faits et leur impact."
      footer={
        <>
          <button className="admin-button secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="admin-button primary-cta"
            disabled={
              busy ||
              !station ||
              !affectedSwapper ||
              title.trim().length < 5 ||
              description.trim().length < 12
            }
            onClick={() => void save()}
          >
            {busy && <SpinnerGapIcon className="spin" />}
            <span>Transmettre l’incident</span>
          </button>
        </>
      }
    >
      <div className="incident-form">
        {error && <p className="error-message">{error}</p>}
        {!fixedStationId && (
          <label>
            <span>Station concernée</span>
            <Select
              value={station}
              placeholder="Sélectionner la station"
              ariaLabel="Station concernée"
              onChange={(value) => {
                setStation(String(value));
                setAffectedSwapper("");
              }}
              options={stations.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </label>
        )}
        <label>
          <span>Swappeur concerné</span>
          <Select
            value={affectedSwapper}
            placeholder={
              station
                ? "Sélectionner le swappeur"
                : "Choisir d’abord la station"
            }
            ariaLabel="Swappeur concerné"
            disabled={!station}
            onChange={(value) => setAffectedSwapper(String(value))}
            options={swappers
              .filter((item) => item.stationId === station)
              .map((item) => ({ value: item.id, label: item.fullName }))}
          />
          <small>Seuls les swappeurs actifs de la station sont proposés.</small>
        </label>
        <div className="incident-form-row">
          <label>
            <span>Catégorie</span>
            <Select
              value={category}
              ariaLabel="Catégorie de l’incident"
              onChange={(value) => setCategory(String(value))}
              options={Object.entries(categories).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </label>
          <label>
            <span>Niveau d’impact</span>
            <Select
              value={severity}
              ariaLabel="Niveau d’impact"
              onChange={(value) => setSeverity(value as IncidentSeverity)}
              options={Object.entries(severityLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </label>
        </div>
        <label>
          <span>Titre court</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Malaise pendant le service"
          />
        </label>
        <label>
          <span>Description et impact opérationnel</span>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Précisez ce que le swappeur a rencontré, les conséquences sur son service et les premières mesures prises…"
          />
        </label>
      </div>
    </Modal>
  );
}

function IncidentDetail({
  incident,
  canManage,
  onClose,
  onSaved,
}: {
  incident: Incident | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<IncidentStatus>(
    incident?.status ?? "REPORTED",
  );
  const [severity, setSeverity] = useState<IncidentSeverity>(
    incident?.severity ?? "MEDIUM",
  );
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!incident) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/incidents/${incident.id}`,
        { status, severity, comment },
        "PATCH",
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={Boolean(incident)}
      onClose={onClose}
      size="xl"
      title={incident?.title ?? "Incident"}
      subtitle={
        incident
          ? `${incident.stationName} · ${date(incident.occurredAt)}`
          : undefined
      }
      footer={
        canManage ? (
          <>
            <button className="admin-button secondary" onClick={onClose}>
              Fermer
            </button>
            <button
              className="admin-button primary-cta"
              disabled={
                busy ||
                (["RESOLVED", "CLOSED"].includes(status) &&
                  comment.trim().length < 10)
              }
              onClick={() => void save()}
            >
              Enregistrer le suivi
            </button>
          </>
        ) : (
          <button className="admin-button secondary" onClick={onClose}>
            Fermer
          </button>
        )
      }
    >
      {incident && (
        <div className="incident-detail">
          {error && <p className="error-message">{error}</p>}
          <div className="incident-detail-summary">
            <span
              className={`incident-severity ${incident.severity.toLowerCase()}`}
            >
              {severityLabels[incident.severity]}
            </span>
            <span
              className={`incident-status ${incident.status.toLowerCase()}`}
            >
              {statusLabels[incident.status]}
            </span>
            <p>{incident.description}</p>
            <strong>{incident.affectedSwapperName}</strong>
            <small>Déclaré par {incident.reporterName}</small>
          </div>
          {canManage && (
            <div className="incident-review">
              <div className="incident-form-row">
                <label>
                  <span>Prochaine étape</span>
                  <Select
                    value={status}
                    ariaLabel="Prochaine étape"
                    onChange={(value) => setStatus(value as IncidentStatus)}
                    options={nextStatuses[incident.status].map((value) => ({
                      value,
                      label: statusLabels[value],
                    }))}
                  />
                </label>
                <label>
                  <span>Priorité</span>
                  <Select
                    value={severity}
                    ariaLabel="Priorité de l’incident"
                    onChange={(value) => setSeverity(value as IncidentSeverity)}
                    options={Object.entries(severityLabels).map(
                      ([value, label]) => ({
                        value,
                        label,
                      }),
                    )}
                  />
                </label>
              </div>
              <label>
                <span>Compte rendu</span>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Ajoutez l’analyse, l’action menée ou la résolution…"
                />
              </label>
            </div>
          )}
          <div className="incident-timeline">
            <h3>Journal de suivi</h3>
            {incident.actions.map((action) => (
              <div key={action.id}>
                <i />
                <span>
                  <strong>{statusLabels[action.toStatus]}</strong>
                  <p>{action.comment}</p>
                  <time>{date(action.createdAt)}</time>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
