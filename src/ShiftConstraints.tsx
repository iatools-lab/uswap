import { useEffect, useState } from 'react';
import { api } from './auth-api';

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