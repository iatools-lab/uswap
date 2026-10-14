import { translate } from "../app/i18n";
import { FileSpreadsheet } from "./icons";

export function ExportExcelButton({
  onClick,
  disabled = false,
  label = translate("Exporter Excel"),
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`admin-button secondary small ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
    >
      <FileSpreadsheet size={16} aria-hidden="true" />
      {label}
    </button>
  );
}
