import { LoaderCircle } from "../ui/icons";

export function RouteFallback({ label = "Chargement de votre espace…" }: { label?: string }) {
  return (
    <div className="route-fallback" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
