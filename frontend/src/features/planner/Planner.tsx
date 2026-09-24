import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
ArrowLeftIcon,
CalendarBlankIcon,
CaretLeftIcon,
CaretRightIcon,
ClockIcon,
DownloadSimple,
MapPinIcon,
PlusIcon,
XIcon,
} from "@phosphor-icons/react";
import { Modal } from "../../ui/Modal";
import { StepperModal, type StepItem } from "../../ui/StepperModal";
import { api, type User } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import { StationPicker } from "../stations/StationPicker";
import { exportToExcel } from "../../utils/excelExport";
import "./planner.css";
import "./day-roster.css";

type Station = {
id: string;
name: string;
timezone?: string | null;
isActive: boolean;
location?: string | null;
latitude?: number | null;
longitude?: number | null;
contactName?: string | null;
contactPhone?: string | null;
latenessToleranceMinutes?: number;
minRestHours?: number;
weeklyHoursLimit?: number;
};

type Swapper = User & {
isActive: boolean;
phoneNumber?: string | null;
stationId?: string | null;
};

type Shift = {
id: string;
stationId: string;
swapperId: string;
startTime: string;
endTime: string;
planningId?: string | null;
station: Station;
swapper: {
id: string;
fullName: string;
email?: string;
phoneNumber?: string | null;
};
attendances?: {
id: string;
status: string;
checkInAt?: string | null;
checkOutAt?: string | null;
}[];
};

type Planning = {
id: string;
startDate: string;
endDate: string;
status: string;
createdAt?: string;
updatedAt?: string;
shifts: Shift[];
};

type ViewScale = "day" | "week" | "month" | "year";

type ShiftType = {
id: string;
label: string;
start: string;
end: string;
};

const SHIFT_TYPES: ShiftType[] = [
{
id: "MORNING",
label: "Matin",
start: "06:00",
end: "14:00",
},
{
id: "AFTERNOON",
label: "Après-midi",
start: "14:00",
end: "22:00",
},
{
id: "NIGHT",
label: "Nuit",
start: "22:00",
end: "06:00",
},
];

const WEEKDAYS = [
"Lundi",
"Mardi",
"Mercredi",
"Jeudi",
"Vendredi",
"Samedi",
"Dimanche",
];

function utcIso(value: Date) {
return value.toISOString().slice(0, 10);
}

function dateOnly(value: string) {
return value.slice(0, 10);
}

function dayKey(value: string) {
return dateOnly(value);
}

function two(value: number) {
return String(value).padStart(2, "0");
}

function formatDate(value: string) {
const date = new Date(value);

return date.toLocaleDateString("fr-FR", {
day: "2-digit",
month: "2-digit",
year: "numeric",
timeZone: "UTC",
});
}

function formatLongDate(value: string) {
const date = new Date(value);

return date.toLocaleDateString("fr-FR", {
weekday: "long",
day: "numeric",
month: "long",
year: "numeric",
timeZone: "UTC",
});
}

function formatTime(value: string) {
const date = new Date(value);

return date.toLocaleTimeString("fr-FR", {
hour: "2-digit",
minute: "2-digit",
hour12: false,
timeZone: "Africa/Douala",
});
}

function periodLabel(start: string, end: string) {
const startDate = new Date(start);
const endDate = new Date(end);

const startDay = startDate.getUTCDate();
const startMonth = startDate.getUTCMonth() + 1;
const startYear = startDate.getUTCFullYear();

const endDay = endDate.getUTCDate();
const endMonth = endDate.getUTCMonth() + 1;
const endYear = endDate.getUTCFullYear();

if (
startDay === endDay &&
startMonth === endMonth &&
startYear === endYear
) {
return Le ${two(startDay)}/${two(startMonth)}/${startYear};
}

if (startYear === endYear && startMonth === endMonth) {
return Du ${two(startDay)} au ${two(endDay)}/${two( startMonth, )}/${startYear};
}

if (startYear === endYear) {
return Du ${two(startDay)}/${two(startMonth)} au ${two( endDay, )}/${two(endMonth)}/${endYear};
}

return Du ${two(startDay)}/${two(startMonth)}/${startYear} au ${two( endDay, )}/${two(endMonth)}/${endYear};
}

function normalizeEndDate(value: string) {
return ${value}T23:59:59.999+01:00;
}

function normalizeStartDate(value: string) {
return ${value}T00:00:00.000+01:00;
}

function createShiftDate(
date: string,
time: string,
isNightEnd: boolean,
) {
const base = new Date(${date}T${time}:00+01:00);

if (isNightEnd) {
base.setDate(base.getDate() + 1);
}

return base.toISOString();
}

function getDatesBetween(start: string, end: string) {
const result: string[] = [];
const cursor = new Date(${start}T00:00:00Z);
const last = new Date(${end}T00:00:00Z);

while (cursor <= last) {
result.push(utcIso(cursor));
cursor.setUTCDate(cursor.getUTCDate() + 1);
}

return result;
}

function coverage(filled: number, total: number) {
if (total === 0) {
return "none";
}

if (filled === 0) {
return "empty";
}

if (filled === total) {
return "full";
}

return "partial";
}

function getMonday(value: Date) {
const result = new Date(value);
const day = result.getUTCDay();
const difference = day === 0 ? -6 : 1 - day;

result.setUTCDate(result.getUTCDate() + difference);
return result;
}

function getMonthEnd(value: Date) {
return new Date(
Date.UTC(
value.getUTCFullYear(),
value.getUTCMonth() + 1,
0,
),
);
}

function getDaysForView(
anchor: string,
view: ViewScale,
) {
const anchorDate = new Date(${anchor}T00:00:00Z);

if (view === "day") {
return [utcIso(anchorDate)];
}

if (view === "week") {
const monday = getMonday(anchorDate);
const result: string[] = [];

for (let index = 0; index < 7; index += 1) {
  const date = new Date(monday);
  date.setUTCDate(date.getUTCDate() + index);
  result.push(utcIso(date));
}

return result;

}

if (view === "month") {
const first = new Date(
Date.UTC(
anchorDate.getUTCFullYear(),
anchorDate.getUTCMonth(),
1,
),
);

const last = getMonthEnd(anchorDate);
const firstMonday = getMonday(first);
const result: string[] = [];

const cursor = new Date(firstMonday);

while (cursor <= last || result.length % 7 !== 0) {
  result.push(utcIso(cursor));
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  if (result.length >= 42) {
    break;
  }
}

return result;

}

const result: string[] = [];

for (let month = 0; month < 12; month += 1) {
result.push(
utcIso(
new Date(
Date.UTC(
anchorDate.getUTCFullYear(),
month,
1,
),
),
),
);
}

return result;
}

function shiftAnchor(
anchor: string,
view: ViewScale,
direction: number,
) {
const date = new Date(${anchor}T00:00:00Z);

if (view === "day") {
date.setUTCDate(date.getUTCDate() + direction);
}

if (view === "week") {
date.setUTCDate(date.getUTCDate() + direction * 7);
}

if (view === "month") {
date.setUTCMonth(date.getUTCMonth() + direction);
}

if (view === "year") {
date.setUTCFullYear(date.getUTCFullYear() + direction);
}

return utcIso(date);
}

function periodTitle(
view: ViewScale,
anchor: string,
) {
const date = new Date(${anchor}T00:00:00Z);

if (view === "day") {
return formatLongDate(anchor);
}

if (view === "week") {
const monday = getMonday(date);
const sunday = new Date(monday);
sunday.setUTCDate(sunday.getUTCDate() + 6);

return `Du ${formatDate(utcIso(monday))} au ${formatDate(
  utcIso(sunday),
)}`;

}

if (view === "month") {
return date.toLocaleDateString("fr-FR", {
month: "long",
year: "numeric",
timeZone: "UTC",
});
}

return String(date.getUTCFullYear());
}

function isInsidePlanning(
shift: Shift,
planning: Planning,
) {
const shiftDate = dayKey(shift.startTime);
const startDate = dateOnly(planning.startDate);
const endDate = dateOnly(planning.endDate);

return shiftDate >= startDate && shiftDate <= endDate;
}

function groupByDay(
shifts: Shift[],
) {
const groups = new Map<string, Shift[]>();

for (const shift of shifts) {
const key = dayKey(shift.startTime);
const current = groups.get(key) ?? [];
current.push(shift);
groups.set(key, current);
}

return groups;
}

function PlanningList({
plans,
onOpen,
onCreate,
}: {
plans: Planning[];
onOpen: (planning: Planning) => void;
onCreate: () => void;
}) {
const [query, setQuery] = useState("");
const [status, setStatus] = useState<"ALL" | "DRAFT" | "PUBLISHED">(
"ALL",
);

const filtered = useMemo(() => {
const needle = query.trim().toLowerCase();

return plans.filter((planning) => {
  const matchesStatus =
    status === "ALL" ||
    planning.status === status;

  const text = `${planning.id} ${planning.startDate} ${planning.endDate}`.toLowerCase();

  return matchesStatus && (!needle || text.includes(needle));
});

}, [plans, query, status]);

return (
<div className="planner">
<div className="planner-toolbar">
<div className="planner-toolbar__intro">
<h2>Plannings</h2>
<p className="planner-muted">
Gestion des périodes et des shifts
</p>
</div>

    <div className="planner-actions">
      <button
        type="button"
        className="admin-button"
        onClick={onCreate}
      >
        <PlusIcon size={16} />
        Nouveau planning
      </button>
    </div>
  </div>

  <div className="planner-filterbar">
    <div className="planner-filterbar__group">
      <input
        className="planner-filter-select"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher un planning"
      />
    </div>

    <div className="planner-filterbar__group">
      <select
        className="planner-filter-select"
        value={status}
        onChange={(event) =>
          setStatus(
            event.target.value as
              | "ALL"
              | "DRAFT"
              | "PUBLISHED",
          )
        }
      >
        <option value="ALL">Tous les statuts</option>
        <option value="DRAFT">Brouillons</option>
        <option value="PUBLISHED">Publiés</option>
      </select>
    </div>
  </div>

  {!filtered.length ? (
    <section className="admin-card planner-empty">
      <CalendarBlankIcon size={30} />
      <h3>Aucun planning</h3>
      <p>
        Aucun planning ne correspond aux critères actuels.
      </p>
      <button
        type="button"
        className="admin-button"
        onClick={onCreate}
      >
        <PlusIcon size={16} />
        Créer un planning
      </button>
    </section>
  ) : (
    <div className="admin-card">
      <div className="day-roster-scroll">
        <table className="day-roster-table">
          <thead>
            <tr>
              <th>Période</th>
              <th>Statut</th>
              <th>Shifts</th>
              <th>Stations</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((planning) => {
              const stations = new Set(
                planning.shifts.map(
                  (shift) => shift.station.id,
                ),
              );

              return (
                <tr key={planning.id}>
                  <td>
                    <strong>
                      {periodLabel(
                        planning.startDate,
                        planning.endDate,
                      )}
                    </strong>
                  </td>
                  <td>
                    <span
                      className={
                        "admin-badge" +
                        (planning.status === "DRAFT"
                          ? " draft"
                          : " active")
                      }
                    >
                      {planning.status === "DRAFT"
                        ? "Brouillon"
                        : "Publié"}
                    </span>
                  </td>
                  <td>{planning.shifts.length}</td>
                  <td>{stations.size}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-button secondary small"
                      onClick={() =>
                        onOpen(planning)
                      }
                    >
                      Ouvrir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  )}
</div>

);
}

function CreatePlanningModal({
open,
stations,
swappers,
busy,
onClose,
onCreated,
}: {
open: boolean;
stations: Station[];
swappers: Swapper[];
busy: boolean;
onClose: () => void;
onCreated: (
startDate: string,
endDate: string,
stationIds: string[],
swapperIds: string[],
shiftTypeIds: string[],
automatic: boolean,
) => Promise<void>;
}) {
const [startDate, setStartDate] = useState("");
const [endDate, setEndDate] = useState("");
const [stationIds, setStationIds] = useState<string[]>([]);
const [swapperIds, setSwapperIds] = useState<string[]>([]);
const [shiftTypeIds, setShiftTypeIds] = useState<string[]>(
SHIFT_TYPES.map((item) => item.id),
);
const [automatic, setAutomatic] = useState(false);
const [step, setStep] = useState(0);
const [error, setError] = useState("");

useEffect(() => {
if (!open) {
return;
}

setStartDate("");
setEndDate("");
setStationIds([]);
setSwapperIds([]);
setShiftTypeIds(
  SHIFT_TYPES.map((item) => item.id),
);
setAutomatic(false);
setStep(0);
setError("");

}, [open]);

const availableSwappers = useMemo(() => {
if (!stationIds.length) {
return swappers.filter(
(swapper) => swapper.isActive,
);
}

return swappers.filter((swapper) => {
  if (!swapper.isActive) {
    return false;
  }

  if (!swapper.stationId) {
    return true;
  }

  return stationIds.includes(swapper.stationId);
});

}, [swappers, stationIds]);

useEffect(() => {
if (!automatic) {
return;
}

setSwapperIds(
  availableSwappers.map(
    (swapper) => swapper.id,
  ),
);

}, [automatic, availableSwappers]);

function toggleStation(id: string) {
setStationIds((current) =>
current.includes(id)
? current.filter((item) => item !== id)
: [...current, id],
);
}

function toggleSwapper(id: string) {
setSwapperIds((current) =>
current.includes(id)
? current.filter((item) => item !== id)
: [...current, id],
);
}

function toggleShiftType(id: string) {
setShiftTypeIds((current) =>
current.includes(id)
? current.filter((item) => item !== id)
: [...current, id],
);
}

async function submit() {
setError("");

if (!startDate || !endDate) {
  setError("Veuillez définir la période.");
  return;
}

if (endDate < startDate) {
  setError(
    "La date de fin doit être après la date de début.",
  );
  return;
}

if (!stationIds.length) {
  setError(
    "Veuillez sélectionner au moins une station.",
  );
  return;
}

if (!shiftTypeIds.length) {
  setError(
    "Veuillez sélectionner au moins un type de shift.",
  );
  return;
}

if (!automatic && !swapperIds.length) {
  setError(
    "Veuillez sélectionner au moins un swappeur.",
  );
  return;
}

await onCreated(
  startDate,
  endDate,
  stationIds,
  automatic
    ? availableSwappers.map(
        (swapper) => swapper.id,
      )
    : swapperIds,
  shiftTypeIds,
  automatic,
);

}

const steps: StepItem[] = [
{
id: "period",
label: "Période",
isValid: () =>
Boolean(startDate && endDate && endDate >= startDate),
content: (
<div className="stepper-form-layout">
<div className="stepper-field-group">
<label>DATE DE DÉBUT *</label>
<input
type="date"
value={startDate}
onChange={(event) =>
setStartDate(event.target.value)
}
/>
</div>

      <div className="stepper-field-group">
        <label>DATE DE FIN *</label>
        <input
          type="date"
          value={endDate}
          min={startDate}
          onChange={(event) =>
            setEndDate(event.target.value)
          }
        />
      </div>

      {error && (
        <p className="error-message">
          {error}
        </p>
      )}
    </div>
  ),
},
{
  id: "stations",
  label: "Stations",
  isValid: () => stationIds.length > 0,
  content: (
    <div className="stepper-form-layout">
      <div className="stepper-field-group">
        <label>STATIONS CONCERNÉES *</label>

        <div className="planner-options">
          {stations
            .filter((station) => station.isActive)
            .map((station) => (
              <label
                key={station.id}
                className="checkbox-label"
              >
                <input
                  type="checkbox"
                  checked={stationIds.includes(
                    station.id,
                  )}
                  onChange={() =>
                    toggleStation(
                      station.id,
                    )
                  }
                />
                <span>
                  <strong>
                    {station.name}
                  </strong>
                  {station.location ? (
                    <small>
                      {station.location}
                    </small>
                  ) : null}
                </span>
              </label>
            ))}
        </div>
      </div>
    </div>
  ),
},
{
  id: "swappers",
  label: "Swappeurs",
  isValid: () =>
    automatic || swapperIds.length > 0,
  content: (
    <div className="stepper-form-layout">
      <div className="stepper-field-group">
        <label>MODE D'AFFECTATION</label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) =>
              setAutomatic(
                event.target.checked,
              )
            }
          />
          <span>
            Affectation automatique
            <small>
              Tous les swappeurs actifs
              compatibles seront considérés.
            </small>
          </span>
        </label>
      </div>

      {!automatic && (
        <div className="stepper-field-group">
          <label>SWAPPEURS À CONSIDÉRER *</label>

          <div className="planner-options">
            {availableSwappers.map(
              (swapper) => (
                <label
                  key={swapper.id}
                  className="checkbox-label"
                >
                  <input
                    type="checkbox"
                    checked={swapperIds.includes(
                      swapper.id,
                    )}
                    onChange={() =>
                      toggleSwapper(
                        swapper.id,
                      )
                    }
                  />
                  <span>
                    {swapper.fullName}
                    <small>
                      {swapper.email}
                    </small>
                  </span>
                </label>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  ),
},
{
  id: "shifts",
  label: "Shifts",
  isValid: () =>
    shiftTypeIds.length > 0,
  content: (
    <div className="stepper-form-layout">
      <div className="stepper-field-group">
        <label>SHIFTS À COUVRIR *</label>

        <div className="planner-options">
          {SHIFT_TYPES.map(
            (shiftType) => (
              <label
                key={shiftType.id}
                className="checkbox-label"
              >
                <input
                  type="checkbox"
                  checked={shiftTypeIds.includes(
                    shiftType.id,
                  )}
                  onChange={() =>
                    toggleShiftType(
                      shiftType.id,
                    )
                  }
                />
                <span>
                  <strong>
                    {shiftType.label}
                  </strong>
                  <small>
                    {shiftType.start} à{" "}
                    {shiftType.end}
                  </small>
                </span>
              </label>
            ),
          )}
        </div>
      </div>
    </div>
  ),
},
{
  id: "summary",
  label: "Résumé",
  content: (
    <div className="stepper-form-layout">
      <div className="planner-preview is-inline">
        <h3>Résumé du planning</h3>

        <p>
          <strong>Période :</strong>{" "}
          {startDate && endDate
            ? periodLabel(
                startDate,
                endDate,
              )
            : "Non définie"}
        </p>

        <p>
          <strong>Stations :</strong>{" "}
          {stationIds.length}
        </p>

        <p>
          <strong>Swappeurs :</strong>{" "}
          {automatic
            ? "Tous les actifs"
            : swapperIds.length}
        </p>

        <p>
          <strong>Types de shift :</strong>{" "}
          {shiftTypeIds.length}
        </p>

        <p>
          <strong>Mode :</strong>{" "}
          {automatic
            ? "Automatique"
            : "Manuel"}
        </p>
      </div>

      {error && (
        <p className="error-message">
          {error}
        </p>
      )}
    </div>
  ),
},

];

return (
<StepperModal
open={open}
title="Nouveau planning"
icon={<CalendarBlankIcon size={20} />}
steps={steps}
submitLabel="Créer le planning"
busy={busy}
onClose={onClose}
onSubmit={submit}
/>
);
}

function DayDetail({
planning,
date,
rows,
canEdit,
busy,
onClose,
onRefresh,
}: {
planning: Planning;
date: string;
rows: Shift[];
canEdit: boolean;
busy: boolean;
onClose: () => void;
onRefresh: () => Promise<void>;
}) {
const [removingId, setRemovingId] = useState<string | null>(
null,
);
const [error, setError] = useState("");

const orderedRows = [...rows].sort(
(first, second) =>
new Date(first.startTime).getTime() -
new Date(second.startTime).getTime(),
);

const stations = Array.from(
new Map(
orderedRows.map((shift) => [
shift.station.id,
shift.station,
]),
).values(),
);

async function removeShift(shift: Shift) {
if (removingId || busy) {
return;
}

setRemovingId(shift.id);
setError("");

try {
  await api(
    `/shifts/${shift.id}`,
    undefined,
    "DELETE",
  );

  await onRefresh();

  notify("Shift supprimé avec succès.");
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible de supprimer le shift.",
  );
} finally {
  setRemovingId(null);
}

}

return (
<Modal
open
title={formatLongDate(date)}
subtitle={${stations.length} station${ stations.length > 1 ? "s" : "" } · ${rows.length} shift${ rows.length > 1 ? "s" : "" }}
size="xl"
onClose={onClose}
>
<div className="planner-day-detail">
{!orderedRows.length ? (
<div className="admin-empty">
<h3>Aucun shift ce jour</h3>
<p>
Cette journée ne comporte aucun shift.
</p>
</div>
) : (
<div className="day-roster-scroll">
<table className="day-roster-table">
<thead>
<tr>
<th>Station</th>
<th>Shift</th>
<th>Swappeur</th>
<th>Pointage</th>
{canEdit && (
<th>Actions</th>
)}
</tr>
</thead>

          <tbody>
            {orderedRows.map((shift) => {
              const attendance =
                shift.attendances?.[0];

              return (
                <tr key={shift.id}>
                  <td>
                    <strong>
                      {shift.station.name}
                    </strong>
                  </td>

                  <td>
                    <div className="planner-day-detail__shift">
                      <strong>
                        {formatTime(
                          shift.startTime,
                        )}{" "}
                        –{" "}
                        {formatTime(
                          shift.endTime,
                        )}
                      </strong>

                      <span>
                        {formatDate(
                          shift.startTime,
                        )}
                      </span>
                    </div>
                  </td>

                  <td>
                    <strong>
                      {shift.swapper.fullName}
                    </strong>

                    {shift.swapper.email && (
                      <small>
                        {shift.swapper.email}
                      </small>
                    )}
                  </td>

                  <td>
                    <span
                      className={
                        "admin-badge " +
                        (attendance?.status ===
                        "CHECKED_OUT"
                          ? "active"
                          : attendance?.status ===
                            "ABSENT"
                          ? "draft"
                          : "")
                      }
                    >
                      {attendance?.status ??
                        "EXPECTED"}
                    </span>
                  </td>

                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="day-roster-remove"
                        disabled={
                          busy ||
                          removingId !== null
                        }
                        title="Supprimer le shift"
                        onClick={() =>
                          void removeShift(
                            shift,
                          )
                        }
                      >
                        <XIcon size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    {error && (
      <p
        className="error-message"
        role="alert"
      >
        {error}
      </p>
    )}

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

function PlanningEditor({
planning,
writable,
onBack,
onUpdate,
}: {
planning: Planning;
writable: boolean;
onBack: () => void;
onUpdate: (planning: Planning) => void;
}) {
const [stations, setStations] = useState<Station[]>([]);
const [view, setView] = useState<ViewScale>("week");
const [anchor, setAnchor] = useState(
dateOnly(planning.startDate),
);
const [stationFilter, setStationFilter] =
useState("");
const [coverageFilter, setCoverageFilter] =
useState<"all" | "assigned" | "absent">("all");
const [dayDetail, setDayDetail] = useState<string | null>(
null,
);
const [busy, setBusy] = useState(false);
const [error, setError] = useState("");

const shifts = planning.shifts.filter(
(shift) =>
isInsidePlanning(shift, planning),
);

const stationOptions = Array.from(
new Map(
shifts.map((shift) => [
shift.station.id,
shift.station,
]),
).values(),
);

const stationRows = shifts.filter(
(shift) =>
!stationFilter ||
shift.station.id === stationFilter,
);

const rows = stationRows.filter(
(shift) => {
if (coverageFilter === "all") {
return true;
}

  if (coverageFilter === "assigned") {
    return Boolean(shift.swapper);
  }

  return shift.attendances?.some(
    (attendance) =>
      attendance.status === "ABSENT",
  );
},

);

const filledShifts = stationRows.filter(
(shift) => Boolean(shift.swapper),
).length;

const totalShifts = stationRows.length;
const absentShifts = stationRows.filter(
(shift) =>
shift.attendances?.some(
(attendance) =>
attendance.status === "ABSENT",
),
).length;

const days = getDaysForView(
anchor,
view,
);

const shiftsByDay = useMemo(
() => groupByDay(rows),
[rows],
);

useEffect(() => {
let active = true;

api<Station[]>("/stations")
  .then((value) => {
    if (active) {
      setStations(value);
    }
  })
  .catch((value) => {
    if (active) {
      setError(
        value instanceof Error
          ? value.message
          : "Impossible de charger les stations.",
      );
    }
  });

return () => {
  active = false;
};

}, []);

async function refresh() {
const latest = await api<Planning>(
/plannings/${planning.id},
);

onUpdate(latest);

}

async function publish() {
if (busy) {
return;
}

if (!planning.shifts.length) {
  setError(
    "Impossible de publier un planning sans shift.",
  );
  return;
}

setBusy(true);
setError("");

try {
  const published = await api<Planning>(
    `/plannings/${planning.id}/publish`,
    undefined,
    "PATCH",
  );

  onUpdate(published);
  notify("Planning publié avec succès.");
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible de publier le planning.",
  );
} finally {
  setBusy(false);
}

}

async function exportPlanning() {
const data = shifts.map(
(shift) => ({
Station: shift.station.name,
Swappeur: shift.swapper.fullName,
Email: shift.swapper.email ?? "",
Début: shift.startTime,
Fin: shift.endTime,
Pointage:
shift.attendances?.[0]?.status ??
"EXPECTED",
}),
);

try {
  await exportToExcel(
    data,
    `planning-${planning.id}`,
  );
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible d'exporter le planning.",
  );
}

}

const globalCoverage =
totalShifts === 0
? {
className: "none",
label: "",
}
: filledShifts === totalShifts
? {
className: "full",
label: "Tous les postes sont affectés",
}
: {
className: "partial",
label: ${filledShifts} affectés · ${totalShifts - filledShifts} postes non affectés,
};

return (
<div className="planner">
<div className="planner-toolbar">
<div className="planner-toolbar__intro">
<button type="button" className="text-button planner-back" onClick={onBack} >
<ArrowLeftIcon size={15} weight="bold" />
Tous les plannings
</button>

      <h2>
        {periodLabel(
          planning.startDate,
          planning.endDate,
        )}
      </h2>

      <p className="planner-muted">
        <span
          className={
            "admin-badge" +
            (planning.status === "DRAFT"
              ? " draft"
              : " active")
          }
        >
          {planning.status === "DRAFT"
            ? "Brouillon"
            : "Publié"}
        </span>

        <span>
          {shifts.length} shift
          {shifts.length > 1 ? "s" : ""}
        </span>

        {shifts.length > 0 && (
          <span
            className={
              "planner-coverage-pill is-" +
              globalCoverage.className
            }
          >
            <i aria-hidden="true" />
            {globalCoverage.label}
          </span>
        )}
      </p>
    </div>

    <div className="planner-actions">
      {shifts.length > 0 && (
        <button
          type="button"
          className="admin-button secondary"
          onClick={() =>
            void exportPlanning()
          }
        >
          <DownloadSimple size={16} />
          <span>Exporter Excel</span>
        </button>
      )}

      {writable &&
        planning.status === "DRAFT" && (
          <button
            type="button"
            className="admin-button"
            disabled={busy}
            onClick={() =>
              void publish()
            }
          >
            {busy
              ? "Publication..."
              : "Publier le planning"}
          </button>
        )}
    </div>
  </div>

  <div
    className="planner-filterbar"
    role="group"
    aria-label="Filtres du planning"
  >
    <div className="planner-filterbar__group">
      <button
        type="button"
        className="admin-button secondary small"
        onClick={() =>
          setAnchor(
            shiftAnchor(
              anchor,
              view,
              -1,
            ),
          )
        }
      >
        <CaretLeftIcon size={15} />
      </button>

      <strong>
        {periodTitle(
          view,
          anchor,
        )}
      </strong>

      <button
        type="button"
        className="admin-button secondary small"
        onClick={() =>
          setAnchor(
            shiftAnchor(
              anchor,
              view,
              1,
            ),
          )
        }
      >
        <CaretRightIcon size={15} />
      </button>
    </div>

    <div className="planner-filterbar__group">
      <select
        className="planner-filter-select"
        value={view}
        onChange={(event) =>
          setView(
            event.target.value as ViewScale,
          )
        }
      >
        <option value="day">Jour</option>
        <option value="week">Semaine</option>
        <option value="month">Mois</option>
        <option value="year">Année</option>
      </select>
    </div>

    {stationOptions.length > 1 && (
      <div className="planner-filterbar__group">
        <select
          className="planner-filter-select"
          value={stationFilter}
          onChange={(event) =>
            setStationFilter(
              event.target.value,
            )
          }
        >
          <option value="">
            Toutes les stations
          </option>

          {stationOptions.map(
            (station) => (
              <option
                key={station.id}
                value={station.id}
              >
                {station.name}
              </option>
            ),
          )}
        </select>
      </div>
    )}

    <div className="planner-filterbar__group">
      <select
        className="planner-filter-select"
        value={coverageFilter}
        onChange={(event) =>
          setCoverageFilter(
            event.target.value as
              | "all"
              | "assigned"
              | "absent",
          )
        }
      >
        <option value="all">
          Tous les shifts ({stationRows.length})
        </option>
        <option value="assigned">
          Affectés ({filledShifts})
        </option>
        <option value="absent">
          Absents ({absentShifts})
        </option>
      </select>
    </div>
  </div>

  {error && (
    <p
      className="error-message"
      role="alert"
    >
      {error}
    </p>
  )}

  {stationOptions.length > 1 && (
    <div
      className="planner-station-coverage"
      aria-label="Couverture par station"
    >
      {stationOptions.map(
        (station) => {
          const stationShifts =
            shifts.filter(
              (shift) =>
                shift.station.id ===
                station.id,
            );

          const stationFilled =
            stationShifts.filter(
              (shift) =>
                Boolean(
                  shift.swapper,
                ),
            ).length;

          return (
            <button
              type="button"
              key={station.id}
              className={
                stationFilter ===
                station.id
                  ? "is-active"
                  : ""
              }
              onClick={() =>
                setStationFilter(
                  stationFilter ===
                    station.id
                    ? ""
                    : station.id,
                )
              }
            >
              <strong>
                {station.name}
              </strong>

              <span>
                {stationFilled}/
                {stationShifts.length}{" "}
                affectés
              </span>
            </button>
          );
        },
      )}
    </div>
  )}

  {!rows.length ? (
    <section className="admin-card planner-empty">
      <CalendarBlankIcon
        size={30}
      />

      <h3>
        Aucun shift à afficher
      </h3>

      <p>
        Aucun shift ne correspond
        aux filtres sélectionnés.
      </p>
    </section>
  ) : (
    <div className="planner-board">
      {view === "year" && (
        <div
          className="planner-year"
          aria-label="Calendrier de l'année"
        >
          {days.map((monthIso) => {
            const monthDate =
              new Date(
                `${monthIso}T00:00:00Z`,
              );

            const monthShifts =
              rows.filter(
                (shift) => {
                  const shiftDate =
                    new Date(
                      shift.startTime,
                    );

                  return (
                    shiftDate.getUTCFullYear() ===
                      monthDate.getUTCFullYear() &&
                    shiftDate.getUTCMonth() ===
                      monthDate.getUTCMonth()
                  );
                },
              );

            return (
              <button
                type="button"
                className="planner-year-month"
                key={monthIso}
                onClick={() => {
                  setAnchor(monthIso);
                  setView("month");
                }}
              >
                <strong>
                  {monthDate.toLocaleDateString(
                    "fr-FR",
                    {
                      month:
                        "long",
                      year:
                        "numeric",
                      timeZone:
                        "UTC",
                    },
                  )}
                </strong>

                <span>
                  {
                    monthShifts.length
                  }{" "}
                  shift
                  {monthShifts.length >
                  1
                    ? "s"
                    : ""}
                </span>

                <span className="planner-year-bar">
                  <i
                    style={{
                      width:
                        monthShifts.length
                          ? "100%"
                          : "0%",
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {view === "month" && (
        <div
          className="planner-month"
          aria-label="Calendrier du mois"
        >
          <div className="planner-month-weekdays">
            {WEEKDAYS.map(
              (weekday) => (
                <span
                  key={weekday}
                >
                  {weekday}
                </span>
              ),
            )}
          </div>

          <div className="planner-month-grid">
            {days.map((iso) => {
              const date =
                new Date(
                  `${iso}T00:00:00Z`,
                );

              const monthAnchor =
                new Date(
                  `${anchor}T00:00:00Z`,
                );

              const inMonth =
                date.getUTCMonth() ===
                  monthAnchor.getUTCMonth() &&
                date.getUTCFullYear() ===
                  monthAnchor.getUTCFullYear();

              const dayRows =
                shiftsByDay.get(
                  iso,
                ) ?? [];

              return (
                <div
                  key={iso}
                  className={
                    "planner-cell" +
                    (inMonth
                      ? ""
                      : " is-outside")
                  }
                >
                  <button
                    type="button"
                    className="planner-cell-num"
                    onClick={() => {
                      setAnchor(iso);
                      setView("day");
                      setDayDetail(
                        iso,
                      );
                    }}
                  >
                    {date.getUTCDate()}
                  </button>

                  {dayRows.length >
                    0 && (
                    <div className="planner-cell-events">
                      <button
                        type="button"
                        className="planner-event-chip"
                        onClick={() =>
                          setDayDetail(
                            iso,
                          )
                        }
                      >
                        <span className="event-dot" />
                        <span className="event-text">
                          {
                            dayRows.length
                          }{" "}
                          shift
                          {dayRows.length >
                          1
                            ? "s"
                            : ""}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(view === "week" ||
        view === "day") && (
        <div
          className={
            "planner-week-overview" +
            (view === "day"
              ? " is-single"
              : "")
          }
        >
          {days.map((iso) => {
            const dayRows =
              shiftsByDay.get(
                iso,
              ) ?? [];

            const filled =
              dayRows.filter(
                (shift) =>
                  Boolean(
                    shift.swapper,
                  ),
              ).length;

            const state =
              coverage(
                filled,
                dayRows.length,
              );

            const date =
              new Date(
                `${iso}T00:00:00Z`,
              );

            const weekday =
              date.getUTCDay();

            const weekdayIndex =
              weekday === 0
                ? 6
                : weekday - 1;

            return (
              <div
                className="planner-week-day"
                key={iso}
              >
                <button
                  type="button"
                  className="planner-week-day-head"
                  onClick={() =>
                    setDayDetail(
                      iso,
                    )
                  }
                >
                  <strong>
                    {
                      WEEKDAYS[
                        weekdayIndex
                      ]
                    }
                  </strong>

                  <span>
                    {date.getUTCDate()}
                  </span>
                </button>

                <button
                  type="button"
                  className={
                    "planner-range is-" +
                    state
                  }
                  onClick={() =>
                    setDayDetail(
                      iso,
                    )
                  }
                >
                  {dayRows.length ===
                  0 ? (
                    <span className="planner-range-empty">
                      Aucun shift
                    </span>
                  ) : (
                    <>
                      <span className="planner-range-count">
                        <strong>
                          {
                            dayRows.length
                          }
                        </strong>
                        <small>
                          shift
                          {dayRows.length >
                          1
                            ? "s"
                            : ""}
                        </small>
                      </span>

                      <span className="planner-range-coverage">
                        {filled}/
                        {
                          dayRows.length
                        }{" "}
                        affecté
                        {filled >
                        1
                          ? "s"
                          : ""}
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
  )}

  {dayDetail && (
    <DayDetail
      planning={planning}
      date={dayDetail}
      rows={
        shiftsByDay.get(
          dayDetail,
        ) ?? []
      }
      canEdit={
        writable &&
        planning.status ===
          "DRAFT"
      }
      busy={busy}
      onClose={() =>
        setDayDetail(null)
      }
      onRefresh={refresh}
    />
  )}
</div>

);
}

export default function Planner({
user,
}: {
user: User;
}) {
const navigate = useNavigate();

const writable =
user.role === "ADMIN" ||
user.role === "SUPERVISOR";

const [plans, setPlans] = useState<
Planning[]

([]);
const [current, setCurrent] =
useState<Planning | null>(null);
const [stations, setStations] =
useState<Station[]>([]);
const [swappers, setSwappers] =
useState<Swapper[]>([]);
const [loading, setLoading] =
useState(true);
const [creating, setCreating] =
useState(false);
const [busy, setBusy] =
useState(false);
const [error, setError] =
useState("");

async function loadPlans() {
setLoading(true);
setError("");

try {
  const result =
    await api<Planning[]>(
      "/plannings",
    );

  setPlans(result);
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible de charger les plannings.",
  );
} finally {
  setLoading(false);
}

}

async function loadResources() {
try {
const [stationResult, userResult] =
await Promise.all([
api<Station[]>(
"/stations",
),
api<Swapper[]>(
"/users?role=SWAPPER",
),
]);

  setStations(
    stationResult.filter(
      (station) =>
        station.isActive,
    ),
  );

  setSwappers(
    userResult.filter(
      (swapper) =>
        swapper.isActive,
    ),
  );
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible de charger les données du planning.",
  );
}

}

useEffect(() => {
void loadPlans();
void loadResources();
}, []);

async function openPlanning(
planning: Planning,
) {
setError("");

try {
  const latest =
    await api<Planning>(
      `/plannings/${planning.id}`,
    );

  setCurrent(latest);
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible de charger ce planning.",
  );
}

}

async function createPlanning(
startDate: string,
endDate: string,
stationIds: string[],
swapperIds: string[],
shiftTypeIds: string[],
automatic: boolean,
) {
if (busy) {
return;
}

setBusy(true);
setError("");

try {
  const planning =
    await api<Planning>(
      "/plannings",
      {
        startDate:
          normalizeStartDate(
            startDate,
          ),
        endDate:
          normalizeEndDate(
            endDate,
          ),
      },
      "POST",
    );

  const selectedShiftTypes =
    SHIFT_TYPES.filter(
      (shiftType) =>
        shiftTypeIds.includes(
          shiftType.id,
        ),
    );

  const selectedSwappers =
    swappers.filter(
      (swapper) =>
        swapperIds.includes(
          swapper.id,
        ),
    );

  if (!selectedSwappers.length) {
    throw new Error(
      automatic
        ? "Aucun swappeur actif disponible."
        : "Aucun swappeur sélectionné.",
    );
  }

  const dates =
    getDatesBetween(
      startDate,
      endDate,
    );

  let assignmentIndex = 0;

  for (
    let dateIndex = 0;
    dateIndex < dates.length;
    dateIndex += 1
  ) {
    const date =
      dates[dateIndex];

    for (
      let stationIndex = 0;
      stationIndex <
      stationIds.length;
      stationIndex += 1
    ) {
      const selectedStationId =
        stationIds[
          stationIndex
        ];

      for (
        let shiftIndex = 0;
        shiftIndex <
        selectedShiftTypes.length;
        shiftIndex += 1
      ) {
        const shiftType =
          selectedShiftTypes[
            shiftIndex
          ];

        if (
          !selectedSwappers.length
        ) {
          continue;
        }

        const swapper =
          selectedSwappers[
            assignmentIndex %
              selectedSwappers.length
          ];

        assignmentIndex += 1;

        const startTime =
          createShiftDate(
            date,
            shiftType.start,
            false,
          );

        const endTime =
          createShiftDate(
            date,
            shiftType.end,
            shiftType.id ===
              "NIGHT",
          );

        await api<Shift>(
          "/shifts",
          {
            stationId:
              selectedStationId,
            swapperId:
              swapper.id,
            startTime,
            endTime,
            planningId:
              planning.id,
          },
          "POST",
        );
      }
    }
  }

  const latest =
    await api<Planning>(
      `/plannings/${planning.id}`,
    );

  setPlans((currentPlans) => [
    latest,
    ...currentPlans.filter(
      (item) =>
        item.id !== latest.id,
    ),
  ]);

  setCurrent(latest);
  setCreating(false);

  notify(
    automatic
      ? "Planning automatique créé."
      : "Planning créé avec succès.",
  );
} catch (value) {
  setError(
    value instanceof Error
      ? value.message
      : "Impossible de créer le planning.",
  );
} finally {
  setBusy(false);
}

}

if (loading) {
return (
<div className="planner">
<section className="admin-card planner-empty">
<ClockIcon size={30} />
<h3>Chargement des plannings</h3>
<p>
Récupération des données en cours.
</p>
</section>
</div>
);
}

if (current) {
return (
<>
<PlanningEditor
planning={current}
writable={writable}
onBack={() =>
setCurrent(null)
}
onUpdate={(planning) => {
setCurrent(planning);

        setPlans(
          (currentPlans) =>
            currentPlans.map(
              (item) =>
                item.id ===
                planning.id
                  ? planning
                  : item,
            ),
        );
      }}
    />

    {error && (
      <p
        className="error-message"
        role="alert"
      >
        {error}
      </p>
    )}
  </>
);

}

return (
<>
{error && (
<p className="error-message" role="alert" >
{error}
</p>
)}

  <PlanningList
    plans={plans}
    onOpen={(planning) =>
      void openPlanning(
        planning,
      )
    }
    onCreate={() => {
      if (!writable) {
        return;
      }

      setCreating(true);
    }}
  />

  {writable && (
    <CreatePlanningModal
      open={creating}
      stations={stations}
      swappers={swappers}
      busy={busy}
      onClose={() =>
        setCreating(false)
      }
      onCreated={
        createPlanning
      }
    />
  )}
</>

);
}