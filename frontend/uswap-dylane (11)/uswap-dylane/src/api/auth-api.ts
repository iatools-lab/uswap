import { mockDownload, mockRequest } from "./mock";
import { DEMO_PASSWORD, FICTITIOUS_DOMAIN, MOCK_LATENCY_MS, delay } from "./mock";
import { MockHttpError, type MockCtx } from "./mock/types";

export type Role = "ADMIN" | "SUPERVISOR" | "STATION_CHIEF" | "SWAPPER";

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
  expiresIn: number;
  sessionExpiresAt: string;
  idleTimeoutSeconds?: number;
  absoluteExpiresAt?: string;
};

export const roles: Record<Role, string> = {
  ADMIN: "Administrateur",
  SUPERVISOR: "Superviseur",
  STATION_CHIEF: "Chef de station",
  SWAPPER: "Swappeur",
};

export const rolePaths: Record<Role, string> = {
  ADMIN: "/app/admin",
  SUPERVISOR: "/app/supervision",
  STATION_CHIEF: "/app/station",
  SWAPPER: "/app/mon-espace",
};

/** Comptes proposés sur l'écran de connexion (maquette). */
export const mockPeople: User[] = [
  { id: "us-admin", email: `admin@${FICTITIOUS_DOMAIN}`, fullName: "Administrateur uSwap", role: "ADMIN" },
  {
    id: "us-supervisor",
    email: `superviseur@${FICTITIOUS_DOMAIN}`,
    fullName: "Camille Nola",
    role: "SUPERVISOR",
  },
  {
    id: "us-chief-bastos",
    email: `chef@${FICTITIOUS_DOMAIN}`,
    fullName: "Sam Kotto",
    role: "STATION_CHIEF",
    stationId: "st-bastos",
    stationName: "Station Bastos",
  },
  {
    id: "us-chief-obobogo",
    email: `chef.obobogo@${FICTITIOUS_DOMAIN}`,
    fullName: "Ariane Tchana",
    role: "STATION_CHIEF",
    stationId: "st-obobogo",
    stationName: "Obobogo",
  },
  {
    id: "sw-01",
    email: `swappeur@${FICTITIOUS_DOMAIN}`,
    fullName: "Léa Meka",
    role: "SWAPPER",
    stationId: "st-bastos",
    stationName: "Station Bastos",
  },
];

export { DEMO_PASSWORD, FICTITIOUS_DOMAIN, MOCK_LATENCY_MS };

/** Sans URL d'API configurée, la maquette locale répond : aucun réseau requis. */
const configured = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL;
const base = (configured || "").replace(/\/$/, "");
export const usingMock = !configured;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Messages de repli par code HTTP, partagés par les appels standards et les téléchargements. */
const fallbackMessages: Record<number, string> = {
  400: "Vérifiez les informations saisies ou la validité du lien.",
  401: "Identifiants invalides ou session expirée.",
  403: "Vous ne disposez pas des droits nécessaires.",
  404: "Cette ressource est introuvable.",
  409: "Cette action entre en conflit avec l'état actuel des données.",
  410: "Ce lien n'est plus valable.",
  413: "Le fichier dépasse la limite autorisée.",
  429: "Trop de tentatives. Veuillez patienter avant de réessayer.",
  503: "Ce service est momentanément indisponible. Veuillez réessayer plus tard.",
};

const unavailable = "Le service est momentanément indisponible.";
const unreachable =
  "Impossible de joindre le service. Vérifiez votre connexion et réessayez.";

let accessToken: string | null = null;
let generation = 0;

/** Le corps d'une requête est sérialisé puis relu : la maquette reçoit un objet simple. */
function serialize(body: unknown): { plain: Record<string, unknown>; file: File | null } {
  if (body instanceof FormData) {
    const candidate = body.get("file");
    return { plain: {}, file: candidate instanceof File ? candidate : null };
  }
  if (body === undefined || body === null) return { plain: {}, file: null };
  return { plain: JSON.parse(JSON.stringify(body)) as Record<string, unknown>, file: null };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* Appels                                                              */
/* ------------------------------------------------------------------ */

export async function api<T>(
  path: string,
  body?: unknown,
  method?: "PATCH",
): Promise<T> {
  const verb: MockCtx["method"] = method ?? (body === undefined ? "GET" : "POST");
  const { plain, file } = serialize(body);

  if (usingMock) {
    await delay(MOCK_LATENCY_MS + Math.round(Math.random() * 120));
    try {
      return await mockRequest<T>(verb, path, plain, file);
    } catch (error) {
      if (error instanceof MockHttpError)
        throw new ApiError(
          error.status,
          error.message || fallbackMessages[error.status] || unavailable,
        );
      throw new ApiError(0, unreachable);
    }
  }

  const requestBody: unknown = body;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(base + path, {
      method: verb,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(requestBody instanceof FormData ? {} : { "Content-Type": "application/json" }),
        "X-USwap-Client": "web",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(requestBody === undefined
        ? {}
        : {
            body:
              requestBody instanceof FormData ? requestBody : JSON.stringify(requestBody),
          }),
    });
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
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, unreachable);
  } finally {
    clearTimeout(timer);
  }
}

function remember(data: Session): Session {
  if (
    !data.user ||
    !Object.hasOwn(roles, data.user.role) ||
    typeof data.accessToken !== "string" ||
    !Number.isFinite(data.expiresIn)
  )
    throw new ApiError(0, "Réponse de connexion invalide.");
  accessToken = data.accessToken;
  return data;
}

export async function login(email: string, password: string): Promise<Session> {
  if (usingMock)
    return remember(
      await mockRequest<Session>("POST", "/auth/login", { email, password }),
    );
  return remember(await api<Session>("/auth/login", { email, password }));
}

export function refresh(): Promise<Session> {
  if (usingMock) return mockRequest<Session>("POST", "/auth/refresh");
  return api<Session>("/auth/refresh", {});
}

export function forgetSession() {
  generation += 1;
  accessToken = null;
}

export async function logout(): Promise<void> {
  try {
    if (usingMock) await mockRequest("POST", "/auth/logout");
    else await api("/auth/logout", {});
  } finally {
    forgetSession();
  }
}

export async function download(path: string, filename: string): Promise<void> {
  if (usingMock) {
    const result = await mockDownload(path);
    if (!result) throw new ApiError(404, "Ce téléchargement n'est pas disponible.");
    triggerDownload(result.blob, result.filename || filename);
    return;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(base + path, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-USwap-Client": "web",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (!response.ok)
      throw new ApiError(response.status, fallbackMessages[response.status] || unavailable);
    const blob = await response.blob();
    triggerDownload(blob, filename);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, unreachable);
  } finally {
    clearTimeout(timer);
  }
}

/** Exposé pour la génération de session (jeton d'accès courant). */
export const currentAccessToken = () => accessToken;
export const sessionGeneration = () => generation;
