import type { ArgumentsHost } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';

/**
 * The one behaviour of the error envelope that is a security control — a 5xx
 * carrying internals is stripped to "Internal server error" in production —
 * lives on a branch no other test reaches: the integration suite runs as
 * NODE_ENV=test. `isProduction` binds at module load, so each posture loads
 * the filter in an isolated module registry with NODE_ENV set first.
 */
function fakeHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const req = { method: 'GET', url: '/users', ip: '10.0.0.1', user: undefined };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, res, req };
}

/**
 * The exceptions must come from the same isolated registry as the filter:
 * `instanceof HttpException` compares class identity, and a
 * `BadRequestException` imported at the top of this file is a different
 * `HttpException` from the one the isolated filter checks against.
 */
async function loadFilter(nodeEnv: string | undefined) {
  let mod: typeof import('./all-exceptions.filter');
  let nest: typeof import('@nestjs/common');
  await jest.isolateModulesAsync(async () => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    process.env.JWT_SECRET = 'spec-secret-not-a-default';
    process.env.JWT_REFRESH_SECRET = 'spec-refresh-not-a-default';
    process.env.POSTGRES_PASSWORD = 'spec-pg-not-a-default';
    process.env.S3_ACCESS_KEY = 'spec-s3-not-a-default';
    process.env.S3_SECRET_KEY = 'spec-s3-secret-not-a-default';
    process.env.CORS_ORIGINS = 'https://spec.example';
    nest = await import('@nestjs/common');
    mod = await import('./all-exceptions.filter');
  });
  return { ...mod!, ...nest! };
}

describe('AllExceptionsFilter', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('keeps a client-safe 4xx message under both `message` and `error`', async () => {
    const { AllExceptionsFilter, BadRequestException } = await loadFilter('production');
    const audit = { record: jest.fn() };
    const { host, res } = fakeHost();

    new AllExceptionsFilter(audit as unknown as AuditService).catch(new BadRequestException('email must be an email'), host);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('email must be an email');
    expect(body.error).toBe('email must be an email');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('strips a 5xx message to the generic text in production, and audits the real one', async () => {
    const { AllExceptionsFilter, InternalServerErrorException } = await loadFilter('production');
    const audit = { record: jest.fn() };
    const { host, res } = fakeHost();

    new AllExceptionsFilter(audit as unknown as AuditService).catch(
      new InternalServerErrorException('password authentication failed for user "bnp"'),
      host,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.error).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('password authentication');

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].action).toBe('ERROR:UNHANDLED');
    expect(audit.record.mock.calls[0][0].metadata.error).toContain('password authentication');
  });

  it('lets the 5xx message through outside production, where it is diagnostic', async () => {
    const { AllExceptionsFilter, InternalServerErrorException } = await loadFilter('development');
    const { host, res } = fakeHost();

    new AllExceptionsFilter(undefined).catch(
      new InternalServerErrorException('password authentication failed for user "bnp"'),
      host,
    );

    expect(res.json.mock.calls[0][0].message).toContain('password authentication');
  });

  it('never exposes a raw Error, in any environment', async () => {
    const { AllExceptionsFilter } = await loadFilter('development');
    const { host, res } = fakeHost();

    new AllExceptionsFilter(undefined).catch(new Error('ECONNREFUSED 10.0.0.5:5432'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('ECONNREFUSED');
  });

  it('reports a body-parser rejection at its own 4xx status, not as a server fault', async () => {
    // `express.json({ limit })` throws an http-errors object: `status: 413`,
    // `expose: true`, `type: 'entity.too.large'`. It is not an HttpException,
    // and treating it as an unhandled 500 tells the client the server broke
    // and writes ERROR:UNHANDLED to the audit trail for every oversized body.
    const { AllExceptionsFilter } = await loadFilter('production');
    const audit = { record: jest.fn() };
    const { host, res } = fakeHost();
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });

    new AllExceptionsFilter(audit as unknown as AuditService).catch(tooLarge, host);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json.mock.calls[0][0].message).toBe('request entity too large');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
