import type {
  MockAbsence,
  MockAttendance,
  MockChange,
  MockDb,
  MockLeave,
  MockLeaveBalance,
  MockIncident,
  MockNotificationPreference,
  MockNotice,
  MockNotification,
  MockOccurrence,
  MockStation,
  MockTemplate,
  MockUser,
} from "./types";

/* ------------------------------------------------------------------ */
/* Utilitaires de dates : les stations sont toutes en Africa/Douala     */
/* (UTC+1, sans heure d'été), ce qui rend les calculs déterministes.    */
/* ------------------------------------------------------------------ */

const STATION_OFFSET_MINUTES = 60;

export const pad2 = (value: number) => String(value).padStart(2, "0");

/** Clé de jour (AAAA-MM-JJ) telle que vue depuis une station. */
export function stationDayKey(ms: number): string {
  const local = new Date(ms + STATION_OFFSET_MINUTES * 60000);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
}

/** Instant ISO correspondant à une heure locale de station. */
export function stationIso(dayKey: string, hhmm: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hours, minutes) -
      STATION_OFFSET_MINUTES * 60000,
  ).toISOString();
}

export function addDaysKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Lundi de la semaine contenant un jour donné. */
export function weekStartKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysKey(dayKey, weekday === 0 ? -6 : 1 - weekday);
}

export function dayKeys(startKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addDaysKey(startKey, index),
  );
}

/** Durée brute d'un créneau « HH:MM » → « HH:MM », en minutes (gère la nuit). */
export function slotMinutes(startTime: string, endTime: string): number {
  const minutes = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return (minutes(endTime) - minutes(startTime) + 1440) % 1440;
}

export const isoFromMs = (ms: number) => new Date(ms).toISOString();

/** Minutes écoulées depuis minuit, dans l'heure locale de la station. */
export function minutesOfDay(ms: number): number {
  const local = new Date(ms + STATION_OFFSET_MINUTES * 60000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/* ------------------------------------------------------------------ */
/* Stations                                                            */
/* ------------------------------------------------------------------ */

const stations: MockStation[] = [
  {
    id: "st-bastos",
    name: "Station Bastos",
    address: "Rue des ambassades",
    city: "Yaoundé",
    latitude: 3.8897,
    longitude: 11.5147,
    location: "Bastos",
    timezone: "Africa/Douala",
    contactName: "Sam Kotto",
    contactPhone: "+237 6XX 00 00 01",
    isActive: true,
    latenessToleranceMinutes: 5,
    minRestHours: 8,
    weeklyHoursLimit: 48,
    blockPublishingWithVacancies: false,
    checkinQrTtl: 300,
    checkoutQrTtl: 300,
  },
  {
    id: "st-obobogo",
    name: "Obobogo",
    address: "Avenue Ad Lucem",
    city: "Yaoundé",
    latitude: 3.8351,
    longitude: 11.5056,
    location: "Obobogo",
    timezone: "Africa/Douala",
    contactName: "Ariane Tchana",
    contactPhone: "+237 6XX 00 00 02",
    isActive: true,
    latenessToleranceMinutes: 5,
    minRestHours: 8,
    weeklyHoursLimit: 48,
    blockPublishingWithVacancies: true,
    checkinQrTtl: 300,
    checkoutQrTtl: 300,
  },
  {
    id: "st-bonapriso",
    name: "Bonapriso",
    address: "Rue Njo-Njo",
    city: "Douala",
    latitude: 4.0252,
    longitude: 9.6966,
    location: "Bonapriso",
    timezone: "Africa/Douala",
    contactName: "Ariane Tchana",
    contactPhone: "+237 6XX 00 00 03",
    isActive: true,
    latenessToleranceMinutes: 10,
    minRestHours: 8,
    weeklyHoursLimit: 48,
    blockPublishingWithVacancies: false,
    checkinQrTtl: 300,
    checkoutQrTtl: 300,
  },
  {
    id: "st-akwa",
    name: "Akwa",
    address: "Boulevard de la Liberté",
    city: "Douala",
    latitude: 4.0511,
    longitude: 9.7085,
    location: "Akwa",
    timezone: "Africa/Douala",
    contactName: "Paul Nguema",
    contactPhone: "+237 6XX 00 00 04",
    isActive: false,
    latenessToleranceMinutes: 5,
    minRestHours: 8,
    weeklyHoursLimit: 48,
    blockPublishingWithVacancies: false,
    checkinQrTtl: 300,
    checkoutQrTtl: 300,
  },
];

/**
 * Domaines et plages réservés à la documentation (RFC 2606, RFC 5737) :
 * tous les comptes et coordonnées seedés sont fictifs par construction.
 * Aucune de ces adresses ne peut exister sur Internet.
 */
export const FICTITIOUS_DOMAIN = "uswap.example.com";

/**
 * Version du schéma de la base simulée. Doit rester alignée avec la graine :
 * une base stockée avec une autre version est ignorée puis régénérée, ce qui
 * referme aussi les sessions en cours (comportement attendu lors d'un
 * changement de schéma, jamais lors d'un simple rechargement).
 */
export const DB_VERSION = 10;

/** Mot de passe commun aux comptes de démonstration (fictifs). */
export const DEMO_PASSWORD = "uswap2026";
/** Mot de passe dédié au compte administrateur demandé pour la maquette. */
export const ADMIN_PASSWORD = "AdminUswap";

/* ------------------------------------------------------------------ */
/* Comptes                                                             */
/* ------------------------------------------------------------------ */

/** Téléphone de la plage fictive +237 6XX XX (jamais attribuée en vrai). */
function fictitiousPhone(index: number): string {
  const tail = String(100000 + index * 1111).slice(-6);
  return `+237 6${tail.slice(0, 2)} 00 ${tail.slice(2, 4)} ${tail.slice(4, 6)}`;
}

function user(
  id: string,
  fullName: string,
  email: string,
  role: MockUser["role"],
  stationId: string | null,
  options: Partial<MockUser> = {},
): MockUser {
  const createdAt = isoFromMs(Date.now() - 90 * 86400000);
  return {
    id,
    fullName,
    email,
    role,
    phoneNumber: options.phoneNumber ?? null,
    address: options.address ?? null,
    stationId,
    isActive: options.isActive ?? true,
    disabledAt: options.disabledAt ?? null,
    updatedAt: options.updatedAt ?? createdAt,
    password: options.password ?? DEMO_PASSWORD,
    invitationStatus: options.invitationStatus ?? "ACTIVATED",
    invitationSentAt: options.invitationSentAt ?? createdAt,
    invitationExpiresAt: options.invitationExpiresAt ?? null,
    audit: options.audit ?? [],
  };
}

export const SWAPPER_POOL: Record<string, string[]> = {
  "st-bastos": ["sw-01", "sw-02", "sw-03", "sw-04"],
  "st-obobogo": ["sw-05", "sw-06", "sw-07", "sw-08"],
  "st-bonapriso": ["sw-09", "sw-10", "sw-11", "sw-12"],
};

const swapperNames: [string, string][] = [
  ["sw-01", "Léa Meka"],
  ["sw-02", "Jean Nono"],
  ["sw-03", "Estelle Njoya"],
  ["sw-04", "Bertrand Onana"],
  ["sw-05", "Amina Mballa"],
  ["sw-06", "Serge Bello"],
  ["sw-07", "Nadège Fotso"],
  ["sw-08", "Hervé Kamdem"],
  ["sw-09", "Carole Meka"],
  ["sw-10", "Yves Ndjock"],
  ["sw-11", "Mireille Essomba"],
  ["sw-12", "Pascal Mbarga"],
];

const stationOfSwapper = (id: string) =>
  Object.entries(SWAPPER_POOL).find(([, pool]) => pool.includes(id))?.[0] ??
  null;

const swapperEmail = (_fullName: string, index: number) =>
  index === 0
    ? `swappeur@${FICTITIOUS_DOMAIN}`
    : `swappeur${pad2(index + 1)}@${FICTITIOUS_DOMAIN}`;

const users: MockUser[] = [
  user(
    "us-admin",
    "Administrateur uSwap",
    `admin@${FICTITIOUS_DOMAIN}`,
    "ADMIN",
    null,
    {
      isActive: true,
      disabledAt: null,
      password: ADMIN_PASSWORD,
      invitationStatus: "ACTIVATED",
    },
  ),
  user(
    "us-supervisor",
    "Camille Nola",
    `superviseur@${FICTITIOUS_DOMAIN}`,
    "SUPERVISOR",
    null,
  ),
  user(
    "us-chief-bastos",
    "Sam Kotto",
    `chef@${FICTITIOUS_DOMAIN}`,
    "STATION_CHIEF",
    "st-bastos",
  ),
  user(
    "us-chief-obobogo",
    "Ariane Tchana",
    `chef.obobogo@${FICTITIOUS_DOMAIN}`,
    "STATION_CHIEF",
    "st-obobogo",
  ),
  ...swapperNames.map(([id, fullName], index) => {
    const disabled = index === 11;
    const pending = index === 10;
    return user(
      id,
      fullName,
      swapperEmail(fullName, index),
      "SWAPPER",
      stationOfSwapper(id),
      disabled
        ? {
            isActive: false,
            disabledAt: isoFromMs(Date.now() - 12 * 86400000),
            phoneNumber: fictitiousPhone(index + 1),
          }
        : pending
          ? {
              isActive: false,
              invitationStatus: "SENT",
              invitationExpiresAt: isoFromMs(Date.now() + 3 * 86400000),
            }
          : { phoneNumber: fictitiousPhone(index + 1), address: "Yaoundé" },
    );
  }),
];

/* ------------------------------------------------------------------ */
/* Modèles de shift                                                    */
/* ------------------------------------------------------------------ */

const templateSeeds = [
  {
    label: "Matin",
    start: "06:00",
    end: "14:00",
    breakStart: "10:00",
    breakEnd: "11:00",
  },
  {
    label: "Après-midi",
    start: "14:00",
    end: "22:00",
    breakStart: "18:00",
    breakEnd: "19:00",
  },
  {
    label: "Nuit",
    start: "22:00",
    end: "06:00",
    breakStart: "02:00",
    breakEnd: "03:00",
  },
];

function buildTemplates(): MockTemplate[] {
  const list: MockTemplate[] = [];
  for (const station of stations.filter((item) => item.isActive)) {
    templateSeeds.forEach((seed, index) => {
      const base = {
        id: `tpl-${station.id.slice(3)}-${index + 1}`,
        stationId: station.id,
        label: seed.label,
        startTime: seed.start,
        endTime: seed.end,
        breakStart: seed.breakStart,
        breakEnd: seed.breakEnd,
        breakMinutes:
          seed.breakStart && seed.breakEnd
            ? slotMinutes(seed.breakStart, seed.breakEnd)
            : 0,
        durationMinutes: slotMinutes(seed.start, seed.end),
        isActive: true,
        revision: 1,
      };
      list.push({
        ...base,
        versions: [
          { ...base, createdAt: isoFromMs(Date.now() - 30 * 86400000) },
        ],
      });
    });
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Construction de la base                                             */
/* ------------------------------------------------------------------ */

const userById = (list: MockUser[], id: string | null) =>
  id ? (list.find((item) => item.id === id) ?? null) : null;

export function createSeed(nowMs: number): MockDb {
  const day = stationDayKey(nowMs);
  const weekStart = weekStartKey(day);
  const nextWeekStart = addDaysKey(weekStart, 7);
  const templates = buildTemplates();
  const activeStations = stations.filter((item) => item.isActive);

  const plannings = [
    {
      id: "pl-courant",
      name: "Semaine opérationnelle",
      startDate: `${weekStart}T00:00:00.000Z`,
      endDate: `${addDaysKey(weekStart, 6)}T23:59:59.999Z`,
      status: "PUBLISHED" as const,
      revision: 3,
      createdAt: isoFromMs(nowMs - 9 * 86400000),
      publishedAt: isoFromMs(nowMs - 8 * 86400000),
    },
    {
      id: "pl-suivant",
      name: "Préparation semaine suivante",
      startDate: `${nextWeekStart}T00:00:00.000Z`,
      endDate: `${addDaysKey(nextWeekStart, 6)}T23:59:59.999Z`,
      status: "DRAFT" as const,
      revision: 1,
      createdAt: isoFromMs(nowMs - 2 * 86400000),
      publishedAt: null,
    },
  ];

  const occurrences: MockOccurrence[] = [];

  /** Un swappeur prend au plus un shift par jour : les données publiées sont cohérentes. */
  const assign = (stationId: string, sequence: number) => {
    const pool = SWAPPER_POOL[stationId].filter(
      (id) => userById(users, id)?.isActive,
    );
    if (!pool.length) return null;
    if (sequence % 8 === 5) return null;
    return pool[sequence % pool.length];
  };

  const fillPlanning = (
    planningId: string,
    days: string[],
    includeStations: MockStation[],
    assignSwappers: boolean,
  ) => {
    let sequence = 0;
    for (const currentDay of days) {
      for (const station of includeStations) {
        for (const template of templates.filter(
          (item) => item.stationId === station.id,
        )) {
          const crossesMidnight = template.startTime >= template.endTime;
          const endDay = crossesMidnight
            ? addDaysKey(currentDay, 1)
            : currentDay;
          occurrences.push({
            id: `occ-${planningId.slice(3)}-${sequence}`,
            planningId,
            stationId: station.id,
            templateId: template.id,
            label: template.label,
            breakStart: template.breakStart,
            breakEnd: template.breakEnd,
            breakMinutes: template.breakMinutes,
            swapperId: assignSwappers ? assign(station.id, sequence) : null,
            startTime: stationIso(currentDay, template.startTime),
            endTime: stationIso(endDay, template.endTime),
          });
          sequence += 1;
        }
      }
    }
  };

  fillPlanning("pl-courant", dayKeys(weekStart, 7), activeStations, true);
  fillPlanning(
    "pl-suivant",
    dayKeys(nextWeekStart, 7),
    activeStations.filter((station) => station.id !== "st-bonapriso"),
    false,
  );

  /* Pointages : le shift en cours illustre chaque statut, la veille fournit un
     relevé consultable par le swappeur. */
  const attendance: MockAttendance[] = [];
  const absences: MockAbsence[] = [];

  const stationOf = (id: string) => stations.find((item) => item.id === id)!;
  const templateOf = (id: string) => templates.find((item) => item.id === id)!;
  const makeAttendance = (
    item: MockOccurrence,
    status: MockAttendance["status"],
    overrides: Partial<MockAttendance> = {},
  ): MockAttendance => ({
    shiftId: item.id,
    swapperId: item.swapperId!,
    status,
    checkedInAt: null,
    checkedOutAt: null,
    isLate: false,
    justified: false,
    correction: null,
    ...overrides,
  });

  const currentMinutes = minutesOfDay(nowMs);
  const coversNow = (template: MockTemplate) => {
    const toMinutes = (value: string) =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const start = toMinutes(template.startTime);
    const end = toMinutes(template.endTime);
    return start < end
      ? currentMinutes >= start && currentMinutes < end
      : currentMinutes >= start || currentMinutes < end;
  };

  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  const dayEnd = Date.parse(`${addDaysKey(day, 1)}T00:00:00.000Z`);
  const publishedToday = occurrences.filter(
    (item) =>
      item.planningId === "pl-courant" &&
      Date.parse(item.endTime) > dayStart &&
      Date.parse(item.startTime) < dayEnd,
  );
  const publishedYesterday = occurrences.filter(
    (item) =>
      item.planningId === "pl-courant" &&
      stationDayKey(Date.parse(item.startTime)) === addDaysKey(day, -1),
  );

  const automatedAbsences: string[] = [];

  for (const item of publishedToday) {
    if (!item.swapperId) continue;
    const station = stationOf(item.stationId);
    const start = Date.parse(item.startTime);
    const end = Date.parse(item.endTime);
    if (
      start <= nowMs &&
      nowMs < end &&
      coversNow(templateOf(item.templateId))
    ) {
      if (item.stationId === "st-obobogo") {
        attendance.push(
          makeAttendance(item, "LATE", {
            checkedInAt: isoFromMs(
              start + (station.latenessToleranceMinutes + 9) * 60000,
            ),
            isLate: true,
          }),
        );
      } else if (item.stationId === "st-bonapriso") {
        automatedAbsences.push(item.id);
        absences.push({
          id: `abs-${item.id}`,
          shiftId: item.id,
          swapperId: item.swapperId,
          reason:
            "Absence automatique : aucun pointage après le délai de tolérance.",
          attachmentId: null,
          clientRef: null,
          reportedAt: isoFromMs(
            start + station.latenessToleranceMinutes * 60000,
          ),
          origin: "AUTOMATIC_ABSENCE",
          status: "OPEN",
          coveredBy: null,
        });
      } else {
        attendance.push(
          makeAttendance(item, "PRESENT", {
            checkedInAt: isoFromMs(start + 3 * 60000),
          }),
        );
      }
    } else if (end <= nowMs) {
      attendance.push(
        makeAttendance(item, "CLOSED", {
          checkedInAt: isoFromMs(start + 1 * 60000),
          checkedOutAt: isoFromMs(end - 2 * 60000),
        }),
      );
    }
  }

  publishedYesterday
    .filter((item) => item.swapperId)
    .forEach((item, index) => {
      const start = Date.parse(item.startTime);
      const end = Date.parse(item.endTime);
      if (index === 0) {
        attendance.push(
          makeAttendance(item, "JUSTIFIED", {
            checkedInAt: isoFromMs(start + 2 * 60000),
            checkedOutAt: isoFromMs(end - 5 * 60000),
            justified: true,
            correction: {
              reason: "Retard justifié par une panne de véhicule.",
              attachmentId: "att-1",
              authorId: "us-supervisor",
              authorName: "Camille Nola",
              at: isoFromMs(nowMs - 20 * 3600000),
              before: { status: "ABSENT", checkedInAt: null },
              after: {
                status: "JUSTIFIED",
                checkedInAt: isoFromMs(start + 2 * 60000),
              },
            },
          }),
        );
        return;
      }
      if (index === 1) {
        // Cas de recette : prise de service effectuée, mais aucun pointage de
        // fin. L'automatisation doit le classer absent une fois le shift échu.
        attendance.push(
          makeAttendance(item, "PRESENT", {
            checkedInAt: isoFromMs(start + 1 * 60000),
            checkedOutAt: null,
          }),
        );
        return;
      }
      if (index % 5 === 3) return;
      attendance.push(
        makeAttendance(item, "CLOSED", {
          checkedInAt: isoFromMs(start + 1 * 60000),
          checkedOutAt: isoFromMs(end - 2 * 60000),
        }),
      );
    });

  const upcoming = occurrences
    .filter(
      (item) =>
        item.planningId === "pl-courant" &&
        item.swapperId &&
        Date.parse(item.startTime) > nowMs,
    )
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  if (upcoming.length) {
    absences.push({
      id: `abs-${upcoming[0].id}-decl`,
      shiftId: upcoming[0].id,
      swapperId: upcoming[0].swapperId!,
      reason: "Indisponibilité familiale signalée depuis la PWA.",
      attachmentId: "att-absence-demo",
      clientRef: "demo-client-ref-1",
      reportedAt: isoFromMs(nowMs - 45 * 60000),
      origin: "DECLARATION",
      status: "OPEN",
      coveredBy: null,
    });
  }

  const leaves: MockLeave[] = [
    {
      id: "leave-approved-sw02",
      swapperId: "sw-02",
      startTime: isoFromMs(nowMs + 20 * 3600000),
      endTime: isoFromMs(nowMs + 44 * 3600000),
      type: "ANNUAL",
      status: "APPROVED",
      reason: "Congé personnel approuvé",
      attachmentId: null,
      externalId: "LV-DEMO-2048",
      clientRef: "leave-seed-approved-sw02",
      createdAt: isoFromMs(nowMs - 10 * 86400000),
      updatedAt: isoFromMs(nowMs - 3 * 86400000),
      submittedAt: isoFromMs(nowMs - 9 * 86400000),
      decidedAt: isoFromMs(nowMs - 3 * 86400000),
      decisionReason: "Demande approuvée par le service RH.",
      cancellable: false,
      editable: false,
    },
    {
      id: "leave-pending-sw01",
      swapperId: "sw-01",
      startTime: isoFromMs(nowMs + 35 * 86400000),
      endTime: isoFromMs(nowMs + 39 * 86400000),
      type: "ANNUAL",
      status: "PENDING",
      reason: "Repos annuel planifié avec anticipation",
      attachmentId: null,
      externalId: "LV-DEMO-2050",
      clientRef: "leave-seed-pending-sw01",
      createdAt: isoFromMs(nowMs - 2 * 86400000),
      updatedAt: isoFromMs(nowMs - 2 * 86400000),
      submittedAt: isoFromMs(nowMs - 2 * 86400000),
      decidedAt: null,
      decisionReason: null,
      cancellable: true,
      editable: true,
    },
    {
      id: "leave-approved-sw01",
      swapperId: "sw-01",
      startTime: isoFromMs(nowMs - 55 * 86400000),
      endTime: isoFromMs(nowMs - 52 * 86400000),
      type: "FAMILY",
      status: "APPROVED",
      reason: "Événement familial validé par le service RH",
      attachmentId: null,
      externalId: "LV-DEMO-2049",
      clientRef: "leave-seed-approved-sw01",
      createdAt: isoFromMs(nowMs - 70 * 86400000),
      updatedAt: isoFromMs(nowMs - 63 * 86400000),
      submittedAt: isoFromMs(nowMs - 69 * 86400000),
      decidedAt: isoFromMs(nowMs - 63 * 86400000),
      decisionReason: "Période validée.",
      cancellable: false,
      editable: false,
    },
    {
      id: "leave-rejected-sw01",
      swapperId: "sw-01",
      startTime: isoFromMs(nowMs - 25 * 86400000),
      endTime: isoFromMs(nowMs - 23 * 86400000),
      type: "OTHER",
      status: "REJECTED",
      reason: "Demande exceptionnelle hors délai",
      attachmentId: null,
      externalId: "LV-DEMO-2051",
      clientRef: "leave-seed-rejected-sw01",
      createdAt: isoFromMs(nowMs - 35 * 86400000),
      updatedAt: isoFromMs(nowMs - 31 * 86400000),
      submittedAt: isoFromMs(nowMs - 35 * 86400000),
      decidedAt: isoFromMs(nowMs - 31 * 86400000),
      decisionReason: "Délai de prévenance insuffisant.",
      cancellable: false,
      editable: false,
    },
  ];

  const currentYear = new Date(nowMs).getUTCFullYear();
  const leaveBalances: MockLeaveBalance[] = users
    .filter((item) => item.role === "SWAPPER")
    .map((item, index) => ({
      swapperId: item.id,
      year: currentYear,
      entitledDays: 24,
      usedDays: index % 3 === 0 ? 6 : 4,
      pendingDays: index % 4 === 0 ? 2 : 0,
      remainingDays: 24 - (index % 3 === 0 ? 6 : 4),
      syncedAt: isoFromMs(nowMs - (12 + index) * 60000),
    }));

  const notificationPreferences: MockNotificationPreference[] = users.map(
    (item) => ({
      userId: item.id,
      internalEnabled: true,
      emailEnabled: true,
      pushEnabled: item.role === "SWAPPER",
      categories: {
        PLANNING: { email: true, push: true },
        ATTENDANCE: { email: false, push: true },
        LEAVE: { email: true, push: true },
        INCIDENT: { email: item.role !== "SWAPPER", push: true },
        REPORT: { email: item.role === "ADMIN", push: false },
      },
      updatedAt: isoFromMs(nowMs - 7 * 86400000),
    }),
  );

  const incidents: MockIncident[] = [
    {
      id: "incident-bastos-terminal",
      stationId: "st-bastos",
      reporterId: "us-chief-bastos",
      assigneeId: "us-supervisor",
      category: "EQUIPMENT",
      severity: "HIGH",
      status: "IN_PROGRESS",
      title: "Terminal de diagnostic indisponible",
      description: "Le terminal principal ne démarre plus et ralentit le contrôle des batteries entrantes.",
      attachmentIds: [],
      occurredAt: isoFromMs(nowMs - 7 * 3600000),
      createdAt: isoFromMs(nowMs - 6.5 * 3600000),
      updatedAt: isoFromMs(nowMs - 2 * 3600000),
      resolvedAt: null,
      closedAt: null,
      resolution: null,
      actions: [
        { id: "ia-bastos-2", incidentId: "incident-bastos-terminal", authorId: "us-supervisor", type: "QUALIFIED", fromStatus: "ACKNOWLEDGED", toStatus: "IN_PROGRESS", comment: "Diagnostic à distance terminé, intervention locale planifiée.", createdAt: isoFromMs(nowMs - 2 * 3600000) },
        { id: "ia-bastos-1", incidentId: "incident-bastos-terminal", authorId: "us-chief-bastos", type: "CREATED", fromStatus: null, toStatus: "REPORTED", comment: "Incident déclaré depuis la station.", createdAt: isoFromMs(nowMs - 6.5 * 3600000) },
      ],
    },
    {
      id: "incident-obobogo-safety",
      stationId: "st-obobogo",
      reporterId: "us-chief-obobogo",
      assigneeId: "us-supervisor",
      category: "SAFETY",
      severity: "CRITICAL",
      status: "ACKNOWLEDGED",
      title: "Zone de circulation à sécuriser",
      description: "Un marquage au sol est détérioré près de la zone de manutention et nécessite une intervention rapide.",
      attachmentIds: [],
      occurredAt: isoFromMs(nowMs - 3 * 3600000),
      createdAt: isoFromMs(nowMs - 2.5 * 3600000),
      updatedAt: isoFromMs(nowMs - 75 * 60000),
      resolvedAt: null,
      closedAt: null,
      resolution: null,
      actions: [
        { id: "ia-obobogo-2", incidentId: "incident-obobogo-safety", authorId: "us-supervisor", type: "QUALIFIED", fromStatus: "REPORTED", toStatus: "ACKNOWLEDGED", comment: "Périmètre balisé en attendant la remise en état.", createdAt: isoFromMs(nowMs - 75 * 60000) },
        { id: "ia-obobogo-1", incidentId: "incident-obobogo-safety", authorId: "us-chief-obobogo", type: "CREATED", fromStatus: null, toStatus: "REPORTED", comment: "Incident déclaré depuis la station.", createdAt: isoFromMs(nowMs - 2.5 * 3600000) },
      ],
    },
    {
      id: "incident-bonapriso-network",
      stationId: "st-bonapriso",
      reporterId: "us-supervisor",
      assigneeId: "us-supervisor",
      category: "SYSTEM",
      severity: "MEDIUM",
      status: "CLOSED",
      title: "Instabilité réseau locale",
      description: "Des coupures brèves perturbaient la synchronisation des pointages pendant le service du matin.",
      attachmentIds: [],
      occurredAt: isoFromMs(nowMs - 9 * 86400000),
      createdAt: isoFromMs(nowMs - 9 * 86400000),
      updatedAt: isoFromMs(nowMs - 8 * 86400000),
      resolvedAt: isoFromMs(nowMs - 8.4 * 86400000),
      closedAt: isoFromMs(nowMs - 8 * 86400000),
      resolution: "Routeur redémarré et liaison stabilisée après contrôle.",
      actions: [
        { id: "ia-bonapriso-2", incidentId: "incident-bonapriso-network", authorId: "us-supervisor", type: "CLOSED", fromStatus: "RESOLVED", toStatus: "CLOSED", comment: "Liaison stable après une journée de surveillance.", createdAt: isoFromMs(nowMs - 8 * 86400000) },
        { id: "ia-bonapriso-1", incidentId: "incident-bonapriso-network", authorId: "us-supervisor", type: "CREATED", fromStatus: null, toStatus: "REPORTED", comment: "Incident déclaré et transmis au support réseau.", createdAt: isoFromMs(nowMs - 9 * 86400000) },
      ],
    },
  ];

  /* Historique des changements d'affectation (US 2046). */
  const changeSeed: {
    type: MockChange["type"];
    shiftId: string;
    outSwapper: string;
    inSwapper: string;
    outSwapperId: string;
    inSwapperId: string;
    reason: string;
    daysAgo: number;
    initiatorId: string;
  }[] = [
    {
      type: "REPLACEMENT",
      shiftId: publishedYesterday[1]?.id ?? publishedToday[0].id,
      outSwapper: "Jean Nono",
      inSwapper: "Bertrand Onana",
      outSwapperId: "sw-02",
      inSwapperId: "sw-04",
      reason: "Absence imprévue",
      daysAgo: 2,
      initiatorId: "us-supervisor",
    },
    {
      type: "PERMUTATION",
      shiftId:
        publishedYesterday[3]?.id ??
        publishedToday[1]?.id ??
        publishedToday[0].id,
      outSwapper: "Amina Mballa",
      inSwapper: "Serge Bello",
      outSwapperId: "sw-05",
      inSwapperId: "sw-06",
      reason: "Échange accepté entre les deux swappeurs",
      daysAgo: 4,
      initiatorId: "us-supervisor",
    },
    {
      type: "REASSIGNMENT",
      shiftId:
        publishedYesterday[5]?.id ??
        publishedToday[2]?.id ??
        publishedToday[0].id,
      outSwapper: "Carole Meka",
      inSwapper: "Yves Ndjock",
      outSwapperId: "sw-09",
      inSwapperId: "sw-10",
      reason: "Renfort demandé sur une autre station",
      daysAgo: 6,
      initiatorId: "us-admin",
    },
  ];

  const changes: MockChange[] = changeSeed.map((entry, index) => {
    const target = occurrences.find((item) => item.id === entry.shiftId)!;
    const station = stationOf(target.stationId);
    const initiator = userById(users, entry.initiatorId)!;
    return {
      id: `chg-${index + 1}`,
      shiftId: target.id,
      type: entry.type,
      initiatorId: initiator.id,
      initiator: initiator.fullName,
      stationId: station.id,
      station: station.name,
      outSwapper: entry.outSwapper,
      inSwapper: entry.inSwapper,
      outSwapperId: entry.outSwapperId,
      inSwapperId: entry.inSwapperId,
      before: { swapper: entry.outSwapper },
      after: { swapper: entry.inSwapper },
      reason: entry.reason,
      createdAt: isoFromMs(nowMs - entry.daysAgo * 86400000),
    };
  });

  /* Notifications internes (US 2038, 2042, 2044, 2045). */
  const notifications: MockNotification[] = [];
  let notificationSeq = 1;
  const pushNotification = (
    userId: string,
    kind: string,
    title: string,
    body: string,
    minutesAgo: number,
    read = false,
  ) => {
    notifications.push({
      id: `ntf-${notificationSeq++}`,
      userId,
      kind,
      title,
      body,
      readAt: read ? isoFromMs(nowMs - (minutesAgo - 1) * 60000) : null,
      createdAt: isoFromMs(nowMs - minutesAgo * 60000),
    });
  };

  pushNotification(
    "us-admin",
    "ACCESS_PENDING",
    "Accès à valider",
    "Un compte attend votre activation.",
    10,
  );
  pushNotification(
    "us-supervisor",
    "PLANNING_PUBLISHED",
    "Planning publié",
    "La semaine en cours est publiée pour Bastos, Obobogo et Bonapriso.",
    480,
  );
  pushNotification(
    "us-supervisor",
    "LATE",
    "Retard détecté",
    "Un swappeur a pointé en retard à Obobogo.",
    35,
  );
  pushNotification(
    "us-supervisor",
    "REPLACEMENT_NEEDED",
    "Besoin de remplacement",
    "Une absence sans remplaçant à Bonapriso doit être couverte.",
    20,
  );
  pushNotification(
    "us-chief-bastos",
    "PLANNING_PUBLISHED",
    "Planning publié",
    "Le planning de votre station est disponible.",
    480,
    true,
  );
  pushNotification(
    "us-chief-bastos",
    "CHECKIN",
    "Prise de service enregistrée",
    "Léa Meka a pointé à l'heure.",
    12,
  );
  pushNotification(
    "us-chief-obobogo",
    "LATE",
    "Retard détecté",
    "Un swappeur a pointé après la tolérance.",
    35,
  );
  pushNotification(
    "sw-01",
    "PLANNING_PUBLISHED",
    "Planning publié",
    "Vos affectations de la semaine sont à jour.",
    480,
    true,
  );
  pushNotification(
    "sw-01",
    "CHECKIN_REMINDER",
    "Rappel de prise de service",
    "Pensez à scanner le QR de début à votre arrivée.",
    300,
  );
  pushNotification(
    "sw-01",
    "LEAVE_APPROVED",
    "Congé approuvé",
    "Votre demande pour événement familial a été approuvée et votre disponibilité mise à jour.",
    1440,
    true,
  );
  pushNotification(
    "us-supervisor",
    "INCIDENT",
    "Incident critique pris en charge",
    "La zone de circulation d’Obobogo a été balisée dans l’attente de l’intervention.",
    75,
  );
  pushNotification(
    "sw-09",
    "ABSENCE",
    "Absence enregistrée",
    "Votre absence a été classée automatiquement, en attente de traitement.",
    25,
  );

  const notices: MockNotice[] = [
    "us-supervisor",
    "us-chief-bastos",
    "us-chief-obobogo",
    "sw-01",
  ].map((userId, index) => ({
    id: `ntc-${index + 1}`,
    userId,
    planningId: "pl-courant",
    readAt: userId === "sw-01" ? isoFromMs(nowMs - 6 * 3600000) : null,
    createdAt: isoFromMs(nowMs - 8 * 3600000),
  }));

  return {
    version: DB_VERSION,
    sessionEmail: null,
    stations,
    users,
    templates,
    plannings,
    occurrences,
    attendance,
    absences,
    leaves,
    leaveBalances,
    leaveSyncOperations: [
      {
        id: "leave-sync-pending-sw01",
        leaveId: "leave-pending-sw01",
        userId: "sw-01",
        action: "CREATE",
        status: "SYNCED",
        idempotencyKey: "leave-seed-pending-sw01",
        attempts: 1,
        queuedAt: isoFromMs(nowMs - 2 * 86400000),
        lastAttemptAt: isoFromMs(nowMs - 2 * 86400000),
        nextAttemptAt: null,
        completedAt: isoFromMs(nowMs - 2 * 86400000),
        lastError: null,
      },
    ],
    incidents,
    notificationPreferences,
    scheduledReports: [],
    offlineOperations: [],
    changes,
    notifications,
    notices,
    qrTokens: [],
    importBatches: [],
    attachments: [
      {
        id: "att-1",
        name: "certificat-medical.pdf",
        size: 184320,
        type: "application/pdf",
        createdAt: isoFromMs(nowMs - 20 * 3600000),
      },
      {
        id: "att-absence-demo",
        name: "justificatif-indisponibilite.pdf",
        size: 126976,
        type: "application/pdf",
        createdAt: isoFromMs(nowMs - 45 * 60000),
      },
    ],
    automatedAbsences,
    notificationSeq,
  };
}

export { users as seedUsers, stations as seedStations };
