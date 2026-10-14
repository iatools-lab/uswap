/**
 * Roles reconnus par le systeme — identiques a `Role` cote frontend.
 */
export enum Role {
  ADMIN = 'ADMIN',
  SUPERVISOR = 'SUPERVISOR',
  SWAPPER = 'SWAPPER',
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Administrateur',
  [Role.SUPERVISOR]: 'Superviseur',
  [Role.SWAPPER]: 'Agent',
};

/** Etats de compte : `invited` = invitation envoyee mais non activee. */
export enum AccountStatus {
  INVITED = 'invited',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DISABLED = 'disabled',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

/** Etats d'un pointage (arrivee / depart / correction). */
export enum AttendanceStatus {
  PENDING = 'pending',
  CHECKED_IN = 'checked-in',
  CHECKED_OUT = 'checked-out',
  LATE = 'late',
  ABSENT = 'absent',
  JUSTIFIED = 'justified',
  CORRECTED = 'corrected',
}

export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum PlanningStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum IncidentStatus {
  OPEN = 'open',
  IN_REVIEW = 'in-review',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum Severity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum NotificationChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
  PUSH = 'push',
}

export enum NotificationStatus {
  UNREAD = 'unread',
  READ = 'read',
  ARCHIVED = 'archived',
}
