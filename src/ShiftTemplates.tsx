import { Modal } from "./modal";
import { useEffect, useState, type FormEvent } from 'react';
import {
  ClockIcon,
  PlusIcon,
  PencilSimpleIcon,
  ArrowLeftIcon,
  ClockCounterClockwiseIcon,
} from '@phosphor-icons/react';
import { api } from './auth-api';
import { notify } from './Notifications';

type Template = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number;
  durationMinutes: number;
  isActive: boolean;
  revision: number;
};

type Version = Template & { createdAt: string };

const empty = {
  label: '',
  startTime: '08:00',
  endTime: '16:00',
  breakStart: '',
  breakEnd: '',
};

export const shiftDuration = (start: string, end: string) => {
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return start && end ? (mins(end) - mins(start) + 1440) % 1440 : 0;
};

const durationLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h${m ? ' ' + String(m).padStart(2, '0') : ''}`;
};

export function ShiftTemplates({
  station,
  onBack,
}: {
  station: { id: string; name: string; timezone: string; isActive: boolean };
  onBack: () => void;
}) {
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  const [form, setForm] = useState<typeof empty | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [confirm, setConfirm] = useState<Template | null>(null);
  const [history, setHistory] = useState<Version[] | null>(null);
  const [historyLabel, setHistoryLabel] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<Template[]>(`/stations/${station.id}/shift-templates`)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [station.id, revision]);

  const rawDuration = form ? shiftDuration(form?.startTime, form?.endTime) : 0;
  const breakDuration =
    form && form.breakStart && form.breakEnd
      ? shiftDuration(form.breakStart, form.breakEnd)
      : 0;
  const netDuration = Math.max(0, rawDuration - breakDuration);

  function edit(item?: Template) {
    setEditing(item || null);
    setForm(
      item
        ? {
            label: item.label,
            startTime: item?.startTime,
            endTime: item?.endTime,
            breakStart: item.breakStart || '',
            breakEnd: item.breakEnd || '',
          }
        : empty,
    );
    setConfirm(null);
    setHistory(null);
    setError('');
  }

  async function write(
    item: typeof empty,
    previous: Template | null,
    active?: boolean,
  ) {
    setBusy(true);
    setError('');
    try {
      await api(
        `/stations/${station.id}/shift-templates${previous ? '/' + previous.id : ''}`,
        {
          ...item,
          breakStart: item.breakStart || null,
          breakEnd: item.breakEnd || null,
          ...(previous ? { revision: previous.revision } : {}),
          ...(active !== undefined ? { isActive: active } : {}),
        },
        previous ? 'PATCH' : undefined,
      );
      setForm(null);
      setConfirm(null);
      setRevision((r) => r + 1);
      notify(
        active === false
          ? 'Modèle désactivé.'
          : active === true
          ? 'Modèle réactivé.'
          : 'Modèle enregistré.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (form && rawDuration) await write(form, editing);
  }

  async function showHistory(item: Template) {
    setBusy(true);
    setError('');
    try {
      setHistory(
        await api<Version[]>(
          `/stations/${station.id}/shift-templates/${item.id}/history`,
        ),
      );
      setHistoryLabel(item.label);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shift-templates" style={{ display: "grid", gap: "24px", paddingBottom: "40px" }}>
      {/* En-tête de la page */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <button
            type="button"
            className="text-button planner-back"
            disabled={busy}
            onClick={onBack}
            style={{ display: "flex", alignItems: "center", gap: "6px", color: "#64748b", fontSize: "13px", fontWeight: 600, marginBottom: "8px", background: "none", border: 0, cursor: "pointer", padding: 0 }}
          >
            <ArrowLeftIcon size={15} weight="bold" /> Stations
          </button>
          <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: "0 0 4px 0" }}>{station.name}</h2>
          <p className="planner-muted" style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Modèles de shifts · {station.timezone}</p>
        </div>
        
        <button
          type="button"
          className="admin-button"
          disabled={busy || !station.isActive}
          onClick={() => edit()}
          style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", borderRadius: "10px", padding: "0 16px", fontSize: "13.5px", fontWeight: 600 }}
        >
          <PlusIcon size={16} weight="bold" /> Nouveau modèle
        </button>
      </div>

      {!station.isActive && (
        <div className="detail-confirm" role="status" style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e", padding: "12px 16px", borderRadius: "10px", fontSize: "13px" }}>
          Cette station est inactive. Ses modèles restent consultables.
        </div>
      )}

      {error && (
        <div className="error-message" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: "10px" }}>
          <span>{error}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setForm(null);
              setRevision((r) => r + 1);
            }}
            style={{ color: "inherit", textDecoration: "underline", fontWeight: 600, background: "none", border: 0, cursor: "pointer" }}
          >
            Recharger les modèles
          </button>
        </div>
      )}

      {/* Le formulaire est maintenant proprement encapsulé dans un VRAI Modal centré */}
      {form && (
        <Modal
          open
          title={editing ? 'Modifier le modèle' : 'Nouveau modèle'}
          onClose={() => {
            if (!busy) setForm(null);
          }}
        >
          <form className="admin-card user-form-card" onSubmit={save} style={{ border: 0, padding: 0, boxShadow: "none", background: "transparent" }}>
            <fieldset disabled={busy} className="planner-fieldset" style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "16px" }}>
              <div className="user-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#475569", gridColumn: "span 2" }}>
                  Libellé
                  <input
                    required
                    maxLength={80}
                    autoFocus
                    placeholder="Ex. Équipe de nuit"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none", fontWeight: 400 }}
                  />
                </label>

                <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                  Heure de début
                  <input
                    type="time"
                    required
                    value={form?.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none", fontWeight: 400 }}
                  />
                </label>

                <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                  Heure de fin
                  <input
                    type="time"
                    required
                    value={form?.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none", fontWeight: 400 }}
                  />
                </label>

                <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                  Début de pause (optionnel)
                  <input
                    type="time"
                    value={form.breakStart}
                    onChange={(e) => setForm({ ...form, breakStart: e.target.value })}
                    style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none", fontWeight: 400 }}
                  />
                </label>

                <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                  Fin de pause (optionnel)
                  <input
                    type="time"
                    value={form.breakEnd}
                    onChange={(e) => setForm({ ...form, breakEnd: e.target.value })}
                    style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none", fontWeight: 400 }}
                  />
                </label>
              </div>

              <div className="planner-hint" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px 16px", display: "grid", gap: "6px" }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#334155" }}>
                  Pause : {breakDuration} min · Temps effectif hors pause :{' '}
                  <strong style={{ color: "#0f172a" }}>{durationLabel(netDuration)}</strong>
                </p>
                <p className="template-duration" role="status" style={{ margin: 0, fontSize: "12.5px", color: "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
                  <ClockIcon size={16} />
                  {rawDuration
                    ? `Durée totale : ${durationLabel(rawDuration)}${
                        form?.endTime < form?.startTime ? ' · fin le lendemain' : ''
                      }`
                    : 'Choisissez deux heures différentes.'}
                </p>
              </div>
            </fieldset>

            <div className="user-form-actions planner-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setForm(null)}
                style={{ height: "38px", borderRadius: "8px", fontSize: "13px" }}
              >
                Annuler
              </button>
              <button
                className="admin-button"
                disabled={busy || !rawDuration || !form.label.trim()}
                style={{ height: "38px", borderRadius: "8px", fontSize: "13px", padding: "0 18px" }}
              >
                Enregistrer le modèle
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <Modal
          open
          title={`${confirm.isActive ? 'Désactiver' : 'Réactiver'} le modèle`}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="planner-panel" style={{ display: "grid", gap: "16px" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "#0f172a", lineHeight: 1.5 }}>
              Voulez-vous vraiment {confirm.isActive ? 'désactiver' : 'réactiver'} «{' '}
              <strong style={{ fontWeight: 600 }}>{confirm.label}</strong> » ?
            </p>
            {confirm.isActive && (
              <p className="planner-muted" style={{ margin: 0, fontSize: "13px", color: "#64748b", lineHeight: 1.4 }}>
                Il ne sera plus proposé pour les nouvelles affectations. Les horaires déjà créés dans les plannings seront conservés.
              </p>
            )}
            <div className="planner-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setConfirm(null)}
                style={{ height: "36px", borderRadius: "8px", fontSize: "13px" }}
              >
                Annuler
              </button>
              <button
                type="button"
                className={`admin-button ${confirm.isActive ? 'secondary' : ''}`}
                disabled={busy}
                onClick={() =>
                  write(
                    {
                      label: confirm.label,
                      startTime: confirm?.startTime,
                      endTime: confirm?.endTime,
                      breakStart: confirm.breakStart || '',
                      breakEnd: confirm.breakEnd || '',
                    },
                    confirm,
                    !confirm.isActive,
                  )
                }
                style={{ height: "36px", borderRadius: "8px", fontSize: "13px", padding: "0 16px" }}
              >
                Confirmer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {loading ? (
        <p role="status" style={{ color: "#64748b", fontSize: "13.5px" }}>Chargement des modèles…</p>
      ) : !items.length ? (
        <div className="admin-card admin-empty" style={{ padding: "60px 20px", textAlign: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", display: "grid", gap: "8px", justifyItems: "center" }}>
          <ClockIcon size={32} style={{ color: "#94a3b8" }} />
          <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: 0 }}>Aucun modèle de shift</h3>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Définissez les horaires utilisés dans cette station.</p>
        </div>
      ) : (
        /* Grille de cartes ultra-épurée et moderne */
        <div className="template-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
          {items.map((item) => (
            <article 
              className="admin-card template-card" 
              key={item.id}
              style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "20px", display: "grid", gap: "14px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", transition: "all 0.2s" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: 0 }}>{item.label}</h3>
                <span
                  className={`admin-badge ${item.isActive ? 'active' : 'draft'}`}
                  style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px" }}
                >
                  {item.isActive ? 'Actif' : 'Inactif'}
                </span>
              </div>

              <div>
                <p className="template-hours" style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", margin: "0 0 2px 0", letterSpacing: "-0.3px" }}>
                  {item?.startTime} – {item?.endTime}
                </p>
                <p style={{ fontSize: "12.5px", color: "#64748b", margin: 0 }}>
                  {durationLabel(item.durationMinutes)}
                  {item?.endTime < item?.startTime ? ' · fin le lendemain' : ''}
                </p>
              </div>

              {item.breakStart && (
                <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", border: "1px solid #f1f5f9" }}>
                  <p className="planner-muted" style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                    Pause : {item.breakStart} – {item.breakEnd} · {item.breakMinutes} min
                  </p>
                </div>
              )}

              <div className="template-actions" style={{ display: "flex", alignItems: "center", gap: "10px", borderTop: "1px solid #f1f5f9", paddingTop: "12px", marginTop: "2px" }}>
                <button
                  type="button"
                  className="admin-button secondary"
                  disabled={busy || !station.isActive}
                  onClick={() => edit(item)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", borderRadius: "6px", fontSize: "12.5px" }}
                >
                  <PencilSimpleIcon size={14} /> Modifier
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || (!station.isActive && !item.isActive)}
                  onClick={() => {
                    setConfirm(item);
                    setError('');
                  }}
                  style={{ background: "none", border: 0, fontSize: "12.5px", fontWeight: 500, color: item.isActive ? "#dc2626" : "#16a34a", cursor: "pointer", padding: "0 4px" }}
                >
                  {item.isActive ? 'Désactiver' : 'Réactiver'}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => showHistory(item)}
                  style={{ background: "none", border: 0, fontSize: "12.5px", fontWeight: 500, color: "#64748b", cursor: "pointer", padding: "0 4px", display: "flex", alignItems: "center", gap: "4px", marginLeft: "auto" }}
                >
                  <ClockCounterClockwiseIcon size={14} /> Historique
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {history && (
        <Modal
          open
          title={`Historique · ${historyLabel}`}
          onClose={() => setHistory(null)}
        >
          <section className="planner-panel" style={{ display: "grid", gap: "16px" }}>
            {!history.length ? (
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Aucun historique disponible.</p>
            ) : (
              <ol className="template-history-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "10px", maxHeight: "60vh", overflowY: "auto" }}>
                {history.map((v) => (
                  <li key={v.id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 16px", display: "grid", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "13px", color: "#0f172a" }}>
                        Version {v.revision} · {v.label}
                      </strong>
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: v.isActive ? "#16a34a" : "#64748b" }}>
                        {v.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: "12.5px", color: "#334155" }}>
                      {v?.startTime} – {v?.endTime} · {durationLabel(v.durationMinutes)}
                    </p>
                    <time style={{ fontSize: "11.5px", color: "#94a3b8", fontFamily: "monospace" }}>
                      {new Date(v.createdAt).toLocaleString('fr-FR', {
                        timeZone: station.timezone,
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            <div className="planner-actions" style={{ display: "flex", justifyContent: "flex-end", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
              <button
                type="button"
                className="admin-button secondary"
                onClick={() => setHistory(null)}
                style={{ height: "36px", borderRadius: "8px", fontSize: "13px" }}
              >
                Fermer
              </button>
            </div>
          </section>
        </Modal>
      )}
    </section>
  );
}