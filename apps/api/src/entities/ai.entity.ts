import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AssistantType, ConfidenceLevel } from '@bnp/shared';
import { User } from './user.entity';

@Entity('ai_questions')
export class AiQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'text' })
  question: string;

  @Column({ name: 'assistant_type', type: 'varchar', default: AssistantType.NURSING })
  assistantType: AssistantType;

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({ type: 'varchar', default: 'WEB' })
  channel: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('ai_answers')
export class AiAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AiQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: AiQuestion;

  @Column({ name: 'question_id' })
  questionId: string;

  @Column({ name: 'short_answer', type: 'text' })
  shortAnswer: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  steps: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  warnings: string[];

  @Column({ type: 'varchar', default: ConfidenceLevel.NONE })
  confidence: ConfidenceLevel;

  @Column({ default: false })
  refused: boolean;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ name: 'review_status', type: 'varchar', default: 'UNREVIEWED' })
  reviewStatus: string;

  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById: string | null;

  @OneToMany(() => Citation, (c) => c.answer, { cascade: true, eager: true })
  citations: Citation[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('citations')
export class Citation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AiAnswer, (a) => a.citations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'answer_id' })
  answer: AiAnswer;

  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @Column({ name: 'chunk_id', type: 'uuid', nullable: true })
  chunkId: string | null;

  @Column({ name: 'document_title' })
  documentTitle: string;

  @Column({ name: 'page_number', type: 'int', nullable: true })
  pageNumber: number | null;

  @Column({ name: 'approval_date', type: 'timestamptz', nullable: true })
  approvalDate: Date | null;

  @Column({ type: 'real', default: 0 })
  similarity: number;

  @Column({ type: 'text', nullable: true })
  snippet: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
