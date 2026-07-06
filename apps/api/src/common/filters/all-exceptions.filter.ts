import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { isProduction } from '../../config/env';
import { AuditService } from '../../audit/audit.service';

/**
 * Uniform error envelope. In production internal 5xx details are never leaked
 * to the client (only a correlation-free generic message); the full error is
 * logged server-side and recorded in the audit trail. Validation and other
 * HttpExceptions keep their client-safe messages.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly audit?: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object = 'Internal server error';
    if (isHttp) {
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as any).message ?? body;
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      this.audit?.record({
        actorId: req.user?.userId ?? null,
        actorEmail: req.user?.email ?? null,
        action: 'ERROR:UNHANDLED',
        resourceType: 'http',
        metadata: {
          method: req.method,
          path: req.url,
          status,
          error: exception instanceof Error ? exception.message : String(exception),
        },
        ip: req.ip,
      });
      if (isProduction) message = 'Internal server error';
    }

    res.status(status).json({
      statusCode: status,
      error: message,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
