import { beforeEach, describe, expect, it } from "vitest";
import {
  ApiError,
  LOGIN_SEGMENT,
  usingMock,
  login,
  setLoginSegment,
  setSessionRole,
} from "./auth-api";
import { DEMO_PASSWORD, resetDb } from "./mock";
import { FICTITIOUS_DOMAIN } from "./mock/seed";

/**
 * Connexion par espace de travail, sur la maquette locale (`usingMock`).
 *
 * La maquette applique les mêmes règles que le serveur :
 *   - `/auth/login/<espace>` refuse un compte d'un autre rôle (403) ;
 *   - sans espace, le rôle du compte est détecté côté « serveur ».
 */
const ACCOUNTS = {
  SUPER_ADMIN: `superadmin@${FICTITIOUS_DOMAIN}`,
  ADMIN: `admin@${FICTITIOUS_DOMAIN}`,
  SUPERVISOR: `superviseur@${FICTITIOUS_DOMAIN}`,
  SWAPPER: `swappeur@${FICTITIOUS_DOMAIN}`,
};

// Sans maquette, ces tests appelleraient un vrai serveur : ils sont alors
// sautés, jamais présentés comme réussis.
describe.skipIf(!usingMock)(
  "connexion par espace de travail (maquette)",
  () => {
    it("le profil de test active la maquette locale", () => {
      // `vitest.mock.config.ts` force `VITE_API_URL` à vide : si ce test s'exécute,
      // les suivants parlent à la maquette et non à un serveur.
      expect(usingMock).toBe(true);
    });

    beforeEach(() => {
      resetDb();
      setLoginSegment(null);
      setSessionRole(null);
    });

    it("associe chaque rôle à son segment d'URL", () => {
      expect(LOGIN_SEGMENT).toEqual({
        SUPER_ADMIN: "superadmin",
        ADMIN: "admin",
        SUPERVISOR: "supervisor",
        SWAPPER: "swapper",
      });
    });

    it("détecte le rôle quand aucun espace n'est choisi", async () => {
      const session = await login(ACCOUNTS.ADMIN, "AdminUswap");
      expect(session.user.role).toBe("ADMIN");
    });

    it("accepte un compte sur son propre espace", async () => {
      // Compte super administrateur du jeu de démonstration : il utilise le
      // mot de passe dédié du compte de plateforme (`ADMIN_PASSWORD`).
      const session = await login(
        ACCOUNTS.SUPER_ADMIN,
        "AdminUswap",
        "superadmin",
      );
      expect(session.user.role).toBe("SUPER_ADMIN");
    });

    it("refuse un compte dont le rôle ne correspond pas à l'espace", async () => {
      const failure = await login(
        ACCOUNTS.SWAPPER,
        DEMO_PASSWORD,
        "admin",
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ status: 403 });
    });

    it("le mot de passe du compte admin de démonstration est connu", async () => {
      // `resetDb` remet les comptes du jeu de démonstration dans leur état
      // initial : le mot de passe du compte administrateur y est `AdminUswap`.
      const session = await login(ACCOUNTS.ADMIN, "AdminUswap", "admin");
      expect(session.user.role).toBe("ADMIN");
    });

    it("refuse des identifiants incorrects", async () => {
      await expect(
        login(ACCOUNTS.ADMIN, "mauvais-mot-de-passe", "admin"),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("un espace inconnu n'existe pas", async () => {
      // Segment hors des quatre espaces : la maquette répond 404, comme le
      // serveur pour `/auth/login/:role` inconnu.
      const failure = await login(
        ACCOUNTS.ADMIN,
        "AdminUswap",
        "inconnu" as never,
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({ status: 404 });
    });
  },
);
