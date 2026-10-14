import { HttpException, HttpStatus } from '@nestjs/common';

/** Erreur metier renvoyee telle quelle au client (code + message FR). */
export class DomainException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundDomain extends DomainException {
  constructor(
    code: string,
    message: string,
    detailsOrStatus?: Record<string, unknown> | number,
    details?: Record<string, unknown>,
  ) {
    super(
      code,
      message,
      HttpStatus.NOT_FOUND,
      typeof detailsOrStatus === 'number' ? details : detailsOrStatus,
    );
  }
}

export class ConflictDomain extends DomainException {
  constructor(
    code: string,
    message: string,
    detailsOrStatus?: Record<string, unknown> | number,
    details?: Record<string, unknown>,
  ) {
    super(
      code,
      message,
      typeof detailsOrStatus === 'number' ? detailsOrStatus : HttpStatus.CONFLICT,
      typeof detailsOrStatus === 'number' ? details : detailsOrStatus,
    );
  }
}

export class ForbiddenDomain extends DomainException {
  constructor(
    code: string,
    message: string,
    detailsOrStatus?: Record<string, unknown> | number,
    details?: Record<string, unknown>,
  ) {
    super(
      code,
      message,
      HttpStatus.FORBIDDEN,
      typeof detailsOrStatus === 'number' ? details : detailsOrStatus,
    );
  }
}

/** Codes d'erreur exposes par l'API — miroir des messages du frontend. */
export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  ROLE_NOT_ALLOWED: 'ROLE_NOT_ALLOWED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  PASSWORD_POLICY: 'PASSWORD_POLICY',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  LEAVE_OVERLAP: 'LEAVE_OVERLAP',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_LEAVE_BALANCE',
  COVERAGE_REQUIRED: 'COVERAGE_REQUIRED',
  STAFFING_BELOW_MINIMUM: 'STAFFING_BELOW_MINIMUM',
  PLANNING_CONFLICT: 'PLANNING_CONFLICT',
  IMMUTABLE: 'IMMUTABLE_RESOURCE',
  ATTENDANCE_LOCKED: 'ATTENDANCE_LOCKED',
  GEO_OUT_OF_RANGE: 'GEO_OUT_OF_RANGE',
  JUSTIFICATION_REQUIRED: 'JUSTIFICATION_REQUIRED',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_KEY_REUSED',
  INTEGRATION_DISABLED: 'INTEGRATION_DISABLED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;
