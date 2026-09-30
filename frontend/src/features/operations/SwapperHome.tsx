import {
useEffect,
useState,
type FormEvent,
} from "react";
import { notify } from "../../ui/Toast";
import { api } from "../../api/auth-api";
import { Select } from "../../ui/Select";
import {
CheckCircle,
LoaderCircle,
Scan,
Warning,
} from "../../ui/icons";
import { QrScanner } from "./QrScanner";
import {
captureQrToken,
clearQrToken,
isValidQrToken,
parseQrToken,
} from "./qrToken";
import {
formatDate,
isInWindow,
isOpenShift,
pickNextShift,
} from "./format";
import { ShiftTable } from "./ShiftTable";
import type {
OperationsViewProps,
ScanResult,
} from "./types";

export function SwapperHome({
user,
data,
onChanged,
}: OperationsViewProps) {
const openShifts = data.shifts.filter(
isOpenShift,
);

const liveShifts = openShifts.filter(
isInWindow,
);

const next = pickNextShift(
data.shifts,
);

const [error, setError] = useState("");

const [result, setResult] =
useState<ScanResult | null>(null);

const [busy, setBusy] = useState(false);

const [token, setToken] = useState(() =>
captureQrToken(),
);

const [scanning, setScanning] =
useState(false);

const [shiftId, setShiftId] = useState(() =>
openShifts.length === 1
? openShifts[0].id
: "",
);

useEffect(() => {
const receive = () => {
const nextToken = captureQrToken();

  if (nextToken) {
    setToken(nextToken);
  }
};

receive();

window.addEventListener(
  "hashchange",
  receive,
);

return () =>
  window.removeEventListener(
    "hashchange",
    receive,
  );

}, []);

useEffect(() => {
if (openShifts.length === 1) {
setShiftId(
openShifts[0].id,
);
}
}, [
openShifts.length,
openShifts[0]?.id,
]);

const selected = data.shifts.find(
(shift) =>
shift.id === shiftId,
);

const showForm =
Boolean(token.trim()) ||
openShifts.length > 0;

const noShiftInWindow =
liveShifts.length === 0;

const scanned = isValidQrToken(
parseQrToken(token) ||
token.trim(),
);

async function punch(
e: FormEvent,
) {
e.preventDefault();

const raw =
  parseQrToken(token) ||
  token.trim();

if (!isValidQrToken(raw)) {
  setError(
    "Scannez le QR ou collez le lien fourni par le chef de station.",
  );
  return;
}

if (!openShifts.length) {
  setError(
    "Aucune affectation ouverte pour votre compte. Le pointage n’est possible que sur une affectation publiée.",
  );
  return;
}

if (!shiftId) {
  setError(
    "Choisissez l’affectation à pointer.",
  );
  return;
}

if (!selected) {
  setError(
    "L’affectation sélectionnée est introuvable.",
  );
  return;
}

const attendanceStatus =
  selected.attendance?.status ??
  "EXPECTED";

if (
  attendanceStatus ===
  "CHECKED_OUT"
) {
  setError(
    "Ce service est déjà terminé.",
  );
  return;
}

if (
  attendanceStatus === "ABSENT" ||
  attendanceStatus === "JUSTIFIED"
) {
  setError(
    "Ce pointage est déjà clôturé et ne peut plus être scanné.",
  );
  return;
}

const action =
  attendanceStatus ===
  "CHECKED_IN"
    ? "CHECKOUT"
    : "CHECKIN";

setBusy(true);
setError("");

try {
  const position =
    await new Promise<
      GeolocationPosition | null
    >((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (value) =>
          resolve(value),
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 30000,
        },
      );
    });

  const location = position
    ? {
        latitude:
          position.coords.latitude,
        longitude:
          position.coords.longitude,
      }
    : {};

  if (action === "CHECKIN") {
    const response =
      await api<{
        message: string;
        punctuality:
          | "ON_TIME"
          | "LATE";
        attendance: {
          checkInAt:
            | string
            | null;
          checkOutAt:
            | string
            | null;
        };
      }>(
        "/attendance/check-in",
        {
          token: raw,
          shiftId: selected.id,
          stationId:
            selected.station.id,
          ...location,
        },
      );

    setResult({
      kind: "CHECKIN",
      status:
        response.punctuality,
      checkedInAt:
        response.attendance
          .checkInAt,
      checkedOutAt:
        response.attendance
          .checkOutAt,
      toleranceMinutes:
        selected.station
          .latenessToleranceMinutes ??
        0,
      timezone:
        selected.station.timezone ||
        "Africa/Douala",
    });

    notify(
      response.punctuality ===
        "LATE"
        ? "Prise de service enregistrée. Pointage en retard."
        : "Prise de service enregistrée.",
    );
  } else {
    const response =
      await api<{
        message: string;
        attendance: {
          checkInAt:
            | string
            | null;
          checkOutAt:
            | string
            | null;
        };
      }>(
        "/attendance/check-out",
        {
          token: raw,
          shiftId: selected.id,
          stationId:
            selected.station.id,
          ...location,
        },
      );

    setResult({
      kind: "CHECKOUT",
      status: "CLOSED",
      checkedInAt:
        response.attendance
          .checkInAt,
      checkedOutAt:
        response.attendance
          .checkOutAt,
      toleranceMinutes:
        selected.station
          .latenessToleranceMinutes ??
        0,
      timezone:
        selected.station.timezone ||
        "Africa/Douala",
    });

    notify(
      "Fin de service enregistrée.",
    );
  }

  setToken("");
  clearQrToken();
  onChanged();
} catch (err) {
  setResult(null);
  setError(
    err instanceof Error
      ? err.message
      : "Une erreur est survenue pendant le pointage.",
  );
} finally {
  setBusy(false);
}

}

const resultDate =
result?.kind === "CHECKIN"
? result.checkedInAt
: result?.checkedOutAt ||
result?.checkedInAt;

return (
<>
{error && (
<p className="error-message" role="alert" >
{error}
</p>
)}

  {result && (
    <p
      className={`ops-result ${
        result.status === "LATE"
          ? "ops-result--late"
          : "ops-result--ok"
      }`}
      role="status"
    >
      {result.status === "LATE" ? (
        <Warning size={22} />
      ) : (
        <CheckCircle size={22} />
      )}

      <span>
        {resultDate
          ? result.kind === "CHECKIN"
            ? result.status === "LATE"
              ? `Prise de service à ${formatDate(
                  resultDate,
                  result.timezone,
                  true,
                )} · En retard (tolérance ${result.toleranceMinutes} min).`
              : `Prise de service à ${formatDate(
                  resultDate,
                  result.timezone,
                  true,
                )} · À l’heure.`
            : `Fin de service à ${formatDate(
                resultDate,
                result.timezone,
                true,
              )}.`
          : result.kind === "CHECKIN"
            ? "Prise de service enregistrée."
            : "Fin de service enregistrée."}
      </span>
    </p>
  )}

  {next && (
    <section className="admin-card operations-hero">
      <p className="admin-eyebrow">
        Prochaine affectation
      </p>

      <h2>
        {next.station?.name}
      </h2>

      <p>
        {formatDate(
          next.startTime,
        )}{" "}
        –{" "}
        {formatDate(
          next.endTime,
        )}
      </p>

      <span
        className={`attendance-status ${
          next.attendance
            ?.checkedOutAt
            ? "attendance-status--closed"
            : next.attendance
              ? next.attendance.isLate
                ? "attendance-status--late"
                : "attendance-status--present"
              : isInWindow(next)
                ? "attendance-status--present"
                : "attendance-status--expected"
        }`}
      >
        {next.attendance
          ?.checkedOutAt
          ? "Terminé"
          : next.attendance
            ? next.attendance.isLate
              ? "Présent · en retard"
              : "Début déjà pointé"
            : isInWindow(next)
              ? "Créneau en cours"
              : "Hors créneau"}
      </span>
    </section>
  )}

  {showForm && (
    <section className="admin-card ops-action-card">
      <form onSubmit={punch}>
        <div className="admin-card-heading">
          <div>
            <h2>
              Pointer mon service
            </h2>

            <p className="operations-hint">
              Scannez le QR affiché par le chef, choisissez votre shift, puis confirmez.
            </p>
          </div>
        </div>

        {!openShifts.length && (
          <p
            className="error-message"
            role="status"
          >
            Aucun shift ouvert pour vous.
          </p>
        )}

        {!!openShifts.length &&
          noShiftInWindow && (
            <p
              className="ops-callout ops-callout--warn"
              role="status"
            >
              Aucun de vos shifts n’est dans sa fenêtre actuelle.
            </p>
          )}

        {scanned && (
          <p
            className="ops-result ops-result--ok"
            role="status"
          >
            <Scan size={18} />
            QR détecté — choisissez l’affectation puis confirmez.
          </p>
        )}

        <fieldset
          disabled={busy}
          className="ops-form ops-form--padded"
        >
          <div className="user-form-grid">
            <label>
              Affectation

              {openShifts.length ? (
                <Select
                  ariaLabel="Affectation"
                  value={shiftId}
                  placeholder="Sélectionner"
                  onChange={(value) =>
                    setShiftId(
                      String(value),
                    )
                  }
                  options={openShifts.map(
                    (shift) => ({
                      value: shift.id,
                      label: `${shift.station?.name} · ${formatDate(
                        shift.startTime,
                      )}`,
                    }),
                  )}
                />
              ) : (
                <span className="operations-hint">
                  Aucune affectation ouverte à sélectionner.
                </span>
              )}
            </label>

            <label>
              Lien ou code QR

              <input
                required
                autoComplete="off"
                value={token || ""}
                onChange={(e) =>
                  setToken(
                    e.target.value,
                  )
                }
                placeholder="Coller le lien, ou scanner ci-dessous"
              />
            </label>
          </div>
        </fieldset>

        {selected &&
          !isInWindow(selected) &&
          !selected.attendance && (
            <p
              className="operations-hint ops-form--padded"
              role="status"
            >
              Ce shift n’est pas dans sa fenêtre (
              {formatDate(
                selected.startTime,
              )}{" "}
              –{" "}
              {formatDate(
                selected.endTime,
              )}
              ).
            </p>
          )}

        <div className="user-form-actions planner-actions ops-form--padded">
          <button
            type="button"
            className="admin-button secondary"
            onClick={() =>
              setScanning(true)
            }
          >
            <Scan size={16} />
            Scanner le QR
          </button>

          <button
            className="admin-button primary-cta"
            disabled={
              busy ||
              !openShifts.length ||
              !shiftId
            }
          >
            {busy && (
              <LoaderCircle
                className="spin"
                size={16}
              />
            )}
            Confirmer le pointage
          </button>
        </div>
      </form>
    </section>
  )}

  <QrScanner
    open={scanning}
    onClose={() =>
      setScanning(false)
    }
    onDetected={setToken}
  />

  <section className="admin-card">
    <div className="admin-card-heading">
      <h2>Mes affectations</h2>
    </div>

    <ShiftTable
      user={user}
      shifts={data.shifts}
      emptyLabel="Aucune affectation à venir"
    />

    {data.shifts.length ===
      data.limit && (
      <p className="workspace-limit">
        Les {data.limit} prochaines affectations sont affichées.
      </p>
    )}
  </section>
</>

);
}