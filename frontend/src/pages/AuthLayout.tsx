import type { ReactNode } from "react";
import { BrandSignature } from "../ui/BrandSignature";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="brand-panel" aria-label="Bienvenue sur uSwap">
        <a
          className="brand"
          href="/"
          aria-label="uSwap, Powered by uPowa — accueil"
        >
          <BrandSignature />
        </a>
        <div className="brand-story">
          <h1>
            La gestion de vos stations,
            <br />
            <span>en un seul endroit.</span>
          </h1>
        </div>
      </aside>
      <section className="form-panel">
        <div className="form-content">{children}</div>
      </section>
    </main>
  );
}
