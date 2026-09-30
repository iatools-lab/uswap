import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/auth-api';

export type ConstraintReport = {
  valid: boolean;
  stationName: string;
  timezone: string;
  durationHours: number;
  weeks: {
    startDate: string;
    existingHours: number;
    addedHours: number;
    projectedHours: number;
    limitHours: number;
  }[];
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};

type Report = ConstraintReport;

export function useShiftConstraints(
  enabled: boolean,
  stationId: string,
  swapperId: string,
  start: string,
  end: string,
) {
  const from = Date.parse(start);
  const until = Date.parse(end);

  const body =
    enabled &&
    stationId &&
    swapperId &&
    Number.isFinite(from) &&
    Number.isFinite(until) &&
    until > from
      ? {
          stationId,
          swapperId,
          startTime: new Date(from).toISOString(),
          endTime: new Date(until).toISOString(),
        }
      : null;

  const key = body ? JSON.stringify(body) : '';
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!key) return;
    let active = true;
    setResult(null);

    const timer = setTimeout(() => {
      api<Report>('/shifts/validate', JSON.parse(key))
        .then((report) => {
          if (active) setResult({ key, report });
        })
        .catch((error) => {
          if (active) setResult({ key, error: error.message });
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, retry]);

  const current = result?.key === key ? result : null;

  return {
    ready: !!current?.report?.valid,
    report: current?.report,
    error: current?.error,
    pending: !!key && !current,
    retry: () => setRetry((n) => n + 1),
  };
}

export function useShiftConstraintsAll(
  enabled: boolean,
  stationId: string,
  swappers: { id: string; fullName: string }[],
  start: string,
  end: string,
) {
  const from = Date.parse(start);
  const until = Date.parse(end);
  const ids = swappers.map((s) => s.id).join(",");
  const canRun =
    enabled &&
    !!stationId &&
    swappers.length > 0 &&
    Number.isFinite(from) &&
    Number.isFinite(until) &&
    until > from;
  const key = canRun
    ? JSON.stringify({
        stationId,
        ids,
        startTime: new Date(from).toISOString(),
        endTime: new Date(until).toISOString(),
      })
    : "";
  const [result, setResult] = useState<{
    key: string;
    reports?: { name: string; report: Report }[];
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  // Les ids des swappeurs sont déjà encodés dans « key » : on évite de dependre
  // du tableau recréé à chaque render, qui relancerait les requêtes en boucle.
  const swappersRef = useRef(swappers);
  swappersRef.current = swappers;

  useEffect(() => {
    if (!key) return;
    let active = true;
    setResult(null);
    const payload = JSON.parse(key) as { stationId: string; startTime: string; endTime: string };
    const timer = setTimeout(() => {
      Promise.all(
        swappersRef.current.map((swapper) =>
          api<Report>("/shifts/validate", {
            stationId: payload.stationId,
            swapperId: swapper.id,
            startTime: payload.startTime,
            endTime: payload.endTime,
          }).then((report) => ({ name: swapper.fullName, report })),
        ),
      )
        .then((reports) => {
          if (active) setResult({ key, reports });
        })
        .catch((error) => {
          if (active) setResult({ key, error: error.message });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, retry]);

  const current = result?.key === key ? result : null;
  const reports = current?.reports || [];
  return {
    ready: reports.length === swappers.length && reports.every((item) => item.report.valid),
    reports,
    error: current?.error,
    pending: !!key && !current,
    retry: () => setRetry((n) => n + 1),
  };
}

export function ShiftConstraints({
  state,
}: {
  state: ReturnType<typeof useShiftConstraints>;
}) {
  if (state.pending) {
    return (
      <p role="status" className="constraint-check">
        Vérification des disponibilités et des heures…
      </p>
    );
  }

  if (state.error) {
    return (
      <p role="alert" className="error-message">
        {state.error}{' '}
        <button type="button" className="text-button" onClick={state.retry}>
          Réessayer le contrôle
        </button>
      </p>
    );
  }

  const report = state.report;
  if (!report) return null;

  return (
    <section className="constraint-check" aria-label="Contrôle de l’affectation" aria-live="polite">
      <h3>{report.valid ? 'Affectation disponible' : 'Affectation à corriger'}</h3>
      <p>
        {report.durationHours} h prévues · {report.stationName}
      </p>

      <div className="constraint-weeks">
        {report.weeks.map((week) => (
          <div key={week.startDate}>
            <span>
              Semaine du{' '}
              {new Date(week.startDate + 'T12:00:00Z').toLocaleDateString('fr-FR', {
                timeZone: 'UTC',
              })}
            </span>
            <strong>
              {week.projectedHours} h / {week.limitHours} h
            </strong>
            <small>
              {week.existingHours} h déjà prévues + {week.addedHours} h ajoutées dans cette station
            </small>
          </div>
        ))}
      </div>

      {report.warnings && report.warnings.length > 0 && (
        <ul className="constraint-warnings" role="status">
          {report.warnings.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}

      {report.errors && report.errors.length > 0 && (
        <ul className="constraint-errors" role="alert">
          {report.errors.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}

      <p className="constraint-note">
        Les contraintes sont revérifiées à l’enregistrement et à la publication.
      </p>
    </section>
  );
}

export function ShiftConstraintsAll({
  state,
}: {
  state: ReturnType<typeof useShiftConstraintsAll>;
}) {
  if (state.pending) {
    return (
      <p role="status" className="constraint-check">
        Vérification des disponibilités pour chaque swappeur…
      </p>
    );
  }
  if (state.error) {
    return (
      <p role="alert" className="error-message">
        {state.error}{" "}
        <button type="button" className="text-button" onClick={state.retry}>
          Réessayer le contrôle
        </button>
      </p>
    );
  }
  if (!state.reports.length) return null;
  return (
    <div className="constraint-stack">
      {state.reports.map((item) => (
        <ShiftConstraints
          key={item.name}
          state={{
            ready: item.report.valid,
            report: { ...item.report, stationName: `${item.report.stationName} · ${item.name}` },
            error: undefined,
            pending: false,
            retry: state.retry,
          }}
        />
      ))}
    </div>
  );
}