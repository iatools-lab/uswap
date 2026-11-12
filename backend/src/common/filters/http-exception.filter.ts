import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from '../errors/domain-errors';

/**
 * Format d'erreur unique, stable pour le client :
 *   { code, message, details?, timestamp, path }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.VALIDATION;
    let message = 'Une erreur interne est survenue.';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        code = (record.code as string) ?? this.codeForStatus(status);
        message = (record.message as string) ?? message;
        details = record.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack ?? exception.message);
    }

    if (status === HttpStatus.BAD_REQUEST) code ||= ErrorCode.VALIDATION;
    if (Array.isArray(details)) {
      message = Array.isArray(message) ? message.join(' ') : message;
    }

    response.status(status).json({
      code,
      message: Array.isArray(message) ? message[0] : message,
      details,
      timestamp: new Date().toISOString(),
      path: request?.url,
    });
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.ACCESS_DENIED;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.VALIDATION;
    }
  }
}
