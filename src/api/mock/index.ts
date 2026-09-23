import * as XLSX from "xlsx";
import { runAutomation } from "./constraints";
import { attendanceRoutes } from "./handlers/attendance";
import { authRoutes } from "./handlers/auth";
import { coverageRoutes } from "./handlers/coverage";
import { planningRoutes } from "./handlers/plannings";
import { stationRoutes } from "./handlers/stations";
import { userRoutes } from "./handlers/users";
import { FICTITIOUS_DOMAIN } from "./seed";
import { currentUser } from "./shared";
import { loadDb, replaceDb } from "./store";
import { MockHttpError, type MockCtx, type MockRoute } from "./types";

export { DEMO_PASSWORD, FICTITIOUS_DOMAIN } from "./seed";
export { MOCK_LATENCY_MS, delay, resetDb } from "./store";

/** Ordre significatif : les routes les plus spécifiques sont déclarées d'abord. */
const routes: MockRoute[] = [
  ...authRoutes,
  ...userRoutes,
  ...stationRoutes,
  ...planningRoutes,
  ...attendanceRoutes,
  ...coverageRoutes,
];

/**
 * Point d'entrée unique de la maquette serveur : reçoit la requête déjà
 * analysée (chemin, corps, fichier) et renvoie la réponse attendue par l'écran.
 */
export async function mockRequest<T>(
  method: MockCtx["method"],
  url: string,
  body: Record<string, unknown> = {},
  file: File | null = null,
): Promise<T> {
  // Chaque requête travaille sur une copie. Une erreur de validation ne peut
  // donc jamais laisser une mutation partielle dans la base en mémoire.
  const persisted = loadDb();
  const db = structuredClone(persisted);
  const now = Date.now();
  const [rawPath, search = ""] = url.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const absencesBefore = db.automatedAbsences.length;
  runAutomation(db, now);
  const ctx: MockCtx = {
    db,
    path,
    params: [],
    query: new URLSearchParams(search),
    body,
    file,
    method,
    now,
    user: currentUser(db),
  };
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    const result = await route.handler({ ...ctx, params: match.slice(1) });
    if (method !== "GET" || db.automatedAbsences.length !== absencesBefore)
      replaceDb(db);
    return result as T;
  }
  throw new MockHttpError(404, `Ressource inconnue : ${method} ${path}`);
}

/**
 * Téléchargements produits localement : le modèle d'import est un vrai classeur
 * XLSX lisible par l'application elle-même.
 */
export async function mockDownload(
  url: string,
): Promise<{ blob: Blob; filename: string } | null> {
  const path = url.split("?")[0].replace(/\/+$/, "");
  if (path === "/users/imports/template") {
    const sheet = XLSX.utils.json_to_sheet([
      {
        "Nom complet": "Amina Mballa",
        "Adresse e-mail": `amina.mballa@${FICTITIOUS_DOMAIN}`,
        Rôle: "Swappeur",
        Station: "Station Bastos",
      },
      {
        "Nom complet": "Paul Nguema",
        "Adresse e-mail": `paul.nguema@${FICTITIOUS_DOMAIN}`,
        Rôle: "Chef de station",
        Station: "Obobogo",
      },
      {
        "Nom complet": "Ariane Tchana",
        "Adresse e-mail": `ariane.tchana@${FICTITIOUS_DOMAIN}`,
        Rôle: "Superviseur",
        Station: "",
      },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Utilisateurs");
    const data = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    return {
      blob: new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      filename: "modele-utilisateurs-uswap.xlsx",
    };
  }
  return null;
}
