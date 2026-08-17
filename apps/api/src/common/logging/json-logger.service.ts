import type { LoggerService, LogLevel } from '@nestjs/common';

/**
 * One JSON object per line on stdout (stderr for error/fatal), for a log
 * aggregator to parse instead of scraping Nest's colored, human-formatted
 * console lines. Installed once via `app.useLogger()` in main.ts — every
 * `new Logger(ClassName)` call site across the codebase is unchanged and
 * routes through this automatically, because Nest's `Logger` instances
 * delegate to whatever `useLogger()` installed (see
 * `Logger.prototype.localInstance` in @nestjs/common).
 *
 * Nest's own `Logger` class appends the bound context as the last element of
 * `optionalParams` (and, for `error`, an `undefined` stack placeholder before
 * it when no stack was passed) — see logger.service.js. This mirrors that
 * convention rather than inventing a new one, so every existing call site
 * needs no changes.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams, true);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams, true);
  }

  private write(
    level: LogLevel,
    message: unknown,
    optionalParams: unknown[],
    isError = false,
  ): void {
    const params = [...optionalParams];
    const context =
      typeof params[params.length - 1] === 'string' ? (params.pop() as string) : undefined;
    const stackParam = isError && params.length ? params.pop() : undefined;

    const stack =
      typeof stackParam === 'string'
        ? stackParam
        : message instanceof Error
          ? message.stack
          : undefined;

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: message instanceof Error ? message.message : this.render(message),
    };
    if (stack) entry.stack = stack;

    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'fatal') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  private render(message: unknown): string {
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
