/**
 * Version du code réellement exécutée par le navigateur.
 *
 * Construite à partir de `__BUILD_ID__` (rempli par `vite.config.ts` avec la
 * date et le SHA du commit). Objectif opérationnel : après un déploiement,
 * distinguer immédiatement « le serveur n'a pas été mis à jour » de
 * « le navigateur exécute encore l'ancien bundle ». La valeur est affichée
 * dans Compte → Profil et lisible depuis la console :
 *
 *   sessionStorage.getItem("uswap:build")
 */
export const deployedBuild =
  typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

if (typeof window !== "undefined") {
  try {
    sessionStorage.setItem("uswap:build", deployedBuild);
    console.info(`[uSwap] version exécutée : ${deployedBuild}`);
  } catch {
    // Navigation privée ou stockage saturé : l'affichage suffit.
  }
}
