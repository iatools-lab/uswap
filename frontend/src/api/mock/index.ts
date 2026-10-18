import * as XLSX from "xlsx";
import { runAutomation } from "./constraints";
import { attendanceRoutes } from "./handlers/attendance";
import { authRoutes } from "./handlers/auth";
import { coverageRoutes } from "./handlers/coverage";
import { leaveRoutes } from "./handlers/leaves";
import { incidentRoutes } from "./handlers/incidents";
import { reportRoutes } from "./handlers/reports";
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
  ...leaveRoutes,
  ...incidentRoutes,
  ...reportRoutes,
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
  const pendingLeaveSyncBefore = db.leaveSyncOperations.filter((item) =>
    ["FAILED", "QUEUED"].includes(item.status),
  ).length;
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
    const pendingLeaveSyncAfter = db.leaveSyncOperations.filter((item) =>
      ["FAILED", "QUEUED"].includes(item.status),
    ).length;
    if (
      method !== "GET" ||
      db.automatedAbsences.length !== absencesBefore ||
      pendingLeaveSyncAfter !== pendingLeaveSyncBefore
    )
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
  if (path === "/reports/export") {
    const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    const report = await mockRequest<{
      period: { from: string; to: string };
      kpis: Record<string, number>;
      attendance: Record<string, number>;
      details: Array<{ startTime: string; station: string; swapper: string; status: string; label: string }>;
      stationRows: Array<Record<string, string | number>>;
      hours: Array<{ name: string; station: string; hours: number }>;
      hoursByStation: Array<{ station: string; hours: number }>;
      changes: Array<{ date: string; station: string; type: string; from: string | null; to: string | null }>;
    }>("GET", `/reports/dashboard${query}`);
    const exportFilters = new URLSearchParams(query);
    const periodFrom = exportFilters.get("from") ?? report.period.from.slice(0, 10);
    const periodTo = exportFilters.get("to") ?? report.period.to.slice(0, 10);
    const english = document.documentElement.lang === "en";
    const labels = english
      ? { summary: "Summary", shifts: "Shifts", station: "Stations", hours: "Hours by swapper", stationHours: "Hours by station", movements: "Changes", periodFrom: "Period from", periodTo: "Period to", shiftsCount: "Shifts", coverage: "Coverage rate (%)", attendance: "Attendance rate (%)", absences: "Absences", late: "Late arrivals", approvedLeaves: "Approved leave requests", leavesSynced: "Leave requests synced", leavesPending: "Leave requests pending sync", leavesFailed: "Leave sync failures", movementsCount: "Schedule changes", hoursTotal: "Total hours", futureVacant: "Upcoming vacant shifts", pastVacant: "Past vacant shifts", present: "Present", closed: "Closed", absent: "Absent", expected: "Expected", justified: "Justified", lateStatus: "Late", stationName: "Station", planned: "Planned shifts", assigned: "Filled shifts", coverageLabel: "Coverage (%)", upcoming: "Upcoming vacancies", previous: "Past vacancies", risk: "Risk", incidents: "Open incidents", swapper: "Swapper", hoursLabel: "Planned hours", date: "Date", type: "Change type", from: "Replaced", to: "Replacement" }
      : { summary: "Résumé", shifts: "Shifts", station: "Stations", hours: "Heures par swappeur", stationHours: "Heures par station", movements: "Mouvements", periodFrom: "Période du", periodTo: "Période au", shiftsCount: "Nombre de shifts", coverage: "Couverture (%)", attendance: "Présence (%)", absences: "Absences", late: "Retards", approvedLeaves: "Congés approuvés", leavesSynced: "Congés synchronisés", leavesPending: "Congés en attente de synchronisation", leavesFailed: "Échecs de synchronisation", movementsCount: "Changements de planning", hoursTotal: "Heures totales", futureVacant: "Shifts vacants à venir", pastVacant: "Shifts vacants passés", present: "Présents", closed: "Terminés", absent: "Absences", expected: "À venir", justified: "Justifiés", lateStatus: "Retards", stationName: "Station", planned: "Shifts planifiés", assigned: "Shifts pourvus", coverageLabel: "Couverture (%)", upcoming: "Postes vacants à venir", previous: "Postes vacants passés", risk: "Risque", incidents: "Incidents ouverts", swapper: "Swappeur", hoursLabel: "Heures planifiées", date: "Date", type: "Type de changement", from: "Remplacé", to: "Remplaçant" };
    const kpiLabels: Record<string, string> = {
      shifts: labels.shiftsCount,
      coverageRate: labels.coverage,
      attendanceRate: labels.attendance,
      absences: labels.absences,
      late: labels.late,
      approvedLeaves: labels.approvedLeaves,
      leavesSynced: labels.leavesSynced,
      leavesPendingSync: labels.leavesPending,
      leavesFailedSync: labels.leavesFailed,
      movements: labels.movementsCount,
      totalHours: labels.hoursTotal,
      futureVacant: labels.futureVacant,
      pastVacant: labels.pastVacant,
    };
    const attendanceLabels: Record<string, string> = {
      present: labels.present,
      closed: labels.closed,
      late: labels.lateStatus,
      absent: labels.absent,
      expected: labels.expected,
      justified: labels.justified,
    };
    const workbook = XLSX.utils.book_new();
    const summary = [
      ["Indicateur", "Valeur"],
      [labels.periodFrom, periodFrom],
      [labels.periodTo, periodTo],
      ...Object.entries(report.kpis).map(([key, value]) => [kpiLabels[key] ?? key, value]),
      ...Object.entries(report.attendance).map(([key, value]) => [`${english ? "Attendance" : "Pointages"} · ${attendanceLabels[key] ?? key}`, value]),
    ];
    summary[0] = [english ? "Metric" : "Indicateur", english ? "Value" : "Valeur"];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), labels.summary);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.details.map((row) => ({
      [labels.date]: row.startTime,
      [labels.stationName]: row.station,
      [labels.swapper]: row.swapper,
      [english ? "Shift" : "Shift"]: row.label,
      [english ? "Status" : "Statut"]: row.status,
    }))), labels.shifts);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.stationRows.map((row) => ({
      [labels.stationName]: row.name,
      [labels.planned]: row.total,
      [labels.assigned]: row.filled,
      [labels.coverageLabel]: row.coverage,
      [labels.upcoming]: row.futureVacant,
      [labels.previous]: row.pastVacant,
      [labels.risk]: row.risk,
      [labels.incidents]: row.incidents,
    }))), labels.station);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.hours.map((row) => ({
      [labels.swapper]: row.name,
      [labels.stationName]: row.station,
      [labels.hoursLabel]: row.hours,
    }))), labels.hours);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.hoursByStation.map((row) => ({
      [labels.stationName]: row.station,
      [labels.hoursLabel]: row.hours,
    }))), labels.stationHours);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.changes.map((row) => ({
      [labels.date]: row.date,
      [labels.stationName]: row.station,
      [labels.type]: row.type,
      [labels.from]: row.from ?? "—",
      [labels.to]: row.to ?? "—",
    }))), labels.movements);
    const data = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    return {
      blob: new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      filename: `rapport-uswap-${periodFrom}-${periodTo}.xlsx`,
    };
  }
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
        Rôle: "Superviseur",
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
