import Card from "@tremor/react/dist/components/layout-elements/Card/Card.js";
import type { ReactNode } from "react";
import "./kpi-card.css";

export type KpiTone = "navy" | "blue" | "green" | "amber" | "red" | "neutral";

const TREMOR_COLORS: Record<KpiTone, string> = {
  navy: "indigo",
  blue: "blue",
  green: "emerald",
  amber: "amber",
  red: "rose",
  neutral: "slate",
};

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

  return (
    <Card
      decoration="top"
      decorationColor={TREMOR_COLORS[tone] as never}
      className={`tremor-kpi tremor-kpi--${tone}${compact ? " tremor-kpi--compact" : ""}${className ? ` ${className}` : ""}`}
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
    </Card>
  );
}
