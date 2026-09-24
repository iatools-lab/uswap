import { isoFromMs, stationDayKey, stationIso, weekStartKey } from "./seed";
import { MockHttpError, type MockDb, type MockOccurrence, type MockUser } from "./types";

let sequence = 1000;

export const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${sequence++}`;

/* ------------------------------------------------------------------ */
/* Sérialisation                                                       */
/* ------------------------------------------------------------------ */

export function stationNameOf(db: MockDb, stationId: string | null): string | null {
  if (!stationId) return null;
  return db.stations.find((item) => item.id === stationId)?.name ?? null;
}

/** Identité minimale attendue par `User` côté client. */
export function serializeUser(db: MockDb, user: MockUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    stationId: user.stationId,
    stationName: stationNameOf(db, user.stationId),
  };
}

/** Statut dérivé : désactivé, actif, en attente d'activation ou invité. */
export function memberStatus(user: MockUser) {
  if (user.disabledAt) return "inactive" as const;
  if (user.isActive) return "active" as const;
  if (user.invitationStatus === "NOT_SENT") return "invited" as const;
  return "pending" as const;
}

export function serializeMember(db: MockDb, user: MockUser) {
  return {
    ...serializeUser(db, user),
    isActive: user.isActive,
    pendingActivation: !user.isActive && !user.disabledAt,
    disabledAt: user.disabledAt,
  };
}

export function serializeDetail(db: MockDb, user: MockUser) {
  return {
    ...serializeUser(db, user),
    phoneNumber: user.phoneNumber,
    address: user.address,
    isActive: user.isActive,
    pendingActivation: !user.isActive && !user.disabledAt,
    disabledAt: user.disabledAt,
    updatedAt: user.updatedAt,
    invitationStatus: user.invitationStatus,
    invitationSentAt: user.invitationSentAt,
    invitationExpiresAt: user.invitationExpiresAt,
    audit: [...user.audit].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ),
  };
}

/** Session renouvelée en continu : la démonstration ne s'interrompt pas. */
export function sessionFor(db: MockDb, user: MockUser) {
  const expiresIn = 8 * 3600;
  return {
    user: serializeUser(db, user),
    accessToken: `mock-${nextId("token")}`,
    expiresIn,
    sessionExpiresAt: isoFromMs(Date.now() + expiresIn * 1000),
    idleTimeoutSeconds: 8 * 3600,
    absoluteExpiresAt: isoFromMs(Date.now() + 7 * 86400000),
  };
}

export function currentUser(db: MockDb): MockUser | null {
  if (!db.sessionEmail) return null;
  return db.users.find((item) => item.email === db.sessionEmail) ?? null;
}

/* ------------------------------------------------------------------ */
/* Accès et périmètres                                                 */
/* ------------------------------------------------------------------ */

export function requireUser(db: MockDb, user: MockUser | null): MockUser {
  if (!user)
    throw new MockHttpError(401, "Identifiants invalides ou session expirée.");
  if (user.disabledAt) throw new MockHttpError(403, "Ce compte est désactivé.");
  return user;
}

export function requireRole(user: MockUser, roles: MockUser["role"][]): MockUser {
  if (!roles.includes(user.role))
    throw new MockHttpError(403, "Vous ne disposez pas des droits nécessaires.");
  return user;
}

export function findUserOr404(db: MockDb, id: string): MockUser {
  const found = db.users.find((item) => item.id === id);
  if (!found) throw new MockHttpError(404, "Compte introuvable.");
  return found;
}

/** Un chef ne voit et n'agit que sur sa station ; les autres rôles sont globaux. */
export function scopeStationId(user: MockUser): string | null {
  return user.role === "STATION_CHIEF" ? user.stationId : null;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function notifyUser(
  db: MockDb,
  userId: string,
  kind: string,
  title: string,
  body: string,
) {
  db.notificationSeq += 1;
  db.notifications.unshift({
    id: `ntf-${db.notificationSeq}`,
    userId,
    kind,
    title,
    body,
    readAt: null,
    createdAt: isoFromMs(Date.now()),
  });
  db.notifications = db.notifications.slice(0, 200);
}

/** Superviseurs, chef de la station concernée, et personnes citées. */
export function notifyStaff(
  db: MockDb,
  stationId: string | null,
  kind: string,
  title: string,
  body: string,
  extraUserIds: string[] = [],
) {
  const targets = new Set<string>(extraUserIds);
  for (const user of db.users) {
    if (user.role === "SUPERVISOR") targets.add(user.id);
    if (user.role === "STATION_CHIEF" && stationId && user.stationId === stationId)
      targets.add(user.id);
  }
  targets.forEach((id) => notifyUser(db, id, kind, title, body));
}

/* ------------------------------------------------------------------ */
/* Occurrences, plannings, journées                                    */
/* ------------------------------------------------------------------ */

export function stationOf(db: MockDb, stationId: string) {
  const station = db.stations.find((item) => item.id === stationId);
  if (!station) throw new MockHttpError(404, "Station introuvable.");
  return station;
}

export function occurrenceOf(db: MockDb, id: string): MockOccurrence {
  const found = db.occurrences.find((item) => item.id === id);
  if (!found) throw new MockHttpError(404, "Affectation introuvable.");
  return found;
}

/** Heures retenues = durée prévue moins la pause (RM-13). */
export function durationHours(db: MockDb, occurrence: MockOccurrence) {
  const template = db.templates.find((item) => item.id === occurrence.templateId);
  const gross =
    (Date.parse(occurrence.endTime) - Date.parse(occurrence.startTime)) / 3600000;
  const pause = (template?.breakMinutes ?? 0) / 60;
  return Math.max(0, Math.round((gross - pause) * 100) / 100);
}

export function occurrenceView(db: MockDb, occurrence: MockOccurrence) {
  const station = stationOf(db, occurrence.stationId);
  const swapper = occurrence.swapperId
    ? db.users.find((item) => item.id === occurrence.swapperId) ?? null
    : null;
  return {
    id: occurrence.id,
    station: {
      id: station.id,
      name: station.name,
      timezone: station.timezone,
      isActive: station.isActive,
    },
    templateVersion: {
      label: occurrence.label,
      breakStart: occurrence.breakStart,
      breakEnd: occurrence.breakEnd,
      breakMinutes: occurrence.breakMinutes,
    },
    swapper: swapper
      ? {
          id: swapper.id,
          fullName: swapper.fullName,
          email: swapper.email,
          phoneNumber: swapper.phoneNumber,
        }
      : null,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
  };
}

export function planningView(db: MockDb, planningId: string) {
  const planning = db.plannings.find((item) => item.id === planningId);
  if (!planning) throw new MockHttpError(404, "Planning introuvable.");
  const occurrences = db.occurrences
    .filter((item) => item.planningId === planning.id)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  return {
    ...planning,
    occurrences: occurrences.map((item) => occurrenceView(db, item)),
    _count: { occurrences: occurrences.length },
  };
}

/** Bornes ISO d'une journée de station. */
export function dayBounds(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const pad = (value: number) => String(value).padStart(2, "0");
  const nextKey = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  return {
    start: Date.parse(stationIso(dayKey, "00:00")),
    end: Date.parse(stationIso(nextKey, "00:00")),
  };
}

/** Occurrences publiées qui chevauchent la journée courante. */
export function publishedShiftsOfDay(db: MockDb, now: number, stationId?: string | null) {
  const { start, end } = dayBounds(stationDayKey(now));
  const published = new Set(
    db.plannings.filter((item) => item.status === "PUBLISHED").map((item) => item.id),
  );
  return db.occurrences
    .filter((item) => published.has(item.planningId))
    .filter((item) => Date.parse(item.endTime) > start && Date.parse(item.startTime) < end)
    .filter((item) => (stationId ? item.stationId === stationId : true))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

/** Lundi de la semaine d'un instant, exprimé en jour de station. */
export function weekKeyOf(iso: string) {
  return weekStartKey(stationDayKey(Date.parse(iso)));
}