export type Role = 'ADMIN' | 'SUPERVISOR' | 'STATION_CHIEF' | 'SWAPPER';
export type User = { id: string; email: string; fullName: string; role: Role; stationId?: string | null; stationName?: string | null };
export type Session = { user: User; accessToken: string; expiresIn: number; sessionExpiresAt: string; idleTimeoutSeconds?: number; absoluteExpiresAt?: string };
export const roles: Record<Role, string> = { ADMIN: 'Administrateur', SUPERVISOR: 'Superviseur', STATION_CHIEF: 'Chef de station', SWAPPER: 'Swappeur' };
export const rolePaths: Record<Role, string> = { ADMIN: '/app/admin', SUPERVISOR: '/app/supervision', STATION_CHIEF: '/app/station', SWAPPER: '/app/mon-espace' };
const configured = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL;
const base = (configured || `${location.protocol}//${location.hostname}:3000`).replace(/\/$/, '');
let accessToken: string | null = null;
let refreshPending: Promise<Session> | null = null;
let generation = 0;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Messages de repli par code HTTP, partagés par les appels standards et les téléchargements. */
const fallbackMessages: Record<number, string> = {
  400: 'Vérifiez les informations saisies ou la validité du lien.',
  401: 'Identifiants invalides ou session expirée.',
  403: 'Vous ne disposez pas des droits nécessaires.',
  429: 'Trop de tentatives. Veuillez patienter avant de réessayer.',
  503: 'Ce service est momentanément indisponible. Veuillez réessayer plus tard.',
};

const unavailable = 'Le service est momentanément indisponible.';
const unreachable = 'Impossible de joindre le service. Vérifiez votre connexion et réessayez.';

export async function api<T>(path: string, body?: unknown, method?: 'PATCH'): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(base + path, {
      method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'X-USwap-Client': 'web', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = [400, 409, 410].includes(response.status) ? await response.json().catch(() => null) : null;
      throw new ApiError(response.status, typeof detail?.message === 'string' ? detail.message : response.status === 413 ? 'Le fichier dépasse la limite de 2 Mo.' : fallbackMessages[response.status] || unavailable);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, unreachable);
  } finally { clearTimeout(timer); }
}
function remember(data: Session): Session {
  if (!data.user || !Object.hasOwn(roles, data.user.role) || typeof data.accessToken !== 'string' || !Number.isFinite(data.expiresIn)) throw new ApiError(0, 'Réponse de connexion invalide.');
  accessToken = data.accessToken;
  return data;
}
export const login = async (email: string, password: string) => remember(await api<Session>('/auth/login', { email, password }));
export function refresh(): Promise<Session> {
  if (!refreshPending) {
    const expected = generation;
    const renew = async () => { if (expected !== generation) throw new ApiError(401, 'Session fermée.'); const data = await api<Session>('/auth/refresh', {}); if (expected !== generation) throw new ApiError(401, 'Session fermée.'); return remember(data); };
    refreshPending = (navigator.locks ? navigator.locks.request('uswap-refresh', renew) : renew()).finally(() => { refreshPending = null; });
  }
  return refreshPending;
}
export function forgetSession() { generation++; accessToken = null; }
export async function logout() {
  const revoke = async () => { await api('/auth/logout', {}); forgetSession(); };
  await (navigator.locks ? navigator.locks.request('uswap-refresh', revoke) : revoke());
}

export async function download(path: string, filename: string): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(base + path, {
      method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'X-USwap-Client': 'web', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
    if (!response.ok) {
      throw new ApiError(response.status, fallbackMessages[response.status] || unavailable);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, unreachable);
  } finally { clearTimeout(timer); }
}
