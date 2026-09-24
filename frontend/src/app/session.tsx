import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, forgetSession, login, logout, refresh, rolePaths, type Session, type User } from "../api/auth-api";
import { captureQrToken, qrHomePath } from "../features/operations/qrToken";
import { isAccountPath, isSessionPath } from "./paths";

type SessionContextValue = {
  session: Session | null;
  checking: boolean;
  busy: boolean;
  warning: boolean;
  error: string;
  setError: (value: string) => void;
  signIn: (email: string, password: string) => Promise<void>;
  disconnect: () => Promise<void>;
  extend: () => Promise<void>;
  onAccessLost: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const accountMode = isAccountPath(location.pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(!accountMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deadline, setDeadline] = useState(0);
  const [warning, setWarning] = useState(false);
  const idleDeadline = useRef(0);
  const tokenDeadline = useRef(0);
  const renewing = useRef(false);
  const sessionEpoch = useRef(0);

  const accept = useCallback(
    (data: Session, preservePath = false, preserveIdle = false) => {
      setSession(data);
      tokenDeadline.current = Date.now() + data.expiresIn * 1000;
      if (!preserveIdle)
        idleDeadline.current = Math.min(
          Date.now() + (data.idleTimeoutSeconds || 1800) * 1000,
          Date.parse(data.absoluteExpiresAt || data.sessionExpiresAt),
        );
      setDeadline(idleDeadline.current);
      setWarning(false);
      document.title = "Mon espace · uSwap";
      captureQrToken();
      const stay =
        preservePath &&
        (isSessionPath(data.user, location.pathname) || isAccountPath(location.pathname));
      if (!stay) navigate(qrHomePath(rolePaths[data.user.role], data.user.role), { replace: true });
    },
    [location.pathname, navigate],
  );

  const clear = useCallback(() => {
    sessionEpoch.current++;
    idleDeadline.current = 0;
    forgetSession();
    setSession(null);
    setDeadline(0);
    setWarning(false);
    document.title = "Connexion · uSwap";
    captureQrToken();
    if (location.pathname !== "/auth/login" && !isAccountPath(location.pathname))
      navigate("/auth/login", { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    const hide = () => {
      document.getElementById("root")!.style.visibility = "hidden";
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    const openToken = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("token")) window.location.reload();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    window.addEventListener("hashchange", openToken);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("uswap-session");
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === "logout" && !isAccountPath(window.location.pathname)) {
          clear();
          setError("Votre session a été fermée.");
        }
      };
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("hashchange", openToken);
      channel?.close();
    };
  }, [clear]);

  useLayoutEffect(() => {
    captureQrToken();
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    captureQrToken();
    const keepForgot = location.pathname === "/auth/forgot-password";
    if (accountMode && !keepForgot) {
      setChecking(false);
      return;
    }
    let active = true;
    refresh()
      .then((data) => {
        if (active) accept(data, true);
      })
      .catch(() => {
        if (active) clear();
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [accountMode]);

  useEffect(() => {
    if (!session) return;
    const expire = () => {
      void logout().catch(() => {});
      clear();
      setError("Votre session a expiré. Veuillez vous reconnecter.");
    };
    const renew = () => {
      if (renewing.current) return;
      renewing.current = true;
      const epoch = sessionEpoch.current;
      refresh()
        .then((data) => {
          if (epoch === sessionEpoch.current) accept(data, true, true);
        })
        .catch(() => {
          if (epoch === sessionEpoch.current) expire();
        })
        .finally(() => {
          renewing.current = false;
        });
    };
    const tick = () => {
      const remaining = idleDeadline.current - Date.now();
      setWarning(remaining <= 60_000);
      if (remaining <= 0) {
        expire();
        return;
      }
      if (tokenDeadline.current - Date.now() <= 60_000 && remaining > 60_000) renew();
    };
    const activityChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("uswap-activity");
    let lastBroadcast = 0;
    if (activityChannel)
      activityChannel.onmessage = (event) => {
        if (event.data?.userId === session.user.id && typeof event.data.deadline === "number")
          idleDeadline.current = Math.max(
            idleDeadline.current,
            Math.min(event.data.deadline, Date.parse(session.absoluteExpiresAt || session.sessionExpiresAt)),
          );
      };
    const activity = () => {
      if (idleDeadline.current <= Date.now()) return;
      idleDeadline.current = Math.min(
        Date.now() + (session.idleTimeoutSeconds || 1800) * 1000,
        Date.parse(session.absoluteExpiresAt || session.sessionExpiresAt),
      );
      if (Date.now() - lastBroadcast > 1000) {
        lastBroadcast = Date.now();
        activityChannel?.postMessage({ userId: session.user.id, deadline: idleDeadline.current });
      }
    };
    const timer = setInterval(tick, 1000);
    const check = () => {
      tick();
      if (document.visibilityState === "visible" && idleDeadline.current > Date.now() && !renewing.current)
        api<{ user: User }>("/auth/me")
          .then(({ user }) => {
            setSession((current) => (current ? { ...current, user } : null));
            if (!isSessionPath(user, window.location.pathname) && !isAccountPath(window.location.pathname))
              navigate(qrHomePath(rolePaths[user.role], user.role), { replace: true });
          })
          .catch(() => clear());
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("scroll", activity, { passive: true });
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("scroll", activity);
      activityChannel?.close();
    };
  }, [session, deadline, accept, clear, navigate]);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await logout();
      clear();
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("uswap-session");
        channel.postMessage("logout");
        channel.close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Déconnexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function extend() {
    setBusy(true);
    try {
      accept(await refresh(), true);
    } catch {
      clear();
      setError("Votre session a expiré. Veuillez vous reconnecter.");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(email: string, password: string) {
    accept(await login(email, password));
  }

  function onAccessLost() {
    clear();
    setError("Votre session ou vos droits ont changé. Veuillez vous reconnecter.");
  }

  return (
    <SessionContext.Provider
      value={{
        session,
        checking,
        busy,
        warning,
        error,
        setError,
        signIn,
        disconnect,
        extend,
        onAccessLost,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
