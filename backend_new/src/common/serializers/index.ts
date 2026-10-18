/**
 * Serialisation : traduit les lignes Prisma vers les structures attendues par
 * frontend_new. Aucun composant ne doit savoir si la donnee vient de la
 * maquette locale ou de cette API : les cles et les valeurs sont identiques.
 */
import type {
  Absence,
  Attendance,
  AttendanceCorrection,
  Incident,
  IncidentAction,
  Leave,
  LeaveBalance,
  LeaveSyncOperation,
  Notification,
  NotificationPreference,
  Occurrence,
  Planning,
  ReportRun,
  ScheduledReport,
  ShiftChange,
  ShiftTemplate,
  Station,
  User,
} from '@prisma/client';

const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const iso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

export interface SerializeContext {
  stationNames: Map<string, string>;
  users: Map<string, { id: string; fullName: string; email: string; phoneNumber: string | null }>;
}

/* ------------------------------------------------------------------ */
/* Utilisateurs                                                        */
/* ------------------------------------------------------------------ */

export function serializeUser(
  user: Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'stationId'>,
  ctx: SerializeContext,
) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    stationId: user.stationId,
    stationName: user.stationId
      ? (ctx.stationNames.get(user.stationId) ?? null)
      : null,
  };
}

/** Statut derive : desactive, actif, en attente d'activation ou invite. */
export function memberStatus(user: {
  disabledAt: Date | null;
  isActive: boolean;
  invitationStatus: string;
}): 'active' | 'inactive' | 'pending' | 'invited' {
  if (user.disabledAt) return 'inactive';
  if (user.isActive) return 'active';
  if (user.invitationStatus === 'NOT_SENT') return 'invited';
  return 'pending';
}

export function serializeMember(user: User, ctx: SerializeContext) {
  return {
    ...serializeUser(user, ctx),
    isActive: user.isActive,
    pendingActivation: !user.isActive && !user.disabledAt,
    disabledAt: iso(user.disabledAt),
    status: memberStatus(user),
  };
}

export function serializeDetail(
  user: User & { auditEntries?: AuditLike[] },
  ctx: SerializeContext,
) {
  return {
    ...serializeUser(user, ctx),
    phoneNumber: user.phoneNumber,
    address: user.address,
    isActive: user.isActive,
    pendingActivation: !user.isActive && !user.disabledAt,
    disabledAt: iso(user.disabledAt),
    updatedAt: user.updatedAt.toISOString(),
    invitationStatus: user.invitationStatus,
    invitationSentAt: iso(user.invitationSentAt),
    invitationExpiresAt: iso(user.invitationExpiresAt),
    audit: [...(user.auditEntries ?? [])]
      .map(serializeAudit)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
}

interface AuditLike {
  id: string;
  action: string;
  actorId: string | null;
  createdAt: Date;
  before: string;
  after: string;
}

export function serializeAudit(entry: AuditLike) {
  return {
    id: entry.id,
    action: entry.action,
    actorId: entry.actorId ?? undefined,
    createdAt: entry.createdAt.toISOString(),
    before: json<Record<string, unknown>>(entry.before, {}),
    after: json<Record<string, unknown>>(entry.after, {}),
  };
}

/* ------------------------------------------------------------------ */
/* Stations et modeles de shift                                        */
/* ------------------------------------------------------------------ */

export function serializeStation(station: Station) {
  return {
    id: station.id,
    name: station.name,
    address: station.address,
    city: station.city,
    latitude: station.latitude,
    longitude: station.longitude,
    location: station.location,
    timezone: station.timezone,
    contactName: station.contactName,
    contactPhone: station.contactPhone,
    isActive: station.isActive,
    latenessToleranceMinutes: station.latenessToleranceMinutes,
    geofenceRadiusMeters: station.geofenceRadiusMeters,
    enforceMinRest: station.enforceMinRest !== false,
    minRestHours: station.minRestHours,
    weeklyHoursLimit: station.weeklyHoursLimit,
    blockPublishingWithVacancies: station.blockPublishingWithVacancies,
  };
}

export function serializeTemplateVersion(version: {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number;
  durationMinutes: number;
  isActive: boolean;
  revision: number;
  createdAt: Date;
}) {
  return {
    id: version.id,
    label: version.label,
    startTime: version.startTime,
    endTime: version.endTime,
    breakStart: version.breakStart,
    breakEnd: version.breakEnd,
    breakMinutes: version.breakMinutes,
    durationMinutes: version.durationMinutes,
    isActive: version.isActive,
    revision: version.revision,
    createdAt: version.createdAt.toISOString(),
  };
}

export function serializeTemplate(
  template: ShiftTemplate & {
    versions?: (Parameters<typeof serializeTemplateVersion>[0] & {
      stationId: string;
    })[];
  },
) {
  return {
    id: template.id,
    stationId: template.stationId,
    label: template.label,
    startTime: template.startTime,
    endTime: template.endTime,
    breakStart: template.breakStart,
    breakEnd: template.breakEnd,
    breakMinutes: template.breakMinutes,
    durationMinutes: template.durationMinutes,
    isActive: template.isActive,
    revision: template.revision,
    versions: (template.versions ?? []).map(serializeTemplateVersion),
  };
}

/* ------------------------------------------------------------------ */
/* Plannings et postes                                                 */
/* ------------------------------------------------------------------ */

export function serializePlanning(planning: Planning) {
  return {
    id: planning.id,
    name: planning.name,
    // `startDate`/`endDate` reprennent le vocabulaire du frontend : la periode
    // est exprimee par ses bornes, meme si la base stocke `periodStart/End`.
    startDate: planning.periodStart.toISOString(),
    endDate: planning.periodEnd.toISOString(),
    periodStart: planning.periodStart.toISOString(),
    periodEnd: planning.periodEnd.toISOString(),
    stationIds: planning.stationIds,
    status: planning.status,
    revision: planning.revision,
    createdAt: planning.createdAt.toISOString(),
    publishedAt: iso(planning.publishedAt),
  };
}

/** Heures retenues = duree prevue moins la pause (RM-13). */
export { durationHours } from '../utils/datetime';

export function serializeOccurrence(
  occurrence: Occurrence,
  ctx: SerializeContext,
) {
  const stationName = ctx.stationNames.get(occurrence.stationId) ?? '';
  const swapper = occurrence.swapperId
    ? (ctx.users.get(occurrence.swapperId) ?? null)
    : null;
  return {
    id: occurrence.id,
    station: {
      id: occurrence.stationId,
      name: stationName,
      timezone: 'Africa/Douala',
      isActive: true,
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
    startTime: occurrence.startTime.toISOString(),
    endTime: occurrence.endTime.toISOString(),
    planningId: occurrence.planningId,
    templateId: occurrence.templateId,
    label: occurrence.label,
    breakStart: occurrence.breakStart,
    breakEnd: occurrence.breakEnd,
    breakMinutes: occurrence.breakMinutes,
    // Tolérance propre au créneau (sinon celle de la station).
    latenessToleranceOverrideMinutes:
      occurrence.latenessToleranceOverrideMinutes ?? null,
  };
}

export function serializePlanningView(
  planning: Planning,
  occurrences: Occurrence[],
  ctx: SerializeContext,
  visibleStations: { id: string; name: string; timezone: string }[],
) {
  const sorted = [...occurrences].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
  return {
    ...serializePlanning(planning),
    occurrences: sorted.map((item) => serializeOccurrence(item, ctx)),
    _count: { occurrences: sorted.length },
    visibleStations,
  };
}

export function serializeNotice(notice: {
  id: string;
  planningId: string;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notice.id,
    planningId: notice.planningId,
    readAt: iso(notice.readAt),
    createdAt: notice.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Pointages et absences                                               */
/* ------------------------------------------------------------------ */

export function serializeCorrection(
  correction:
    | (AttendanceCorrection & { author?: { fullName: string } | null })
    | null
    | undefined,
) {
  if (!correction) return null;
  return {
    reason: correction.reason,
    attachmentId: correction.attachmentId,
    authorId: correction.authorId,
    authorName: correction.authorName,
    at: correction.createdAt.toISOString(),
    before: json<Record<string, unknown>>(correction.before, {}),
    after: json<Record<string, unknown>>(correction.after, {}),
  };
}

export function serializeAttendanceRecord(
  attendance:
    | (Attendance & { corrections?: AttendanceCorrection[] })
    | null
    | undefined,
) {
  if (!attendance) return null;
  const correction = [...(attendance.corrections ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  return {
    shiftId: attendance.shiftId,
    swapperId: attendance.swapperId,
    status: attendance.status,
    checkedInAt: iso(attendance.checkedInAt),
    checkedOutAt: iso(attendance.checkedOutAt),
    isLate: attendance.isLate,
    justified: attendance.justified,
    correction: serializeCorrection(correction),
  };
}

export function serializeAbsence(absence: Absence) {
  return {
    id: absence.id,
    shiftId: absence.shiftId,
    swapperId: absence.swapperId,
    reason: absence.reason,
    attachmentId: absence.attachmentId,
    clientRef: absence.clientRef,
    reportedAt: absence.reportedAt.toISOString(),
    origin: absence.origin,
    status: absence.status,
    coveredBy: absence.coveredBy,
  };
}

/* ------------------------------------------------------------------ */
/* Conges                                                              */
/* ------------------------------------------------------------------ */

export function serializeLeaveBalance(balance: LeaveBalance) {
  return {
    swapperId: balance.swapperId,
    year: balance.year,
    entitledDays: balance.entitledDays,
    usedDays: balance.usedDays,
    pendingDays: balance.pendingDays,
    remainingDays: balance.remainingDays,
    syncedAt: balance.syncedAt.toISOString(),
  };
}

export function serializeLeaveSyncOperation(operation: LeaveSyncOperation) {
  return {
    id: operation.id,
    leaveId: operation.leaveId,
    userId: operation.userId,
    action: operation.action,
    status: operation.status,
    idempotencyKey: operation.idempotencyKey,
    attempts: operation.attempts,
    queuedAt: operation.queuedAt.toISOString(),
    lastAttemptAt: iso(operation.lastAttemptAt),
    nextAttemptAt: iso(operation.nextAttemptAt),
    completedAt: iso(operation.completedAt),
    lastError: operation.lastError,
  };
}

export function serializeLeave(
  leave: Leave,
  attachmentName: string | null,
  syncStatus: string | null,
) {
  return {
    id: leave.id,
    startTime: leave.startTime.toISOString(),
    endTime: leave.endTime.toISOString(),
    type: leave.type,
    status: leave.status,
    reason: leave.reason,
    attachmentName,
    editable: leave.editable,
    cancellable: leave.cancellable,
    syncStatus,
    decisionReason: leave.decisionReason,
    updatedAt: leave.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export function serializeIncidentAction(action: IncidentAction) {
  return {
    id: action.id,
    incidentId: action.incidentId,
    authorId: action.authorId,
    type: action.type,
    fromStatus: action.fromStatus,
    toStatus: action.toStatus,
    comment: action.comment,
    createdAt: action.createdAt.toISOString(),
  };
}

export function serializeIncident(
  incident: Incident & {
    actions?: IncidentAction[];
    _count?: { actions: number };
    assignee?: { id: string; fullName: string } | null;
    reporter?: { id: string; fullName: string } | null;
    affectedSwapper?: { id: string; fullName: string } | null;
    station?: { id: string; name: string } | null;
  },
  ctx: SerializeContext,
) {
  const affected = incident.affectedSwapperId
    ? ctx.users.get(incident.affectedSwapperId)
    : null;
  const reporter = incident.reporterId ? ctx.users.get(incident.reporterId) : null;
  const assignee = incident.assigneeId ? ctx.users.get(incident.assigneeId) : null;
  return {
    id: incident.id,
    stationId: incident.stationId,
    stationName:
      incident.station?.name ??
      ctx.stationNames.get(incident.stationId) ??
      'Station inconnue',
    affectedSwapperId: incident.affectedSwapperId,
    affectedSwapperName:
      affected?.fullName ?? incident.affectedSwapper?.fullName ?? null,
    reporterId: incident.reporterId,
    reporterName: reporter?.fullName ?? incident.reporter?.fullName ?? null,
    assigneeId: incident.assigneeId,
    assigneeName: assignee?.fullName ?? incident.assignee?.fullName ?? null,
    category: incident.category,
    severity: incident.severity,
    status: incident.status,
    title: incident.title,
    description: incident.description,
    attachmentIds: json<string[]>(incident.attachmentIds as never, []),
    occurredAt: incident.occurredAt.toISOString(),
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    resolvedAt: iso(incident.resolvedAt),
    closedAt: iso(incident.closedAt),
    resolution: incident.resolution,
    actions: (incident.actions ?? []).map(serializeIncidentAction),
    _count: incident._count ?? { actions: (incident.actions ?? []).length },
  };
}

/* ------------------------------------------------------------------ */
/* Changements d'affectation                                           */
/* ------------------------------------------------------------------ */

export function serializeChange(
  change: ShiftChange & {
    outSwapperName?: string | null;
    inSwapperName?: string | null;
  },
) {
  return {
    id: change.id,
    shiftId: change.shiftId,
    type: change.type,
    initiatorId: change.initiatorId,
    initiator: change.initiator,
    stationId: change.stationId,
    station: change.station,
    outSwapper: change.outSwapper,
    inSwapper: change.inSwapper,
    outSwapperId: change.outSwapperId,
    inSwapperId: change.inSwapperId,
    before: json<Record<string, unknown>>(change.before, {}),
    after: json<Record<string, unknown>>(change.after, {}),
    reason: change.reason,
    createdAt: change.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function serializeNotification(notification: Notification) {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    readAt: iso(notification.readAt),
    createdAt: notification.createdAt.toISOString(),
    targetId: notification.targetId,
    targetUrl: notification.targetUrl,
  };
}

export function serializePreferences(preference: NotificationPreference) {
  return {
    inApp: preference.internalEnabled,
    email: preference.emailEnabled,
    push: preference.pushEnabled,
    digest: preference.digestEnabled,
    quietHoursEnabled: preference.quietHoursEnabled,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    retentionDays: preference.retentionDays,
    updatedAt: preference.updatedAt.toISOString(),
    categories: json<Record<string, { email: boolean; push: boolean }>>(
      preference.categories,
      {},
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Rapports programmés                                                 */
/* ------------------------------------------------------------------ */

export function serializeScheduledReport(
  report: ScheduledReport & { runs?: ReportRun[] },
) {
  return {
    id: report.id,
    ownerId: report.ownerId,
    name: report.name,
    frequency: report.frequency,
    format: report.format,
    scope: report.scope,
    stationId: report.stationId,
    recipients: json<string[]>(report.recipients, []),
    sections: json<string[]>(report.sections, []),
    isActive: report.isActive,
    nextRunAt: report.nextRunAt.toISOString(),
    lastRunAt: iso(report.lastRunAt),
    createdAt: report.createdAt.toISOString(),
  };
}

export function serializeReportRun(run: ReportRun) {
  return {
    id: run.id,
    reportId: run.reportId,
    status: run.status,
    format: run.format,
    generatedAt: run.generatedAt.toISOString(),
    sentAt: iso(run.sentAt),
    errorMessage: run.errorMessage,
  };
}

/* ------------------------------------------------------------------ */
/* Reglages globaux                                                    */
/* ------------------------------------------------------------------ */

export function serializeSettings(settings: {
  sessionMinutes: number;
  invitationValidityHours: number;
  maxAttachmentMb: number;
  notificationRetentionDays: number;
  supportEmail: string;
  webhookSecretHash: string | null;
  revision: number;
  updatedAt: Date;
  updatedById: string | null;
}) {
  return {
    sessionMinutes: settings.sessionMinutes,
    invitationValidityHours: settings.invitationValidityHours,
    maxAttachmentMb: settings.maxAttachmentMb,
    notificationRetentionDays: settings.notificationRetentionDays,
    supportEmail: settings.supportEmail,
    webhookSecretConfigured: Boolean(settings.webhookSecretHash),
    revision: settings.revision,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedById ?? '',
  };
}

export function serializeSettingsRevision(revision: {
  id: string;
  revision: number;
  actorId: string;
  createdAt: Date;
  before: string;
  after: string;
}) {
  return {
    id: revision.id,
    revision: revision.revision,
    actorId: revision.actorId,
    createdAt: revision.createdAt.toISOString(),
    before: json<Record<string, unknown>>(revision.before, {}),
    after: json<Record<string, unknown>>(revision.after, {}),
  };
}
