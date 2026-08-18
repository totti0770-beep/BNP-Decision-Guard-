import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PLATFORM_NAME } from '@bnp/shared';
import { Public } from './common/decorators';
import { StorageService } from './storage/storage.service';

/**
 * Liveness and readiness are deliberately different questions. Liveness asks
 * "is the process alive enough to keep or replace" — it must stay cheap and
 * dependency-free, or a slow/degraded Postgres would make Kubernetes kill and
 * restart healthy API pods in a loop, compounding an outage instead of
 * isolating it. Readiness asks "can this pod actually serve traffic right
 * now" — it checks the two things a request can't work without.
 *
 * Readiness sets its own response status via `res` rather than throwing,
 * deliberately bypassing AllExceptionsFilter: a >=500 there writes an
 * ERROR:UNHANDLED audit record and, in production, redacts the body down to
 * a generic message — both wrong for a dependency-down signal a probe polls
 * every few seconds and an operator needs the detail from.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  liveness() {
    return { status: 'ok', platform: PLATFORM_NAME, time: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response) {
    const [database, objectStorage] = await Promise.all([
      this.checkDatabase(),
      this.storage.isHealthy(),
    ]);
    const ok = database && objectStorage;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'degraded',
      dependencies: {
        database: database ? 'ok' : 'down',
        objectStorage: objectStorage ? 'ok' : 'down',
      },
      time: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
