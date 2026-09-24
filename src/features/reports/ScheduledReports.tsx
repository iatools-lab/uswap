import { useEffect, useState } from "react";
import { CalendarCheckIcon, ClockIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import "./reports.css";

type Report = {
  id: string;
  name: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  format: "XLSX" | "CSV";
  recipients: string[];
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
};
const frequency = {
  DAILY: "Chaque jour",
  WEEKLY: "Chaque semaine",
  MONTHLY: "Chaque mois",
};
export function ScheduledReports() {
  const [items, setItems] = useState<Report[]>([]);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<Report[]>("/admin/reports/schedules").then(
      (v) => active && setItems(v),
    );
    return () => {
      active = false;
    };
  }, [revision]);
  async function toggle(item: Report) {
    await api(
      `/admin/reports/schedules/${item.id}`,
      { isActive: !item.isActive },
      "PATCH",
    );
    setRevision((v) => v + 1);
  }
  return (
    <section className="scheduled-reports">
      <div className="scheduled-reports-head">
        <div>
          <span className="scheduled-icon">
            <CalendarCheckIcon />
          </span>
          <div>
            <h3>Rapports périodiques</h3>
            <p>
              Automatisez l’envoi des indicateurs aux destinataires autorisés.
            </p>
          </div>
        </div>
        <button
          className="admin-button secondary small"
          onClick={() => setOpen(true)}
        >
          <PlusIcon />
          Programmer
        </button>
      </div>
      {items.length ? (
        <div className="scheduled-report-list">
          {items.map((item) => (
            <article key={item.id}>
              <span className="scheduled-report-state">
                <i className={item.isActive ? "active" : ""} />
              </span>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {frequency[item.frequency]} · {item.format} ·{" "}
                  {item.recipients.length} destinataire(s)
                </small>
              </div>
              <span>
                <ClockIcon />
                Prochain envoi{" "}
                {new Intl.DateTimeFormat("fr-FR", {
                  dateStyle: "medium",
                }).format(new Date(item.nextRunAt))}
              </span>
              <button onClick={() => void toggle(item)}>
                {item.isActive ? "Suspendre" : "Activer"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="scheduled-empty">
          Aucun rapport programmé. Les exports manuels restent disponibles dans
          le tableau de bord superviseur.
        </p>
      )}
      <ScheduleModal
        key={open ? "open" : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          setRevision((v) => v + 1);
        }}
      />
    </section>
  );
}
function ScheduleModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [frequencyValue, setFrequency] = useState("WEEKLY");
  const [format, setFormat] = useState("XLSX");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/admin/reports/schedules", {
        name,
        frequency: frequencyValue,
        format,
        recipients: emails
          .split(/[,;]/)
          .map((v) => v.trim())
          .filter(Boolean),
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
      title="Programmer un rapport"
      subtitle="Le rapport consolide présences, couverture, heures et mouvements du réseau."
      footer={
        <>
          <button className="admin-button secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="admin-button primary-cta"
            disabled={busy || name.trim().length < 4 || !emails.includes("@")}
            onClick={() => void save()}
          >
            Créer la programmation
          </button>
        </>
      }
    >
      <div className="report-schedule-form">
        {error && <p className="error-message">{error}</p>}
        <label>
          <span>Nom du rapport</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Synthèse opérationnelle hebdomadaire"
          />
        </label>
        <div>
          <label>
            <span>Fréquence</span>
            <Select
              value={frequencyValue}
              ariaLabel="Fréquence du rapport"
              onChange={(value) => setFrequency(String(value))}
              options={[
                { value: "DAILY", label: "Chaque jour" },
                { value: "WEEKLY", label: "Chaque semaine" },
                { value: "MONTHLY", label: "Chaque mois" },
              ]}
            />
          </label>
          <label>
            <span>Format</span>
            <Select
              value={format}
              ariaLabel="Format du rapport"
              onChange={(value) => setFormat(String(value))}
              options={[
                { value: "XLSX", label: "Excel (.xlsx)" },
                { value: "CSV", label: "CSV" },
              ]}
            />
          </label>
        </div>
        <label>
          <span>Destinataires</span>
          <textarea
            rows={3}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="prenom.nom@uswap.example.com, direction@uswap.example.com"
          />
          <small>Séparez plusieurs adresses par une virgule.</small>
        </label>
      </div>
    </Modal>
  );
}
