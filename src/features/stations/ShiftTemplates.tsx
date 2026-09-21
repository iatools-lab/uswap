import { Modal } from "../../ui/Modal";
import { useEffect, useState, type FormEvent } from 'react';
import {
  ClockIcon,
  PlusIcon,
  PencilSimpleIcon,
  ArrowLeftIcon,
  ClockCounterClockwiseIcon,
} from '@phosphor-icons/react';
import { api } from '../../api/auth-api';
import { notify } from '../../ui/Toast';
import './shift-templates.css';

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

export const shiftBreakError = (
  start: string,
  end: string,
  breakStart: string,
  breakEnd: string,
) => {
  if (!breakStart && !breakEnd) return "";
  if (!breakStart || !breakEnd) return "Renseignez le début et la fin de la pause.";
  const shiftMinutes = shiftDuration(start, end);
  const pauseMinutes = shiftDuration(breakStart, breakEnd);
  if (!pauseMinutes) return "La pause doit avoir une durée supérieure à zéro.";
  const mins = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const pauseOffset = (mins(breakStart) - mins(start) + 1440) % 1440;
  if (pauseOffset >= shiftMinutes || pauseOffset + pauseMinutes > shiftMinutes)
    return "La pause doit être entièrement comprise dans les horaires du shift.";
  return "";
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
  const breakError = form
    ? shiftBreakError(form.startTime, form.endTime, form.breakStart, form.breakEnd)
    : "";

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
    <section className="shift-templates">
      {/* En-tête de la page */}
      <div className="shift-templates-head">
        <div>
          <button
            type="button"
            className="text-button planner-back shift-templates-back"
            disabled={busy}
            onClick={onBack}
          >
            <ArrowLeftIcon size={15} weight="bold" /> Stations
          </button>
          <h2 className="shift-templates-title">{station.name}</h2>
          <p className="planner-muted shift-templates-subtitle">Modèles de shifts · {station.timezone}</p>
        </div>

        <button
          type="button"
          className="admin-button shift-templates-create"
          disabled={busy || !station.isActive}
          onClick={() => edit()}
        >
          <PlusIcon size={16} weight="bold" /> Nouveau modèle
        </button>
      </div>

      {!station.isActive && (
        <div className="shift-templates-notice" role="status">
          Cette station est inactive. Ses modèles restent consultables.
        </div>
      )}

      {error && (
        <div className="error-message shift-templates-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="text-button shift-templates-reload"
            onClick={() => {
              setForm(null);
              setRevision((r) => r + 1);
            }}
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
          <form className="admin-card user-form-card shift-template-form" onSubmit={save}>
            <fieldset disabled={busy} className="planner-fieldset shift-template-fieldset">
              <div className="user-form-grid shift-template-form-grid">
                <label className="wide">
                  Libellé
                  <input
                    required
                    maxLength={80}
                    autoFocus
                    placeholder="Ex. Équipe de nuit"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </label>

                <label>
                  Heure de début
                  <input
                    type="time"
                    required
                    value={form?.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  />
                </label>

                <label>
                  Heure de fin
                  <input
                    type="time"
                    required
                    value={form?.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  />
                </label>

                <label>
                  Début de pause (optionnel)
                  <input
                    type="time"
                    value={form.breakStart}
                    onChange={(e) => setForm({ ...form, breakStart: e.target.value })}
                  />
                </label>

                <label>
                  Fin de pause (optionnel)
                  <input
                    type="time"
                    value={form.breakEnd}
                    onChange={(e) => setForm({ ...form, breakEnd: e.target.value })}
                  />
                </label>
              </div>

              <div className="planner-hint shift-template-duration-box">
                <p>
                  Pause : {breakDuration} min · Temps effectif hors pause :{' '}
                  <strong>{durationLabel(netDuration)}</strong>
                </p>
                <p className="template-duration" role="status">
                  <ClockIcon size={16} />
                  {rawDuration
                    ? `Durée : ${durationLabel(rawDuration)}${
                        form?.endTime < form?.startTime ? ' · fin le lendemain' : ''
                      }`
                    : 'Choisissez deux heures différentes.'}
                </p>
              </div>
              {breakError && (
                <p className="error-message" role="alert">{breakError}</p>
              )}
            </fieldset>

            <div className="user-form-actions planner-actions shift-template-form-actions">
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                Annuler
              </button>
              <button
                className="admin-button"
                disabled={busy || !rawDuration || !form.label.trim() || !!breakError}
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
          <div className="planner-panel shift-template-confirm">
            <p>
              Voulez-vous vraiment {confirm.isActive ? 'désactiver' : 'réactiver'} «{' '}
              <strong>{confirm.label}</strong> » ?
            </p>
            {confirm.isActive && (
              <p className="planner-muted">
                Il ne sera plus proposé pour les nouvelles affectations. Les horaires déjà créés dans les plannings seront conservés.
              </p>
            )}
            <div className="planner-actions shift-template-confirm-actions">
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setConfirm(null)}
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
              >
                Confirmer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {loading ? (
        <p role="status" className="shift-templates-loading">Chargement des modèles…</p>
      ) : !items.length ? (
        <div className="admin-card admin-empty shift-templates-empty">
          <ClockIcon size={32} />
          <h3>Aucun modèle de shift</h3>
          <p>Définissez les horaires utilisés dans cette station.</p>
        </div>
      ) : (
        /* Grille de cartes */
        <div className="template-list shift-templates-list">
          {items.map((item) => (
            <article  className="admin-card template-card shift-template-card" key={item.id}>
              <div className="shift-template-card-head">
                <h3>{item.label}</h3>
                <span className={`admin-badge ${item.isActive ? 'active' : 'draft'}`}>
                  {item.isActive ? 'Actif' : 'Inactif'}
                </span>
              </div>

              <div>
                <p className="template-hours shift-template-card-hours">
                  {item?.startTime} – {item?.endTime}
                </p>
                <p className="shift-template-card-subtitle">
                  {durationLabel(item.durationMinutes)}
                  {item?.endTime < item?.startTime ? ' · fin le lendemain' : ''}
                </p>
              </div>

              {item.breakStart && (
                <div className="shift-template-break">
                  <p className="planner-muted">
                    Pause : {item.breakStart} – {item.breakEnd} · {item.breakMinutes} min
                  </p>
                </div>
              )}

              <div className="template-actions shift-template-card-actions">
                <button
                  type="button"
                  className="admin-button secondary"
                  disabled={busy || !station.isActive}
                  onClick={() => edit(item)}
                >
                  <PencilSimpleIcon size={14} /> Modifier
                </button>
                <button
                  type="button"
                  className={`text-button shift-template-toggle ${item.isActive ? 'danger' : 'success'}`}
                  disabled={busy || (!station.isActive && !item.isActive)}
                  onClick={() => {
                    setConfirm(item);
                    setError('');
                  }}
                >
                  {item.isActive ? 'Désactiver' : 'Réactiver'}
                </button>
                <button
                  type="button"
                  className="text-button shift-template-history-btn"
                  disabled={busy}
                  onClick={() => showHistory(item)}
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
          <section className="planner-panel shift-template-history">
            {!history.length ? (
              <p className="shift-template-card-subtitle">Aucun historique disponible.</p>
            ) : (
              <ol className="template-history-list shift-template-history-list">
                {history.map((v) => (
                  <li key={v.id}>
                    <strong>Version {v.revision} · {v.label}</strong>
                    <p>
                      {v?.startTime} – {v?.endTime} · {durationLabel(v.durationMinutes)} · {v.isActive ? 'Actif' : 'Inactif'}
                    </p>
                    <time>
                      {new Date(v.createdAt).toLocaleString('fr-FR', {
                        timeZone: station.timezone,
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            <div className="planner-actions shift-template-history-actions">
              <button type="button" className="admin-button secondary" onClick={() => setHistory(null)}>
                Fermer
              </button>
            </div>
          </section>
        </Modal>
      )}
    </section>
  );
}
