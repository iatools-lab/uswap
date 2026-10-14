/**
 * Configuration centrale de l'API.
 *
 * Toutes les valeurs sont surchargeables par variables d'environnement, ce qui
 * permet d'aligner le backend sur les reglages lus par le frontend (duree de
 * session, tolerance de retard, rayon de pointage, etc.).
 */

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const list = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export type AppConfig = ReturnType<typeof configuration>;

export const configuration = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 3000),

  corsOrigins: list(process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS, [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]),

  // Session
  jwtSecret:
    process.env.JWT_SECRET ??
    'change-me-uswap-access-secret-please-32-chars',
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ??
    process.env.JWT_SECRET ??
    'change-me-uswap-refresh-secret-please-32-chars',
  accessTtlSeconds: num(
    process.env.JWT_ACCESS_TTL_SECONDS ?? process.env.ACCESS_TOKEN_TTL_SECONDS,
    900,
  ),
  refreshTtlSeconds: num(
    process.env.JWT_REFRESH_TTL_SECONDS ?? process.env.REFRESH_TOKEN_TTL_SECONDS,
    604800,
  ),
  sessionIdleSeconds: num(
    process.env.SESSION_IDLE_SECONDS ?? process.env.DEFAULT_IDLE_TIMEOUT_SECONDS,
    1800,
  ),
  sessionAbsoluteSeconds: num(process.env.SESSION_ABSOLUTE_SECONDS, 43200),
  sessionMinutes: num(process.env.SESSION_MINUTES, 60),

  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'uswap_refresh',
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as
    | 'lax'
    | 'strict'
    | 'none',

  publicAppUrl: process.env.PUBLIC_APP_URL ?? 'http://127.0.0.1:5173',

  // E-mails
  mailDriver: (process.env.MAIL_DRIVER ?? process.env.MAIL_TRANSPORT ?? 'console') as
    | 'console'
    | 'json'
    | 'smtp',
  mailFrom: process.env.MAIL_FROM ?? 'uSwap <no-reply@uswap.local>',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: num(process.env.SMTP_PORT, 587),
  smtpSecure: bool(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',

  // Web Push
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:no-reply@uswap.local',
  enableWebPush: bool(process.env.ENABLE_WEB_PUSH, false),

  // Reglages metier par defaut (surcharges par /admin/settings en base)
  invitationValidityHours: num(process.env.INVITATION_VALIDITY_HOURS, 48),
  maxAttachmentMb: num(
    process.env.MAX_ATTACHMENT_MB ?? process.env.DEFAULT_MAX_ATTACHMENT_MB,
    5,
  ),
  notificationRetentionDays: num(process.env.NOTIFICATION_RETENTION_DAYS, 90),
  supportEmail: process.env.SUPPORT_EMAIL ?? 'support@uswap.local',

  defaultToleranceMinutes: num(process.env.TOLERANCE_MINUTES, 5),
  defaultGeofenceRadiusMeters: num(process.env.GEOFENCE_RADIUS_METERS, 150),
  defaultMinRestHours: num(
    process.env.MIN_REST_HOURS ?? process.env.DEFAULT_MIN_REST_HOURS,
    8,
  ),
  defaultWeeklyHoursLimit: num(
    process.env.WEEKLY_HOURS_LIMIT ?? process.env.DEFAULT_MAX_WEEKLY_HOURS,
    48,
  ),
  defaultEmailDomain: process.env.DEFAULT_EMAIL_DOMAIN ?? 'uswap.local',

  // Integration RH externe (RM-15)
  leaveSyncEnabled: bool(process.env.LEAVE_SYNC_ENABLED, false),
  leaveSyncEndpoint: process.env.LEAVE_SYNC_ENDPOINT ?? '',
  leaveSyncToken: process.env.LEAVE_SYNC_TOKEN ?? '',
  leaveSyncWebhookSecret:
    process.env.LEAVE_SYNC_WEBHOOK_SECRET ??
    process.env.WEBHOOK_SECRET ??
    '',

  uploadDir: process.env.UPLOAD_DIR ?? 'var/uploads',
});
