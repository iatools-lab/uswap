import { translate } from "../../app/i18n";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  RefreshCw,
  XCircleIcon,
} from "../../ui/icons";
import { api, ApiError, type Role } from "../../api/auth-api";
import type {
  LeaveManagementItem,
  LeaveRequestView,
} from "../../domain/sprint4";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import { LoaderCircle } from "../../ui/icons";
import { notify } from "../../ui/Toast";
import { formatDateRange } from "../../utils/french";
import { KpiCard } from "../../ui/KpiCard";
import "../../features/leaves/leaves.css";
import "./leave-management.css";

const TYPE_LABELS: Record<LeaveRequestView["type"], string> = {
  ANNUAL: "Congé annuel",
  SICK: "Congé maladie",
  FAMILY: "Événement familial",
  UNPAID: "Congé sans solde",
  OTHER: "Autre absence planifiée",
};
const STATUS_LABELS: Record<LeaveRequestView["status"], string> = {
  DRAFT: "Brouillon",
  QUEUED: "À synchroniser",
  SYNCING: "Synchronisation",
  PENDING: "En attente",
  APPROVED: "Approuvé",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
  SYNC_FAILED: "Échec de synchronisation",
};
const STATUS_TONES: Record<LeaveRequestView["status"], string> = {
  DRAFT: "neutral",
  QUEUED: "warning",
  SYNCING: "info",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  SYNC_FAILED: "danger",
};
const dayCount = (start: string, end: string) =>
  Math.max(
    1,
    Math.round(
      (Date.parse(end.slice(0, 10)) - Date.parse(start.slice(0, 10))) /
        86_400_000,
    ) + 1,
  );
type Props = { role: Extract<Role, "ADMIN" | "SUPERVISOR"> };
type Decision = "APPROVED" | "REJECTED";

export function LeaveManagementPage({ role }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const targetId = new URLSearchParams(location.search).get("leave");
  const [items, setItems] = useState<LeaveManagementItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | LeaveRequestView["status"]>(
    "ALL",
  );
  const [station, setStation] = useState("ALL");
  const [selected, setSelected] = useState<LeaveManagementItem | null>(null);
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loadingError, setLoadingError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setItems(null);
    setLoadingError("");
    api<LeaveManagementItem[]>("/leaves/management")
      .then((data) => active && setItems(data))
      .catch((cause) => {
        if (!active) return;
        setLoadingError(
          cause instanceof ApiError && cause.status === 403
            ? "Vous ne disposez pas des droits nécessaires pour consulter cet espace."
            : (cause as Error).message,
        );
      });
    return () => {
      active = false;
    };
  }, [revision, role]);

  const stations = useMemo(
    () =>
      Array.from(new Set((items ?? []).map((item) => item.stationName))).sort(
        (a, b) => a.localeCompare(b, "fr"),
      ),
    [items],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    return (items ?? []).filter((item) => {
      if (status !== "ALL" && item.status !== status) return false;
      if (station !== "ALL" && item.stationName !== station) return false;
      if (!normalized) return true;
      return [
        item.swapperName,
        item.stationName,
        TYPE_LABELS[item.type],
        item.reason,
      ]
        .join(" ")
        .toLocaleLowerCase("fr")
        .includes(normalized);
    });
  }, [items, query, station, status]);
  const counts = useMemo(
    () => ({
      pending: (items ?? []).filter((item) => item.status === "PENDING").length,
      approved: (items ?? []).filter((item) => item.status === "APPROVED")
        .length,
      days: (items ?? [])
        .filter((item) => item.status === "APPROVED")
        .reduce(
          (total, item) => total + dayCount(item.startTime, item.endTime),
          0,
        ),
    }),
    [items],
  );

  useEffect(() => {
    if (!items || !targetId) return;
    const target = items.find((item) => item.id === targetId);
    if (target) setSelected(target);
  }, [items, targetId]);

  function openDecision(item: LeaveManagementItem) {
    setSelected(item);
    setDecision("APPROVED");
    setReason("");
    setError("");
  }
  async function saveDecision() {
    if (!selected) return;
    if (decision === "REJECTED" && reason.trim().length < 5) {
      setError("Indiquez le motif du refus (5 caractères minimum).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        `/leaves/${encodeURIComponent(selected.id)}/decision`,
        { decision, reason: reason.trim() },
        "PATCH",
      );
      notify(decision === "APPROVED" ? "Congé approuvé." : "Demande refusée.");
      setSelected(null);
      setRevision((value) => value + 1);
      if (targetId) navigate(location.pathname, { replace: true });
    } catch (cause) {
      setError(
        (cause as Error).message || "La décision n’a pas pu être enregistrée.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leave-management">
      <section className="leave-management-intro">
        <div>
          <span className="leave-eyebrow">{translate("Gestion des congés")}</span>
          <h2>
            {role === "ADMIN"
              ? translate("Demandes de congé")
              : translate("Congés de votre périmètre")}
          </h2>
          <p>
            {role === "ADMIN"
              ? translate("Centralisez les demandes, les décisions et l’historique des absences planifiées.")
              : translate("Examinez les demandes de votre équipe et anticipez les remplacements à organiser.")}
          </p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          onClick={() => setRevision((value) => value + 1)}
          disabled={items === null}
        >
          <RefreshCw size={16} /> {" "}{translate("Actualiser")}</button>
      </section>
      {loadingError ? (
        <section className="admin-card leave-management-empty" role="alert">
          <XCircleIcon size={25} />
          <h3>{translate("Chargement indisponible")}</h3>
          <p>{loadingError}</p>
          <button
            type="button"
            className="admin-button secondary small"
            onClick={() => setRevision((value) => value + 1)}
          >
            {translate("Réessayer")}</button>
        </section>
      ) : (
        <>
          <section
            className="leave-management-kpis"
            aria-label={translate("Résumé des congés")}
          >
            <KpiCard
              compact
              label={translate("À examiner")}
              value={items === null ? "—" : counts.pending}
              detail={translate("Demandes en attente")}
              icon={<ClockIcon size={19} />}
              tone={counts.pending > 0 ? "amber" : "neutral"}
            />
            <KpiCard
              compact
              label={translate("Approuvées")}
              value={items === null ? "—" : counts.approved}
              detail={translate("Demandes validées")}
              icon={<CheckCircleIcon size={19} />}
              tone="green"
            />
            <KpiCard
              compact
              label={translate("Jours planifiés")}
              value={items === null ? "—" : counts.days}
              detail={translate("Sur les congés approuvés")}
              icon={<CalendarBlankIcon size={19} />}
              tone="blue"
            />
          </section>
          <section
            className="leave-management-panel"
            aria-labelledby="leave-management-list-title"
          >
            <div className="leave-management-panel-head">
              <div className="leave-management-panel-heading">
                <h3 id="leave-management-list-title">{translate("Toutes les demandes")}</h3>
                <p>
                  {items === null
                    ? "Chargement…"
                    : `${filtered.length} ${translate(filtered.length === 1 ? "demande" : "demandes")}`}
                </p>
              </div>
              <div className="leave-management-filters">
                <label className="leave-management-search">
                  <MagnifyingGlassIcon size={18} />
                  <span className="sr-only">{translate("Rechercher une demande")}</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={translate("Rechercher…")}
                  />
                </label>
                <Select
                  value={status}
                  size="sm"
                  ariaLabel={translate("Filtrer par statut")}
                  onChange={(value) =>
                    setStatus(String(value) as typeof status)
                  }
                  options={[
                    { value: "ALL", label: translate("Tous les statuts") },
                    { value: "PENDING", label: translate("En attente") },
                    { value: "APPROVED", label: translate("Approuvés") },
                    { value: "REJECTED", label: translate("Refusés") },
                    { value: "CANCELLED", label: translate("Annulés") },
                  ]}
                />
                <Select
                  value={station}
                  size="sm"
                  ariaLabel={translate("Filtrer par station")}
                  onChange={(value) => setStation(String(value))}
                  options={[
                    { value: "ALL", label: translate("Toutes les stations") },
                    ...stations.map((item) => ({ value: item, label: item })),
                  ]}
                />
              </div>
            </div>
            {items === null ? (
              <div className="leave-management-empty" role="status">
                <LoaderCircle className="spin" size={22} /> {" "}{translate("Chargement des demandes…")}</div>
            ) : filtered.length === 0 ? (
              <div className="leave-management-empty">
                <MagnifyingGlassIcon size={25} />
                <h3>{translate("Aucune demande trouvée")}</h3>
                <p>{translate("Modifiez les filtres pour élargir votre recherche.")}</p>
              </div>
            ) : (
              <div className="leave-management-list">
                {filtered.map((item) => (
                  <article className="leave-management-item" key={item.id}>
                    <span
                      className={`leave-management-rail ${STATUS_TONES[item.status]}`}
                    />
                    <div className="leave-management-item-main">
                      <div className="leave-management-item-title">
                        <strong>{item.swapperName}</strong>
                        <span
                          className={`leave-status ${STATUS_TONES[item.status]}`}
                        >
                          {translate(STATUS_LABELS[item.status])}
                        </span>
                      </div>
                      <p>
                        {translate(TYPE_LABELS[item.type])} {" "}{translate("·")}{" "}{item.stationName}
                      </p>
                      <span className="leave-management-period">
                        <CalendarBlankIcon size={14} />{" "}
                        {formatDateRange(item.startTime, item.endTime)} {" "}{translate("·")}{" "}
                        {dayCount(item.startTime, item.endTime)} {" "}{translate(dayCount(item.startTime, item.endTime) === 1 ? "jour" : "jours")}
                      </span>
                    </div>
                    <div className="leave-management-item-reason">
                      <span>{translate("Motif")}</span>
                      <p>{translate(item.reason)}</p>
                    </div>
                    <div className="leave-management-item-action">
                      <button
                        type="button"
                        className="admin-button secondary small"
                        onClick={() => openDecision(item)}
                      >
                        {item.status === "PENDING"
                          ? "Examiner"
                          : translate("Voir le détail")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <Modal
        open={!!selected}
        size="md"
        title={
          selected?.status === "PENDING"
            ? "Examiner la demande"
            : "Détail de la demande"
        }
        subtitle={
          selected
            ? `${selected.swapperName} · ${selected.stationName}`
            : undefined
        }
        onClose={() => !busy && setSelected(null)}
        footer={
          selected?.status === "PENDING" ? (
            <>
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                {translate("Annuler")}</button>
              <button
                type="button"
                className={`admin-button ${decision === "APPROVED" ? "primary-cta" : "danger"}`}
                disabled={busy}
                onClick={() => void saveDecision()}
              >
                {busy
                  ? "Enregistrement…"
                  : decision === "APPROVED"
                    ? "Approuver"
                    : "Refuser"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="admin-button secondary"
              onClick={() => setSelected(null)}
            >
              {translate("Fermer")}</button>
          )
        }
      >
        {selected && (
          <div className="leave-management-detail">
            <div className="leave-management-summary">
              <CalendarBlankIcon size={19} />
              <div>
                <strong>
                  {formatDateRange(selected.startTime, selected.endTime)}
                </strong>
                <span>
                  {dayCount(selected.startTime, selected.endTime)} {" "}{translate("jour")}{dayCount(selected.startTime, selected.endTime) > 1
                    ? "s"
                    : ""}{" "}
                  {translate("·")}{" "}{translate(TYPE_LABELS[selected.type])}
                </span>
              </div>
            </div>
            <div className="leave-management-detail-row">
              <span>{translate("Statut")}</span>
              <span className={`leave-status ${STATUS_TONES[selected.status]}`}>
                {translate(STATUS_LABELS[selected.status])}
              </span>
            </div>
            <div className="leave-management-detail-block">
              <span>{translate("Motif")}</span>
              <p>{translate(selected.reason)}</p>
            </div>
            {selected.attachmentName && (
              <div className="leave-management-detail-block">
                <span>{translate("Justificatif")}</span>
                <p>{selected.attachmentName}</p>
              </div>
            )}
            {selected.status === "PENDING" && (
              <div
                className="leave-decision-options"
                role="group"
                aria-label={translate("Décision")}
              >
                <button
                  type="button"
                  aria-pressed={decision === "APPROVED"}
                  onClick={() => setDecision("APPROVED")}
                >
                  <CheckCircleIcon size={17} /> {" "}{translate("Approuver")}</button>
                <button
                  type="button"
                  aria-pressed={decision === "REJECTED"}
                  onClick={() => setDecision("REJECTED")}
                >
                  <XCircleIcon size={17} /> {" "}{translate("Refuser")}</button>
              </div>
            )}
            {selected.status === "PENDING" && decision === "REJECTED" && (
              <label className="leave-form-field">
                <span>{translate("Motif du refus")}</span>
                <textarea
                  rows={2}
                  minLength={5}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={translate("Expliquez brièvement la décision")}
                />
              </label>
            )}
            {selected.decisionReason && selected.status !== "PENDING" && (
              <div className="leave-management-detail-block">
                <span>{translate("Décision")}</span>
                <p>{translate(selected.decisionReason)}</p>
              </div>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
