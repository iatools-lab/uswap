import React, { useEffect, useState, useRef, type FormEvent } from 'react';
import { Modal } from "./modal";
import { StepperModal, type StepItem } from './StepperModal';
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  CalendarIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PlusIcon,
  RowsIcon,
  ArrowLeftIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { DownloadSimple, Clock3, CaretDownIcon, Building2 } from "./icons";
import { api, type User } from './auth-api';
import { notify } from './Notifications';
import { ShiftConstraints, type ConstraintReport } from './ShiftConstraints';
import { exportToExcel } from './utils/excelExport';
import './planner.css';
import { StationPicker } from "./Stationpicker";

type Station = { id: string; name: string; timezone: string; isActive: boolean };
type Template = { id: string; label: string; startTime: string; endTime: string; isActive: boolean };
type Occurrence = {
  id: string;
  station: Station;
  templateVersion: {
    label: string;
    breakStart: string | null;
    breakEnd: string | null;
    breakMinutes: number;
  };
  swapper: { id: string; fullName: string; email: string; phoneNumber: string | null } | null;
  startTime: string;
  endTime: string;
};
type Planning = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  revision: number;
  occurrences: Occurrence[];
  _count?: { occurrences: number };
};
type Preview = {
  previewHash: string;
  occurrences: {
    label: string;
    stationName: string;
    timezone: string;
    startTime: string;
    endTime: string;
    durationHours: number;
  }[];
  duplicates: unknown[];
  outside: unknown[];
};

const day = (value: string) => new Date(value).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const shortDay = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const time = (value: string, zone: string) =>
  new Date(value).toLocaleString('fr-FR', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' });
const clock = (value: string, zone: string) =>
  new Date(value).toLocaleTimeString('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
const period = (p: Planning) => `${day(p.startDate)} au ${day(p.endDate)}`;
const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const groupKey = (o: Occurrence) => `${o.station.id}|${o?.templateVersion?.label}|${o?.startTime}|${o?.endTime}`;

type ShiftGroup = {
  key: string;
  label: string;
  start: string;
  end: string;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number;
  station: Station;
  occurrences: Occurrence[];
};

function groupOccurrences(list: Occurrence[]): ShiftGroup[] {
  const map = new Map<string, ShiftGroup>();
  for (const o of list) {
    let g = map.get(groupKey(o));
    if (!g) {
      g = {
        key: groupKey(o),
        label: o?.templateVersion?.label,
        start: o?.startTime,
        end: o?.endTime,
        breakStart: o.templateVersion.breakStart,
        breakEnd: o.templateVersion.breakEnd,
        breakMinutes: o.templateVersion.breakMinutes,
        station: o.station,
        occurrences: [],
      };
      map.set(g.key, g);
    }
    g.occurrences.push(o);
  }
  return Array.from(map.values());
}

type CalendarDay = { key: string; iso: string; weekday: number; occurrences: Occurrence[] };
type CalendarWeek = { key: string; start: string; end: string; days: CalendarDay[] };

function buildCalendar(startDate: string, endDate: string, rows: Occurrence[]): CalendarWeek[] {
  const byDate = new Map<string, Occurrence[]>();
  for (const o of rows) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: o?.station?.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(o?.startTime));
    const list = byDate.get(key);
    if (list) list.push(o);
    else byDate.set(key, [o]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a?.startTime.localeCompare(b?.startTime));

  const first = new Date(startDate.slice(0, 10) + 'T00:00:00Z');
  const last = new Date(endDate.slice(0, 10) + 'T00:00:00Z');
  const monday = new Date(first);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

  const weeks: CalendarWeek[] = [];
  for (let w = new Date(monday); w <= last; w.setUTCDate(w.getUTCDate() + 7)) {
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(w);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString();
      const key = iso.slice(0, 10);
      days.push({ key, iso, weekday: i, occurrences: byDate.get(key) || [] });
    }
    weeks.push({ key: w.toISOString(), start: days[0].iso, end: days[6].iso, days });
  }
  return weeks;
}

const utcIso = (d: Date) => d.toISOString().slice(0, 10);

function shiftAnchor(anchor: string, view: string, dir: number) {
  const d = new Date(anchor + 'T00:00:00Z');
  if (view === 'day') d.setUTCDate(d.getUTCDate() + dir);
  else if (view === 'week') d.setUTCDate(d.getUTCDate() + dir * 7);
  else if (view === 'month') {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + dir);
  } else {
    d.setUTCMonth(0, 1);
    d.setUTCFullYear(d.getUTCFullYear() + dir);
  }
  return utcIso(d);
}

function periodTitle(view: string, from: Date, to: Date) {
  const long = {
    timeZone: 'UTC' as const,
    weekday: 'long' as const,
    day: 'numeric' as const,
    month: 'long' as const,
    year: 'numeric' as const,
  };
  const dayMonth = { timeZone: 'UTC' as const, day: 'numeric' as const, month: 'long' as const };
  if (view === 'day') return from.toLocaleDateString('fr-FR', long);
  if (view === 'week')
    return `${from.toLocaleDateString('fr-FR', { ...dayMonth, weekday: 'short' })} – ${to.toLocaleDateString('fr-FR', { ...dayMonth, year: 'numeric' })}`;
  if (view === 'month') return from.toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  return from.toLocaleDateString('fr-FR', { timeZone: 'UTC', year: 'numeric' });
}

function covers(p: Planning, iso: string) {
  return p.startDate.slice(0, 10) <= iso && p.endDate.slice(0, 10) >= iso;
}

function daysBetween(from: Date, to: Date) {
  const days: { iso: string; weekday: number }[] = [];
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1))
    days.push({ iso: utcIso(d), weekday: (d.getUTCDay() + 6) % 7 });
  return days;
}

function monthCells(from: Date, to: Date) {
  const start = new Date(from);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(to);
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)));
  return daysBetween(start, end).map((d) => ({ ...d, inMonth: d.iso >= utcIso(from) && d.iso <= utcIso(to) }));
}

const periodTabs = [
  ['day', 'Journalier', 'Jour', CalendarBlankIcon],
  ['week', 'Hebdomadaire', 'Sem.', CalendarIcon],
  ['month', 'Mensuel', 'Mois', CalendarDotsIcon],
  ['year', 'Annuel', 'An', RowsIcon],
] as const;

function PeriodLegend() {
  return (
    <p className="planner-legend">
      <span>
        <i className="is-published" aria-hidden="true" />
        Publié
      </span>
      <span>
        <i className="is-draft" aria-hidden="true" />
        Brouillon
      </span>
    </p>
  );
}

function PeriodBoard({
  view,
  from,
  to,
  plans,
  stations,
  selectedStationFilter,
  onStationFilterChange,
  onDay,
  onPlan,
  busy,
}: {
  view: string;
  from: Date;
  to: Date;
  plans: Planning[];
  stations: Station[];
  selectedStationFilter: string;
  onStationFilterChange: (id: string) => void;
  onDay: (iso: string) => void;
  onPlan: (id: string) => void;
  busy: boolean;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const [selectedMobileDate, setSelectedMobileDate] = useState(today);

  const filteredPlans = plans.filter((p) => {
    if (!selectedStationFilter) return true;
    const occurrences = p.occurrences || [];
    return occurrences.some((o) => o.station?.id === selectedStationFilter);
  });

  // Génération des 7 jours de la semaine courante pour le calendrier mobile interactif
  const weekDaysList = (() => {
    const startOfWeek = new Date(from);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - ((startOfWeek.getUTCDay() + 6) % 7));
    const list = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setUTCDate(d.getUTCDate() + i);
      list.push(utcIso(d));
    }
    return list;
  })();

  const selectedDayPlans = filteredPlans.filter((p) => covers(p, selectedMobileDate));

  return (
    <div className="planner-board" style={{ display: "grid", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", padding: "12px 16px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Building2 size={18} style={{ color: "#3b82f6" }} />
          <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#0f172a" }}>Filtrer par station :</span>
        </div>
        <div style={{ width: "280px" }}>
          <StationPicker
            value={selectedStationFilter}
            onChange={onStationFilterChange}
            stations={stations}
            placeholder="Toutes les stations"
          />
        </div>
      </div>

      <PeriodLegend />

      {/* VERSION MOBILE INTERACTIVE (Affichée en priorité sur petits écrans) */}
      <div className="mobile-interactive-calendar-wrapper">
        <div className="mobile-interactive-calendar">
          <div className="mobile-days-strip">
            {weekDaysList.map((isoStr) => {
              const dObj = new Date(isoStr + 'T00:00:00Z');
              const weekdayName = weekdays[(dObj.getUTCDay() + 6) % 7];
              const dayNum = Number(isoStr.slice(8));
              const isActive = isoStr === selectedMobileDate;
              const hasEvents = filteredPlans.some((p) => covers(p, isoStr));

              return (
                <div
                  key={isoStr}
                  className={'day-pill' + (isActive ? ' active' : '')}
                  onClick={() => setSelectedMobileDate(isoStr)}
                >
                  <small>{weekdayName}</small>
                  <strong>{dayNum}</strong>
                  {hasEvents && <span className="event-dot" />}
                </div>
              );
            })}
          </div>

          <div className="selected-day-card">
            <div className="day-card-header">
              <strong>{new Date(selectedMobileDate + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
              <span className="admin-badge active">{selectedDayPlans.length} Planning(s)</span>
            </div>
            <div className="day-card-body" style={{ display: "grid", gap: "8px" }}>
              {selectedDayPlans.length === 0 ? (
                <p className="planner-day-empty" style={{ padding: "12px 0", textAlign: "center" }}>Aucun planning pour cette date.</p>
              ) : (
                selectedDayPlans.map((p) => {
                  const isDraft = p.status === 'DRAFT';
                  const occurrences = p.occurrences || [];
                  const count = p._count?.occurrences ?? occurrences.length;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={'planner-range' + (isDraft ? ' is-draft' : '')}
                      disabled={busy}
                      onClick={() => onPlan(p.id)}
                      style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span className={'admin-badge' + (isDraft ? ' draft' : ' active')}>
                          {isDraft ? 'Brouillon' : 'Publié'}
                        </span>
                        <small style={{ color: "#64748b" }}>{period(p)}</small>
                      </div>
                      <strong style={{ color: "#0f172a" }}>{count} shift(s)</strong>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* VUES DESKTOP CLASSIQUES */}
      <div className="desktop-calendar-views">
        {view === 'year' && (
          <div className="planner-year" aria-label="Mois de l’année">
            {Array.from({ length: 12 }, (_, i) => {
              const start = new Date(Date.UTC(from.getUTCFullYear(), i, 1));
              const end = new Date(Date.UTC(from.getUTCFullYear(), i + 1, 0));
              const iso = utcIso(start);
              const overlapping = filteredPlans.filter(
                (p) => p.startDate && p.endDate && p.startDate.slice(0, 10) <= utcIso(end) && p.endDate.slice(0, 10) >= iso,
              );
              const covered = daysBetween(start, end).filter((d) => overlapping.some((p) => covers(p, d.iso))).length;
              return (
                <button type="button" className="planner-year-month" key={iso} onClick={() => onDay(iso)}>
                  <strong>{start.toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long' })}</strong>
                  <span>
                    {overlapping.length ? `${overlapping.length} planning${overlapping.length > 1 ? 's' : ''}` : 'Aucun planning'}
                  </span>
                  {overlapping.length > 0 && <span>{covered} j. couverts</span>}
                  <span className="planner-year-bar" aria-hidden="true">
                    <i style={{ width: `${Math.round((covered / end.getUTCDate()) * 100)}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {view === 'month' && (
          <div className="planner-month" aria-label="Calendrier du mois">
            <div className="planner-month-weekdays">
              {weekdays.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="planner-month-grid">
              {monthCells(from, to).map((d) => {
                const overlapping = filteredPlans.filter((p) => p.startDate && p.endDate && covers(p, d.iso));
                return (
                  <div
                    key={d.iso}
                    className={'planner-cell' + (d.inMonth ? '' : ' is-outside') + (d.iso === today ? ' is-today' : '')}
                  >
                    <button type="button" className="planner-cell-num" onClick={() => onDay(d.iso)}>
                      {Number(d.iso.slice(8))}
                    </button>
                    
                    {overlapping.length > 0 && (
                      <div className="planner-cell-events">
                        {overlapping.map((p) => {
                          const isDraft = p.status === 'DRAFT';
                          const occurrences = p.occurrences || [];
                          const count = p._count?.occurrences ?? occurrences.length;
                          return (
                            <button
                              type="button"
                              key={p.id}
                              className={'planner-event-chip' + (isDraft ? ' is-draft' : '')}
                              disabled={busy}
                              onClick={() => onPlan(p.id)}
                              title={`Planning du ${day(p.startDate)} au ${day(p.endDate)} (${count} shifts) — Cliquer pour ouvrir`}
                            >
                              <span className="event-dot" />
                              <span className="event-text">
                                {count} shift{count > 1 ? 's' : ''} ({isDraft ? 'Brouillon' : 'Publié'})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(view === 'week' || view === 'day') && (
          <div
            className={'planner-week-overview' + (view === 'day' ? ' is-single' : '')}
            aria-label={view === 'day' ? 'Jour sélectionné' : 'Jours de la semaine'}
          >
            {daysBetween(from, to).map((d) => {
              const overlapping = filteredPlans.filter((p) => p.startDate && p.endDate && covers(p, d.iso));
              return (
                <div className={'planner-week-day' + (d.iso === today ? ' is-today' : '')} key={d.iso}>
                  <button type="button" className="planner-week-day-head" onClick={() => onDay(d.iso)}>
                    <strong>{weekdays[d.weekday]}</strong>
                    <span>{Number(d.iso.slice(8))}</span>
                  </button>
                  {overlapping.length === 0 ? (
                    <p className="planner-day-empty">Aucun planning</p>
                  ) : (
                    overlapping.map((p) => {
                      const occurrences = p.occurrences || [];
                      return (
                        <button
                          type="button"
                          className={'planner-range' + (p.status === 'DRAFT' ? ' is-draft' : '')}
                          disabled={busy}
                          key={p.id}
                          onClick={() => onPlan(p.id)}
                        >
                          <span className={'admin-badge' + (p.status === 'DRAFT' ? ' draft' : ' active')}>
                            {p.status === 'DRAFT' ? 'Brouillon' : 'Publié'}
                          </span>
                          <small>{period(p)}</small>
                          <strong>{p._count?.occurrences ?? occurrences.length} shifts</strong>
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Planner({ user }: { user: User }) {
  const writable = user.role === 'ADMIN' || user.role === 'SUPERVISOR';

  const [plans, setPlans] = useState<Planning[]>([]),
    [current, setCurrent] = useState<Planning | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false);

  const [view, setView] = useState('week'),
    [anchor, setAnchor] = useState(new Date().toLocaleDateString('en-CA')),
    [dayModalDate, setDayModalDate] = useState<string | null>(null);

  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reload, setReload] = useState(0);

  const [stations, setStations] = useState<Station[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [swappers, setSwappers] = useState<(User & { isActive: boolean })[]>([]);
  const [stationId, setStationId] = useState('');
  const [stationFilter, setStationFilter] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selectedSwappers, setSelectedSwappers] = useState<string[]>([]);
  const [publishDirectly, setPublishDirectly] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Planning[]>('/plannings')
      .then((p) => {
        if (active) {
          setPlans(p);
          setError('');
        }
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
  }, [reload]);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('planning');
    if (id) void open(id);
  }, []);

  useEffect(() => {
    let active = true;
    (writable ? api<Station[]>('/stations') : Promise.resolve([]))
      .then((s) => {
        if (active) setStations(s.filter((st) => st.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => { active = false; };
  }, [writable]);

  useEffect(() => {
    setTemplates([]);
    setSelectedTemplates([]);
    if (!stationId) return;
    let active = true;
    api<Template[]>(`/stations/${stationId}/shift-templates`)
      .then((t) => {
        if (active) setTemplates(t.filter((tpl) => tpl.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => { active = false; };
  }, [stationId]);

  useEffect(() => {
    let active = true;
    api<typeof swappers>('/users?role=SWAPPER')
      .then((u) => {
        if (active) setSwappers(u.filter((userItem) => userItem.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => { active = false; };
  }, []);

  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      const plan = await api<Planning>('/plannings/' + id);
      setCurrent(plan);
      setAnchor(plan.startDate.slice(0, 10));
      const notices = await api<{ id: string; planningId: string }[]>('/plannings/notices');
      await Promise.all(
        notices.filter((n) => n.planningId === id).map((n) => api('/plannings/notices/' + n.id + '/read', {}, 'PATCH')),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createPlanning() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setAnchor(start);
      const p = await api<Planning>('/plannings', {
        startDate: start + 'T00:00:00.000Z',
        endDate: end + 'T23:59:59.999Z',
      });

      if (stationId && selectedTemplates.length > 0 && selectedDays.length > 0) {
        const payload = {
          stationId,
          templateIds: selectedTemplates,
          weekdays: selectedDays,
          revision: p.revision,
        };
        const previewRes = await api<Preview>(`/plannings/${p.id}/preview`, payload);
        await api(`/plannings/${p.id}/generate`, {
          ...payload,
          previewHash: previewRes.previewHash,
        });
      }

      if (publishDirectly) {
        const latestPlan = await api<Planning>('/plannings/' + p.id);
        await api(`/plannings/${p.id}/publish`, { revision: latestPlan.revision });
        notify('Planning créé et publié avec succès.');
      } else {
        notify('Planning brouillon créé avec succès.');
      }

      await open(p.id);
      setCreating(false);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (current)
    return (
      <PlanningEditor
        key={current.id}
        planning={current}
        writable={writable}
        user={user}
        onUpdate={setCurrent}
        onBack={() => {
          setCurrent(null);
          setReload((n) => n + 1);
        }}
      />
    );

  const anchorDate = new Date(anchor + 'T00:00:00Z'),
    from = new Date(anchorDate),
    to = new Date(anchorDate);

  if (view === 'week') {
    from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
    to.setTime(+from);
    to.setUTCDate(to.getUTCDate() + 6);
  }

  if (view === 'month') {
    from.setUTCDate(1);
    to.setUTCMonth(to.getUTCMonth() + 1, 0);
  }

  if (view === 'year') {
    from.setUTCMonth(0, 1);
    to.setUTCMonth(11, 31);
  }

  const visible = plans.filter(
    (p) => p.startDate && p.endDate && p.startDate.slice(0, 10) <= to.toISOString().slice(0, 10) && p.endDate.slice(0, 10) >= from.toISOString().slice(0, 10),
  );

  const createSteps: StepItem[] = [
    {
      id: "period",
      label: "Choix de la période",
      isValid: () => !!start && !!end && end >= start,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>PREMIER JOUR *</label>
            <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="stepper-field-group">
            <label>DERNIER JOUR *</label>
            <input type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      ),
    },
    {
      id: "station",
      label: "Affecter la station",
      isValid: () => !!stationId,
      content: (
        <div className="stepper-form-layout" style={{ minHeight: "260px" }}>
          <div className="stepper-field-group">
            <label>STATION CIBLE *</label>
            <StationPicker
              value={stationId}
              onChange={(val: string) => setStationId(val)}
              stations={stations}
            />
          </div>
        </div>
      ),
    },
    {
      id: "shift",
      label: "Choix du shift",
      isValid: () => true,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>MODÈLES DE SHIFT DISPONIBLES</label>
            {templates.length === 0 ? (
              <p className="planner-muted">Aucun modèle actif pour cette station.</p>
            ) : (
              <div className="planner-options" style={{ background: "#ffffff", padding: "8px" }}>
                {templates.map((t) => (
                  <label key={t.id} className="checkbox-label" style={{ padding: "4px 0" }}>
                    <input
                      type="checkbox"
                      checked={selectedTemplates.includes(t.id)}
                      onChange={(e) => {
                        setSelectedTemplates(
                          e.target.checked ? [...selectedTemplates, t.id] : selectedTemplates.filter((id) => id !== t.id),
                        );
                      }}
                    />
                    <span>{t.label} (<strong>{t?.startTime}–{t?.endTime}</strong>)</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="stepper-field-group">
            <label>JOURS DE LA SEMAINE CONCERNÉS</label>
            <div className="planner-days" style={{ background: "#ffffff", padding: "8px" }}>
              {weekdays.map((label, i) => (
                <label key={label} className="checkbox-label" style={{ display: "inline-flex", marginRight: "12px" }}>
                  <input
                    type="checkbox"
                    checked={selectedDays.includes(i + 1)}
                    onChange={(e) => {
                      setSelectedDays(
                        e.target.checked ? [...selectedDays, i + 1] : selectedDays.filter((d) => d !== i + 1),
                      );
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "swappers",
      label: "Affecter les swappeurs",
      isValid: () => true,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>SÉLECTIONNER LES SWAPPEURS (OPTIONNEL)</label>
            <div style={{ maxHeight: "200px", overflowY: "auto", background: "#fff", padding: "8px", border: "1px solid #cbd5e1", borderRadius: "8px", display: "grid", gap: "4px" }}>
              {swappers.map((u) => (
                <label key={u.id} className="checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                  <input
                    type="checkbox"
                    checked={selectedSwappers.includes(u.id)}
                    onChange={(e) => {
                      setSelectedSwappers(
                        e.target.checked ? [...selectedSwappers, u.id] : selectedSwappers.filter((id) => id !== u.id)
                      );
                    }}
                  />
                  <span><strong>{u.fullName}</strong> ({u.email})</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "summary",
      label: "Récapitulatif",
      content: (
        <div className="stepper-form-layout">
          {error && <p className="error-message">{error}</p>}
          <div className="stepper-summary-card">
            <div className="summary-row">
              <span>Période :</span>
              <strong>{start ? day(start) : "—"} au {end ? day(end) : "—"}</strong>
            </div>
            <div className="summary-row">
              <span>Station :</span>
              <strong>{stations.find((s) => s.id === stationId)?.name || "Non spécifiée"}</strong>
            </div>
            <div className="summary-row">
              <span>Modèles de shift :</span>
              <strong>{selectedTemplates.length} sélectionné(s)</strong>
            </div>
            <div className="summary-row">
              <span>Swappeurs pré-sélectionnés :</span>
              <strong>{selectedSwappers.length} collaborateur(s)</strong>
            </div>
          </div>

          <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              id="publishDirectly"
              checked={publishDirectly}
              onChange={(e) => setPublishDirectly(e.target.checked)}
              style={{ width: "16px", height: "16px" }}
            />
            <label htmlFor="publishDirectly" style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", cursor: "pointer" }}>
              Publier directement le planning (sinon enregistré en brouillon)
            </label>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="planner">
      <div className="planner-chrome">
        <div className="settings-tabs planner-period-tabs">
          {periodTabs.map(([value, label, short, Icon]) => (
            <button
              type="button"
              key={value}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              <Icon size={16} weight="regular" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="planner-period-nav">
          <button
            type="button"
            className="planner-step"
            aria-label="Période précédente"
            onClick={() => setAnchor(shiftAnchor(anchor, view, -1))}
          >
            <CaretLeftIcon size={16} />
          </button>

          <div className="planner-period-picker">
            <strong>{periodTitle(view, from, to)}</strong>
            <input
              type="date"
              value={anchor}
              onChange={(e) => {
                if (e.target.value) setAnchor(e.target.value);
              }}
            />
          </div>

          <button
            type="button"
            className="planner-step"
            aria-label="Période suivante"
            onClick={() => setAnchor(shiftAnchor(anchor, view, 1))}
          >
            <CaretRightIcon size={16} />
          </button>
        </div>

        {writable && !creating && (
          <button className="admin-button" onClick={() => setCreating(true)}>
            <PlusIcon weight="regular" size={16} />
            Nouveau planning…
          </button>
        )}
      </div>

      {error && !creating && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </button>
        </p>
      )}

      <div style={{ "--modal-max-width": "840px" } as React.CSSProperties}>
        <StepperModal
          open={creating}
          title="Création guidée du planning"
          icon={<CalendarIcon size={20} />}
          steps={createSteps}
          submitLabel={publishDirectly ? "Créer et publier" : "Enregistrer le brouillon"}
          busy={busy}
          onClose={() => setCreating(false)}
          onSubmit={createPlanning}
        />
      </div>

      {dayModalDate && (
        <DaySummaryModal
          dateIso={dayModalDate}
          plans={plans}
          onClose={() => setDayModalDate(null)}
          onOpenPlanning={(id) => {
            setDayModalDate(null);
            void open(id);
          }}
        />
      )}

      {loading ? (
        <p role="status">Chargement des plannings…</p>
      ) : (
        <PeriodBoard
          view={view}
          from={from}
          to={to}
          plans={visible}
          stations={stations}
          selectedStationFilter={stationFilter}
          onStationFilterChange={setStationFilter}
          busy={busy}
          onPlan={open}
          onDay={(iso) => {
            setDayModalDate(iso);
          }}
        />
      )}
    </div>
  );
}

function DaySummaryModal({
  dateIso,
  plans,
  onClose,
  onOpenPlanning,
}: {
  dateIso: string;
  plans: Planning[];
  onClose: () => void;
  onOpenPlanning: (planningId: string) => void;
}) {
  const dayOccurrences: { planningId: string; occurrence: Occurrence }[] = [];

  for (const p of plans) {
    if (p.startDate && p.endDate && p.startDate.slice(0, 10) <= dateIso && p.endDate.slice(0, 10) >= dateIso) {
      const occurrences = p.occurrences || [];
      for (const o of occurrences) {
        if (!o?.startTime || !o?.station?.timezone) continue;
        const oDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: o.station.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(o.startTime));

        if (oDate === dateIso) {
          dayOccurrences.push({ planningId: p.id, occurrence: o });
        }
      }
    }
  }

  return (
    <Modal open title={`Shifts du ${day(dateIso)}`} onClose={onClose}>
      <div className="planner-roster" style={{ minWidth: "640px" }}>
        {dayOccurrences.length === 0 ? (
          <p className="planner-muted" style={{ textAlign: "center", padding: "24px 0" }}>
            Aucun shift enregistré pour cette date.
          </p>
        ) : (
          <div className="admin-table-wrap planner-roster-table">
            <table className="admin-table" aria-label="Shifts de la journée">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Shift / Modèle</th>
                  <th>Swappeur</th>
                  <th>Contact</th>
                  <th>Statut</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {dayOccurrences.map(({ planningId, occurrence: o }) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.station?.name}</strong>
                    </td>
                    <td>
                      <div>{o.templateVersion?.label}</div>
                      <small className="planner-muted">
                        {clock(o.startTime, o.station?.timezone)} – {clock(o.endTime, o.station?.timezone)}
                      </small>
                    </td>
                    <td>
                      {o.swapper ? (
                        <strong>{o.swapper.fullName}</strong>
                      ) : (
                        <span className="planner-muted">Non affecté</span>
                      )}
                    </td>
                    <td>
                      <div className="planner-roster-contact">
                        {o.swapper ? (
                          <>
                            {o.swapper.email && <a href={'mailto:' + o.swapper.email}>{o.swapper.email}</a>}
                            {o.swapper.phoneNumber && <a href={'tel:' + o.swapper.phoneNumber}>{o.swapper.phoneNumber}</a>}
                          </>
                        ) : (
                          '—'
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={'admin-badge' + (o.swapper ? ' active' : ' draft')}>
                        {o.swapper ? 'Confirmé' : 'À affecter'}
                      </span>
                    </td>
                    <td className="planner-roster-action">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onOpenPlanning(planningId)}
                      >
                        Gérer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="planner-actions" style={{ justifyContent: "flex-end", marginTop: "12px" }}>
          <button type="button" className="admin-button secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PlanningEditor({
  planning: p,
  writable,
  user,
  onUpdate,
  onBack,
}: {
  planning: Planning;
  writable: boolean;
  user: User;
  onUpdate: (p: Planning) => void;
  onBack: () => void;
}) {
  const [stations, setStations] = useState<Station[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [stationId, setStation] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [days, setDays] = useState([1, 2, 3, 4, 5]),
    [preview, setPreview] = useState<Preview | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [openGroupKey, setOpenGroupKey] = useState<string | null>(null),
    [focusOccurrenceId, setFocusOccurrenceId] = useState<string | null>(null),
    [stationFilter, setStationFilter] = useState(''),
    [publication, setPublication] = useState(false),
    [report, setReport] = useState<{ valid: boolean; errors: { message: string; occurrenceId?: string }[] } | null>(null);

  const canEdit = writable && p.status === 'DRAFT';
  const occurrences = p.occurrences || [];

  async function publish(confirm: boolean) {
    setBusy(true);
    setError('');
    try {
      if (confirm) {
        await api(`/plannings/${p.id}/publish`, { revision: p.revision });
        await refresh();
        setPublication(false);
        notify('Planning publié dans les espaces concernés.');
      } else {
        setReport(await api(`/plannings/${p.id}/validate`, { revision: p.revision }));
        setPublication(true);
      }
    } catch (e) {
      setError((e as Error).message);
      setPublication(false);
    } finally {
      setBusy(false);
    }
  }

  function handleExportExcel() {
    if (!occurrences.length) return;
    exportToExcel<Occurrence>({
      data: occurrences,
      filename: `planning_${p.startDate.slice(0, 10)}_au_${p.endDate.slice(0, 10)}`,
      sheetName: 'Affectations',
      columns: [
        { header: 'Station', key: (o: Occurrence) => o?.station?.name, width: 25 },
        { header: 'Shift / Modèle', key: (o: Occurrence) => o?.templateVersion?.label, width: 22 },
        { header: 'Swappeur affecté', key: (o: Occurrence) => (o.swapper ? o?.swapper?.fullName : 'Non affecté'), width: 25 },
        { header: 'Email Swappeur', key: (o: Occurrence) => (o.swapper ? o?.swapper?.email : '—'), width: 25 },
        { header: 'Téléphone Swappeur', key: (o: Occurrence) => o.swapper?.phoneNumber || '—', width: 18 },
        { header: 'Début shift', key: (o: Occurrence) => time(o?.startTime, o?.station?.timezone), width: 22 },
        { header: 'Fin shift', key: (o: Occurrence) => time(o?.endTime, o?.station?.timezone), width: 22 },
        { header: 'Statut poste', key: (o: Occurrence) => (o.swapper ? 'Affecté' : 'À affecter'), width: 15 },
      ],
    });
    notify('Exportation Excel du planning réussie.');
  }

  useEffect(() => {
    let active = true;
    (writable ? api<Station[]>('/stations') : Promise.resolve([]))
      .then((s) => {
        if (active) setStations(s.filter((s) => s.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setTemplates([]);
    setSelected([]);
    setPreview(null);
    if (!stationId) return;
    let active = true;
    api<Template[]>(`/stations/${stationId}/shift-templates`)
      .then((t) => {
        if (active) setTemplates(t.filter((t) => t.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId]);

  async function refresh() {
    const latest = await api<Planning>('/plannings/' + p.id);
    onUpdate(latest);
  }

  async function generate(confirm: boolean) {
    setBusy(true);
    setError('');
    try {
      const payload = {
        stationId,
        templateIds: selected,
        weekdays: days,
        revision: p.revision,
        ...(confirm ? { previewHash: preview?.previewHash } : {}),
      };
      if (!confirm) setPreview(await api<Preview>(`/plannings/${p.id}/preview`, payload));
      else {
        await api(`/plannings/${p.id}/generate`, payload);
        setPreview(null);
        setAdding(false);
        await refresh();
        notify('Shifts ajoutés au brouillon.');
      }
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = occurrences.filter((o) => !stationFilter || o.station?.id === stationFilter);
  const calendar = buildCalendar(p.startDate, p.endDate, rows);

  const openGroupOccurrences = openGroupKey ? occurrences.filter((o) => groupKey(o) === openGroupKey) : [];
  const openGroup: ShiftGroup | null = openGroupOccurrences.length
    ? {
        key: openGroupKey!,
        label: openGroupOccurrences[0].templateVersion.label,
        start: openGroupOccurrences[0].startTime,
        end: openGroupOccurrences[0].endTime,
        breakStart: openGroupOccurrences[0].templateVersion.breakStart,
        breakEnd: openGroupOccurrences[0].templateVersion.breakEnd,
        breakMinutes: openGroupOccurrences[0].templateVersion.breakMinutes,
        station: openGroupOccurrences[0].station,
        occurrences: openGroupOccurrences,
      }
    : null;

  const addShiftSteps: StepItem[] = [
    {
      id: "station",
      label: "Sélection station",
      isValid: () => !!stationId,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>STATION CONCERNÉE *</label>
            <StationPicker
              value={stationId}
              onChange={(val) => setStation(val)}
              stations={stations}
            />
          </div>
        </div>
      ),
    },
    {
      id: "models",
      label: "Modèles & Jours",
      isValid: () => selected.length > 0 && days.length > 0,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>MODÈLES DE SHIFT DISPONIBLES *</label>
            {templates.length === 0 ? (
              <p className="planner-muted">Aucun modèle actif sur cette station.</p>
            ) : (
              <div className="planner-options" style={{ background: "#ffffff", padding: "8px" }}>
                {templates.map((t) => (
                  <label key={t.id} className="checkbox-label" style={{ padding: "4px 0" }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id),
                        );
                        setPreview(null);
                      }}
                    />
                    <span>{t.label} (<strong>{t?.startTime}–{t?.endTime}</strong>)</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="stepper-field-group">
            <label>JOURS DE LA SEMAINE *</label>
            <div className="planner-days" style={{ background: "#ffffff", padding: "8px" }}>
              {weekdays.map((label, i) => (
                <label key={label} className="checkbox-label" style={{ display: "inline-flex", marginRight: "12px" }}>
                  <input
                    type="checkbox"
                    checked={days.includes(i + 1)}
                    onChange={(e) => {
                      setDays(
                        e.target.checked ? [...days, i + 1] : days.filter((d) => d !== i + 1),
                      );
                      setPreview(null);
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "preview",
      label: "Aperçu & Validation",
      content: (
        <div className="stepper-form-layout">
          {error && <p className="error-message">{error}</p>}

          {!preview ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <p style={{ fontSize: "13.5px", color: "#64748b" }}>
                Cliquez ci-dessous pour calculer l'aperçu des shifts à ajouter.
              </p>
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => generate(false)}
                style={{ marginTop: "12px" }}
              >
                Générer l'aperçu des shifts
              </button>
            </div>
          ) : (
            <div className="planner-preview" style={{ marginTop: 0 }}>
              <h3>{preview.occurrences.length} shifts à ajouter au brouillon</h3>
              {preview.duplicates.length > 0 && <p>{preview.duplicates.length} doublons ignorés.</p>}
              <div className="planner-preview-rows" style={{ maxHeight: "180px", overflowY: "auto" }}>
                {preview.occurrences.map((o, i) => (
                  <div className="planner-preview-row" key={i}>
                    <strong>{o.label}</strong>
                    <span>{o.stationName}</span>
                    <span>{time(o?.startTime, o.timezone)} – {time(o?.endTime, o.timezone)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="planner">
      <div className="planner-toolbar">
        <div>
          <button type="button" className="text-button planner-back" onClick={onBack}>
            <ArrowLeftIcon size={15} weight="bold" /> Tous les plannings
          </button>
          <h2>{period(p)}</h2>
          <p className="planner-muted">
            <span className={'admin-badge' + (p.status === 'DRAFT' ? ' draft' : ' active')}>
              {p.status === 'DRAFT' ? 'Brouillon' : 'Publié'}
            </span>
            <span>{occurrences.length} shifts</span>
          </p>
        </div>

        <div className="planner-actions">
          {occurrences.length > 0 && (
            <>
              <button
                type="button"
                className="admin-button secondary"
                onClick={handleExportExcel}
                title="Exporter ce planning au format Excel"
              >
                <DownloadSimple size={16} />
                <span>Exporter Excel</span>
              </button>

              <select
                aria-label="Station affichée"
                className="planner-filter-select"
                value={stationFilter}
                onChange={(e) => setStationFilter(e.target.value)}
              >
                <option value="">Toutes les stations</option>
                {Array.from(new Map(occurrences.map((o) => [o.station?.id, o.station])).values()).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {canEdit && !adding && !openGroupKey && (
            <button className="admin-button secondary" onClick={() => setAdding(true)}>
              <PlusIcon weight="regular" /> Ajouter des shifts…
            </button>
          )}
          {canEdit && (
            <button className="admin-button" disabled={busy} onClick={() => publish(false)}>
              Vérifier et publier…
            </button>
          )}
        </div>
      </div>

      {publication && (
        <Modal
          open
          title="Publier le planning"
          onClose={() => {
            if (!busy) setPublication(false);
          }}
        >
          <div className="planner">
            <p>Les swappeurs recevront leurs shifts et les chefs les horaires de leur station dans leur espace.</p>
            {report?.errors.map((issue, i) => (
              <div key={i}>
                <p>{issue.message}</p>
                {issue.occurrenceId && (
                  <button
                    className="text-button"
                    onClick={() => {
                      const o = occurrences.find((o) => o.id === issue.occurrenceId);
                      if (!o) return;
                      setPublication(false);
                      setFocusOccurrenceId(o.id);
                      setOpenGroupKey(groupKey(o));
                    }}
                  >
                    Corriger l’affectation
                  </button>
                )}
              </div>
            ))}
            <button className="admin-button" disabled={busy || !report?.valid} onClick={() => publish(true)}>
              Confirmer la publication
            </button>
          </div>
        </Modal>
      )}

      {error && !adding && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button
            className="text-button"
            onClick={() =>
              refresh()
                .then(() => {
                  setError('');
                  setPreview(null);
                })
                .catch((e) => setError(e.message))
            }
          >
            Recharger le planning
          </button>
        </p>
      )}

      <StepperModal
        open={adding}
        title="Ajouter des shifts au planning"
        icon={<Clock3 size={20} />}
        steps={addShiftSteps}
        submitLabel="Ajouter au brouillon"
        busy={busy}
        onClose={() => {
          setAdding(false);
          setPreview(null);
        }}
        onSubmit={() => generate(true)}
      />

      {openGroup && (
        <Modal
          open
          title={openGroup.label}
          subtitle={`${openGroup?.station?.name} · ${day(openGroup.start)}`}
          onClose={() => {
            setOpenGroupKey(null);
            setFocusOccurrenceId(null);
          }}
        >
          <ShiftRoster
            planning={p}
            group={openGroup}
            canEdit={canEdit}
            focusOccurrenceId={focusOccurrenceId}
            onConsumeFocus={() => setFocusOccurrenceId(null)}
            onUpdate={onUpdate}
            onClose={() => {
              setOpenGroupKey(null);
              setFocusOccurrenceId(null);
            }}
          />
        </Modal>
      )}

      {!rows.length ? (
        <section className="admin-card planner-empty">
          <CalendarBlankIcon size={30} weight="regular" />
          <h3>Aucun shift dans ce planning</h3>
          {canEdit && <p>Ajoutez les horaires à partir des modèles de station.</p>}
        </section>
      ) : (
        <div className="planner-calendar">
          {calendar.map((w) => (
            <details open className="planner-week" key={w.key}>
              <summary className="planner-week-title">
                Semaine du {day(w.start)} au {day(w.end)}{' '}
                <span>{w.days.reduce((n, d) => n + d.occurrences.length, 0)} shifts</span>
              </summary>
              <div className="planner-week-grid">
                {w.days.map((d) => (
                  <div className="planner-day" key={d.key}>
                    <header>
                      <strong>{weekdays[d.weekday]}</strong>
                      <span>{shortDay(d.iso)}</span>
                    </header>
                    {d.occurrences.length === 0 ? (
                      <p className="planner-day-empty">Aucun shift</p>
                    ) : (
                      groupOccurrences(d.occurrences).map((g) => {
                        const filled = g.occurrences.filter((o) => o.swapper).length;
                        const total = g.occurrences.length;
                        const full = filled === total;

                        const badgeLabel =
                          total > 1
                            ? `${filled}/${total} affectés`
                            : full
                            ? '1 affecté'
                            : 'À affecter';

                        return (
                          <button
                            type="button"
                            key={g.key}
                            className={'planner-occurrence-card' + (full ? '' : ' planner-vacant-card')}
                            disabled={busy || adding}
                            onClick={() => setOpenGroupKey(g.key)}
                          >
                            <strong>{g.label}</strong>
                            <small>
                              {clock(g.start, g?.station?.timezone)} – {clock(g.end, g?.station?.timezone)}
                            </small>
                            <p>{g?.station?.name}</p>
                            <span className={'admin-badge' + (full ? ' active' : ' draft')}>
                              {badgeLabel}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftRoster({
  planning: p,
  group: g,
  canEdit,
  focusOccurrenceId,
  onConsumeFocus,
  onUpdate,
  onClose,
}: {
  planning: Planning;
  group: ShiftGroup;
  canEdit: boolean;
  focusOccurrenceId: string | null;
  onConsumeFocus: () => void;
  onUpdate: (p: Planning) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (focusOccurrenceId && g.occurrences.some((o) => o.id === focusOccurrenceId)) {
      setEditingId(focusOccurrenceId);
      onConsumeFocus();
    }
  }, [focusOccurrenceId]);

  const editing = editingId ? g.occurrences.find((o) => o.id === editingId) || null : null;

  if (editing)
    return (
      <Assignment
        key={editing.id + ':' + p.revision}
        planning={p}
        occurrence={editing}
        onClose={() => setEditingId(null)}
        onSaved={async (opts) => {
          const latest = await api<Planning>('/plannings/' + p.id);
          onUpdate(latest);
          if (opts?.keepOpen) setEditingId(editing.id);
          else setEditingId(null);
          notify(opts?.message || 'Affectation enregistrée.');
        }}
      />
    );

  const multi = g.occurrences.length > 1;

  async function addSlot() {
    setBusy(true);
    setError('');
    try {
      await api(`/plannings/${p.id}/occurrences/${g.occurrences[0].id}/duplicate`, { revision: p.revision });
      onUpdate(await api<Planning>('/plannings/' + p.id));
      notify('Poste ajouté.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeSlot(occurrenceId: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/plannings/${p.id}/occurrences/${occurrenceId}/remove`, { revision: p.revision });
      onUpdate(await api<Planning>('/plannings/' + p.id));
      notify('Poste retiré.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="planner-roster">
      <p className="planner-roster-meta">
        {clock(g.start, g?.station?.timezone)} – {clock(g.end, g?.station?.timezone)}
        {g.breakStart && ` · Pause ${g.breakStart}–${g.breakEnd} (${g.breakMinutes} min)`}
      </p>

      {canEdit && (
        <p className="planner-muted">
          {g.occurrences.length} poste{multi ? 's' : ''} sur ce shift — chaque poste vacant peut recevoir un swappeur
          différent.
        </p>
      )}

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="admin-table-wrap planner-roster-table">
        <table className="admin-table" aria-label="Swappeurs affectés à ce shift">
          <thead>
            <tr>
              {multi && <th>Poste</th>}
              <th>Swappeur</th>
              <th>Contact</th>
              <th>Statut</th>
              {canEdit && <th aria-hidden="true" />}
            </tr>
          </thead>
          <tbody>
            {g.occurrences.map((o, i) => (
              <tr key={o.id}>
                {multi && <td className="planner-roster-slot">Poste {i + 1}</td>}
                <td>
                  {o.swapper ? (
                    <strong>{o?.swapper?.fullName}</strong>
                  ) : (
                    <span className="planner-muted">Non affecté</span>
                  )}
                </td>
                <td>
                  <div className="planner-roster-contact">
                    {o.swapper ? (
                      <>
                        {o?.swapper?.email && <a href={'mailto:' + o?.swapper?.email}>{o?.swapper?.email}</a>}
                        {o.swapper.phoneNumber && <a href={'tel:' + o.swapper.phoneNumber}>{o.swapper.phoneNumber}</a>}
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                </td>
                <td>
                  <span className={'admin-badge' + (o.swapper ? ' active' : ' draft')}>
                    {o.swapper ? 'Confirmé' : 'À affecter'}
                  </span>
                </td>
                {canEdit && (
                  <td className="planner-roster-action">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setEditingId(o.id)}
                    >
                      {o.swapper ? 'Changer' : 'Affecter'}
                    </button>

                    {!o.swapper && multi && (
                      <button
                        type="button"
                        className="planner-icon-btn danger"
                        disabled={busy}
                        title="Supprimer ce poste"
                        aria-label="Supprimer ce poste"
                        onClick={() => removeSlot(o.id)}
                      >
                        <TrashIcon size={16} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="planner-actions">
        <button type="button" className="admin-button secondary" onClick={onClose}>
          Fermer
        </button>
        {canEdit && (
          <button type="button" className="admin-button" disabled={busy} onClick={addSlot}>
            + Ajouter un poste
          </button>
        )}
      </div>
    </div>
  );
}

function Assignment({
  planning: p,
  occurrence: o,
  onClose,
  onSaved,
}: {
  planning: Planning;
  occurrence: Occurrence;
  onClose: () => void;
  onSaved: (opts?: { keepOpen?: boolean; message?: string }) => Promise<void>;
}) {
  const [users, setUsers] = useState<(User & { isActive: boolean })[] | undefined>(),
    [swapperId, setSwapper] = useState(o.swapper?.id || ''),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [report, setReport] = useState<{ id: string; value: ConstraintReport } | null>(null),
    [checking, setChecking] = useState(false),
    [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    api<(User & { isActive: boolean })[]>('/users?role=SWAPPER')
      .then((u) => {
        if (active) setUsers(u.filter((userItem) => userItem.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setReport(null);
    setError('');
    if (!swapperId) {
      setChecking(false);
      return;
    }
    let active = true;
    setChecking(true);
    api<ConstraintReport>(`/plannings/${p.id}/occurrences/${o.id}/validate`, { swapperId, revision: p.revision })
      .then((value) => {
        if (active) setReport({ id: swapperId, value });
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [swapperId, retry, p.id, p.revision, o.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/plannings/${p.id}/occurrences/${o.id}`, { swapperId: swapperId || null, revision: p.revision }, 'PATCH');
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api(`/plannings/${p.id}/occurrences/${o.id}`, { swapperId: null, revision: p.revision }, 'PATCH');
      setSwapper('');
      await onSaved({ keepOpen: true, message: 'Affectation retirée.' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = report?.id === swapperId ? report.value : undefined;

  return (
    <form className="admin-card planner-panel" onSubmit={save} aria-label="Affecter un swappeur">
      <h3>
        {o?.templateVersion?.label} · {o?.station?.name}
      </h3>
      <p>
        {time(o?.startTime, o?.station?.timezone)} – {time(o?.endTime, o?.station?.timezone)}
      </p>
      {o.templateVersion.breakStart && (
        <p>
          Pause : {o.templateVersion.breakStart} – {o.templateVersion.breakEnd} · {o.templateVersion.breakMinutes} min
        </p>
      )}
      {o.swapper && (
        <div className="planner-contact">
          <strong>{o?.swapper?.fullName}</strong>
          <a href={'mailto:' + o?.swapper?.email}>{o?.swapper?.email}</a>
          {o.swapper.phoneNumber ? (
            <a href={'tel:' + o.swapper.phoneNumber}>{o.swapper.phoneNumber}</a>
          ) : (
            <small>Téléphone non renseigné</small>
          )}
          <button type="button" className="text-button" disabled={busy} onClick={remove}>
            Retirer l’affectation
          </button>
        </div>
      )}
      <div className="planner-fields">
        <label>
          Rechercher un swappeur
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom ou adresse email"
          />
        </label>
        <label>
          Swappeur
          <select aria-label="Swappeur" value={swapperId} disabled={busy} onChange={(e) => setSwapper(e.target.value)}>
            <option value="">Sans affectation</option>
            {(users || [])
              .filter(
                (u) =>
                  u.id === swapperId ||
                  (u.fullName + ' ' + u.email).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
              )
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} · {u.email}
                </option>
              ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button type="button" className="text-button" onClick={() => setRetry((n) => n + 1)}>
            Réessayer
          </button>
        </p>
      )}

      {swapperId && (
        <ShiftConstraints
          state={{
            ready: !!current?.valid,
            report: current,
            pending: checking,
            retry: () => setRetry((n) => n + 1),
            error: undefined,
          }}
        />
      )}

      <div className="planner-actions">
        <button type="button" className="admin-button secondary" disabled={busy} onClick={onClose}>
          Fermer
        </button>
        <button className="admin-button" disabled={busy || !!error || (!!swapperId && !current?.valid)}>
          Enregistrer l’affectation
        </button>
      </div>
    </form>
  );
}