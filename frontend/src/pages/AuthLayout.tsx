import type { ReactNode } from "react";
import { BrandSignature } from "../ui/BrandSignature";
import { LanguageSwitcher, useI18n } from "../app/i18n";

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="auth-layout">
      <LanguageSwitcher />
      <aside className="brand-panel" aria-label={t("Bienvenue sur uSwap")}>
        <a
          className="brand"
          href="/"
          aria-label={t("uSwap, Powered by uPowa — accueil")}
        >
          <BrandSignature />
        </a>
        <div className="brand-story">
          <h1>
            {t("La gestion de vos stations,")}
            <br />
            <span>{t("en un seul endroit.")}</span>
          </h1>
        </div>
      </aside>
      <section className="form-panel">
        <div className="form-content">{children}</div>
      </section>
    </main>
  );
}
