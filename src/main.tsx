import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { IconContext } from "@phosphor-icons/react";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "./styles/styles.css";
import "./styles/users.css";
import "./styles/detail.css";
import "./styles/design-system.css";
import "./styles/foundation.css";
import { Notifications } from "./ui/Toast";
import { PwaStatus } from "./ui/PwaStatus";
import { startOutboxSync } from "./features/offline/outbox";
import { SessionProvider } from "./app/session";
import { AppRoutes } from "./app/router";

startOutboxSync();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconContext.Provider value={{ weight: "regular", size: 22 }}>
      <BrowserRouter>
        <SessionProvider>
          <AppRoutes />
          <Notifications />
          <PwaStatus />
        </SessionProvider>
      </BrowserRouter>
    </IconContext.Provider>
  </React.StrictMode>,
);
