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
import {
  api,
  forgetSession,
  login,
  logout,
  normalizeUserRole,
  refresh,
  rolePaths,
  type LoginSegment,
  type Session,
  type User,
} from "../api/auth-api";
import { isAccountPath, isSessionPath } from "./paths";

type SessionContextValue = {
  session: Session | null;
  checking: boolean;
  busy: boolean;
  warning: boolean;
  error: string;
  setError: (value: string) => void;
  signIn: (
    email: string,
    password: string,
    segment?: LoginSegment | null,
  ) => Promise<void>;
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
      const stay =
        preservePath &&
        (isSessionPath(data.user, location.pathname) ||
          isAccountPath(location.pathname));
      if (!stay) navigate(rolePaths[data.user.role], { replace: true });
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
    if (
      location.pathname !== "/auth/login" &&
      !isAccountPath(location.pathname)
    )
      navigate("/auth/login", { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    const hide = () => {
      document.getElementById("root")!.style.visibility = "hidden";
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("uswap-session");
    if (channel)
      channel.onmessage = (event) => {
        if (
          event.data === "logout" &&
          !isAccountPath(window.location.pathname)
        ) {
          clear();
          setError("Votre session a été fermée.");
        }
      };
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      channel?.close();
    };
  }, [clear]);

  useLayoutEffect(() => {}, [
    location.pathname,
    location.search,
    location.hash,
  ]);

  useEffect(() => {
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
        if (!active) return;
        // Aucune session restaurable : on nettoie les traces locales sans
        // rediriger. `clear()` redirige vers /auth/login, ce qui faisait
        // clignoter l'ecran de connexion et effacait le message d'erreur.
        forgetSession();
        setSession(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [accountMode, accept]);

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
      if (tokenDeadline.current - Date.now() <= 60_000 && remaining > 60_000)
        renew();
    };
    const activityChannel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("uswap-activity");
    let lastBroadcast = 0;
    if (activityChannel)
      activityChannel.onmessage = (event) => {
        if (
          event.data?.userId === session.user.id &&
          typeof event.data.deadline === "number"
        )
          idleDeadline.current = Math.max(
            idleDeadline.current,
            Math.min(
              event.data.deadline,
              Date.parse(session.absoluteExpiresAt || session.sessionExpiresAt),
            ),
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
        activityChannel?.postMessage({
          userId: session.user.id,
          deadline: idleDeadline.current,
        });
      }
    };
    const timer = setInterval(tick, 1000);
    const check = () => {
      tick();
      if (
        document.visibilityState === "visible" &&
        idleDeadline.current > Date.now() &&
        !renewing.current
      )
        api<{ user: User }>("/auth/me")
          .then((response) => {
            const user = normalizeUserRole(response.user);
            setSession((current) => (current ? { ...current, user } : null));
            if (
              !isSessionPath(user, window.location.pathname) &&
              !isAccountPath(window.location.pathname)
            )
              navigate(rolePaths[user.role], { replace: true });
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

  // Mémorisé : `useState` accepte une valeur ou un initialiseur, jamais une
  // fonction censée produire une valeur. Sans ce retournement de flèche, le
  // provider prendrait `setError` lui-même pour un état.
  const setMessage = useCallback((value: string) => setError(value), []);

  async function signIn(
    email: string,
    password: string,
    segment?: LoginSegment | null,
  ) {
    accept(await login(email, password, segment));
  }

  // `useCallback` : les écrans gardent cette fonction dans les dépendances de
  // leurs effets de chargement. Recréée à chaque rendu du provider (à chaque
  // tick de minuterie, puisque `warning`/`deadline` en dépendent), elle
  // relançait ces chargements en boucle ; combinée à leur traitement d'un 403,
  // la session était effacée et l'utilisateur renvoyé à la connexion.
  const onAccessLost = useCallback(() => {
    clear();
    setError(
      "Votre session ou vos droits ont changé. Veuillez vous reconnecter.",
    );
  }, [clear]);

  return (
    <SessionContext.Provider
      value={{
        session,
        checking,
        busy,
        warning,
        error,
        setError: setMessage,
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
