import { useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
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

function hours(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);
}

function issueText(issue: { code: string; message: string }, report: Report) {
  const week = report.weeks[0];
  if (issue.code === 'REST') {
    const values = issue.message.match(/([\d,.]+) h.*minimum ([\d,.]+) h/i);
    const actual = values?.[1]?.replace('.', ',') ?? 'moins que prévu';
    const minimum = values?.[2]?.replace('.', ',') ?? 'le minimum requis';
    return {
      title: 'Le temps de repos obligatoire n’est pas respecté.',
      detail: `Ce shift ne laisserait que ${actual} h de repos avant ou après un autre service. La station exige au moins ${minimum} h. Choisissez un autre swappeur ou décalez l’un des shifts.`,
    };
  }
  if (issue.code === 'OVERLAP') {
    return {
      title: 'Ce swappeur travaille déjà sur ce créneau.',
      detail: `${issue.message} Choisissez un autre swappeur ou modifiez l’horaire du shift.`,
    };
  }
  if (issue.code === 'WEEKLY_LIMIT' && week) {
    return {
      title: 'La limite hebdomadaire serait dépassée.',
      detail: `Avec ce shift, le total atteindrait ${hours(week.projectedHours)} h, soit ${hours(week.projectedHours - week.limitHours)} h de plus que les ${hours(week.limitHours)} h autorisées.`,
    };
  }
  if (issue.code === 'NIGHT') {
    return {
      title: 'Ce shift se termine le lendemain.',
      detail: 'Le prochain service doit laisser assez de repos après la fin de ce shift de nuit.',
    };
  }
  if (issue.code === 'NO_BREAK') {
    return {
      title: 'Aucune pause n’est prévue.',
      detail: 'Ce shift dure au moins 6 h. Ajoutez une pause dans le modèle de shift avant de l’utiliser.',
    };
  }
  if (issue.code === 'NEAR_LIMIT' && week) {
    return {
      title: 'La limite hebdomadaire est proche.',
      detail: `Après cette affectation, il ne restera que ${hours(Math.max(0, week.limitHours - week.projectedHours))} h disponibles cette semaine.`,
    };
  }
  return { title: issue.message, detail: '' };
}

export function ShiftConstraints({
  state,
  subjectName,
}: {
  state: ReturnType<typeof useShiftConstraints>;
  subjectName?: string;
}) {
  if (state.pending) {
    return (
      <div role="status" className="constraint-check constraint-check--pending">
        <span className="constraint-check__spinner" aria-hidden="true" />
        Vérification du planning et des règles de la station…
      </div>
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
  const uniqueIssues = (issues: { code: string; message: string }[]) =>
    issues.filter(
      (issue, index, all) =>
        all.findIndex((candidate) => candidate.code === issue.code && candidate.message === issue.message) === index,
    );
  const errors = uniqueIssues(report.errors);
  // L'état de la limite est déjà expliqué dans le résumé hebdomadaire.
  const warnings = uniqueIssues(report.warnings).filter((issue) => issue.code !== 'NEAR_LIMIT');

  return (
    <section
      className={`constraint-check ${report.valid ? 'is-valid' : 'is-blocked'}`}
      aria-label="Contrôle de l’affectation"
      aria-live="polite"
      role={report.valid ? 'status' : 'alert'}
    >
      <header className="constraint-check__header">
        <span className="constraint-check__icon" aria-hidden="true">
          {report.valid ? <CheckCircleIcon size={20} weight="fill" /> : <WarningCircleIcon size={20} weight="fill" />}
        </span>
        <div>
          <span className="constraint-check__eyebrow">Résultat du contrôle</span>
          <h3>
            {report.valid
              ? subjectName ? `L’affectation de ${subjectName} est possible.` : 'Cette affectation est possible.'
              : subjectName ? `L’affectation de ${subjectName} est bloquée.` : 'Cette affectation est bloquée.'}
          </h3>
          <p>
            Le shift ajoute {hours(report.durationHours)} h de travail effectif à {report.stationName}. La pause prévue n’est pas comptée comme du temps travaillé.
          </p>
        </div>
      </header>

      <div className="constraint-weeks">
        {report.weeks.map((week) => {
          const remaining = week.limitHours - week.projectedHours;
          const percent = Math.min(100, Math.max(0, (week.projectedHours / week.limitHours) * 100));
          return (
            <div key={week.startDate} className={remaining < 0 ? 'is-over' : remaining <= week.limitHours * .1 ? 'is-near' : ''}>
              <span className="constraint-week__date">
                Semaine du {new Date(week.startDate + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })}
              </span>
              <p>
                Cette personne a déjà <strong>{hours(week.existingHours)} h</strong> planifiées. Ce shift ajouterait <strong>{hours(week.addedHours)} h</strong> et porterait son total à <strong>{hours(week.projectedHours)} h sur {hours(week.limitHours)} h</strong>.
              </p>
              <span className="constraint-week__bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
              <small>
                {remaining < 0
                  ? `La limite serait dépassée de ${hours(Math.abs(remaining))} h.`
                  : `Il resterait ${hours(remaining)} h disponibles cette semaine.`}
              </small>
            </div>
          );
        })}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="constraint-issues">
          {errors.map((issue, index) => {
            const copy = issueText(issue, report);
            return <div className="constraint-issue is-error" key={`error-${issue.code}-${index}`}>
              <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
              <div><strong>{copy.title}</strong>{copy.detail && <p>{copy.detail}</p>}</div>
            </div>;
          })}
          {warnings.map((issue, index) => {
            const copy = issueText(issue, report);
            return <div className="constraint-issue is-warning" key={`warning-${issue.code}-${index}`}>
              <InfoIcon size={18} weight="fill" aria-hidden="true" />
              <div><strong>{copy.title}</strong>{copy.detail && <p>{copy.detail}</p>}</div>
            </div>;
          })}
        </div>
      )}

      <p className="constraint-note">
        Ce contrôle sera refait au moment d’enregistrer puis de publier le planning.
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
          subjectName={item.name}
          state={{
            ready: item.report.valid,
            report: item.report,
            error: undefined,
            pending: false,
            retry: state.retry,
          }}
        />
      ))}
    </div>
  );
}
