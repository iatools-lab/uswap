import type { ReactNode, RefObject } from "react";

type AppTopbarProps = {
  title: string;
  description: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  actions: ReactNode;
};

export function AppTopbar({
  title,
  description,
  headingRef,
  actions,
}: AppTopbarProps) {
  return (
    <header className="admin-topbar">
      <div className="admin-heading-copy">
        <span className="admin-mobile-brand" aria-hidden="true">
          uSwap<span>.</span>
        </span>
        <div className="admin-heading-text">
          <h1 ref={headingRef} tabIndex={-1} className="admin-breadcrumb">
            {title}
          </h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="admin-topbar__actions">{actions}</div>
    </header>
  );
}
