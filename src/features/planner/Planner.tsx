import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../../ui/Modal";
import { StepperModal, type StepItem } from "../../ui/StepperModal";
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  CalendarIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PlusIcon,
  RowsIcon,
  ArrowLeftIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  DownloadSimple,
  Clock3,
} from "../../ui/icons";
import { api, type User } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import {
  ShiftConstraints,
  type ConstraintReport,
} from "../stations/ShiftConstraints";
import { exportToExcel } from "../../utils/excelExport";
import "./planner.css";
import "./day-roster.css";
import { SwapperContact } from "./SwapperContact";
import { StationPicker } from "../stations/StationPicker";
import { PlanningList } from "./PlanningList";

type Station = {
  id: string;
  name: string;
  timezone: string;
  isActive: boolean;
};
type Template = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
};
type Occurrence = {
  id: string;
  station: Station;
  templateVersion: {
    label: string;
    breakStart: string | null;
    breakEnd: string | null;
    breakMinutes: number;
  };
  swapper: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string | null;
  } | null;
  startTime: string;
  endTime: string;
};
type Planning = {
  name?: string;
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  revision: number;
  occurrences: Occurrence[];
  _count?: { occurrences: number };
};
type ViewScale = "day" | "week" | "month" | "year";

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

const day = (value: string) =>
  new Date(value).toLocaleDateString("fr-FR", { timeZone: "UTC" });
const dayKeyOf = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

const time = (value: string, zone: string) =>
  new Date(value).toLocaleString("fr-FR", {
    timeZone: zone,
    dateStyle: "short",
    timeStyle: "short",
  });

const clock = (value: string, zone: string) =>
  new Date(value).toLocaleTimeString("fr-FR", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  });

const two = (n: number) => String(n).padStart(2, "0");

function periodShort(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sd = s.getUTCDate(),
    sm = s.getUTCMonth() + 1,
    sy = s.getUTCFullYear();
  const ed = e.getUTCDate(),
    em = e.getUTCMonth() + 1,
    ey = e.getUTCFullYear();
  if (sy === ey && sm === em) {
    if (sd === ed) return `Le ${two(sd)}/${two(sm)}`;
    return `Du ${two(sd)} au ${two(ed)}/${two(sm)}`;
  }
  if (sy === ey) return `Du ${two(sd)}/${two(sm)} au ${two(ed)}/${two(em)}`;
  return `Du ${two(sd)}/${two(sm)}/${sy} au ${two(ed)}/${two(em)}/${ey}`;
}
const period = (p: Planning) => periodShort(p.startDate, p.endDate);
const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const groupKey = (o: Occurrence) =>
  `${o.station.id}|${o?.templateVersion?.label}|${o?.startTime}|${o?.endTime}`;

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
function coverage(filled: number, total: number) {
  if (total > 0 && filled === total) return "full" as const;
  if (filled === 0) return "empty" as const;
  return "partial" as const;
}

const utcIso = (d: Date) => d.toISOString().slice(0, 10);

function shiftAnchor(anchor: string, view: string, dir: number) {
  const d = new Date(anchor + "T00:00:00Z");
  if (view === "day") d.setUTCDate(d.getUTCDate() + dir);
  else if (view === "week") d.setUTCDate(d.getUTCDate() + dir * 7);
  else if (view === "month") {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + dir);
  } else {
    d.setUTCMonth(0, 1);
    d.setUTCFullYear(d.getUTCFullYear() + dir);
  }
  return utcIso(d);
}

const dmy = (d: Date) =>
  `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const dm = (d: Date) => `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`;
function periodTitle(view: string, from: Date, to: Date) {
  if (view === "day") return dmy(from);
  if (view === "week") return `${dm(from)} – ${dmy(to)}`;
  if (view === "month")
    return `${two(from.getUTCMonth() + 1)}/${from.getUTCFullYear()}`;
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
  return daysBetween(start, end).map((d) => ({
    ...d,
    inMonth: d.iso >= utcIso(from) && d.iso <= utcIso(to),
  }));
}

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

const viewScales: [
  ViewScale,
  string,
  string,
  React.ComponentType<{ size?: number }>,
][] = [
  ["day", "Journalier", "Jour", CalendarBlankIcon],
  ["week", "Hebdomadaire", "Sem.", CalendarIcon],
  ["month", "Mensuel", "Mois", CalendarDotsIcon],
  ["year", "Annuel", "An", RowsIcon],
];

function ViewToolbar({
  view,
  onView,
  label,
  onShift,
  onPick,
  anchor,
  onToday,
}: {
  view: ViewScale;
  onView: (value: ViewScale) => void;
  label: string;
  onShift: (dir: number) => void;
  onPick: (iso: string) => void;
  anchor: string;
  onToday: () => void;
}) {
  return (
    <div className="planner-viewbar">
      <div
        className="settings-tabs planner-viewbar__tabs"
        role="tablist"
        aria-label="Échelle de lecture"
      >
        {viewScales.map(([value, full, short, Icon]) => (
          <button
            type="button"
            key={value}
            role="tab"
            aria-selected={view === value}
            aria-label={`Vue ${full.toLowerCase()}`}
            title={full}
            onClick={() => onView(value)}
          >
            <Icon size={16} />
            <span className="planner-tab-label-full">{full}</span>
            <span className="planner-tab-label-short">{short}</span>
          </button>
        ))}
      </div>

      <div className="planner-viewbar__nav">
        <button
          type="button"
          className="planner-step"
          aria-label="Période précédente"
          onClick={() => onShift(-1)}
        >
          <CaretLeftIcon size={16} />
        </button>

        <div className="planner-period-picker">
          <strong>{label}</strong>
          <input
            type="date"
            aria-label="Choisir une date"
            value={anchor}
            onChange={(e) => {
              if (e.target.value) onPick(e.target.value);
            }}
          />
        </div>

        <button
          type="button"
          className="planner-step"
          aria-label="Période suivante"
          onClick={() => onShift(1)}
        >
          <CaretRightIcon size={16} />
        </button>

        <button type="button" className="planner-today" onClick={onToday}>
          Aujourd'hui
        </button>
      </div>
    </div>
  );
}

export function Planner({ user }: { user: User }) {
  const [planningName, setPlanningName] = useState("");
  const writable = user.role === "ADMIN" || user.role === "SUPERVISOR";
  const [plans, setPlans] = useState<Planning[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Planning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationMode, setCreationMode] = useState<"manual" | "automatic">("manual");

  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [reload, setReload] = useState(0);

  const [stations, setStations] = useState<Station[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [stationId, setStationId] = useState("");
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [publishDirectly, setPublishDirectly] = useState(false);

  function openCreate(mode: "manual" | "automatic" = "manual") {
    setCreationMode(mode);
    setPlanningName("");
    setStart("");
    setEnd("");
    setStationId("");
    setSelectedTemplates([]);
    setSelectedDays([1, 2, 3, 4, 5]);
    setPublishDirectly(false);
    setError("");
    setCreating(true);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Planning[]>("/plannings")
      .then((p) => {
        if (active) {
          setPlans(p);
          setError("");
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
    const id = new URLSearchParams(location.search).get("planning");
    if (id) void open(id);
  }, []);

  useEffect(() => {
    let active = true;
    (writable ? api<Station[]>("/stations") : Promise.resolve([]))
      .then((s) => {
        if (active) setStations(s.filter((st) => st.isActive));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
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
    return () => {
      active = false;
    };
  }, [stationId]);

  async function open(id: string) {
    setBusy(true);
    setError("");
    setOpeningId(id);
    try {
      const plan = await api<Planning>("/plannings/" + id);
      setCurrent(plan);
      setOpeningId(null);
      const notices =
        await api<{ id: string; planningId: string }[]>("/plannings/notices");
      await Promise.all(
        notices
          .filter((n) => n.planningId === id)
          .map((n) => api("/plannings/notices/" + n.id + "/read", {}, "PATCH")),
      );
    } catch (e) {
      setOpeningId(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createPlanning() {
    if (busy) return;
    if (!planningName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<Planning>("/plannings", {
        name: planningName.trim(),
        startDate: start + "T00:00:00.000Z",
        endDate: end + "T23:59:59.999Z",
      });

      let automaticAssignment: { assigned: number; vacant: number } | null = null;
      if (
        stationId &&
        selectedTemplates.length > 0 &&
        selectedDays.length > 0
      ) {
        const payload = {
          stationId,
          templateIds: selectedTemplates,
          weekdays: selectedDays,
          revision: p.revision,
        };
        const previewRes = await api<Preview>(
          `/plannings/${p.id}/preview`,
          payload,
        );
        await api(`/plannings/${p.id}/generate`, {
          ...payload,
          previewHash: previewRes.previewHash,
        });
        if (creationMode === "automatic")
          automaticAssignment = await api<{ assigned: number; vacant: number }>(
            `/plannings/${p.id}/auto-assign`,
            {},
          );
      }

      const canPublishAutomatically =
        creationMode === "automatic" &&
        publishDirectly &&
        automaticAssignment?.vacant === 0;

      if (canPublishAutomatically) {
        const latestPlan = await api<Planning>("/plannings/" + p.id);
        await api(`/plannings/${p.id}/publish`, {
          revision: latestPlan.revision,
        });
        notify("Planning créé et publié avec succès.");
      } else if (creationMode === "automatic" && automaticAssignment) {
        notify(
          automaticAssignment.vacant > 0
            ? `Planning généré en brouillon : ${automaticAssignment.assigned} poste(s) affecté(s), ${automaticAssignment.vacant} à compléter.`
            : `Planning généré : ${automaticAssignment.assigned} poste(s) affecté(s) automatiquement.`,
        );
      } else {
        notify("Planning créé en brouillon. Les postes peuvent maintenant être affectés depuis le calendrier.");
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
        onUpdate={setCurrent}
        onBack={() => {
          setCurrent(null);
          setReload((n) => n + 1);
        }}
      />
    );

  const createSteps: StepItem[] = [
    {
      id: "period",
      label: "Nom et période",
      isValid: () => !!planningName.trim() && planningName.trim().length <= 100 && !!start && !!end && end >= start,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="planning-name">NOM DU PLANNING *</label>
            <input id="planning-name" required maxLength={100} value={planningName}
              placeholder="Ex. Équipe Yaoundé · Septembre"
              onChange={(event) => setPlanningName(event.target.value)} />
          </div>
          <div className="stepper-field-group">
            <label>PREMIER JOUR *</label>
            <input
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="stepper-field-group">
            <label>DERNIER JOUR *</label>
            <input
              type="date"
              required
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
      ),
    },
    {
      id: "station",
      label: "Choisir la station",
      isValid: () => !!stationId,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group is-tall">
            <label>STATION CIBLE *</label>
            <StationPicker
              value={stationId}
              onChange={(val: string) => setStationId(val)}
              stations={stations}
              placeholder="Sélectionner une station"
              allowEmpty={false}
            />
          </div>
        </div>
      ),
    },
    {
      id: "shift",
      label: "Choix du shift",
      isValid: () => selectedTemplates.length > 0 && selectedDays.length > 0,
      content: (
        <div className="stepper-form-layout">
          <div className="stepper-field-group">
            <label>MODÈLES DE SHIFT DISPONIBLES</label>
            {templates.length === 0 ? (
              <p className="planner-muted">
                Aucun modèle actif pour cette station.
              </p>
            ) : (
              <div className="planner-options">
                {templates.map((t) => (
                  <label key={t.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedTemplates.includes(t.id)}
                      onChange={(e) => {
                        setSelectedTemplates(
                          e.target.checked
                            ? [...selectedTemplates, t.id]
                            : selectedTemplates.filter((id) => id !== t.id),
                        );
                      }}
                    />
                    <span>
                      {t.label} (
                      <strong>
                        {t?.startTime}–{t?.endTime}
                      </strong>
                      )
                    </span>
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
                        e.target.checked
                          ? [...selectedDays, i + 1]
                          : selectedDays.filter((d) => d !== i + 1),
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
      id: "summary",
      label: "Récapitulatif",
      content: (
        <div className="stepper-form-layout">
          {error && <p className="error-message">{error}</p>}
          <div className="stepper-summary-card">
            <div className="summary-row"><span>Nom :</span><strong>{planningName.trim()}</strong></div>
            <div className="summary-row">
              <span>Période :</span>
              <strong>
                {start ? day(start) : "—"} au {end ? day(end) : "—"}
              </strong>
            </div>
            <div className="summary-row">
              <span>Station :</span>
              <strong>
                {stations.find((s) => s.id === stationId)?.name ||
                  "Non spécifiée"}
              </strong>
            </div>
            <div className="summary-row">
              <span>Modèles de shift :</span>
              <strong>{selectedTemplates.length} sélectionné(s)</strong>
            </div>
            <div className="summary-row">
              <span>Affectation :</span>
              <strong>
                {creationMode === "automatic"
                  ? "Répartition automatique entre les swappeurs actifs de la station"
                  : "Postes laissés libres pour une affectation depuis le calendrier"}
              </strong>
            </div>
          </div>

          {creationMode === "automatic" ? (
            <div className="planner-publish-toggle">
              <input
                type="checkbox"
                id="publishDirectly"
                checked={publishDirectly}
                onChange={(e) => setPublishDirectly(e.target.checked)}
              />
              <label htmlFor="publishDirectly">
                Publier si tous les postes peuvent être affectés ; sinon conserver le brouillon
              </label>
            </div>
          ) : (
            <p className="planner-form-note">
              Le planning sera enregistré en brouillon. Vous pourrez affecter les postes, contrôler les contraintes puis le publier depuis son calendrier.
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PlanningList
        plans={plans}
        userRole={user.role}
        busy={busy}
        loading={loading || openingId !== null}
        error={error}
        onRetry={() => setReload((n) => n + 1)}
        onCreate={writable ? () => openCreate("manual") : undefined}
        onGenerate={writable ? () => openCreate("automatic") : undefined}
        onOpen={open}
      />
      <StepperModal
        open={creating}
        title={creationMode === "automatic" ? "Générer un planning" : "Créer un planning"}
        icon={<CalendarIcon size={20} />}
        steps={createSteps}
        submitLabel={creationMode === "automatic" ? "Générer et affecter" : "Créer le brouillon"}
        busy={busy}
        onClose={() => setCreating(false)}
        onSubmit={createPlanning}
      />
    </>
  );
}

function PlanningEditor({
  planning: p,
  writable,
  onUpdate,
  onBack,
}: {
  planning: Planning;
  writable: boolean;
  onUpdate: (p: Planning) => void;
  onBack: () => void;
}) {
  const [stations, setStations] = useState<Station[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [stationId, setStation] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [days, setDays] = useState([1, 2, 3, 4, 5]),
    [preview, setPreview] = useState<Preview | null>(null),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [openGroupKey, setOpenGroupKey] = useState<string | null>(null),
    [focusOccurrenceId, setFocusOccurrenceId] = useState<string | null>(null),
    [stationFilter, setStationFilter] = useState(""),
    [view, setView] = useState<ViewScale>("week"),
    [anchor, setAnchor] = useState(() => p.startDate.slice(0, 10)),
    [dayDetail, setDayDetail] = useState<string | null>(null),
    [publication, setPublication] = useState(false),
    [report, setReport] = useState<{
      valid: boolean;
      errors: { message: string; occurrenceId?: string }[];
    } | null>(null);

  const canEdit = writable;
  const occurrences = p.occurrences || [];

  function openAdding() {
    setStation("");
    setSelected([]);
    setDays([1, 2, 3, 4, 5]);
    setPreview(null);
    setError("");
    setAdding(true);
  }

  async function publish(confirm: boolean) {
    setBusy(true);
    setError("");
    try {
      if (confirm) {
        await api(`/plannings/${p.id}/publish`, { revision: p.revision });
        await refresh();
        setPublication(false);
        notify("Planning publié dans les espaces concernés.");
      } else {
        setReport(
          await api(`/plannings/${p.id}/validate`, { revision: p.revision }),
        );
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
      sheetName: "Affectations",
      columns: [
        {
          header: "Station",
          key: (o: Occurrence) => o?.station?.name,
          width: 25,
        },
        {
          header: "Shift / Modèle",
          key: (o: Occurrence) => o?.templateVersion?.label,
          width: 22,
        },
        {
          header: "Swappeur affecté",
          key: (o: Occurrence) =>
            o.swapper ? o?.swapper?.fullName : "Non affecté",
          width: 25,
        },
        {
          header: "Email Swappeur",
          key: (o: Occurrence) => (o.swapper ? o?.swapper?.email : "—"),
          width: 25,
        },
        {
          header: "Téléphone Swappeur",
          key: (o: Occurrence) => o.swapper?.phoneNumber || "—",
          width: 18,
        },
        {
          header: "Début shift",
          key: (o: Occurrence) => time(o?.startTime, o?.station?.timezone),
          width: 22,
        },
        {
          header: "Fin shift",
          key: (o: Occurrence) => time(o?.endTime, o?.station?.timezone),
          width: 22,
        },
        {
          header: "Statut poste",
          key: (o: Occurrence) => (o.swapper ? "Affecté" : "À affecter"),
          width: 15,
        },
      ],
    });
    notify("Exportation Excel du planning réussie.");
  }

  useEffect(() => {
    let active = true;
    (writable ? api<Station[]>("/stations") : Promise.resolve([]))
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
    const latest = await api<Planning>("/plannings/" + p.id);
    onUpdate(latest);
  }

  async function generate(confirm: boolean) {
    setBusy(true);
    setError("");
    try {
      const payload = {
        stationId,
        templateIds: selected,
        weekdays: days,
        revision: p.revision,
        ...(confirm ? { previewHash: preview?.previewHash } : {}),
      };
      if (!confirm)
        setPreview(await api<Preview>(`/plannings/${p.id}/preview`, payload));
      else {
        await api(`/plannings/${p.id}/generate`, payload);
        setPreview(null);
        setAdding(false);
        await refresh();
        notify("Shifts ajoutés au brouillon.");
      }
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = occurrences.filter(
    (o) => !stationFilter || o.station?.id === stationFilter,
  );

  const anchorDate = new Date(anchor + "T00:00:00Z");
  const from = new Date(anchorDate);
  const to = new Date(anchorDate);
  if (view === "week") {
    from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
    to.setTime(+from);
    to.setUTCDate(to.getUTCDate() + 6);
  } else if (view === "month") {
    from.setUTCDate(1);
    to.setUTCMonth(to.getUTCMonth() + 1, 0);
  } else if (view === "year") {
    from.setUTCMonth(0, 1);
    to.setUTCMonth(11, 31);
  }

  const rowsOfDay = (iso: string) =>
    rows.filter((o) => {
      if (!o?.startTime || !o?.station?.timezone) return false;
      return dayKeyOf(o.startTime, o.station.timezone) === iso;
    });

  const totalShifts = rows.length;
  const filledShifts = rows.filter((o) => o.swapper).length;
  const vacantShifts = totalShifts - filledShifts;
  const plural = (n: number) => (n > 1 ? "s" : "");
  const vacantLabel =
    p.status === "DRAFT"
      ? `${vacantShifts} à pourvoir`
      : `${vacantShifts} non affecté${plural(vacantShifts)}`;
  const globalCoverage =
    totalShifts === 0
      ? { className: "none", label: "" }
      : vacantShifts === 0
        ? { className: "full", label: "Tous les postes sont affectés" }
        : filledShifts === 0
          ? {
              className: "empty",
              label:
                p.status === "DRAFT"
                  ? `${vacantShifts} poste${plural(vacantShifts)} à pourvoir`
                  : vacantLabel,
            }
          : {
              className: "partial",
              label: `${filledShifts} affecté${plural(filledShifts)} · ${vacantLabel}`,
            };

  const openGroupOccurrences = openGroupKey
    ? occurrences.filter((o) => groupKey(o) === openGroupKey)
    : [];
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
              <p className="planner-muted">
                Aucun modèle actif sur cette station.
              </p>
            ) : (
              <div className="planner-options">
                {templates.map((t) => (
                  <label key={t.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked
                            ? [...selected, t.id]
                            : selected.filter((id) => id !== t.id),
                        );
                        setPreview(null);
                      }}
                    />
                    <span>
                      {t.label} (
                      <strong>
                        {t?.startTime}–{t?.endTime}
                      </strong>
                      )
                    </span>
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
                        e.target.checked
                          ? [...days, i + 1]
                          : days.filter((d) => d !== i + 1),
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
              <h3>
                {preview.occurrences.length} shifts à ajouter au brouillon
              </h3>
              {preview.duplicates.length > 0 && (
                <p>{preview.duplicates.length} doublons ignorés.</p>
              )}
              <div className="planner-preview-rows">
                {preview.occurrences.map((o, i) => (
                  <div className="planner-preview-row" key={i}>
                    <strong>{o.label}</strong>
                    <span>{o.stationName}</span>
                    <span>
                      {time(o?.startTime, o.timezone)} –{" "}
                      {time(o?.endTime, o.timezone)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  const stationOptions = Array.from(
    new Map(occurrences.map((o) => [o.station?.id, o.station])).values(),
  ).filter((s): s is Station => Boolean(s?.id));

  return (
    <div className="planner">
      <div className="planner-toolbar">
        <div className="planner-toolbar__intro">
          <button
            type="button"
            className="text-button planner-back"
            onClick={onBack}
          >
            <ArrowLeftIcon size={15} weight="bold" /> Tous les plannings
          </button>
          <h2>{p.name || period(p)}</h2>
          {p.name && <p className="planner-muted">{period(p)}</p>}
          <p className="planner-muted">
            <span
              className={
                "admin-badge" + (p.status === "DRAFT" ? " draft" : " active")
              }
            >
              {p.status === "DRAFT" ? "Brouillon" : "Publié"}
            </span>
            <span>
              {occurrences.length} shift{occurrences.length === 1 ? "" : "s"}
            </span>
            {occurrences.length > 0 && (
              <span
                className={
                  "planner-coverage-pill is-" + globalCoverage.className
                }
              >
                <i aria-hidden="true" />
                {globalCoverage.label}
              </span>
            )}
          </p>
        </div>

        <div className="planner-actions">
          {occurrences.length > 0 && (
            <button
              type="button"
              className="admin-button secondary"
              onClick={handleExportExcel}
              title="Exporter ce planning au format Excel"
            >
              <DownloadSimple size={16} />
              <span>Exporter Excel</span>
            </button>
          )}
          {canEdit && !adding && !openGroupKey && (
            <button className="admin-button secondary" onClick={openAdding}>
              <PlusIcon weight="regular" /> Ajouter des shifts…
            </button>
          )}
          {canEdit && (
            <button
              className="admin-button"
              disabled={busy}
              onClick={() => publish(false)}
            >
              {p.status === "DRAFT"
                ? "Vérifier et publier…"
                : "Vérifier et republier…"}
            </button>
          )}
        </div>
      </div>

      <div className="planner-filterbar" role="group" aria-label="Filtres du planning">
        <div className="planner-filterbar__group">
          <span className="sr-only">Période</span>
          <ViewToolbar
            view={view}
            onView={setView}
            label={periodTitle(view, from, to)}
            anchor={anchor}
            onShift={(dir) => setAnchor(shiftAnchor(anchor, view, dir))}
            onPick={(iso) => setAnchor(iso)}
            onToday={() => setAnchor(utcIso(new Date()))}
          />
        </div>

        {occurrences.length > 0 && stationOptions.length > 1 && (
          <div className="planner-filterbar__group">
            <span className="sr-only">Station</span>
            <label className="planner-inline-filter">
              <span className="sr-only">Station affichée</span>
              <select
                aria-label="Station affichée"
                className="planner-filter-select"
                value={stationFilter}
                onChange={(e) => setStationFilter(e.target.value)}
              >
                <option value="">Toutes les stations</option>
                {stationOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <p
        className={
          "planner-stage is-" + (p.status === "DRAFT" ? "draft" : "published")
        }
      >
        {!writable ? (
          <>
            <strong>Consultation.</strong> Ce planning est publié : vous y voyez
            uniquement vos affectations. Aucune modification n'est possible
            depuis cet espace.
          </>
        ) : p.status === "DRAFT" ? (
          <>
            <strong>Brouillon en cours d'édition.</strong> Ajustez les shifts et
            les affectations, puis cliquez sur « Vérifier et publier » pour
            diffuser le planning aux équipes.
          </>
        ) : (
          <>
            <strong>Planning publié.</strong> Les équipes concernées ont reçu
            leurs horaires. Il reste modifiable : toute affectation ajustée
            déclenche une notification de mise à jour.
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
            <p>
              Les swappeurs recevront leurs shifts et les chefs les horaires de
              leur station dans leur espace.
            </p>
            {report?.errors.map((issue, i) => (
              <div key={i}>
                <p>{issue.message}</p>
                {issue.occurrenceId && (
                  <button
                    className="text-button"
                    onClick={() => {
                      const o = occurrences.find(
                        (o) => o.id === issue.occurrenceId,
                      );
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
            <button
              className="admin-button"
              disabled={busy || !report?.valid}
              onClick={() => publish(true)}
            >
              {p.status === "PUBLISHED"
                ? "Confirmer la republication"
                : "Confirmer la publication"}
            </button>
          </div>
        </Modal>
      )}

      {error && !adding && (
        <p className="error-message" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() =>
              refresh()
                .then(() => {
                  setError("");
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
        <DayDetail
          date={dayKeyOf(openGroup.start, openGroup.station.timezone)}
          rows={rowsOfDay(dayKeyOf(openGroup.start, openGroup.station.timezone))}
          canEdit={canEdit}
          busy={busy || adding}
          planning={p}
          onUpdate={onUpdate}
          initialEditingId={focusOccurrenceId}
          onRemove={async (occurrence) => {
            await api(`/plannings/${p.id}/occurrences/${occurrence.id}`, { swapperId: null, revision: p.revision }, "PATCH");
            onUpdate(await api<Planning>(`/plannings/${p.id}`));
            notify("Affectation retirée.");
          }}
          onClose={() => {
            setOpenGroupKey(null);
            setFocusOccurrenceId(null);
          }}
        />
      )}

      {!rows.length ? (
        <section className="admin-card planner-empty">
          <CalendarBlankIcon size={30} weight="regular" />
          <h3>
            {stationFilter
              ? "Aucun shift pour cette station"
              : "Aucun shift dans ce planning"}
          </h3>
          {stationFilter ? (
            <p>
              Essayez de retirer le filtre de station pour afficher tous les
              shifts du planning.
            </p>
          ) : canEdit ? (
            <p>
              Ajoutez les horaires à partir des modèles de station pour
              constituer ce planning.
            </p>
          ) : (
            <p>Aucun horaire n'a été défini pour cette période.</p>
          )}
          <div className="planner-empty-actions">
            {stationFilter && (
              <button
                className="admin-button secondary"
                onClick={() => setStationFilter("")}
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
        <div className="planner-board">
          <PeriodLegend />

          <div className="desktop-calendar-views">
            {view === "year" && (
              <div className="planner-year" aria-label="Mois de l’année">
                {Array.from({ length: 12 }, (_, i) => {
                  const start = new Date(Date.UTC(from.getUTCFullYear(), i, 1));
                  const end = new Date(Date.UTC(from.getUTCFullYear(), i + 1, 0));
                  const iso = utcIso(start);
                  const overlapping = [p].filter(
                    (item) =>
                      item.startDate &&
                      item.endDate &&
                      item.startDate.slice(0, 10) <= utcIso(end) &&
                      item.endDate.slice(0, 10) >= iso,
                  );
                  const covered = daysBetween(start, end).filter((d) =>
                    overlapping.some((item) => covers(item, d.iso)),
                  ).length;
                  return (
                    <button
                      type="button"
                      className="planner-year-month"
                      key={iso}
                      onClick={() => {
                        setAnchor(iso);
                        setView("day");
                      }}
                    >
                      <strong>
                        {start.toLocaleDateString("fr-FR", {
                          timeZone: "UTC",
                          month: "long",
                        })}
                      </strong>
                      <span>
                        {overlapping.length
                          ? `${overlapping.length} planning actif`
                          : "Aucun shift"}
                      </span>
                      {overlapping.length > 0 && <span>{covered} j. couverts</span>}
                      <span className="planner-year-bar" aria-hidden="true">
                        <i
                          style={{
                            width: `${Math.round((covered / end.getUTCDate()) * 100)}%`,
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {view === "month" && (
              <div className="planner-month" aria-label="Calendrier du mois">
                <div className="planner-month-weekdays">
                  {weekdays.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="planner-month-grid">
                  {monthCells(from, to).map((d) => {
                    const todayIso = utcIso(new Date());
                    const overlapping = [p].filter(
                      (item) => item.startDate && item.endDate && covers(item, d.iso),
                    );
                    return (
                      <div
                        key={d.iso}
                        className={
                          "planner-cell" +
                          (d.inMonth ? "" : " is-outside") +
                          (d.iso === todayIso ? " is-today" : "")
                        }
                      >
                        <button
                          type="button"
                          className="planner-cell-num"
                          onClick={() => {
                            setAnchor(d.iso);
                            setView("day");
                            setDayDetail(d.iso);
                          }}
                        >
                          {Number(d.iso.slice(8))}
                        </button>

                        {overlapping.length > 0 && (
                          <div className="planner-cell-events">
                            {rowsOfDay(d.iso).length > 0 && (
                              <button
                                type="button"
                                className="planner-event-chip"
                                disabled={busy}
                                onClick={() => setDayDetail(d.iso)}
                                title="Voir le détail des shifts de cette journée"
                              >
                                <span className="event-dot" />
                                <span className="event-text">
                                  {rowsOfDay(d.iso).length} shift{rowsOfDay(d.iso).length > 1 ? "s" : ""}
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(view === "week" || view === "day") && (
              <div
                className={
                  "planner-week-overview" + (view === "day" ? " is-single" : "")
                }
                aria-label={
                  view === "day" ? "Jour sélectionné" : "Jours de la semaine"
                }
              >
                {daysBetween(from, to).map((d) => {
                  const todayIso = utcIso(new Date());
                  const todayOccurrences = rowsOfDay(d.iso);
                  const countToday = todayOccurrences.length;
                  const filledToday = todayOccurrences.filter(
                    (o) => o.swapper,
                  ).length;
                  const state =
                    countToday === 0
                      ? "none"
                      : coverage(filledToday, countToday);

                  return (
                    <div
                      className={
                        "planner-week-day" + (d.iso === todayIso ? " is-today" : "")
                      }
                      key={d.iso}
                    >
                      <button
                        type="button"
                        className="planner-week-day-head"
                        onClick={() => setDayDetail(d.iso)}
                      >
                        <strong>{weekdays[d.weekday]}</strong>
                        <span>{Number(d.iso.slice(8))}</span>
                      </button>
                      <button
                        type="button"
                        className={
                          "planner-range is-" +
                          state +
                          (p.status === "DRAFT" ? " is-draft" : "")
                        }
                        disabled={busy}
                        onClick={() => setDayDetail(d.iso)}
                        title="Voir le détail des shifts de cette journée"
                      >
                        {countToday === 0 ? (
                          <span className="planner-range-empty">
                            Aucun shift ce jour
                          </span>
                        ) : (
                          <>
                            <span className="planner-range-count">
                              <strong>{countToday}</strong>
                              <small>
                                shift{countToday === 1 ? "" : "s"}
                              </small>
                            </span>
                            <span className="planner-range-coverage">
                              {filledToday}/{countToday} affecté
                              {filledToday === 1 ? "" : "s"}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {dayDetail && (
        <DayDetail
          planning={p}
          onUpdate={onUpdate}
          date={dayDetail}
          rows={rowsOfDay(dayDetail)}
          canEdit={canEdit}
          busy={busy || adding}
          onRemove={async (occurrence) => {
            await api(`/plannings/${p.id}/occurrences/${occurrence.id}`, { swapperId: null, revision: p.revision }, "PATCH");
            onUpdate(await api<Planning>(`/plannings/${p.id}`));
            notify("Affectation retirée.");
          }}
          onClose={() => setDayDetail(null)}
        />
      )}
    </div>
  );
}

function DayDetail({
  planning,
  onUpdate,
  initialEditingId,
  date,
  rows,
  busy,
  canEdit,
  onRemove,
  onClose,
}: {
  planning: Planning;
  onUpdate: (planning: Planning) => void;
  initialEditingId?: string | null;
  date: string;
  rows: Occurrence[];
  canEdit: boolean;
  busy: boolean;
  onRemove: (occurrence: Occurrence) => Promise<void>;
  onClose: () => void;
}) {
  const groups = groupOccurrences(rows);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(initialEditingId || null);
  const [temporaryVacantId, setTemporaryVacantId] = useState<string | null>(null);
  const editing = rows.find(o => o.id === editingId);
  async function addMember(group: ShiftGroup) {
    const vacant = group.occurrences.find(o => !o.swapper);
    if (vacant) { setTemporaryVacantId(null); setEditingId(vacant.id); return; }
    setRemoving(group.key);
    setRemoveError("");
    try {
      await api(`/plannings/${planning.id}/occurrences/${group.occurrences[0].id}/duplicate`, { revision: planning.revision });
      const latest = await api<Planning>(`/plannings/${planning.id}`);
      onUpdate(latest);
      const added = latest.occurrences.find(o => groupKey(o) === group.key && !o.swapper && !group.occurrences.some(old => old.id === o.id));
      if (added) { setTemporaryVacantId(added.id); setEditingId(added.id); }
    } catch (error) { setRemoveError(error instanceof Error ? error.message : "Impossible d’ajouter un poste."); }
    finally { setRemoving(null); }
  }
  const stations = [...new Map(groups.map(g => [g.station.id, g.station])).values()];
  const orderedGroups = stations.flatMap(station => groups.filter(g => g.station.id === station.id));
  const colors = ["blue", "violet", "teal", "amber", "rose", "indigo"];
  const people = [...new Set(rows.flatMap(o => o.swapper ? [o.swapper.id] : []))].sort();
  async function remove(occurrence: Occurrence) {
    if (removing || busy) return;
    setRemoving(occurrence.id);
    setRemoveError("");
    try {
      if (occurrence.swapper) await onRemove(occurrence);
      else {
        await api(`/plannings/${planning.id}/occurrences/${occurrence.id}/remove`, { revision: planning.revision });
        onUpdate(await api<Planning>(`/plannings/${planning.id}`));
        notify("Poste vacant supprimé.");
      }
    }
    catch (error) { setRemoveError(error instanceof Error ? error.message : "Impossible de retirer cette affectation."); }
    finally { setRemoving(null); }
  }
  async function closeAssignment() {
    const temporaryId = temporaryVacantId;
    setEditingId(null);
    setTemporaryVacantId(null);
    if (!temporaryId) return;
    try {
      await api(`/plannings/${planning.id}/occurrences/${temporaryId}/remove`, { revision: planning.revision });
      onUpdate(await api<Planning>(`/plannings/${planning.id}`));
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Impossible d’annuler l’ajout du poste.");
    }
  }
  const filled = rows.filter((o) => o.swapper).length;
  const longDate = new Date(date + "T00:00:00Z").toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Modal
      open
      title={longDate}
      subtitle={`${stations.length} station${stations.length > 1 ? "s" : ""} · ${groups.length} shifts · ${filled}/${rows.length} postes affectés`}
      size="xl"
      onClose={onClose}
    >
      <div className="planner-day-detail">

        {!groups.length ? (
          <div className="admin-empty">
            <h3>Aucun shift ce jour</h3>
            <p>
              Cette journée ne comporte aucune affectation pour ce planning.
            </p>
          </div>
        ) : (
          <div className="day-roster-scroll">
          <table className="day-roster-table">
            <thead><tr><th scope="col">Station</th><th scope="col">Shift</th><th scope="col">Swappeurs</th><th scope="col">Actions</th></tr></thead>
            <tbody>
            {orderedGroups.map((g, index) => {
              const groupFilled = g.occurrences.filter((o) => o.swapper).length;
              const state = coverage(groupFilled, g.occurrences.length);
              return (
                <tr key={g.key}>
                  {(index === 0 || orderedGroups[index - 1].station.id !== g.station.id) && <th scope="rowgroup" rowSpan={groups.filter(row => row.station.id === g.station.id).length} className="day-roster-station">{g.station.name}</th>}
                  <td><div className="planner-day-detail__shift">
                    <strong>{g.label}</strong>
                    <span>
                      {clock(g.start, g.station.timezone)} –{" "}
                      {clock(g.end, g.station.timezone)}
                    </span>
                    <small className="day-roster-pause">{g.breakStart ? `Pause ${g.breakStart}–${g.breakEnd} · ${g.breakMinutes} min` : "Sans pause"}</small>
                    <span className={"planner-day-detail__slots is-" + state}>
                      {groupFilled}/{g.occurrences.length} poste
                      {g.occurrences.length > 1 ? "s" : ""}
                    </span>
                  </div></td>
                  <td><div className="planner-day-detail__people">
                    {g.occurrences.map((o) =>
                      o.swapper ? (
                        <div key={o.id} className="day-roster-member"><span className={`planner-day-swapper-chip tone-${colors[people.indexOf(o.swapper.id) % colors.length]}`}>
                          <SwapperContact person={o.swapper} disabled={busy || removing !== null} onChange={canEdit ? () => setEditingId(o.id) : undefined}/>
                          {canEdit && <button type="button" className="day-roster-remove" disabled={busy || removing !== null} aria-label={`Retirer ${o.swapper.fullName} du shift ${g.label} à ${g.station.name}`} title="Retirer l’affectation" onClick={() => void remove(o)}><XIcon size={14}/></button>}
                        </span></div>
                      ) : (
                        <span key={o.id} className="planner-day-vacant">
                          {canEdit ? <>
                            <button type="button" className="day-roster-name" disabled={busy || removing !== null} onClick={() => setEditingId(o.id)} aria-label={`Affecter un swappeur : ${g.label}, ${g.station.name}`}>Non affecté</button>
                            <button type="button" className="day-roster-remove" disabled={busy || removing !== null} aria-label={`Supprimer le poste vacant : ${g.label}, ${g.station.name}`} title="Supprimer le poste vacant" onClick={() => void remove(o)}><XIcon size={14}/></button>
                          </> : "Non affecté"}
                        </span>
                      ),
                    )}
                  </div></td>
                  <td>{canEdit ? <button
                    type="button"
                    className="admin-button secondary small"
                    disabled={busy || removing !== null}
                    onClick={() => void addMember(g)}
                  >
                    <PlusIcon size={14}/> Ajouter
                  </button> : <span className="planner-muted">Consultation</span>}</td>
                </tr>
              );
            })}
            </tbody>
          </table></div>
        )}

        {removeError && <p role="alert" className="error-message">{removeError}</p>}
        {removing && <p role="status">Mise à jour…</p>}
        {editing && canEdit && <Modal open size="lg" title={editing.swapper ? "Modifier les affectations" : "Ajouter des swappeurs"} subtitle={`${editing.station.name} · ${editing.templateVersion.label}`} onClose={() => void closeAssignment()}><div className="day-roster-assignment-dialog"><Assignment key={editing.id + ':' + planning.revision} planning={planning} occurrence={editing} onClose={() => void closeAssignment()} onSaved={async (opts) => { setTemporaryVacantId(null); onUpdate(await api<Planning>(`/plannings/${planning.id}`)); setEditingId(null); notify(opts?.message || "Affectation enregistrée."); }}/></div></Modal>}

        <div className="planner-actions is-end">
          <button
            type="button"
            className="admin-button secondary"
            onClick={onClose}
          >
            Fermer
          </button>
        </div>
      </div>
    </Modal>
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
  const [users, setUsers] = useState<
      (User & { isActive: boolean; phoneNumber?: string | null })[] | undefined
    >(),
    [selectedIds, setSelectedIds] = useState<string[]>(o.swapper ? [o.swapper.id] : []),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [activeInfoId, setActiveInfoId] = useState<string | null>(o.swapper?.id || null),
    [reports, setReports] = useState<Record<string, { loading: boolean; value?: ConstraintReport; error?: string }>>({});

  useEffect(() => {
    let active = true;
    api<(User & { isActive: boolean })[]>("/users?role=SWAPPER")
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

  function validateSwapper(swapperId: string, force = false) {
    if (!force && reports[swapperId]) return;
    setReports((current) => ({ ...current, [swapperId]: { loading: true } }));
    api<ConstraintReport>(`/plannings/${p.id}/occurrences/${o.id}/validate`, {
      swapperId,
      revision: p.revision,
    })
      .then((value) => {
        setReports((current) => ({ ...current, [swapperId]: { loading: false, value } }));
      })
      .catch((e) => {
        setReports((current) => ({ ...current, [swapperId]: { loading: false, error: e.message } }));
      });
  }

  useEffect(() => {
    if (o.swapper?.id) validateSwapper(o.swapper.id);
    // Validation initiale de l'affectation déjà présente uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSwapper(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
    if (checked) validateSwapper(id);
    setActiveInfoId(id);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let revision = p.revision;
      for (let index = 0; index < selectedIds.length; index += 1) {
        let occurrenceId = o.id;
        if (index > 0) {
          const duplicate = await api<{ id: string; revision: number }>(
            `/plannings/${p.id}/occurrences/${o.id}/duplicate`,
            { revision },
          );
          occurrenceId = duplicate.id;
          revision = duplicate.revision;
        }
        const updated = await api<{ revision: number }>(
          `/plannings/${p.id}/occurrences/${occurrenceId}`,
          { swapperId: selectedIds[index], revision },
          "PATCH",
        );
        revision = updated.revision;
      }
      await onSaved({ message: `${selectedIds.length} swappeur${selectedIds.length > 1 ? "s" : ""} affecté${selectedIds.length > 1 ? "s" : ""}.` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLocaleLowerCase();
  const stationUsers = (users || []).filter((u) => u.stationId === o.station.id);
  const filteredUsers = stationUsers.filter((u) =>
    [u.fullName, u.email, u.phoneNumber || "", o.station.name].join(" ").toLocaleLowerCase().includes(needle),
  );
  const activeReport = activeInfoId ? reports[activeInfoId] : undefined;
  const activeUser = activeInfoId ? users?.find((user) => user.id === activeInfoId) : undefined;
  const selectionReady = selectedIds.length > 0 && selectedIds.every((id) => reports[id]?.value?.valid);

  return (
    <form
      className="admin-card planner-panel"
      onSubmit={save}
      aria-label="Affecter un swappeur"
    >
      <div className="assignment-shift-summary">
        <strong>{o.templateVersion.label}</strong>
        <span>{time(o.startTime, o.station.timezone)} – {time(o.endTime, o.station.timezone)}</span>
        {o.templateVersion.breakStart && <small>Pause {o.templateVersion.breakStart}–{o.templateVersion.breakEnd} · {o.templateVersion.breakMinutes} min</small>}
      </div>
      <div className="assignment-picker">
        <label className="assignment-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par nom, e-mail ou téléphone…"
            aria-label="Rechercher un swappeur"
          />
        </label>
        <fieldset className="assignment-table-wrap" disabled={busy}>
          <legend className="sr-only">Choisir un ou plusieurs swappeurs</legend>
          {!users && !error && <p role="status">Chargement des swappeurs…</p>}
          {users && !filteredUsers.length && <p className="assignment-empty">Aucun swappeur trouvé dans cette station.</p>}
          {!!filteredUsers.length && <table className="assignment-table">
            <thead><tr><th aria-label="Sélection"/><th>Swappeur</th><th>Contact</th><th>Affectation</th></tr></thead>
            <tbody>{filteredUsers.map((u) => {
              const selected = selectedIds.includes(u.id);
              const state = reports[u.id];
              return <tr key={u.id} className={selected ? "is-selected" : ""}>
                <td><input aria-label={`Sélectionner ${u.fullName}`} type="checkbox" checked={selected} onChange={(event) => toggleSwapper(u.id, event.target.checked)}/></td>
                <td><div className="assignment-person"><span className="assignment-avatar" aria-hidden="true">{u.fullName.split(" ").map(part => part[0]).slice(0, 2).join("")}</span><strong>{u.fullName}</strong></div></td>
                <td><span className="assignment-contact"><span>{u.email}</span><small>{u.phoneNumber || "Téléphone non renseigné"}</small></span></td>
                <td><button type="button" aria-expanded={activeInfoId === u.id} className={`assignment-status ${state?.value?.valid ? "is-valid" : state?.value ? "is-invalid" : ""}`} onClick={() => { setActiveInfoId((current) => current === u.id ? null : u.id); validateSwapper(u.id); }}>
                  {state?.loading ? "Vérification…" : activeInfoId === u.id ? "Masquer" : state?.value?.valid ? "Disponible" : state?.value ? "À corriger" : "Vérifier"}
                </button></td>
              </tr>;
            })}</tbody>
          </table>}
        </fieldset>
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => activeInfoId && validateSwapper(activeInfoId, true)}
          >
            Réessayer
          </button>
        </p>
      )}

      {activeInfoId && (
        <ShiftConstraints
          subjectName={activeUser?.fullName}
          state={{
            ready: !!activeReport?.value?.valid,
            report: activeReport?.value,
            pending: !!activeReport?.loading,
            retry: () => validateSwapper(activeInfoId, true),
            error: activeReport?.error,
          }}
        />
      )}

      <div className="planner-actions">
        <button
          type="button"
          className="admin-button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Fermer
        </button>
        <button
          className="admin-button"
          disabled={busy || !!error || !selectionReady}
        >
          {busy ? "Enregistrement…" : `Affecter ${selectedIds.length || ""} swappeur${selectedIds.length > 1 ? "s" : ""}`}
        </button>
      </div>
    </form>
  );
}

