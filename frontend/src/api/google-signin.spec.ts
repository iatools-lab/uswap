import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Verrouille le contrat d'appel de la connexion Google.
 *
 * Régression corrigée : `GoogleSignIn` appelait
 *   api("/auth/google", { method: "POST", body: { idToken } })
 * alors que `api()` attend `(route, corps, méthode)`. L'URL devenait
 * `[object Object]` et le backend recevait `{}` : 400/404 alors que Google
 * avait bien authentifié l'utilisateur. Ce test lit la source et refuse le
 * retour de cette forme.
 */
const source = readFileSync(
  resolve(__dirname, "../features/auth/GoogleSignIn.tsx"),
  "utf8",
);

describe("connexion Google — appel du backend", () => {
  it("envoie le jeton via la signature (route, corps, méthode)", () => {
    expect(source).toMatch(
      /api\(\s*["']\/auth\/google["']\s*,\s*\{\s*idToken\s*\}\s*,\s*["']POST["']\s*\)/,
    );
  });

  it("n'utilise plus l'objet d'options non supporté par api()", () => {
    expect(source).not.toMatch(/api\(\s*["']\/auth\/google["']\s*,\s*\{[^}]*method:/);
  });

  it("prend l'identifiant client de la configuration partagée", () => {
    expect(source).toContain('from "../../config/google"');
    expect(source).not.toMatch(
      /const CLIENT_ID = import\.meta\.env\.VITE_GOOGLE_CLIENT_ID/,
    );
  });
});
