import type { MockDb } from "./types";

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`Invariant violé : identifiant dupliqué dans ${label}.`);
}

/** Contraintes structurelles vérifiées avant chaque commit simulé. */
export function assertDbInvariants(db: MockDb): void {
  assertUnique(
    db.users.map((item) => item.id),
    "users",
  );
  assertUnique(
    db.stations.map((item) => item.id),
    "stations",
  );
  assertUnique(
    db.plannings.map((item) => item.id),
    "plannings",
  );
  assertUnique(
    db.occurrences.map((item) => item.id),
    "occurrences",
  );
  assertUnique(
    db.leaves.map((item) => item.id),
    "leaves",
  );
  assertUnique(
    db.incidents.map((item) => item.id),
    "incidents",
  );
  assertUnique(
    db.leaveSyncOperations.map((item) => item.idempotencyKey),
    "leaveSyncOperations.idempotencyKey",
  );
  assertUnique(
    db.offlineOperations.map((item) => item.idempotencyKey),
    "offlineOperations.idempotencyKey",
  );

  const users = new Set(db.users.map((item) => item.id));
  const stations = new Set(db.stations.map((item) => item.id));
  const plannings = new Set(db.plannings.map((item) => item.id));

  for (const leave of db.leaves) {
    if (!users.has(leave.swapperId))
      throw new Error(
        `Invariant violé : swappeur de congé inconnu (${leave.id}).`,
      );
    if (Date.parse(leave.startTime) >= Date.parse(leave.endTime))
      throw new Error(
        `Invariant violé : période de congé invalide (${leave.id}).`,
      );
  }

  for (const occurrence of db.occurrences) {
    if (!stations.has(occurrence.stationId))
      throw new Error(
        `Invariant violé : station de shift inconnue (${occurrence.id}).`,
      );
    if (!plannings.has(occurrence.planningId))
      throw new Error(
        `Invariant violé : planning de shift inconnu (${occurrence.id}).`,
      );
    if (occurrence.swapperId && !users.has(occurrence.swapperId))
      throw new Error(
        `Invariant violé : swappeur de shift inconnu (${occurrence.id}).`,
      );
  }

  for (const incident of db.incidents) {
    const reporter = db.users.find((item) => item.id === incident.reporterId);
    const affectedSwapper = db.users.find(
      (item) => item.id === incident.affectedSwapperId,
    );
    if (
      !stations.has(incident.stationId) ||
      reporter?.role !== "STATION_CHIEF" ||
      reporter.stationId !== incident.stationId ||
      affectedSwapper?.role !== "SWAPPER" ||
      affectedSwapper.stationId !== incident.stationId
    )
      throw new Error(
        `Invariant violé : périmètre d'incident invalide (${incident.id}).`,
      );
  }
}
