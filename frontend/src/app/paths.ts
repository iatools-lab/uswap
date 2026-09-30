import { rolePaths, type User } from "../api/auth-api";

const adminExact = [
  "/app/admin",
  "/app/admin/utilisateurs",
  "/app/admin/stations",
  "/app/admin/plannings",
  "/app/admin/compte",
  "/app/admin/utilisateurs/nouveau",
  "/app/admin/utilisateurs/import",
];

export const isAdminPath = (path: string) =>
  adminExact.includes(path) ||
  /^\/app\/admin\/utilisateurs\/[a-f0-9-]{36}$/.test(path);

export const isRolePath = (user: User, path: string) =>
  [
    rolePaths[user.role],
    `${rolePaths[user.role]}/compte`,
    `${rolePaths[user.role]}/plannings`,
    ...(user.role === "SUPERVISOR"
      ? [`${rolePaths[user.role]}/pointages`]
      : []),
    ...(user.role === "SWAPPER" ? [`${rolePaths[user.role]}/conges`] : []),
  ].includes(path);

export const isAccountPath = (path: string) =>
  path === "/auth/activate" ||
  path === "/auth/reset-password" ||
  path === "/auth/forgot-password";

export const isSessionPath = (user: User, path: string) =>
  user.role === "ADMIN" ? isAdminPath(path) : isRolePath(user, path);
