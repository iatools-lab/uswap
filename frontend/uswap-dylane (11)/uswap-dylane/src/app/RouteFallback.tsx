import { LoaderCircle } from "../ui/icons";

export function RouteFallback({
  label = "Chargement de votre espace…",
}: {
  label?: string;
}) {
  return (
    <div className="route-fallback" role="status">
      <div className="route-fallback__content">
        <span className="route-fallback__brand" aria-hidden="true">
          uSwap<span>.</span>
        </span>
        <span className="route-fallback__progress">
          <LoaderCircle className="spin" size={18} />
          {label}
        </span>
      </div>
    </div>
  );
}
