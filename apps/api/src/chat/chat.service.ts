import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantType, DocumentCategory } from '@bnp/shared';
import { AiAnswer, AiQuestion, Citation } from '../entities';
import { RagQueryService } from '../rag/rag-query.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

/** Assistant flavors constrain retrieval to their governed category. */
const ASSISTANT_CATEGORY: Partial<Record<AssistantType, DocumentCategory>> = {
  [AssistantType.DRUG_PREPARATION]: DocumentCategory.MEDICATIONS,
  [AssistantType.CBAHI]: DocumentCategory.CBAHI,
};

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(AiQuestion)
    private readonly questions: Repository<AiQuestion>,
    @InjectRepository(AiAnswer) private readonly answers: Repository<AiAnswer>,
    private readonly rag: RagQueryService,
    private readonly audit: AuditService,
  ) {}

  async ask(
    input: {
      question: string;
      assistantType?: AssistantType;
      category?: DocumentCategory;
      channel?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const assistantType = input.assistantType ?? AssistantType.NURSING;
    const category = input.category ?? ASSISTANT_CATEGORY[assistantType];
    const started = Date.now();

    const question = await this.questions.save(
      this.questions.create({
        userId: actor.userId,
        question: input.question,
        assistantType,
        category: category ?? null,
        channel: input.channel ?? 'WEB',
      }),
    );

    const result = await this.rag.ask(input.question, { category });

    const answer = await this.answers.save(
      this.answers.create({
        questionId: question.id,
        shortAnswer: result.shortAnswer,
        steps: result.steps,
        warnings: result.warnings,
        confidence: result.confidence,
        refused: result.refused,
        model: result.model,
        latencyMs: Date.now() - started,
        citations: result.citations.map(
          (c) =>
            ({
              documentId: c.documentId,
              chunkId: c.chunkId,
              documentTitle: c.documentTitle,
              pageNumber: c.pageNumber,
              approvalDate: c.approvalDate,
              similarity: c.similarity,
              snippet: c.snippet,
            }) as Citation,
        ),
      }),
    );

    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: result.refused ? 'AI:ANSWER_REFUSED' : 'AI:ANSWER',
      resourceType: 'ai_question',
      resourceId: question.id,
      metadata: {
        assistantType,
        category,
        confidence: result.confidence,
        citations: result.citations.length,
        latencyMs: answer.latencyMs,
      },
    });

    return {
      questionId: question.id,
      answerId: answer.id,
      refused: result.refused,
      shortAnswer: result.shortAnswer,
      steps: result.steps,
      warnings: result.warnings,
      confidence: result.confidence,
      citations: result.citations,
    };
  }

  async history(actor: AuthenticatedUser, limit = 20) {
    const items = await this.questions.find({
      where: { userId: actor.userId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });
    const withAnswers = await Promise.all(
      items.map(async (q) => {
        const answer = await this.answers.findOne({
          where: { questionId: q.id },
          order: { createdAt: 'DESC' },
        });
        return {
          id: q.id,
          question: q.question,
          assistantType: q.assistantType,
          createdAt: q.createdAt,
          answer: answer
            ? {
                id: answer.id,
                shortAnswer: answer.shortAnswer,
                steps: answer.steps,
                warnings: answer.warnings,
                confidence: answer.confidence,
                refused: answer.refused,
                citations: answer.citations?.map((c) => ({
                  documentId: c.documentId,
                  documentTitle: c.documentTitle,
                  pageNumber: c.pageNumber,
                  approvalDate: c.approvalDate,
                  similarity: c.similarity,
                })),
              }
            : null,
        };
      }),
    );
    return { items: withAnswers };
  }

  /**
   * Scientific-committee review queue: answers across ALL nurses (not just
   * the caller), so a reviewer can see what needs sign-off. Refusals carry
   * nothing to review, so they are excluded by default.
   */
  async listAnswersForReview(query: { reviewStatus?: string; limit?: number; offset?: number }) {
    const qb = this.answers
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.question', 'q')
      .leftJoinAndSelect('q.user', 'u')
      .leftJoinAndSelect('a.citations', 'c')
      .where('a.refused = false')
      .orderBy('a.createdAt', 'DESC');

    qb.andWhere('a.reviewStatus = :rs', { rs: query.reviewStatus ?? 'UNREVIEWED' });
    qb.take(Math.min(query.limit ?? 20, 100)).skip(query.offset ?? 0);

    const [items, total] = await qb.getManyAndCount();
    return {
      total,
      items: items.map((a) => ({
        answerId: a.id,
        questionId: a.questionId,
        question: a.question?.question ?? '',
        assistantType: a.question?.assistantType,
        askedBy: a.question?.user
          ? { fullName: a.question.user.fullName, email: a.question.user.email }
          : null,
        shortAnswer: a.shortAnswer,
        steps: a.steps,
        warnings: a.warnings,
        confidence: a.confidence,
        reviewStatus: a.reviewStatus,
        citations: a.citations?.map((c) => ({
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          pageNumber: c.pageNumber,
          approvalDate: c.approvalDate,
          similarity: c.similarity,
        })),
        createdAt: a.createdAt,
      })),
    };
  }

  /** Scientific-committee review of AI answers (governance requirement). */
  async reviewAnswer(
    answerId: string,
    status: 'APPROVED' | 'FLAGGED',
    actor: AuthenticatedUser,
  ) {
    await this.answers.update(
      { id: answerId },
      { reviewStatus: status, reviewedById: actor.userId },
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'AI:ANSWER_REVIEWED',
      resourceType: 'ai_answer',
      resourceId: answerId,
      metadata: { status },
    });
    return { ok: true };
  }
}
