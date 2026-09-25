import type { ReactNode } from "react";
import { Zap } from "../ui/icons";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="brand-panel" aria-label="Bienvenue sur uSwap">
        <a className="brand" href="/" aria-label="uSwap, Powered by uPowa — accueil">
          <span className="brand-symbol">
            <Zap size={25} fill="currentColor" />
          </span>
          <span className="brand-lockup">
            <span className="brand-name">
              u<span className="brand-swap">Swap</span>
              <span className="brand-dot">.</span>
            </span>
            <span className="brand-endorsement">
              Powered by <strong>uPowa</strong>
            </span>
          </span>
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
