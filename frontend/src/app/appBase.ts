import { rolePaths, type Role } from "../api/auth-api";
import { useSession } from "./session";

/**
 * Préfixe de l'espace courant, lu depuis la session. Les écrans d'administration
 * sont partagés par `/app/admin` et `/app/super-admin` : tout lien absolu doit
 * passer par `useAppPath()` pour ne jamais sortir de l'espace du signataire.
 */
export function useAppPath(): (path: string) => string {
  const { session } = useSession();
  const base = appBase(session?.user.role);
  return (path: string) => scoped(path, session?.user.role, base);
}

/**
 * Chemin de l'espace de pilotage.
 *
 * Le super administrateur a exactement les mêmes écrans que l'administrateur
 * (mêmes composants, même CSS) servis sous `/app/super-admin`, ce qui évite de
 * dupliquer les pages. Les liens absolus écrits dans les écrans passent par
 * `scoped()`, qui réécrit `/app/admin/...` vers l'espace courant.
 */
export const appBase = (role: Role | undefined): string =>
  role === "SUPER_ADMIN" ? rolePaths.SUPER_ADMIN : rolePaths.ADMIN;

/** `/app/admin/utilisateurs` → `/app/super-admin/utilisateurs` pour un super admin. */
export function scoped(
  path: string,
  role: Role | undefined,
  base = appBase(role),
): string {
  if (base === rolePaths.ADMIN) return path;
  return path.replace(/^\/app\/admin(?=\/|$|\?)/, base);
}
