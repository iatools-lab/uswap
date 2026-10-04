import { useEffect, useState } from "react";
import {
  CalendarCheckIcon,
  ClockIcon,
  EyeIcon,
  PlusIcon,
  RowsIcon,
} from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import "./reports.css";

type Run = {
  id: string;
  status: string;
  format: "XLSX" | "CSV";
  generatedAt: string;
  sentAt: string | null;
  errorMessage: string | null;
};
type Report = {
  id: string;
  name: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  format: "XLSX" | "CSV";
  scope: "NETWORK" | "STATION";
  stationId: string | null;
  recipients: string[];
  sections: string[];
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  runs?: Run[];
};
type Station = { id: string; name: string; isActive: boolean };
type Preview = {
  period: { from: string; to: string };
  kpis: { shifts: number; coverageRate: number; totalHours: number; movements: number };
  stationRows: Array<{ name: string; total: number; filled: number; coverage: number; futureVacant: number }>;
  hours: Array<{ name: string; station: string; hours: number }>;
};

const frequency: Record<Report["frequency"], string> = {
  DAILY: "Chaque jour",
  WEEKLY: "Chaque semaine",
  MONTHLY: "Chaque mois",
};
const sectionLabels: Record<string, string> = {
  ATTENDANCE: "Assiduité",
  COVERAGE: "Couverture",
  HOURS: "Heures",
  MOVEMENTS: "Mouvements",
};

export function ScheduledReports() {
  const [items, setItems] = useState<Report[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [runs, setRuns] = useState<{ report: Report; rows: Run[] } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([api<Report[]>("/admin/reports/schedules"), api<Station[]>("/stations")])
      .then(([reports, stationRows]) => {
        if (active) {
          setItems(reports);
          setStations(stationRows.filter((station) => station.isActive));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [revision]);
  async function toggle(item: Report) {
    await api(`/admin/reports/schedules/${item.id}`, { isActive: !item.isActive }, "PATCH");
    setRevision((v) => v + 1);
  }
  async function showRuns(item: Report) {
    const rows = await api<Run[]>(`/admin/reports/schedules/${item.id}/runs`);
    setRuns({ report: item, rows });
  }
  return (
    <section className="scheduled-reports">
      <div className="scheduled-reports-head">
        <div>
          <span className="scheduled-icon"><CalendarCheckIcon /></span>
          <div>
            <h3>Envois automatiques de rapports</h3>
            <p>Fréquence, périmètre, destinataires, aperçu et historique d’exécution.</p>
          </div>
        </div>
        <button className="admin-button secondary small" onClick={() => setOpen(true)}>
          <PlusIcon /> Créer un envoi
        </button>
      </div>
      {items.length ? (
        <div className="scheduled-report-list">
          {items.map((item) => (
            <article key={item.id}>
              <span className="scheduled-report-state"><i className={item.isActive ? "active" : ""} /></span>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {frequency[item.frequency]} · {item.format} · {item.scope === "STATION" ? `station ciblée` : "réseau"} · {item.recipients.length} destinataire(s)
                </small>
                <small>{item.sections.map((section) => sectionLabels[section] ?? section).join(" · ")}</small>
              </div>
              <span>
                <ClockIcon /> Prochain envoi {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(item.nextRunAt))}
              </span>
              <div className="scheduled-report-actions">
                <button onClick={() => void showRuns(item)}><RowsIcon /> Historique</button>
                <button onClick={() => void toggle(item)}>{item.isActive ? "Suspendre" : "Activer"}</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="scheduled-empty">Aucun envoi automatique. Utilisez « Créer un envoi » pour recevoir régulièrement un rapport.</p>
      )}
      <ScheduleModal
        key={open ? "open" : "closed"}
        open={open}
        stations={stations}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); setRevision((v) => v + 1); }}
        onPreview={setPreview}
      />
      <Modal open={preview !== null} onClose={() => setPreview(null)} size="lg" title="Aperçu du rapport" subtitle={preview ? `${new Date(preview.period.from).toLocaleDateString("fr-FR")} au ${new Date(preview.period.to).toLocaleDateString("fr-FR")}` : ""}>
        {preview && (
          <div className="kpi-detail-list">
            <article><strong>{preview.kpis.shifts}</strong><span>shifts analysés</span><span>{preview.kpis.coverageRate}% de couverture · {preview.kpis.totalHours} h</span></article>
            <article><strong>{preview.kpis.movements}</strong><span>mouvements</span></article>
            {preview.stationRows.map((row) => <article key={row.name}><strong>{row.name}</strong><span>{row.filled}/{row.total} postes couverts</span><span>{row.futureVacant} vacant(s) à venir</span></article>)}
          </div>
        )}
      </Modal>
      <Modal open={runs !== null} onClose={() => setRuns(null)} size="lg" title="Historique des exécutions" subtitle={runs?.report.name ?? ""}>
        {!runs?.rows.length ? <p className="scheduled-empty">Aucune exécution enregistrée.</p> : <div className="kpi-detail-list">{runs.rows.map((run) => <article key={run.id}><strong>{run.status}</strong><span>{new Date(run.generatedAt).toLocaleString("fr-FR")} · {run.format}</span><span>{run.errorMessage || (run.sentAt ? "Envoyé aux destinataires." : "En cours")}</span></article>)}</div>}
      </Modal>
    </section>
  );
}

function ScheduleModal({ open, stations, onClose, onSaved, onPreview }: { open: boolean; stations: Station[]; onClose: () => void; onSaved: () => void; onPreview: (preview: Preview) => void }) {
  const [name, setName] = useState("");
  const [frequencyValue, setFrequency] = useState("WEEKLY");
  const [format, setFormat] = useState("XLSX");
  const [scope, setScope] = useState("NETWORK");
  const [stationId, setStationId] = useState("");
  const [emails, setEmails] = useState("");
  const [sections, setSections] = useState(["ATTENDANCE", "COVERAGE", "HOURS", "MOVEMENTS"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function toggleSection(value: string) { setSections((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); }
  const payload = () => ({ name, frequency: frequencyValue, format, scope, stationId: scope === "STATION" ? stationId : null, sections, recipients: emails.split(/[,;]/).map((v) => v.trim()).filter(Boolean) });
  async function save() {
    setBusy(true); setError("");
    try { await api("/admin/reports/schedules", payload()); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function preview() {
    setBusy(true); setError("");
    try { onPreview(await api<Preview>("/admin/reports/schedules/preview", { scope, stationId: scope === "STATION" ? stationId : null, sections })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Programmer un rapport" subtitle="Configurez le périmètre, les sections et les destinataires avant activation." footer={<><button className="admin-button secondary" onClick={onClose}>Annuler</button><button className="admin-button secondary" disabled={busy} onClick={() => void preview()}><EyeIcon /> Aperçu</button><button className="admin-button primary-cta" disabled={busy || name.trim().length < 4 || !emails.includes("@") || !sections.length || (scope === "STATION" && !stationId)} onClick={() => void save()}>Créer la programmation</button></>}>
      <div className="report-schedule-form">
        {error && <p className="error-message">{error}</p>}
        <label><span>Nom du rapport</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Synthèse opérationnelle hebdomadaire" /></label>
        <div><label><span>Fréquence</span><Select value={frequencyValue} ariaLabel="Fréquence du rapport" onChange={(value) => setFrequency(String(value))} options={[{ value: "DAILY", label: "Chaque jour" }, { value: "WEEKLY", label: "Chaque semaine" }, { value: "MONTHLY", label: "Chaque mois" }]} /></label><label><span>Format</span><Select value={format} ariaLabel="Format du rapport" onChange={(value) => setFormat(String(value))} options={[{ value: "XLSX", label: "Excel (.xlsx)" }, { value: "CSV", label: "CSV" }]} /></label></div>
        <div><label><span>Périmètre</span><Select value={scope} ariaLabel="Périmètre" onChange={(value) => setScope(String(value))} options={[{ value: "NETWORK", label: "Tout le réseau autorisé" }, { value: "STATION", label: "Une station" }]} /></label>{scope === "STATION" && <label><span>Station</span><Select value={stationId} ariaLabel="Station" onChange={(value) => setStationId(String(value))} options={[{ value: "", label: "Choisir une station" }, ...stations.map((station) => ({ value: station.id, label: station.name }))]} /></label>}</div>
        <fieldset><legend>Sections</legend><div className="report-section-options">{Object.entries(sectionLabels).map(([key, label]) => <label key={key}><input type="checkbox" checked={sections.includes(key)} onChange={() => toggleSection(key)} /> {label}</label>)}</div></fieldset>
        <label><span>Destinataires</span><textarea rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="direction@uswap.example.com, supervision@uswap.example.com" /><small>Séparez plusieurs adresses par une virgule.</small></label>
      </div>
    </Modal>
  );
}
