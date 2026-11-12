import { rolePaths, type User } from "../api/auth-api";

const adminExact = [
  "/app/admin",
  "/app/admin/utilisateurs",
  "/app/admin/stations",
  "/app/admin/plannings",
  "/app/admin/audit",
  "/app/admin/conges",
  "/app/admin/compte",
  "/app/admin/parametres",
  "/app/admin/utilisateurs/nouveau",
  "/app/admin/utilisateurs/import",
];

/** Espace super administrateur : mêmes écrans, chemin dédié, plus la maintenance. */
const superAdminExact = [
  "/app/super-admin",
  "/app/super-admin/utilisateurs",
  "/app/super-admin/stations",
  "/app/super-admin/plannings",
  "/app/super-admin/conges",
  "/app/super-admin/audit",
  "/app/super-admin/parametres",
  "/app/super-admin/nettoyage",
  "/app/super-admin/compte",
  "/app/super-admin/utilisateurs/nouveau",
  "/app/super-admin/utilisateurs/import",
];

const isUserDetail = (path: string, base: string) =>
  new RegExp(`^${base}/utilisateurs/[a-f0-9-]{36}$`).test(path);

export const isAdminPath = (path: string) =>
  adminExact.includes(path) || isUserDetail(path, "/app/admin");

export const isSuperAdminPath = (path: string) =>
  superAdminExact.includes(path) || isUserDetail(path, "/app/super-admin");

export const isRolePath = (user: User, path: string) =>
  [
    rolePaths[user.role],
    `${rolePaths[user.role]}/compte`,
    `${rolePaths[user.role]}/plannings`,
    ...(user.role === "SUPERVISOR"
      ? [`${rolePaths[user.role]}/pointages`, `${rolePaths[user.role]}/conges`]
      : []),
    ...(user.role === "SWAPPER" ? [`${rolePaths[user.role]}/conges`] : []),
  ].includes(path);

export const isAccountPath = (path: string) =>
  path === "/auth/activate" ||
  path === "/auth/reset-password" ||
  path === "/auth/forgot-password";

export const isSessionPath = (user: User, path: string) => {
  if (user.role === "SUPER_ADMIN") return isSuperAdminPath(path);
  if (user.role === "ADMIN") return isAdminPath(path);
  return isRolePath(user, path);
};
