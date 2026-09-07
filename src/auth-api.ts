export type Role = 'ADMIN' | 'SUPERVISOR' | 'STATION_CHIEF' | 'SWAPPER';
export type User = { id: string; email: string; fullName: string; role: Role };
export type Session = { user: User; accessToken: string; expiresIn: number; sessionExpiresAt: string };
export const roles: Record<Role, string> = { ADMIN: 'Administrateur', SUPERVISOR: 'Superviseur', STATION_CHIEF: 'Chef de station', SWAPPER: 'Swappeur' };
export const rolePaths: Record<Role, string> = { ADMIN: '/app/admin', SUPERVISOR: '/app/supervision', STATION_CHIEF: '/app/station', SWAPPER: '/app/mon-espace' };
const configured = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL;
const base = (configured || `${location.protocol}//${location.hostname}:3000`).replace(/\/$/, '');
let accessToken: string | null = null;
let refreshPending: Promise<Session> | null = null;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-USwap-Client': 'web', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const messages: Record<number, string> = { 400: 'Vérifiez les informations saisies ou la validité du lien.', 401: 'Identifiants invalides ou session expirée.', 403: 'Vous ne disposez pas des droits nécessaires.', 429: 'Trop de tentatives. Veuillez patienter avant de réessayer.', 503: 'Ce service est momentanément indisponible. Veuillez réessayer plus tard.' };
      throw new ApiError(response.status, messages[response.status] || 'Le service est momentanément indisponible.');
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'Impossible de joindre le service. Vérifiez votre connexion et réessayez.');
  } finally { clearTimeout(timer); }
}
function remember(data: Session): Session {
  if (!data.user || !Object.hasOwn(roles, data.user.role) || typeof data.accessToken !== 'string' || !Number.isFinite(data.expiresIn)) throw new ApiError(0, 'Réponse de connexion invalide.');
  accessToken = data.accessToken;
  return data;
}
export const login = async (email: string, password: string) => remember(await api<Session>('/auth/login', { email, password }));
export function refresh(): Promise<Session> {
  if (!refreshPending) refreshPending = api<Session>('/auth/refresh', {}).then(remember).finally(() => { refreshPending = null; });
  return refreshPending;
}
export function forgetSession() { accessToken = null; }
export async function logout() { await api('/auth/logout', {}); forgetSession(); }
