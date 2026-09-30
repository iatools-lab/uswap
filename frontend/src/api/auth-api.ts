import { mockDownload, mockRequest } from "./mock";
import { MOCK_LATENCY_MS, delay } from "./mock";
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
  refreshToken?: string;
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

export type Profile = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  stationId?: string | null;
};

/**
 * Real accounts the login screen may offer, read from the backend directory.
 * Returns an empty list on failure so the (optional) picker simply hides
 * instead of blocking authentication.
 */
export async function fetchProfiles(): Promise<Profile[]> {
  const rows = await api<Profile[]>("/public/profiles");

  return rows.filter((row) =>
    Object.prototype.hasOwnProperty.call(roles, row.role),
  );
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
  503: "Ce service est momentanément indisponible. Veuillez réessayer plus tard.",
};

const unavailable = "Le service est momentanément indisponible.";

const unreachable =
  "Impossible de joindre le service. Vérifiez votre connexion et réessayez.";

const REFRESH_TOKEN_KEY = "uswap-refresh-token";
const USER_KEY = "uswap-session-user";

let accessToken: string | null = null;
let generation = 0;

/** Single in-flight refresh shared by concurrent callers. See refresh(). */
let inFlightRefresh: Promise<Session> | null = null;

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

function triggerDownload(
  blob: Blob,
  filename: string,
) {
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
  path: string,
  body?: unknown,
  method?: "POST" | "PUT" | "PATCH" | "DELETE",
): Promise<T> {
  const verb: MockCtx["method"] =
    method ?? (body === undefined ? "GET" : "POST");

  const { plain, file } = serialize(body);

  if (usingMock) {
    await delay(
      MOCK_LATENCY_MS +
        Math.round(Math.random() * 120),
    );

    try {
      return await mockRequest<T>(
        verb,
        path,
        plain,
        file,
      );
    } catch (error) {
      if (error instanceof MockHttpError) {
        throw new ApiError(
          error.status,
          error.message ||
            fallbackMessages[error.status] ||
            unavailable,
        );
      }

      throw new ApiError(
        0,
        unreachable,
      );
    }
  }

  const requestBody: unknown = body;

  const controller = new AbortController();

  const timer = window.setTimeout(() => {
    controller.abort();
  }, 20_000);

  try {
    const response = await fetch(
      base + path,
      {
        method: verb,
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          ...(requestBody instanceof FormData
            ? {}
            : {
                "Content-Type":
                  "application/json",
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
      },
    );

    if (!response.ok) {
      const detail = [
        400,
        409,
        410,
      ].includes(response.status)
        ? await response
            .json()
            .catch(() => null)
        : null;

      throw new ApiError(
        response.status,
        typeof detail?.message === "string"
          ? detail.message
          : response.status === 413
            ? fallbackMessages[413]
            : fallbackMessages[
                response.status
              ] || unavailable,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      0,
      unreachable,
    );
  } finally {
    clearTimeout(timer);
  }
}

function remember(
  data: Session,
): Session {
  if (
    !data.user ||
    !Object.prototype.hasOwnProperty.call(
      roles,
      data.user.role,
    ) ||
    typeof data.accessToken !== "string" ||
    !Number.isFinite(data.expiresIn)
  ) {
    throw new ApiError(
      0,
      "Réponse de connexion invalide.",
    );
  }

  accessToken = data.accessToken;

  if (data.refreshToken) {
    localStorage.setItem(
      REFRESH_TOKEN_KEY,
      data.refreshToken,
    );
  }

  localStorage.setItem(
    USER_KEY,
    JSON.stringify(data.user),
  );

  return data;
}

export async function login(
  email: string,
  password: string,
): Promise<Session> {
  if (usingMock) {
    return remember(
      await mockRequest<Session>(
        "POST",
        "/auth/login",
        {
          email,
          password,
        },
      ),
    );
  }

  return remember(
    await api<Session>(
      "/auth/login",
      {
        email,
        password,
      },
    ),
  );
}

export function refresh(): Promise<Session> {
  if (usingMock) {
    return mockRequest<Session>(
      "POST",
      "/auth/refresh",
    );
  }

  // The refresh token is single-use and rotated server-side. Under React
  // StrictMode (dev) the boot effect runs twice, so two concurrent calls would
  // send the same token: the first succeeds, the second is refused as already
  // used, and the session looks dead. Share one in-flight request instead.
  if (inFlightRefresh) return inFlightRefresh;

  const started = doRefresh();

  inFlightRefresh = started.finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

function doRefresh(): Promise<Session> {
  const refreshToken =
    localStorage.getItem(
      REFRESH_TOKEN_KEY,
    );

  const savedUser =
    localStorage.getItem(USER_KEY);

  if (!refreshToken || !savedUser) {
    return Promise.reject(
      new ApiError(
        401,
        "Session introuvable.",
      ),
    );
  }

  let user: UserIcon;

  try {
    user =
      JSON.parse(
        savedUser,
      ) as UserIcon;
  } catch {
    localStorage.removeItem(
      USER_KEY,
    );

    localStorage.removeItem(
      REFRESH_TOKEN_KEY,
    );

    return Promise.reject(
      new ApiError(
        401,
        "Session introuvable.",
      ),
    );
  }

  return api<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>(
    "/auth/refresh",
    {
      refreshToken,
    },
  ).then((data) =>
    remember({
      user,
      accessToken:
        data.accessToken,
      refreshToken:
        data.refreshToken,
      expiresIn:
        data.expiresIn,
      sessionExpiresAt:
        new Date(
          Date.now() +
            data.expiresIn * 1000,
        ).toISOString(),
    }),
  );
}

export function forgetSession() {
  generation += 1;

  accessToken = null;

  localStorage.removeItem(
    REFRESH_TOKEN_KEY,
  );

  localStorage.removeItem(
    USER_KEY,
  );
}

export async function logout(): Promise<void> {
  try {
    if (usingMock) {
      await mockRequest(
        "POST",
        "/auth/logout",
      );
    } else {
      await api(
        "/auth/logout",
        {},
      );
    }
  } finally {
    forgetSession();
  }
}

export async function download(
  path: string,
  filename: string,
): Promise<void> {
  if (usingMock) {
    const result =
      await mockDownload(path);

    if (!result) {
      throw new ApiError(
        404,
        "Ce téléchargement n'est pas disponible.",
      );
    }

    triggerDownload(
      result.blob,
      result.filename ||
        filename,
    );

    return;
  }

  const controller =
    new AbortController();

  const timer =
    window.setTimeout(
      () => {
        controller.abort();
      },
      20_000,
    );

  try {
    const response =
      await fetch(
        base + path,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal:
            controller.signal,
          headers: {
            "X-USwap-Client":
              "web",
            ...(accessToken
              ? {
                  Authorization: `Bearer ${accessToken}`,
                }
              : {}),
          },
        },
      );

    if (!response.ok) {
      throw new ApiError(
        response.status,
        fallbackMessages[
          response.status
        ] || unavailable,
      );
    }

    const blob =
      await response.blob();

    triggerDownload(
      blob,
      filename,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      0,
      unreachable,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const currentAccessToken =
  () => accessToken;

export const sessionGeneration =
  () => generation;