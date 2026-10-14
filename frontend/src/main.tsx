import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "./styles/styles.css";
import "./styles/users.css";
import "./styles/detail.css";
import "./styles/design-system.css";
import "./styles/foundation.css";
import "./styles/i18n.css";
import { Notifications } from "./ui/Toast";
import { PwaStatus } from "./ui/PwaStatus";
import { startOutboxSync } from "./features/offline/outbox";
import { SessionProvider } from "./app/session";
import { AppRoutes } from "./app/router";
import { I18nProvider } from "./app/i18n";

startOutboxSync();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <SessionProvider>
          <AppRoutes />
          <Notifications />
          <PwaStatus />
        </SessionProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
