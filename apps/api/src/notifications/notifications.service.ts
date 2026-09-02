import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { DocumentStatus, RoleName } from '@bnp/shared';
import { Document, Notification, User } from '../entities';
import { ApprovalService } from '../approval/approval.service';
import { MailService } from '../mail/mail.service';

const NEAR_EXPIRY_DAYS = 30;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly approval: ApprovalService,
    private readonly mail: MailService,
  ) {}

  listForUser(userId: string) {
    return this.notifications.find({
      where: [{ userId }, { userId: undefined as never }],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async markRead(id: string, userId: string) {
    await this.notifications.update({ id, userId }, { isRead: true });
    return { ok: true };
  }

  /** Daily governance sweep: expire stale documents, warn about near-expiry ones. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async expirySweep() {
    await this.runExpirySweep();
  }

  async runExpirySweep() {
    const now = new Date();

    // 1) Hard-expire ACTIVE documents past their expiry date. EXPIRED status
    //    removes them from AI retrieval immediately (retrieval filters on ACTIVE).
    const expired = await this.documents.find({
      where: { status: DocumentStatus.ACTIVE, expiryDate: LessThan(now) },
    });
    for (const doc of expired) {
      // Through the state machine, not by assigning status here: that is what
      // puts an EXPIRE row in the document's approval history. The audit row
      // (DOCUMENTS:EXPIRE, same action and metadata as before) is written by
      // `transition` too.
      await this.approval.expire(doc);
      await this.notifyKnowledgeManagers(
        'DOCUMENT_EXPIRED',
        'Document expired',
        `"${doc.title}" passed its expiry date and was removed from AI retrieval.`,
        { documentId: doc.id },
      );
    }

    // 2) Warn about documents expiring within NEAR_EXPIRY_DAYS.
    const soon = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 24 * 3600 * 1000);
    const nearExpiry = await this.documents
      .createQueryBuilder('d')
      .where('d.status = :s', { s: DocumentStatus.ACTIVE })
      .andWhere('d.expiry_date IS NOT NULL')
      .andWhere('d.expiry_date BETWEEN :now AND :soon', { now, soon })
      .getMany();
    for (const doc of nearExpiry) {
      // Avoid re-notifying the same document every day.
      //
      // This must be scoped to THIS document. It previously read the newest
      // DOCUMENT_NEAR_EXPIRY row across the whole table and compared its
      // documentId, which works only while exactly one document is near
      // expiry: with two, whichever did not raise the latest row failed the
      // comparison and was warned again, so they alternated re-notifying
      // every manager — and emailing them — every single day.
      //
      // Bounded by `doc.updatedAt` rather than muting forever: re-approving a
      // document with a longer expiry moves that timestamp past the old
      // warning, so a genuinely renewed document that later nears expiry
      // again is warned afresh, while an untouched one stays quiet.
      const alreadyWarned = await this.notifications
        .createQueryBuilder('n')
        .where('n.type = :type', { type: 'DOCUMENT_NEAR_EXPIRY' })
        .andWhere("n.metadata ->> 'documentId' = :id", { id: doc.id })
        .andWhere('n.created_at > :since', { since: doc.updatedAt })
        .getCount();
      if (alreadyWarned > 0) continue;
      await this.notifyKnowledgeManagers(
        'DOCUMENT_NEAR_EXPIRY',
        'Document near expiry',
        `"${doc.title}" expires on ${doc.expiryDate?.toISOString().slice(0, 10)}. Review and re-approve a new version.`,
        { documentId: doc.id },
      );
    }

    if (expired.length || nearExpiry.length) {
      this.logger.log(
        `Expiry sweep: ${expired.length} expired, ${nearExpiry.length} near expiry`,
      );
    }
    return { expired: expired.length, nearExpiry: nearExpiry.length };
  }

  private async notifyKnowledgeManagers(
    type: string,
    title: string,
    message: string,
    metadata: Record<string, unknown>,
  ) {
    const managers = await this.users
      .createQueryBuilder('u')
      .innerJoin('u.roles', 'r')
      .where('r.name IN (:...names)', {
        names: [
          RoleName.NURSING_KNOWLEDGE_MANAGER,
          RoleName.HOSPITAL_ADMIN,
          RoleName.SUPER_ADMIN,
        ],
      })
      .getMany();
    for (const m of managers) {
      await this.notifications.save(
        this.notifications.create({ userId: m.id, type, title, message, metadata }),
      );
      // The in-app row stays the record of truth; email is an additive nudge,
      // so a mail outage never costs a governance notification.
      await this.mail.sendQuietly({
        to: m.email,
        subject: `BNP Decision Guard — ${title}`,
        text: `${message}\n\nReview it in the Approval Workflow screen.`,
      });
    }
  }
}
