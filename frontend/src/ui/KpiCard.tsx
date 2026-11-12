/**
 * Carte de produit cartesien (KPI).
 *
 * Historiquement rendue par le `Card` de @tremor/react. Ce composant n'apportait
 * qu'une <div> portant des classes Tailwind, or Tailwind n'est pas installe :
 * ces classes ne produisaient aucun style. Le rendu vient entierement de
 * `kpi-card.css`, dont les classes `tremor-kpi*` sont conservees pour ne pas
 * toucher aux feuilles existantes (dont admin-home.css).
 */
import type { ReactNode } from "react";
import "./kpi-card.css";

export type KpiTone = "navy" | "blue" | "green" | "amber" | "red" | "neutral";

const KPI_TONES: ReadonlySet<KpiTone> = new Set([
  "navy",
  "blue",
  "green",
  "amber",
  "red",
  "neutral",
]);

export function KpiCard({
  label,
  value,
  detail,
  hint,
  icon,
  tone = "navy",
  progress,
  compact = false,
  className = "",
  children,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
  progress?: number;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const normalizedProgress =
    progress === undefined ? undefined : Math.max(0, Math.min(100, progress));

  const toneClass = KPI_TONES.has(tone) ? tone : "navy";

  return (
    <div
      className={`tremor-kpi tremor-kpi--${toneClass}${compact ? " tremor-kpi--compact" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="tremor-kpi__head">
        <span className="tremor-kpi__label">{label}</span>
        {icon && <span className="tremor-kpi__icon">{icon}</span>}
      </div>
      <div className="tremor-kpi__value">{value}</div>
      {detail && <div className="tremor-kpi__detail">{detail}</div>}
      {normalizedProgress !== undefined && (
        <div
          className="tremor-kpi__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(normalizedProgress)}
        >
          <span style={{ width: `${normalizedProgress}%` }} />
        </div>
      )}
      {hint && <div className="tremor-kpi__hint">{hint}</div>}
      {children}
    </div>
  );
}
