import { useEffect, useState, useRef, type FormEvent } from 'react';
import { Modal } from "../../ui/Modal";
import { StepperModal, type StepItem } from '../../ui/StepperModal';
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
  XIcon,
  DotsThreeIcon,
} from '@phosphor-icons/react';
import { DownloadSimple, Clock3, CaretDownIcon, Building2 } from "../../ui/icons";
import { api, type User } from '../../api/auth-api';
import { notify } from '../../ui/Toast';
import { ShiftConstraints, type ConstraintReport } from '../stations/ShiftConstraints';
import { exportToExcel } from '../../utils/excelExport';
import './planner.css';
import { StationPicker } from "../stations/StationPicker";

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
const longDay = (value: string) => {
  const d = new Date(value + 'T00:00:00Z');
  const wd = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()];
  return `${wd} ${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
const shortDay = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
/** Occurrences d'un planning qui tombent réellement sur un jour donné (date locale de la station). */
const occurrencesOnDay = (p: Planning, iso: string) => {
  if (!p.startDate || !p.endDate || p.startDate.slice(0, 10) > iso || p.endDate.slice(0, 10) < iso) return [];
  return (p.occurrences || []).filter((o) => {
    if (!o?.startTime || !o?.station?.timezone) return false;
    return new Intl.DateTimeFormat('en-CA', { timeZone: o.station.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(o.startTime)) === iso;
  });
};
const time = (value: string, zone: string) =>
  new Date(value).toLocaleString('fr-FR', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' });
const clock = (value: string, zone: string) =>
  new Date(value).toLocaleTimeString('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
const two = (n: number) => String(n).padStart(2, '0');
/** Période lisible en chiffres : « Du 15 au 22/09 » (année ajoutée seulement si différente). */
function periodShort(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sd = s.getUTCDate(), sm = s.getUTCMonth() + 1, sy = s.getUTCFullYear();
  const ed = e.getUTCDate(), em = e.getUTCMonth() + 1, ey = e.getUTCFullYear();
  if (sy === ey && sm === em) {
    if (sd === ed) return `Le ${two(sd)}/${two(sm)}`;
    return `Du ${two(sd)} au ${two(ed)}/${two(sm)}`;
  }
  if (sy === ey) return `Du ${two(sd)}/${two(sm)} au ${two(ed)}/${two(em)}`;
  return `Du ${two(sd)}/${two(sm)}/${sy} au ${two(ed)}/${two(em)}/${ey}`;
}
const period = (p: Planning) => periodShort(p.startDate, p.endDate);
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

/**
 * Statut d'affectation d'un poste, contextualisé par le statut du planning.
 *
 * - Brouillon : le poste n'est pas encore figé, on invite à le compléter → « À affecter ».
 * - Publié    : la publication est faite, il ne reste qu'à constater → « Non affecté ».
 */
function assignmentStatus(hasSwapper: boolean, planningStatus: string) {
  const published = planningStatus !== 'DRAFT';
  if (hasSwapper) {
    return { label: 'Affecté', tone: 'filled' as const, published };
  }
  return {
    label: published ? 'Non affecté' : 'À affecter',
    tone: 'vacant' as const,
    published,
  };
}

/** État d'avancement d'un groupe de postes (shift) : complet, partiel ou vide. */
function coverage(filled: number, total: number) {
  if (total > 0 && filled === total) return 'full' as const;
  if (filled === 0) return 'empty' as const;
  return 'partial' as const;
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

const dmy = (d: Date) => `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const dm = (d: Date) => `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`;
function periodTitle(view: string, from: Date, to: Date) {
  if (view === 'day') return dmy(from);
  if (view === 'week') return `${dm(from)} – ${dmy(to)}`;
  if (view === 'month') return `${two(from.getUTCMonth() + 1)}/${from.getUTCFullYear()}`;
  return String(from.getUTCFullYear());
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

const viewLabels: Record<string, string> = {
  day: 'journalière',
  week: 'hebdomadaire',
  month: 'mensuelle',
  year: 'annuelle',
};

function PeriodLegend() {
  return (
    <p className="planner-legend">
      <span>
        <i className="is-published" aria-hidden="true" />
        Planning publié
      </span>
      <span>
        <i className="is-draft" aria-hidden="true" />
        Brouillon
      </span>
      <span>
        <i className="is-filled" aria-hidden="true" />
        Poste affecté
      </span>
      <span>
        <i className="is-vacant" aria-hidden="true" />
        Poste resté libre
      </span>
    </p>
  );
}

function PeriodBoard({
  view,
  from,
  to,
  plans,
  allPlansCount,
  stations,
  selectedStationFilter,
  onStationFilterChange,
  onDay,
  onPlan,
  onCreate,
  busy,
}: {
  view: string;
  from: Date;
  to: Date;
  plans: Planning[];
  allPlansCount: number;
  stations: Station[];
  selectedStationFilter: string;
  onStationFilterChange: (id: string) => void;
  onDay: (iso: string) => void;
  onPlan: (id: string) => void;
  onCreate?: () => void;
  busy: boolean;
}) {
  const today = utcIso(new Date());
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

  // Aucun planning à afficher : on distingue « rien du tout » de « rien sur cette période ».
  if (plans.length === 0) {
    const anywhere = allPlansCount > 0;
    return (
      <section className="admin-card planner-empty">
        <CalendarDotsIcon size={30} weight="regular" />
        <h3>{anywhere ? 'Aucun planning sur cette période' : 'Aucun planning pour le moment'}</h3>
        <p>
          {anywhere
            ? 'Des plannings existent sur d’autres périodes. Naviguez avec les flèches ou choisissez une date pour les retrouver.'
            : onCreate
            ? 'Créez votre premier planning pour commencer à affecter des swappeurs aux shifts.'
            : 'Les plannings apparaîtront ici dès leur publication.'}
        </p>
        {onCreate && (
          <div className="planner-empty-actions">
            <button className="admin-button" onClick={onCreate}>
              <PlusIcon weight="regular" size={16} /> Créer un planning
            </button>
          </div>
        )}
      </section>
    );
  }

  // Le filtre n'a de sens que si plusieurs stations sont concernées.
  const involvedStations = new Set<string>();
  for (const p of filteredPlans) for (const o of p.occurrences || []) if (o.station?.id) involvedStations.add(o.station.id);
  const showStationFilter = involvedStations.size > 1;

  return (
    <div className="planner-board">
      {showStationFilter && (
        <div className="planner-station-filter">
          <div className="planner-station-filter-label">
            <Building2 size={18} />
            <span>Filtrer par station :</span>
          </div>
          <div className="planner-station-filter-picker">
            <StationPicker
              value={selectedStationFilter}
              onChange={onStationFilterChange}
              stations={stations}
              placeholder="Toutes les stations"
            />
          </div>
        </div>
      )}

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
                <button
                  type="button"
                  key={isoStr}
                  className={'day-pill' + (isActive ? ' active' : '')}
                  aria-pressed={isActive}
                  aria-label={`${weekdayName} ${dayNum}${hasEvents ? ' — plannings prévus' : ''}`}
                  onClick={() => setSelectedMobileDate(isoStr)}
                >
                  <small>{weekdayName}</small>
                  <strong>{dayNum}</strong>
                  {hasEvents && <span className="event-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="selected-day-card">
            <div className="day-card-header">
              <strong>{new Date(selectedMobileDate + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
              <span className="admin-badge active">
                {selectedDayPlans.length} planning{selectedDayPlans.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="day-card-body">
              {selectedDayPlans.length === 0 ? (
                <p className="planner-day-empty is-centered">Aucun planning pour cette date.</p>
              ) : (
                selectedDayPlans.map((p) => {
                  const isDraft = p.status === 'DRAFT';
                  const occurrences = p.occurrences || [];
                  const count = p._count?.occurrences ?? occurrences.length;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={'planner-range mobile-row' + (isDraft ? ' is-draft' : '')}
                      disabled={busy}
                      onClick={() => onPlan(p.id)}
                    >
                      <div className="planner-range-meta">
                        <span className={'admin-badge' + (isDraft ? ' draft' : ' active')}>
                          {isDraft ? 'Brouillon' : 'Publié'}
                        </span>
                        <small>{period(p)}</small>
                      </div>
                      <strong>
                        {count} shift{count > 1 ? 's' : ''}
                      </strong>
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
                              title={`Planning du ${day(p.startDate)} au ${day(p.endDate)} · ${count} shift${count > 1 ? 's' : ''} (${isDraft ? 'Brouillon' : 'Publié'}) — ouvrir`}
                            >
                              <span className="event-dot" />
                              <span className="event-text">
                                {count} shift{count > 1 ? 's' : ''}
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
                      const todayOccurrences = occurrencesOnDay(p, d.iso);
                      const countToday = todayOccurrences.length;
                      const filledToday = todayOccurrences.filter((o) => o.swapper).length;
                      // Un jour sans aucun shift n'est ni « vide » ni « complet » : état neutre.
                      const state = countToday === 0 ? 'none' : coverage(filledToday, countToday);
                      return (
                        <button
                          type="button"
                          className={'planner-range is-' + state + (p.status === 'DRAFT' ? ' is-draft' : '')}
                          disabled={busy}
                          key={p.id}
                          onClick={() => onDay(d.iso)}
                          title="Voir le détail des shifts de cette journée"
                        >
                          {countToday === 0 ? (
                            <span className="planner-range-empty">Aucun shift ce jour</span>
                          ) : (
                            <>
                              <span className="planner-range-count">
                                <strong>{countToday}</strong>
                                <small>shift{countToday === 1 ? '' : 's'}</small>
                              </span>
                              <span className="planner-range-coverage">
                                {filledToday}/{countToday} affecté{filledToday === 1 ? '' : 's'}
                              </span>
                            </>
                          )}
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

  // Repart d'un formulaire vierge à chaque ouverture de la création guidée.
  function openCreate() {
    setStationId('');
    setSelectedTemplates([]);
    setSelectedDays([1, 2, 3, 4, 5]);
    setSelectedSwappers([]);
    setPublishDirectly(false);
    setError('');
    setCreating(true);
  }

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
        <div className="stepper-form-layout">
          <div className="stepper-field-group is-tall">
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
              <div className="planner-options">
                {templates.map((t) => (
                  <label key={t.id} className="checkbox-label">
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
            <div className="planner-days">
              {weekdays.map((label, i) => (
                <label key={label} className="checkbox-label">
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
            <div className="planner-swapper-list">
              {swappers.map((u) => (
                <label key={u.id} className="checkbox-label">
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

          <div className="planner-publish-toggle">
            <input
              type="checkbox"
              id="publishDirectly"
              checked={publishDirectly}
              onChange={(e) => setPublishDirectly(e.target.checked)}
            />
            <label htmlFor="publishDirectly">
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
              aria-label={`Vue ${label.toLowerCase()}`}
              title={label}
              onClick={() => setView(value)}
            >
              <Icon size={16} weight="regular" />
              <span className="planner-tab-label-full">{label}</span>
              <span className="planner-tab-label-short">{short}</span>
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
          <button className="admin-button planner-create-btn" onClick={openCreate}>
            <PlusIcon weight="regular" size={16} />
            <span>Nouveau planning…</span>
          </button>
        )}
      </div>

      {!loading && (plans.length > 0 || visible.length > 0) && (
        <p className="planner-context">
          <CalendarDotsIcon size={15} weight="regular" />
          <span>
            Vue <strong>{viewLabels[view]}</strong> — {periodTitle(view, from, to)}
          </span>
          <span className="planner-context-count">
            {visible.length} planning{visible.length > 1 ? 's' : ''} sur la période
          </span>
        </p>
      )}

      {error && !creating && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </button>
        </p>
      )}

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

      {dayModalDate && (
        <DaySummaryModal
          dateIso={dayModalDate}
          plans={plans}
          writable={writable}
          onClose={() => setDayModalDate(null)}
          onChanged={() => setReload((n) => n + 1)}
          onOpenPlanning={(id) => {
            setDayModalDate(null);
            void open(id);
          }}
        />
      )}

      {loading ? (
        <div className="planner-skeleton" role="status" aria-live="polite">
          <span>Chargement des plannings…</span>
          <i />
          <i />
          <i />
        </div>
      ) : (
        <PeriodBoard
          view={view}
          from={from}
          to={to}
          plans={visible}
          allPlansCount={plans.length}
          stations={stations}
          selectedStationFilter={stationFilter}
          onStationFilterChange={setStationFilter}
          busy={busy}
          onCreate={writable ? openCreate : undefined}
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
  writable,
  onClose,
  onChanged,
  onOpenPlanning,
}: {
  dateIso: string;
  plans: Planning[];
  writable: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenPlanning: (planningId: string) => void;
}) {
  type Entry = {
    planningId: string;
    planningRevision: number;
    planningStatus: string;
    occurrence: Occurrence;
  };

  const dayOccurrences: Entry[] = [];

  for (const p of plans) {
    for (const o of occurrencesOnDay(p, dateIso)) {
      dayOccurrences.push({
        planningId: p.id,
        planningRevision: p.revision,
        planningStatus: p.status,
        occurrence: o,
      });
    }
  }

  dayOccurrences.sort(
    (a, b) => +new Date(a.occurrence.startTime) - +new Date(b.occurrence.startTime),
  );

  /*
   * Regroupement par SHIFT (et non par poste) : un même shift avec plusieurs
   * postes n'apparaît qu'une seule fois, et tous ses swappeurs sont listés
   * dans la colonne « Swappeurs ». Fini les lignes « Equipe de Nuit » répétées.
   */
  const groups = new Map<string, { key: string; stationName: string; sample: Entry; entries: Entry[] }>();
  for (const entry of dayOccurrences) {
    const o = entry.occurrence;
    const key = `${o.station?.id}|${o.templateVersion?.label}|${o.startTime}|${o.endTime}`;
    const g = groups.get(key);
    if (g) g.entries.push(entry);
    else
      groups.set(key, {
        key,
        stationName: o.station?.name || '',
        sample: entry,
        entries: [entry],
      });
  }
  const shiftGroups = [...groups.values()];

  // Generaliser la station : si tous les shifts partagent la meme station, on l'affiche une seule fois.
  const stationNames = [...new Set(shiftGroups.map((g) => g.stationName).filter(Boolean))];
  const singleStation = stationNames.length === 1 ? stationNames[0] : null;
  const filled = dayOccurrences.filter((d) => d.occurrence.swapper).length;
  const vacant = dayOccurrences.length - filled;
  const anyDraft = dayOccurrences.some((d) => d.planningStatus === 'DRAFT');

  const [swappers, setSwappers] = useState<(User & { isActive: boolean })[]>([]);
  const [editingOccurrence, setEditingOccurrence] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<(User & { isActive: boolean })[]>('/users?role=SWAPPER')
      .then((u) => {
        if (active) setSwappers(u.filter((s) => s.isActive));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function setSwapper(entry: (typeof dayOccurrences)[number], swapperId: string | null) {
    setBusyId(entry.occurrence.id);
    setError('');
    try {
      await api(
        `/plannings/${entry.planningId}/occurrences/${entry.occurrence.id}`,
        { swapperId, revision: entry.planningRevision },
        'PATCH',
      );
      setEditingOccurrence(null);
      notify(swapperId ? 'Swappeur affecté.' : 'Affectation retirée.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open title={longDay(dateIso)} onClose={onClose} subtitle={singleStation || undefined}>
      <div className="planner-day-sheet">
        {dayOccurrences.length === 0 ? (
          <div className="planner-day-empty-state">
            <Clock3 size={30} />
            <strong>Aucun shift pour cette date</strong>
            <p>Ouvrez un planning pour y générer des shifts.</p>
          </div>
        ) : (
          <>
            <div className="planner-day-summary-bar">
              <span className="planner-day-count">
                <strong>{shiftGroups.length}</strong> shift{shiftGroups.length === 1 ? '' : 's'}
                {dayOccurrences.length !== shiftGroups.length && (
                  <small> · {dayOccurrences.length} postes</small>
                )}
              </span>
              <span
                className={
                  'planner-day-coverage' +
                  (vacant === 0 ? ' is-complete' : filled === 0 ? ' is-empty' : '')
                }
              >
                {vacant === 0
                  ? 'Tous les postes sont affectés'
                  : `${filled} affecté${filled === 1 ? '' : 's'} · ${vacant} ${
                      anyDraft ? 'à pourvoir' : 'non affecté' + (vacant === 1 ? '' : 's')
                    }`}
              </span>
              {singleStation && <span className="planner-day-station-tag">{singleStation}</span>}
            </div>

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}

            <ul className="planner-day-list">
              <li className="planner-day-list-head" aria-hidden="true">
                <span>Shift</span>
                <span>Swappeur{shiftGroups.some((g) => g.entries.length > 1) ? 's' : ''}</span>
                <span>Actions</span>
              </li>
              {shiftGroups.map((group) => {
                const s = group.sample.occurrence;
                const published = group.sample.planningStatus !== 'DRAFT';
                const groupFilled = group.entries.filter((e) => e.occurrence.swapper).length;
                const state = coverage(groupFilled, group.entries.length);

                return (
                  <li className="planner-day-row is-group" key={group.key}>
                    <div className="planner-day-shift">
                      <strong>{s.templateVersion?.label || 'Shift'}</strong>
                      <span className="planner-day-time">
                        {clock(s.startTime, s.station?.timezone)} – {clock(s.endTime, s.station?.timezone)}
                        {!singleStation && s.station?.name && (
                          <>
                            <i>·</i>
                            {s.station.name}
                          </>
                        )}
                      </span>
                      <span className={'planner-day-slots is-' + state}>
                        <i aria-hidden="true" />
                        {groupFilled}/{group.entries.length} poste{group.entries.length > 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="planner-day-swappers">
                      {group.entries.map((entry) => {
                        const o = entry.occurrence;
                        const busy = busyId === o.id;
                        const status = assignmentStatus(!!o.swapper, entry.planningStatus);
                        if (!o.swapper)
                          return (
                            <span
                              key={o.id}
                              className={'planner-day-vacant' + (status.published ? ' is-published' : '')}
                            >
                              {status.label}
                            </span>
                          );
                        return (
                          <span className="planner-day-swapper-chip" key={o.id}>
                            <span>{o.swapper.fullName}</span>
                            {writable && (
                              <button
                                type="button"
                                className="planner-day-swapper-remove"
                                aria-label={`Retirer ${o.swapper.fullName}`}
                                title="Retirer ce swappeur"
                                disabled={busy}
                                onClick={() => void setSwapper(entry, null)}
                              >
                                <XIcon size={12} weight="bold" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>

                    <div className="planner-day-actions">
                      {writable ? (
                        editingOccurrence && group.entries.some((e) => e.occurrence.id === editingOccurrence) ? (
                          <div className="planner-day-picker">
                            <select
                              autoFocus
                              value=""
                              disabled={busyId === editingOccurrence}
                              onChange={(event) => {
                                const entry = dayOccurrences.find((e) => e.occurrence.id === editingOccurrence);
                                if (event.target.value && entry) void setSwapper(entry, event.target.value);
                              }}
                            >
                              <option value="">Choisir un swappeur…</option>
                              {swappers.map((sw) => (
                                <option key={sw.id} value={sw.id}>
                                  {sw.fullName}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="text-button"
                              disabled={busyId === editingOccurrence}
                              onClick={() => setEditingOccurrence(null)}
                            >
                              Annuler
                            </button>
                          </div>
                        ) : group.entries.length > 1 ? (
                          /* Plusieurs postes : un menu déroulant pour choisir lequel affecter. */
                          <details className="planner-day-menu-holder">
                            <summary className="admin-button secondary small">
                              <DotsThreeIcon size={18} weight="bold" />
                              Actions
                            </summary>
                            <div className="planner-day-menu" role="menu">
                              {group.entries.map((entry, i) => (
                                <button
                                  key={entry.occurrence.id}
                                  type="button"
                                  role="menuitem"
                                  className="planner-day-menu-item"
                                  onClick={() => setEditingOccurrence(entry.occurrence.id)}
                                >
                                  <PlusIcon size={16} />
                                  {entry.occurrence.swapper
                                    ? `Réaffecter le poste ${i + 1}…`
                                    : `Affecter le poste ${i + 1}…`}
                                </button>
                              ))}
                              <button
                                type="button"
                                role="menuitem"
                                className="planner-day-menu-item"
                                onClick={() => onOpenPlanning(group.sample.planningId)}
                              >
                                <CalendarIcon size={16} />
                                Ouvrir le planning
                              </button>
                            </div>
                          </details>
                        ) : (
                          <button
                            type="button"
                            className="admin-button secondary small"
                            disabled={busyId === group.sample.occurrence.id}
                            onClick={() => setEditingOccurrence(group.sample.occurrence.id)}
                          >
                            {group.sample.occurrence.swapper ? 'Réaffecter' : 'Ajouter'}
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          className="admin-button secondary small"
                          onClick={() => onOpenPlanning(group.sample.planningId)}
                        >
                          Consulter
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="planner-actions is-end">
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

  // Repart d'un formulaire vierge à chaque ouverture de l'ajout de shifts.
  function openAdding() {
    setStation('');
    setSelected([]);
    setDays([1, 2, 3, 4, 5]);
    setPreview(null);
    setError('');
    setAdding(true);
  }

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

  // Synthèse de couverture du planning filtré, pour situer l'utilisateur en un coup d'œil.
  const totalShifts = rows.length;
  const filledShifts = rows.filter((o) => o.swapper).length;
  const vacantShifts = totalShifts - filledShifts;
  const plural = (n: number) => (n > 1 ? 's' : '');
  const vacantLabel =
    p.status === 'DRAFT'
      ? `${vacantShifts} à pourvoir`
      : `${vacantShifts} non affecté${plural(vacantShifts)}`;
  const globalCoverage =
    totalShifts === 0
      ? { className: 'none', label: '' }
      : vacantShifts === 0
      ? { className: 'full', label: 'Tous les postes sont affectés' }
      : filledShifts === 0
      ? { className: 'empty', label: p.status === 'DRAFT' ? `${vacantShifts} poste${plural(vacantShifts)} à pourvoir` : vacantLabel }
      : {
          className: 'partial',
          label: `${filledShifts} affecté${plural(filledShifts)} · ${vacantLabel}`,
        };

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
              <div className="planner-options">
                {templates.map((t) => (
                  <label key={t.id} className="checkbox-label">
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
            <div className="planner-days">
              {weekdays.map((label, i) => (
                <label key={label} className="checkbox-label">
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
            <div className="planner-preview-intro">
              <p>
                Cliquez ci-dessous pour calculer l'aperçu des shifts à ajouter.
              </p>
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => generate(false)}
              >
                Générer l'aperçu des shifts
              </button>
            </div>
          ) : (
            <div className="planner-preview is-inline">
              <h3>{preview.occurrences.length} shifts à ajouter au brouillon</h3>
              {preview.duplicates.length > 0 && <p>{preview.duplicates.length} doublons ignorés.</p>}
              <div className="planner-preview-rows">
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
            <span>
              {occurrences.length} shift{occurrences.length === 1 ? '' : 's'}
            </span>
            {occurrences.length > 0 && (
              <span className={'planner-coverage-pill is-' + globalCoverage.className}>
                <i aria-hidden="true" />
                {globalCoverage.label}
              </span>
            )}
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
            <button className="admin-button secondary" onClick={openAdding}>
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

      <p className={'planner-stage is-' + (p.status === 'DRAFT' ? 'draft' : 'published')}>
        {p.status === 'DRAFT' ? (
          <>
            <strong>Brouillon en cours d'édition.</strong> Ajustez les shifts et les affectations, puis cliquez sur
            « Vérifier et publier » pour diffuser le planning aux équipes.
          </>
        ) : (
          <>
            <strong>Planning publié.</strong> Les équipes concernées ont reçu leurs horaires. Les postes sans swappeur
            apparaissent comme « Non affecté » et ne sont plus modifiables.
          </>
        )}
      </p>

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
          <h3>
            {stationFilter
              ? 'Aucun shift pour cette station'
              : 'Aucun shift dans ce planning'}
          </h3>
          {stationFilter ? (
            <p>Essayez de retirer le filtre de station pour afficher tous les shifts du planning.</p>
          ) : canEdit ? (
            <p>Ajoutez les horaires à partir des modèles de station pour constituer ce planning.</p>
          ) : (
            <p>Aucun horaire n'a été défini pour cette période.</p>
          )}
          <div className="planner-empty-actions">
            {stationFilter && (
              <button
                className="admin-button secondary"
                onClick={() => setStationFilter('')}
              >
                Retirer le filtre
              </button>
            )}
            {canEdit && !stationFilter && (
              <button className="admin-button" onClick={openAdding}>
                <PlusIcon weight="regular" size={16} /> Ajouter des shifts…
              </button>
            )}
          </div>
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
                        const state = coverage(filled, total);
                        const published = p.status !== 'DRAFT';

                        const badgeLabel =
                          total > 1
                            ? `${filled}/${total} affecté${filled === 1 ? '' : 's'}`
                            : state === 'full'
                            ? 'Affecté'
                            : published
                            ? 'Non affecté'
                            : 'À affecter';

                        return (
                          <button
                            type="button"
                            key={g.key}
                            className={
                              'planner-occurrence-card is-' + state + (published ? ' is-published' : '')
                            }
                            disabled={busy || adding}
                            title={`${total} poste${total > 1 ? 's' : ''} · ${badgeLabel} — ouvrir le détail`}
                            onClick={() => setOpenGroupKey(g.key)}
                          >
                            <span className="planner-occurrence-head">
                              <strong>{g.label}</strong>
                              <small>
                                {clock(g.start, g?.station?.timezone)}–{clock(g.end, g?.station?.timezone)}
                              </small>
                            </span>
                            <span className="planner-occurrence-station">{g?.station?.name}</span>
                            <span className={'planner-occurrence-status is-' + state}>
                              <i aria-hidden="true" />
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
  const filled = g.occurrences.filter((o) => o.swapper).length;
  const vacant = g.occurrences.length - filled;

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
          <span className="planner-roster-count">
            <strong>{filled}</strong>/{g.occurrences.length} poste{multi ? 's' : ''} affecté
            {filled === 1 ? '' : 's'}
          </span>
          {vacant > 0 && (
            <span>
              — chaque poste resté libre peut recevoir un swappeur différent.
            </span>
          )}
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
                    {o.swapper
                      ? 'Affecté'
                      : p.status === 'DRAFT'
                      ? 'À affecter'
                      : 'Non affecté'}
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