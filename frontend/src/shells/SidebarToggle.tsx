import { SidebarSimpleIcon } from "@phosphor-icons/react";

export function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "Afficher la navigation" : "Masquer la navigation";
  return (
    <button
      type="button"
      className="sidebar-rail-toggle"
      aria-label={label}
      aria-pressed={collapsed}
      title={label}
      onClick={onToggle}
    >
      <SidebarSimpleIcon size={18} weight="bold" />
    </button>
  );
}
