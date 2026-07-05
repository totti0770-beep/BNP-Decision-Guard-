import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities';

export interface AuditEvent {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /** Fire-and-forget: an audit failure must never break the clinical flow. */
  record(event: AuditEvent): void {
    void this.repo
      .save(
        this.repo.create({
          actorId: event.actorId ?? null,
          actorEmail: event.actorEmail ?? null,
          action: event.action,
          resourceType: event.resourceType ?? null,
          resourceId: event.resourceId ?? null,
          metadata: event.metadata ?? null,
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
        }),
      )
      .catch((err) => this.logger.error(`Failed to write audit log: ${err}`));
  }

  async find(query: {
    action?: string;
    actorEmail?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
  }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (query.action) qb.andWhere('a.action = :action', { action: query.action });
    if (query.actorEmail)
      qb.andWhere('a.actor_email ILIKE :email', { email: `%${query.actorEmail}%` });
    if (query.resourceType)
      qb.andWhere('a.resource_type = :rt', { rt: query.resourceType });
    qb.take(Math.min(query.limit ?? 50, 200)).skip(query.offset ?? 0);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
