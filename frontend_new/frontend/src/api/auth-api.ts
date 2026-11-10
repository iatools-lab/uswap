import { mockDownload, mockRequest } from "./mock";
import { DEMO_PASSWORD, MOCK_LATENCY_MS, delay } from "./mock";
import { FICTITIOUS_DOMAIN, MOCK_LOGIN_PROFILES } from "./mock/seed";
import { MockHttpError, type MockCtx } from "./mock/types";
import { scopedPath, stripWorkspace } from "./role-routes";

export type Role = "SUPER_ADMIN" | "ADMIN" | "SUPERVISOR" | "SWAPPER";

export type UserIcon = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  stationId?: string | null;
  stationName?: string | null;
};

export type User = UserIcon;

export type Session = {
  user: UserIcon;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  sessionExpiresAt: string;
  idleTimeoutSeconds?: number;
  absoluteExpiresAt?: string;
};

export const roles: Record<Role, string> = {
  SUPER_ADMIN: "Super administrateur",
  ADMIN: "Administrateur",
  SUPERVISOR: "Superviseur",
  SWAPPER: "Swappeur",
};

export const rolePaths: Record<Role, string> = {
  SUPER_ADMIN: "/app/super-admin",
  ADMIN: "/app/admin",
  SUPERVISOR: "/app/supervision",
  SWAPPER: "/app/mon-espace",
};

/**
 * Roles attribuables par l'utilisateur connecte.
 *
 * - Super administrateur : tous, y compris le sien.
 * - Administrateur : jamais de super administrateur.
 * - Superviseur : tous (il gere les comptes).
 */
export function assignableRoles(actor: Role | undefined): Role[] {
  if (actor === "SUPER_ADMIN" || actor === "SUPERVISOR")
    return ["SUPER_ADMIN", "ADMIN", "SUPERVISOR", "SWAPPER"];
  return ["ADMIN", "SUPERVISOR", "SWAPPER"];
}

export const mockPeople: User[] = MOCK_LOGIN_PROFILES;

export { DEMO_PASSWORD, FICTITIOUS_DOMAIN, MOCK_LATENCY_MS };

/** Profils proposés sur l'écran de connexion. En mode démo, la liste reste locale. */
export async function fetchProfiles(): Promise<User[]> {
  if (usingMock) return mockPeople;

  // Le backend ne publie pas de répertoire de comptes avant authentification.
  // Le champ e-mail reste saisissable librement sur l'écran de connexion.
  return [];
}

const configured = (
  import.meta as unknown as {
    env: Record<string, string>;
  }
).env.VITE_API_URL;

const base = (configured || "").replace(/\/$/, "");

export const usingMock = !configured;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const fallbackMessages: Record<number, string> = {
  400: "Vérifiez les informations saisies ou la validité du lien.",
  401: "Identifiants invalides ou session expirée.",
  403: "Vous ne disposez pas des droits nécessaires.",
  404: "Cette ressource est introuvable.",
  409: "Cette action entre en conflit avec l'état actuel des données.",
  410: "Ce lien n'est plus valable.",
  413: "Le fichier dépasse la limite autorisée.",
  429: "Trop de tentatives. Veuillez patienter avant de réessayer.",
  /*
   * 502 / 504 sont produits par le proxy Nginx quand le conteneur backend est
   * arrêté, en cours de redémarrage ou injoignable. Sans message dédié, la
   * page affichait « service momentanément indisponible » sans plus de détail,
   * ce qui se confondait avec une panne de l'application elle-même.
   */
  502: "Le serveur de l'application ne répond pas. Réessayez dans une minute ; si le problème persiste, l'administrateur doit vérifier que le conteneur backend tourne.",
  503: "Ce service est momentanément indisponible. Veuillez réessayer plus tard.",
  504: "Le serveur de l'application met trop de temps à répondre. Réessayez dans un instant.",
};

const unavailable = "Le service est momentanément indisponible.";

const unreachable =
  "Impossible de joindre le service. Vérifiez votre connexion et réessayez.";

const REFRESH_TOKEN_KEY = "uswap-refresh-token";
const USER_KEY = "uswap-session-user";

let accessToken: string | null = null;
let generation = 0;
let inFlightRefresh: Promise<Session> | null = null;

/**
 * Rôle de la session courante. Sert à préfixer les appels métier par
 * l'espace de travail du rôle (`/agent/…`, `/pilot/…`, `/supervision/…`,
 * `/superadmin/…`) : voir `api/role-routes.ts`.
 */
let currentRole: Role | null = null;

/**
 * Espace de travail choisi sur la page de connexion (segment d'URL) :
 * `"admin"` (pilotage), `"supervisor"` (supervision), `"swapper"` (agent),
 * ou `null` quand l'utilisateur saisit simplement son adresse.
 *
 * Il ne remplace JAMAIS le rôle vérifié par le serveur : il choisit seulement
 * la route `/auth/login/:role` à appeler.
 */
let requestedSegment: LoginSegment | null = null;

/** Rôle courant, ou `null` avant connexion. */
export function getSessionRole(): Role | null {
  return currentRole;
}

/** Force le rôle courant (restauration de session, tests, mode démo). */
export function setSessionRole(role: Role | null): void {
  currentRole = role;
}

/** Espace de connexion choisi, ou `null` (détection automatique). */
export function setLoginSegment(segment: LoginSegment | null): void {
  requestedSegment = segment;
}

/** Espace de connexion actuellement choisi. */
export function getLoginSegment(): LoginSegment | null {
  return requestedSegment;
}

function serialize(body: unknown): {
  plain: Record<string, unknown>;
  file: File | null;
} {
  if (body instanceof FormData) {
    const candidate = body.get("file");

    return {
      plain: {},
      file: candidate instanceof File ? candidate : null,
    };
  }

  if (body === undefined || body === null) {
    return {
      plain: {},
      file: null,
    };
  }

  return {
    plain: JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
    file: null,
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export async function api<T>(
  route: string,
  body?: unknown,
  method?: "POST" | "PUT" | "PATCH" | "DELETE",
  allowRefresh = true,
): Promise<T> {
  const verb: MockCtx["method"] =
    method ?? (body === undefined ? "GET" : "POST");

  // Les composants appellent les routes métier (`/users`, `/plannings`…) ;
  // l'espace de travail du rôle connecté est ajouté ici, en un seul endroit.
  const path = scopedPath(route, currentRole ?? undefined);

  const { plain, file } = serialize(body);

  if (usingMock) {
    await delay(MOCK_LATENCY_MS + Math.round(Math.random() * 120));

    try {
      return await mockRequest<T>(verb, path, plain, file);
    } catch (error) {
      // Détection par FORME, pas par `instanceof` : la maquette (`api/mock`) et
      // cette couche peuvent provenir de deux copies du module (deux
      // résolutions CJS/ESM sous Vitest), et `instanceof` échouerait alors en
      // transformant un refus 403/404 en « service indisponible ».
      const status = (error as { status?: unknown } | null)?.status;
      // Un refus HTTP (400 et plus) est transmis tel quel. Tout le reste vient
      // de la LOGIQUE de la maquette (donnée absente, état incohérent après
      // une action de démonstration) : le message de la maquette est conservé
      // avec le code 0 (erreur locale), jamais présenté comme un 401.
      if (typeof status === "number" && status >= 400) {
        const message = (error as { message?: unknown }).message;
        throw new ApiError(
          status,
          typeof message === "string" && message
            ? message
            : fallbackMessages[status] || unavailable,
        );
      }

      const message = (error as { message?: unknown } | null)?.message;
      throw new ApiError(
        0,
        typeof message === "string" && message ? message : unreachable,
      );
    }
  }

  const requestBody: unknown = body;

  const controller = new AbortController();

  const timer = window.setTimeout(() => {
    controller.abort();
  }, 20_000);

  try {
    const response = await fetch(base + path, {
      method: verb,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(requestBody instanceof FormData
          ? {}
          : {
              "Content-Type": "application/json",
            }),
        "X-USwap-Client": "web",
        ...(accessToken
          ? {
              Authorization: `Bearer ${accessToken}`,
            }
          : {}),
      },
      ...(requestBody === undefined
        ? {}
        : {
            body:
              requestBody instanceof FormData
                ? requestBody
                : JSON.stringify(requestBody),
          }),
    });

    if (
      response.status === 401 &&
      allowRefresh &&
      Boolean(accessToken) &&
      !path.startsWith("/auth/login") &&
      !path.startsWith("/auth/refresh") &&
      !path.startsWith("/auth/activate") &&
      !path.startsWith("/auth/reset-password")
    ) {
      try {
        await refresh();
        return await api<T>(path, body, method, false);
      } catch {
        // Fall through with the original 401 so callers keep their normal error handling.
      }
    }

    if (!response.ok) {
      const detail = [400, 409, 410].includes(response.status)
        ? await response.json().catch(() => null)
        : null;

      throw new ApiError(
        response.status,
        typeof detail?.message === "string"
          ? detail.message
          : response.status === 413
            ? fallbackMessages[413]
            : fallbackMessages[response.status] || unavailable,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(0, unreachable);
  } finally {
    clearTimeout(timer);
  }
}

function remember(data: Session): Session {
  if ((data.user?.role as string) === "STATION_CHIEF") {
    data = {
      ...data,
      user: {
        ...data.user,
        role: "SUPERVISOR",
        stationId: null,
        stationName: null,
      },
    };
  }
  if (
    !data.user ||
    !Object.prototype.hasOwnProperty.call(roles, data.user.role) ||
    typeof data.accessToken !== "string" ||
    !Number.isFinite(data.expiresIn)
  ) {
    throw new ApiError(0, "Réponse de connexion invalide.");
  }

  accessToken = data.accessToken;
  // Les appels suivants sont préfixés par l'espace de travail de ce rôle.
  currentRole = data.user.role;
  // L'espace de connexion suit aussi la session : après un rechargement de
  // page (session restaurée par `refresh`), un nouvel essai de connexion ne
  // doit pas repartir vers l'espace de l'ancien compte.
  requestedSegment = LOGIN_SEGMENT[data.user.role];

  if (data.refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
  }

  localStorage.setItem(USER_KEY, JSON.stringify(data.user));

  return data;
}

export function normalizeUserRole(user: UserIcon): UserIcon {
  return (user.role as string) === "STATION_CHIEF"
    ? { ...user, role: "SUPERVISOR", stationId: null, stationName: null }
    : user;
}

export type LoginSegment = "superadmin" | "admin" | "supervisor" | "swapper";

export const LOGIN_SEGMENT: Record<Role, LoginSegment> = {
  SUPER_ADMIN: "superadmin",
  ADMIN: "admin",
  SUPERVISOR: "supervisor",
  SWAPPER: "swapper",
};

/** Ordre de détection quand aucun espace n'a été choisi : du plus fréquent au plus rare. */
const DETECTION_ORDER: LoginSegment[] = [
  "swapper",
  "supervisor",
  "admin",
  "superadmin",
];

/**
 * Connexion.
 *
 * Le serveur expose une route par espace de travail
 * (`POST /auth/login/<espace>`) et refuse un compte dont le rôle ne correspond
 * pas à la route appelée. Deux cas :
 *
 *  - un espace a été choisi sur la page de connexion (`setLoginSegment`) :
 *    seule cette route est appelée ; un refus 403 est renvoyé tel quel ;
 *  - aucun espace : le frontend ne connaît pas le rôle du compte avant la
 *    première réponse, il essaie donc chaque route jusqu'à la bonne. Le
 *    serveur seul décide ; le message reste identique d'un rôle à l'autre.
 */
export async function login(
  email: string,
  password: string,
  segment?: LoginSegment | null,
): Promise<Session> {
  const chosen = segment !== undefined ? segment : requestedSegment;
  // Un segment inconnu (`/auth/login/inconnu`) n'est jamais essayé en
  // détection : il doit répondre 404, pas être ignoré.
  if (chosen && !DETECTION_ORDER.includes(chosen)) {
    throw new ApiError(404, "Cette page de connexion n’existe pas.");
  }
  const attempts = chosen ? [chosen] : DETECTION_ORDER;

  // La connexion ne doit pas être préfixée par l'espace du rôle COURANT : elle
  // établit justement la nouvelle session (un rôle précédent, encore stocké,
  // contredirait le suivant). `api()` n'ajoute un préfixe que si un rôle est
  // connu : on neutralise celui de cette requête et on le rétablit ensuite.
  const previousSegment = getLoginSegment();
  setLoginSegment(null);
  const previousRole = getSessionRole();
  setSessionRole(null);
  const restore = () => {
    setSessionRole(previousRole);
    setLoginSegment(previousSegment);
  };

  let forbidden: ApiError | null = null;
  for (const candidate of attempts) {
    try {
      const session = await api<Session>(`/auth/login/${candidate}`, {
        email,
        password,
      });
      // L'espace de la NOUVELLE session remplace celui de la précédente :
      // les appels métier suivants partent sous ce préfixe.
      requestedSegment = session.user
        ? LOGIN_SEGMENT[session.user.role]
        : candidate;
      return remember(session);
    } catch (error) {
      // Maquette et serveur renvoient la même erreur typée (`ApiError`).
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 403) {
        forbidden = error;
        // Espace explicitement choisi : le refus est définitif.
        if (chosen) {
          restore();
          throw error;
        }
        continue;
      }
      // 401 (identifiants), 429 (verrouillage), 404 (serveur sans routes par
      // rôle) : aucun autre espace ne peut réussir.
      if (error.status === 404) break;
      restore();
      throw error;
    }
  }

  // Serveur d'une version antérieure (routes par rôle absentes) : repli sur
  // la route commune. Sans ce repli, une mise à jour du frontend seul
  // empêcherait toute connexion.
  try {
    return remember(
      await api<Session>("/auth/login", {
        email,
        password,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && forbidden) {
      throw forbidden;
    }
    throw error;
  } finally {
    restore();
  }
}

export function refresh(): Promise<Session> {
  if (usingMock) {
    return mockRequest<Session>("POST", "/auth/refresh");
  }

  const savedUser = localStorage.getItem(USER_KEY);

  if (!savedUser) {
    return Promise.reject(new ApiError(401, "Session introuvable."));
  }

  // Partage le refresh en cours : le backend renouvelle le token, donc deux
  // appels concurrents pourraient réutiliser le même token à usage unique.
  if (inFlightRefresh) return inFlightRefresh;

  let user: UserIcon;

  try {
    user = JSON.parse(savedUser) as UserIcon;
  } catch {
    localStorage.removeItem(USER_KEY);

    localStorage.removeItem(REFRESH_TOKEN_KEY);

    return Promise.reject(new ApiError(401, "Session introuvable."));
  }

  // Session RESTAURÉE (rechargement de page, nouvel onglet) : le rôle de
  // l'utilisateur mémorisé doit être posé AVANT l'appel. `/auth/refresh` est
  // une route commune (`scopedPath` ne la préfixe pas), mais les appels
  // lancés en parallèle par les écrans, eux, ont besoin de l'espace.
  currentRole = user.role;
  requestedSegment = LOGIN_SEGMENT[user.role] ?? requestedSegment;

  // Le backend conserve le refresh token dans un cookie HttpOnly et le fait
  // tourner à chaque renouvellement. Il ne doit donc jamais être lu ni envoyé
  // dans le corps de la requête côté navigateur.
  const request = api<Session>("/auth/refresh", {}, "POST").then((data) => {
    const session = remember({
      ...data,
      user: data.user ?? user,
    });
    if (!data.refreshToken) localStorage.removeItem(REFRESH_TOKEN_KEY);
    return session;
  });

  inFlightRefresh = request.finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

export function forgetSession() {
  generation += 1;

  accessToken = null;
  currentRole = null;

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("uswap:planning-cache:")) localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("uswap:session-cleared"));

  localStorage.removeItem(REFRESH_TOKEN_KEY);

  localStorage.removeItem(USER_KEY);
}

export async function logout(): Promise<void> {
  try {
    if (usingMock) {
      await mockRequest("POST", "/auth/logout");
    } else {
      await api("/auth/logout", {});
    }
  } finally {
    forgetSession();
  }
}

export async function download(route: string, filename: string): Promise<void> {
  // Même préfixage que `api()` : l'export de rapport est servi sous
  // `/supervision/reports/export` (ou `/pilot/...`, `/superadmin/...`). Sans
  // cette ligne, le téléchargement demandait `/reports/export` — le chemin
  // historique — et recevait 404 pour un superviseur.
  const path = scopedPath(route, currentRole ?? undefined);

  if (usingMock) {
    // La maquette déclare les chemins métier : elle reçoit le chemin SANS
    // préfixe d'espace, comme `mockRequest` le fait pour `api()`.
    const result = await mockDownload(stripWorkspace(path));

    if (!result) {
      throw new ApiError(404, "Ce téléchargement n'est pas disponible.");
    }

    triggerDownload(result.blob, result.filename || filename);

    return;
  }

  const controller = new AbortController();

  const timer = window.setTimeout(() => {
    controller.abort();
  }, 20_000);

  try {
    const response = await fetch(base + path, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-USwap-Client": "web",
        ...(accessToken
          ? {
              Authorization: `Bearer ${accessToken}`,
            }
          : {}),
      },
    });

    // Même renouvellement que `api()` : un export lancé après l'expiration du
    // jeton d'accès ne doit pas produire un 404/401 trompeur alors qu'un
    // simple renouvellement suffit.
    if (response.status === 401 && accessToken) {
      try {
        await refresh();
        return await download(route, filename);
      } catch {
        // On garde l'erreur d'origine, plus explicite pour l'utilisateur.
      }
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        fallbackMessages[response.status] || unavailable,
      );
    }

    // Nom de fichier choisi par le serveur quand il le fournit : évite de
    // deviner le format (CSV/XLSX) côté client.
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const suggested = match?.[1]?.trim();

    const blob = await response.blob();

    triggerDownload(blob, suggested || filename);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(0, unreachable);
  } finally {
    clearTimeout(timer);
  }
}

export const currentAccessToken = () => accessToken;

export const sessionGeneration = () => generation;
