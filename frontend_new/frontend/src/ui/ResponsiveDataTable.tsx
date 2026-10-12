import type { ReactNode } from "react";
import "./responsive-data-table.css";

export type ResponsiveColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  primary?: boolean;
  mobileLabel?: ReactNode;
  className?: string;
};

export function ResponsiveDataTable<T>({
  rows,
  columns,
  rowKey,
  ariaLabel,
  className = "",
}: {
  rows: T[];
  columns: ResponsiveColumn<T>[];
  rowKey: (row: T) => string;
  ariaLabel: string;
  className?: string;
}) {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const details = columns.filter((column) => column !== primary);

  return (
    <div className={`responsive-data-table ${className}`.trim()}>
      <div className="responsive-data-table__desktop admin-table-wrap">
        <table className="admin-table" aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="responsive-data-table__mobile"
        role="list"
        aria-label={ariaLabel}
      >
        {rows.map((row) => (
          <article
            className="responsive-data-card"
            role="listitem"
            key={rowKey(row)}
          >
            <div className="responsive-data-card__title">
              {primary.render(row)}
            </div>
            <dl>
              {details.map((column) => (
                <div
                  className={`responsive-data-card__field ${column.className || ""}`.trim()}
                  key={column.key}
                >
                  <dt>{column.mobileLabel ?? column.header}</dt>
                  <dd>{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
