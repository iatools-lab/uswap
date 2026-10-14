import type { ReactNode, RefObject } from "react";
import {translate,  LanguageSwitcher, useI18n } from "../app/i18n";

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
  const { t } = useI18n();
  return (
    <header className="admin-topbar">
      <div className="admin-heading-copy">
        <span className="admin-mobile-brand" aria-hidden="true">
          {translate("uSwap")}<span>{translate(".")}</span>
        </span>
        <div className="admin-heading-text">
          <h1 ref={headingRef} tabIndex={-1} className="admin-breadcrumb">
            {t(title)}
          </h1>
          <p>{t(description)}</p>
        </div>
      </div>
      <div className="admin-topbar__actions">
        <LanguageSwitcher />
        {actions}
      </div>
    </header>
  );
}
