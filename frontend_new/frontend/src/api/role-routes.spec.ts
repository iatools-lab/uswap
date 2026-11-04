import { describe, expect, it } from "vitest";
import {
  ROLE_WORKSPACE,
  scopedPath,
  stripWorkspace,
  workspaceSegment,
} from "./role-routes";

/**
 * Table de correspondance route métier -> espace de travail.
 *
 * C'est le seul endroit où le préfixe est décidé : ces tests garantissent
 * qu'aucun chemin n'est doublé, qu'aucune route commune n'est préfixée et
 * qu'aucun appel ne part sans espace une fois connecté.
 */
describe("préfixes par espace de travail", () => {
  it("associe chaque rôle à son espace", () => {
    expect(ROLE_WORKSPACE).toEqual({
      SUPER_ADMIN: "superadmin",
      ADMIN: "pilot",
      SUPERVISOR: "supervision",
      SWAPPER: "agent",
    });
    expect(workspaceSegment("superadmin")).toBe("superadmin");
    expect(workspaceSegment("agent")).toBe("agent");
  });

  it("préfixe les routes métier selon le rôle", () => {
    expect(scopedPath("/users", "ADMIN")).toBe("/pilot/users");
    expect(scopedPath("/users/42", "ADMIN")).toBe("/pilot/users/42");
    expect(scopedPath("/plannings?month=2026-10", "ADMIN")).toBe(
      "/pilot/plannings?month=2026-10",
    );
    expect(scopedPath("/users", "SUPERVISOR")).toBe("/supervision/users");
    expect(scopedPath("/leaves/workspace", "SWAPPER")).toBe(
      "/agent/leaves/workspace",
    );
    expect(scopedPath("/users", "SUPER_ADMIN")).toBe("/superadmin/users");
  });

  /**
   * Régression du 2026-10-31 : les pages d'administration appellent
   * `/admin/settings`, `/admin/audit`, `/admin/leaves/pending`. Ces routes
   * n'existent côté API que sous `pilot` / `superadmin` (contrôleur à plat) :
   * le super administrateur recevait 404 sur `/superadmin/admin/settings`.
   */
  it("place les routes /admin sous l'espace de la personne connectée", () => {
    expect(scopedPath("/admin/settings", "SUPER_ADMIN")).toBe(
      "/superadmin/admin/settings",
    );
    expect(scopedPath("/admin/audit", "SUPER_ADMIN")).toBe(
      "/superadmin/admin/audit",
    );
    // `/admin/leaves/pending` et `/admin/reports/schedules` sont des chemins
    // MÉTIER : ils ne sont PAS dans `ADMIN_CONTROLLER_PATHS`, donc seule
    // l'addition normale de l'espace s'applique (le segment `admin` fait
    // partie du chemin appelé, il n'est pas ajouté une seconde fois).
    expect(scopedPath("/admin/leaves/pending", "SUPER_ADMIN")).toBe(
      "/superadmin/admin/leaves/pending",
    );
    expect(scopedPath("/admin/reports/schedules", "SUPER_ADMIN")).toBe(
      "/superadmin/admin/reports/schedules",
    );
    expect(scopedPath("/leaves/pending", "SUPER_ADMIN")).toBe(
      "/superadmin/leaves/pending",
    );
    // Un administrateur garde son espace de pilotage (et ne double pas).
    expect(scopedPath("/admin/settings", "ADMIN")).toBe(
      "/pilot/admin/settings",
    );
    expect(scopedPath("/pilot/admin/settings", "ADMIN")).toBe(
      "/pilot/admin/settings",
    );
    // Un agent n'a aucun accès aux pages d'administration : le chemin reste
    // brut, le serveur répond 403/404 (jamais un chemin inventé).
    expect(scopedPath("/admin/settings", "SWAPPER")).toBe(
      "/agent/admin/settings",
    );
  });

  it("ne préfixe jamais une route commune", () => {
    for (const path of [
      "/auth/login",
      "/auth/login/superadmin",
      "/auth/session",
      "/notifications",
      "/notifications/read-all",
      "/workspace",
    ]) {
      expect(scopedPath(path, "SWAPPER")).toBe(path);
    }
  });

  it("ne double jamais un espace déjà présent", () => {
    expect(scopedPath("/pilot/users", "ADMIN")).toBe("/pilot/users");
    expect(scopedPath("/agent/leaves", "SWAPPER")).toBe("/agent/leaves");
    // Ancien chemin du contrôleur de nettoyage : jamais doublé.
    expect(scopedPath("/super-admin/cleanup", "SUPER_ADMIN")).toBe(
      "/super-admin/cleanup",
    );
    expect(scopedPath("/superadmin/cleanup", "SUPER_ADMIN")).toBe(
      "/superadmin/cleanup",
    );
  });

  it("retire l'espace pour la maquette locale", () => {
    expect(stripWorkspace("/pilot/users/42?id=1")).toBe("/users/42?id=1");
    expect(stripWorkspace("/supervision/attendance/history")).toBe(
      "/attendance/history",
    );
    expect(stripWorkspace("/agent/leaves")).toBe("/leaves");
    expect(stripWorkspace("/superadmin/users")).toBe("/users");
    expect(stripWorkspace("/auth/login")).toBe("/auth/login");
    expect(stripWorkspace("/notifications")).toBe("/notifications");
    expect(stripWorkspace("/users")).toBe("/users");
  });

  it("laisse le chemin brut sans session (le serveur répond 401)", () => {
    expect(scopedPath("/users", undefined)).toBe("/users");
    expect(scopedPath("/users", null)).toBe("/users");
  });

  it("ignore les chemins non absolus (déjà résolus)", () => {
    expect(scopedPath("https://exemple.test/x", "ADMIN")).toBe(
      "https://exemple.test/x",
    );
  });
});
