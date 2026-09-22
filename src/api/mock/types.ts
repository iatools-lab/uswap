/**
 * Types de la maquette serveur.
 *
 * La maquette remplace l'API réelle : ces structures reproduisent exactement
 * les contrats attendus par les écrans, afin qu'aucun composant n'ait à
 * connaître la différence entre les données fictives et un vrai service.
 */

export type Role = "ADMIN" | "SUPERVISOR" | "STATION_CHIEF" | "SWAPPER";

export type AttendanceStatus =
  "EXPECTED" | "PRESENT" | "LATE" | "CLOSED" | "ABSENT" | "JUSTIFIED";

export type MockStation = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  location: string | null;
  timezone: string;
  contactName: string | null;
  contactPhone: string | null;
  isActive: boolean;
  latenessToleranceMinutes: number;
  minRestHours: number;
  weeklyHoursLimit: number;
  blockPublishingWithVacancies: boolean;
  checkinQrTtl: number;
  checkoutQrTtl: number;
};

export type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type MockUser = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  phoneNumber: string | null;
  address: string | null;
  stationId: string | null;
  isActive: boolean;
  disabledAt: string | null;
  updatedAt: string;
  password: string;
  invitationStatus: "NOT_SENT" | "SENT" | "EXPIRED" | "ACTIVATED" | "FAILED";
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  audit: AuditEntry[];
};

export type MockTemplate = {
  id: string;
  stationId: string;
  label: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number;
  durationMinutes: number;
  isActive: boolean;
  revision: number;
  versions: (Omit<MockTemplate, "versions"> & { createdAt: string })[];
};

export type MockPlanning = {
  name?: string;
  id: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "PUBLISHED";
  revision: number;
  createdAt: string;
  publishedAt: string | null;
};

export type MockOccurrence = {
  id: string;
  planningId: string;
  stationId: string;
  templateId: string;
  label: string;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number;
  swapperId: string | null;
  startTime: string;
  endTime: string;
};

export type MockAttendance = {
  shiftId: string;
  swapperId: string;
  status: AttendanceStatus;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  isLate: boolean;
  justified: boolean;
  correction: {
    reason: string;
    attachmentId: string | null;
    authorId: string;
    authorName: string;
    at: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  } | null;
};

export type MockAbsence = {
  id: string;
  shiftId: string;
  swapperId: string;
  reason: string;
  attachmentId: string | null;
  clientRef: string | null;
  reportedAt: string;
  origin: "DECLARATION" | "AUTOMATIC_ABSENCE";
  status: "OPEN" | "COVERED";
  coveredBy: string | null;
};

export type MockLeave = {
  id: string;
  swapperId: string;
  startTime: string;
  endTime: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
};

export type MockChange = {
  id: string;
  shiftId: string;
  type: "REPLACEMENT" | "PERMUTATION" | "REASSIGNMENT";
  initiatorId: string;
  initiator: string;
  stationId: string;
  station: string;
  outSwapper: string | null;
  inSwapper: string | null;
  outSwapperId: string | null;
  inSwapperId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
};

export type MockNotification = {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type MockNotice = {
  id: string;
  userId: string;
  planningId: string;
  readAt: string | null;
  createdAt: string;
};

export type MockQr = {
  token: string;
  kind: "CHECKIN" | "CHECKOUT";
  stationId: string;
  shiftId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  consumedBy: string[];
};

export type MockImportRow = {
  line: number;
  fullName: string;
  email: string;
  role: string;
  stationId: string | null;
  stationName: string;
  status: "READY" | "IGNORED" | "REJECTED" | "CREATED";
  reason: string;
};

export type MockImportBatch = {
  id: string;
  createdAt: string;
  expiresAt: string;
  rows: MockImportRow[];
};

export type MockAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
};

export type MockDb = {
  version: number;
  sessionEmail: string | null;
  stations: MockStation[];
  users: MockUser[];
  templates: MockTemplate[];
  plannings: MockPlanning[];
  occurrences: MockOccurrence[];
  attendance: MockAttendance[];
  absences: MockAbsence[];
  leaves: MockLeave[];
  changes: MockChange[];
  notifications: MockNotification[];
  notices: MockNotice[];
  qrTokens: MockQr[];
  importBatches: MockImportBatch[];
  attachments: MockAttachment[];
  /** Dernière occurrence traitée par l'automatisation des absences. */
  automatedAbsences: string[];
  notificationSeq: number;
};

/** Erreur HTTP simulée, convertie en `ApiError` côté client. */
export class MockHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type MockCtx = {
  db: MockDb;
  path: string;
  /** Segments capturés par l'expression régulière de la route. */
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  file: File | null;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  now: number;
  user: MockUser | null;
};

export type MockHandler = (ctx: MockCtx) => unknown | Promise<unknown>;

export type MockRoute = {
  method: MockCtx["method"];
  pattern: RegExp;
  handler: MockHandler;
};
