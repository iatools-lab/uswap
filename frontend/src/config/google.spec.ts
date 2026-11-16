import { describe, expect, it } from "vitest";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_ID_DEFAULT,
  isGoogleClientId,
} from "./google";

/**
 * Verrouille la connexion Google.
 *
 * Régression corrigée : le bouton disparaissait — et, quand un identifiant
 * obsolète était fourni, Google répondait « OAuth client not found » — parce
 * que `VITE_GOOGLE_CLIENT_ID` dépendait entièrement du build. L'identifiant
 * est public : il est désormais embarqué, ce qui garantit sa présence.
 */
describe("identifiant OAuth Google (frontend)", () => {
  it("est toujours défini, même sans variable d'environnement", () => {
    expect(GOOGLE_CLIENT_ID).toBeTruthy();
    expect(isGoogleClientId(GOOGLE_CLIENT_ID)).toBe(true);
  });

  it("la valeur par défaut est un identifiant client complet", () => {
    expect(GOOGLE_CLIENT_ID_DEFAULT).toMatch(
      /^\d+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i,
    );
  });

  it("rejette un numéro de projet seul", () => {
    expect(isGoogleClientId("739196811493")).toBe(false);
    expect(isGoogleClientId(undefined)).toBe(false);
  });
});
