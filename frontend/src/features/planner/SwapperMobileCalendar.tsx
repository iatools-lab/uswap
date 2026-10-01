import { useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ClockIcon,
  MapPinIcon,
} from "@phosphor-icons/react";
import { Modal } from "../../ui/Modal";
import "./swapper-mobile-calendar.css";

type MobileOccurrence = {
  id: string;
  station: { id: string; name: string; timezone: string };
  templateVersion: {
    label: string;
    breakStart: string | null;
    breakEnd: string | null;
    breakMinutes: number;
  };
  startTime: string;
  endTime: string;
};

type MobilePlanning = {
  name?: string;
  startDate: string;
  endDate: string;
  status: string;
  occurrences: MobileOccurrence[];
};

type ShiftState = "upcoming" | "ongoing" | "finished";

const stateMeta: Record<ShiftState, { label: string; className: string }> = {
  upcoming: { label: "À venir", className: "is-upcoming" },
  ongoing: { label: "En cours", className: "is-ongoing" },
  finished: { label: "Terminé", className: "is-finished" },
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function localDay(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function shiftState(shift: MobileOccurrence, now = Date.now()): ShiftState {
  if (now < Date.parse(shift.startTime)) return "upcoming";
  if (now <= Date.parse(shift.endTime)) return "ongoing";
  return "finished";
}

function monthCells(cursor: Date) {
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      iso: isoDay(date),
      day: date.getUTCDate(),
      currentMonth: date.getUTCMonth() === cursor.getUTCMonth(),
    };
  });
}

const monthTitle = (cursor: Date) =>
  cursor.toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const clock = (value: string, timezone: string) =>
  new Date(value).toLocaleTimeString("fr-FR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

export function SwapperMobileCalendar({
  planning,
  onBack,
  onPunch,
  onAbsence,
}: {
  planning: MobilePlanning;
  onBack: () => void;
  onPunch: (shiftId: string) => void;
  onAbsence: (shiftId: string) => void;
}) {
  const initial = new Date(`${planning.startDate.slice(0, 7)}-01T00:00:00Z`);
  const [cursor, setCursor] = useState(initial);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const shiftsByDay = useMemo(() => {
    const grouped = new Map<string, MobileOccurrence[]>();
    for (const occurrence of planning.occurrences) {
      const key = localDay(occurrence.startTime, occurrence.station.timezone);
      grouped.set(key, [...(grouped.get(key) ?? []), occurrence]);
    }
    for (const rows of grouped.values())
      rows.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    return grouped;
  }, [planning.occurrences]);
  const selected = selectedDay ? shiftsByDay.get(selectedDay) ?? [] : [];
  const today = isoDay(new Date());

  function moveMonth(direction: number) {
    setCursor(
      new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + direction, 1)),
    );
  }

  return (
    <section className="swapper-calendar" aria-label="Mon calendrier de shifts">
      <header className="swapper-calendar__header">
        <button type="button" className="swapper-calendar__back" onClick={onBack}>
          <ArrowLeftIcon size={17} /> Mes plannings
        </button>
        <span className="admin-badge active">Publié</span>
        <h2>{planning.name || "Mon planning"}</h2>
        <p>Consultez vos services et ouvrez une date pour agir rapidement.</p>
      </header>

      <div className="swapper-calendar__surface">
        <div className="swapper-calendar__nav">
          <button type="button" aria-label="Mois précédent" onClick={() => moveMonth(-1)}>
            <CaretLeftIcon size={18} />
          </button>
          <strong>{monthTitle(cursor)}</strong>
          <button type="button" aria-label="Mois suivant" onClick={() => moveMonth(1)}>
            <CaretRightIcon size={18} />
          </button>
        </div>

        <div className="swapper-calendar__weekdays" aria-hidden="true">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>

        <div className="swapper-calendar__grid">
          {cells.map((cell) => {
            const shifts = shiftsByDay.get(cell.iso) ?? [];
            const states = [...new Set(shifts.map((shift) => shiftState(shift)))];
            return (
              <button
                type="button"
                key={cell.iso}
                className={`swapper-calendar__day${cell.currentMonth ? "" : " is-outside"}${cell.iso === today ? " is-today" : ""}${shifts.length ? ` has-shift has-status-${states[0]}` : ""}`}
                disabled={!shifts.length}
                onClick={() => setSelectedDay(cell.iso)}
                aria-label={
                  shifts.length
                    ? `${longDate(cell.iso)}, ${shifts.length} shift${shifts.length > 1 ? "s" : ""}`
                    : longDate(cell.iso)
                }
              >
                <span className="swapper-calendar__number">{cell.day}</span>
                <span className="swapper-calendar__markers" aria-hidden="true">
                  {states.map((state) => (
                    <i key={state} className={stateMeta[state].className} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="swapper-calendar__legend" aria-label="Légende des shifts">
          {(Object.keys(stateMeta) as ShiftState[]).map((state) => (
            <span key={state}>
              <i className={stateMeta[state].className} aria-hidden="true" />
              {stateMeta[state].label}
            </span>
          ))}
        </div>
      </div>

      <Modal
        open={Boolean(selectedDay)}
        size="md"
        title={selectedDay ? longDate(selectedDay) : "Détail des shifts"}
        subtitle={`${selected.length} service${selected.length > 1 ? "s" : ""} prévu${selected.length > 1 ? "s" : ""}`}
        onClose={() => setSelectedDay(null)}
      >
        <div className="swapper-shift-detail-list">
          {selected.map((shift) => {
            const state = shiftState(shift);
            const meta = stateMeta[state];
            const canPunch = state === "ongoing";
            const canReportAbsence = Date.parse(shift.endTime) > Date.now();
            return (
              <article className="swapper-shift-detail" key={shift.id}>
                <div className="swapper-shift-detail__heading">
                  <div>
                    <span className="swapper-shift-detail__eyebrow">{shift.templateVersion.label}</span>
                    <h3>{shift.station.name}</h3>
                  </div>
                  <span className={`swapper-shift-state ${meta.className}`}>
                    <i aria-hidden="true" /> {meta.label}
                  </span>
                </div>

                <dl>
                  <div>
                    <dt><ClockIcon size={15} /> Horaires</dt>
                    <dd>{clock(shift.startTime, shift.station.timezone)} – {clock(shift.endTime, shift.station.timezone)}</dd>
                  </div>
                  <div>
                    <dt><CalendarBlankIcon size={15} /> Pause</dt>
                    <dd>
                      {shift.templateVersion.breakStart
                        ? `${shift.templateVersion.breakStart} – ${shift.templateVersion.breakEnd} · ${shift.templateVersion.breakMinutes} min`
                        : "Aucune pause prévue"}
                    </dd>
                  </div>
                  <div>
                    <dt><MapPinIcon size={15} /> Station</dt>
                    <dd>{shift.station.name}</dd>
                  </div>
                </dl>

                {(canPunch || canReportAbsence) && (
                  <div className="swapper-shift-detail__actions">
                    {canPunch && (
                      <button type="button" className="admin-button primary-cta" onClick={() => onPunch(shift.id)}>
                        Pointer
                      </button>
                    )}
                    {canReportAbsence && (
                      <button type="button" className="admin-button secondary" onClick={() => onAbsence(shift.id)}>
                        Signaler une absence
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </Modal>
    </section>
  );
}
