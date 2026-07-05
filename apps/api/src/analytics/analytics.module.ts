import { Controller, Get, Module } from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { Permission } from '@bnp/shared';
import { Permissions } from '../common/decorators';

@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async overview() {
    const [row] = await this.ds.query(`
      SELECT
        (SELECT count(*) FROM users WHERE is_active)                        AS active_users,
        (SELECT count(*) FROM documents)                                    AS total_documents,
        (SELECT count(*) FROM documents WHERE status = 'ACTIVE')            AS active_documents,
        (SELECT count(*) FROM documents WHERE status = 'IN_REVIEW')         AS documents_in_review,
        (SELECT count(*) FROM documents WHERE status = 'EXPIRED')           AS expired_documents,
        (SELECT count(*) FROM documents
          WHERE status = 'ACTIVE' AND expiry_date IS NOT NULL
            AND expiry_date < now() + interval '30 days')                   AS near_expiry_documents,
        (SELECT count(*) FROM ai_questions)                                 AS total_questions,
        (SELECT count(*) FROM ai_answers WHERE refused)                     AS refused_answers,
        (SELECT count(*) FROM ai_answers WHERE NOT refused)                 AS answered_questions,
        (SELECT count(*) FROM dose_calculations)                            AS dose_calculations,
        (SELECT count(*) FROM dose_formulas WHERE status = 'APPROVED')      AS approved_formulas,
        (SELECT count(*) FROM audit_logs)                                   AS audit_events
    `);

    const questionsByDay = await this.ds.query(`
      SELECT date_trunc('day', created_at)::date AS day,
             count(*) FILTER (WHERE true)        AS questions
        FROM ai_questions
       WHERE created_at > now() - interval '14 days'
       GROUP BY 1 ORDER BY 1
    `);

    const byCategory = await this.ds.query(`
      SELECT category, count(*) AS count
        FROM documents GROUP BY category ORDER BY count DESC
    `);

    const total = Number(row.total_questions) || 0;
    const refused = Number(row.refused_answers) || 0;
    return {
      counters: Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, Number(v)]),
      ),
      refusalRate: total ? Math.round((refused / total) * 1000) / 10 : 0,
      questionsByDay,
      documentsByCategory: byCategory.map((r: any) => ({
        category: r.category,
        count: Number(r.count),
      })),
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Permissions(Permission.ANALYTICS_READ)
  overview() {
    return this.analytics.overview();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
