import { useEffect, useRef, useState } from "react";
import { api } from "../../api/auth-api";
import { GOOGLE_CLIENT_ID } from "../../config/google";

/**
 * Connexion Google (SSO) réservée aux comptes professionnels uPowa.
 *
 * Le composant ne décide d'AUCUN accès : il obtient un jeton d'identité auprès
 * de Google et le transmet au backend (`POST /auth/google`), qui vérifie la
 * signature, l'audience et le domaine (`upowa.org`) avant d'ouvrir une session.
 *
 * L'identifiant client vient de `config/google.ts` : variable d'environnement
 * si elle est fournie, sinon la valeur par défaut embarquée. Un build sans
 * `VITE_GOOGLE_CLIENT_ID` ne supprime donc plus le bouton (cause du message
 * « OAuth client not found » en production).
 */
const CLIENT_ID = GOOGLE_CLIENT_ID;

type GoogleCredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

export function GoogleSignIn() {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID || !holder.current) return;

    const mount = () => {
      if (!window.google || !holder.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => {
          void exchange(response.credential ?? "");
        },
      });
      window.google.accounts.id.renderButton(holder.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: 320,
      });
    };

    /** Échange le jeton Google contre une session uSwap. */
    async function exchange(idToken: string) {
      if (!idToken) return;
      setBusy(true);
      setError("");
      try {
        // `api()` n'accepte pas d'objet d'options : (route, corps, méthode).
        // L'ancien appel transmettait l'objet à l'URL — `/auth/google` recevait
        // `{}` et répondait 400 alors même que Google avait bien authentifié
        // l'utilisateur.
        await api("/auth/google", { idToken }, "POST");
        // Rechargement complet : le provider de session relit le cookie et
        // redirige vers l'espace du rôle, comme après une connexion classique.
        window.location.assign("/");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Connexion Google impossible.",
        );
      } finally {
        setBusy(false);
      }
    }

    if (window.google) {
      mount();
      return;
    }

    // Chargement du script Google à la première utilisation. Le `<script>` est
    // partagé : deux montages successifs (navigation) ne doivent pas l'ajouter
    // deux fois.
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener("load", mount, { once: true });
      if (window.google) mount();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = mount;
    // Le script peut être déjà en cache navigateur : `onload` n'est alors pas
    // rejoué, mais `window.google` est disponible immédiatement.
    if (window.google) mount();
    script.onerror = () => {
      // Message explicite : sans lui, l'utilisateur voyait un cadre vide et
      // pouvait croire que la connexion Google n'existait pas.
      setError(
        "Connexion Google indisponible (script bloqué par le réseau). Utilisez votre e-mail et votre mot de passe.",
      );
    };
    document.head.appendChild(script);
  }, []);

  if (!CLIENT_ID) return null;

  return (
    <div className="google-signin">
      <div className="google-signin__separator">
        <span>ou</span>
      </div>
      <div ref={holder} className="google-signin__button" aria-busy={busy} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="field-hint">
        Réservé aux comptes professionnels autorisés (domaine uPowa).
      </p>
    </div>
  );
}
