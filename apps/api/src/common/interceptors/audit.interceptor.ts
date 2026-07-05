import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../audit/audit.service';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Global write-audit: records every mutating HTTP request with actor, route,
 * IP and outcome. Domain services add richer, semantic events on top
 * (question asked, document approved, ...).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!MUTATING_METHODS.has(req.method)) return next.handle();
    // Login/refresh bodies contain credentials; auth service audits those itself.
    if (req.path?.startsWith('/auth')) return next.handle();

    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.log(req, 'SUCCESS', started),
        error: (err) => this.log(req, `ERROR:${err?.status ?? 500}`, started),
      }),
    );
  }

  private log(req: any, outcome: string, started: number) {
    this.audit.record({
      actorId: req.user?.userId ?? null,
      actorEmail: req.user?.email ?? null,
      action: `HTTP:${req.method}:${req.route?.path ?? req.path}`,
      resourceType: 'http',
      metadata: { outcome, durationMs: Date.now() - started, params: req.params },
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }
}
