import { LogMailProvider, MailMessage, MailService } from './mail.service';

function makeAudit() {
  return { record: jest.fn() };
}

describe('MailService', () => {
  it('defaults to the log provider when MAIL_PROVIDER is unset', () => {
    expect(new MailService(makeAudit() as never).name).toBe('log');
  });

  it('sendQuietly swallows provider failures so callers cannot leak state', async () => {
    const svc = new MailService(makeAudit() as never);
    (svc as unknown as { provider: { send: () => Promise<void> } }).provider = {
      send: () => Promise.reject(new Error('relay unreachable')),
    };
    await expect(
      svc.sendQuietly({ to: 'a@b.c', subject: 's', text: 't' }),
    ).resolves.toBeUndefined();
  });

  it('log provider resolves without delivering', async () => {
    const message: MailMessage = { to: 'nurse@bnp.health', subject: 's', text: 't' };
    await expect(new LogMailProvider().send(message)).resolves.toBeUndefined();
  });
});

describe('MailService.onApplicationBootstrap — log-provider-in-production visibility', () => {
  // isProduction is bound at env.ts module load, so exercise both branches via
  // jest.isolateModulesAsync with NODE_ENV set before the module graph loads —
  // the same pattern used in account-security.spec.ts for the same reason.
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('records an audit event when production boots on the log provider', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-non-default-secret';
    process.env.JWT_REFRESH_SECRET = 'test-non-default-refresh';
    process.env.POSTGRES_PASSWORD = 'test-non-default-db';
    process.env.S3_SECRET_KEY = 'test-non-default-s3';
    process.env.S3_ACCESS_KEY = 'test-non-default-s3-key';
    delete process.env.MAIL_PROVIDER; // defaults to "log"

    await jest.isolateModulesAsync(async () => {
      const { MailService: ProdMailService } = require('./mail.service');
      const audit = makeAudit();
      const svc = new ProdMailService(audit);
      svc.onApplicationBootstrap();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'MAIL:LOG_PROVIDER_IN_PRODUCTION' }),
      );
    });
  });

  it('does not record anything outside production', async () => {
    delete process.env.NODE_ENV;

    await jest.isolateModulesAsync(async () => {
      const { MailService: DevMailService } = require('./mail.service');
      const audit = makeAudit();
      const svc = new DevMailService(audit);
      svc.onApplicationBootstrap();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('does not record anything in production when smtp is correctly configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-non-default-secret';
    process.env.JWT_REFRESH_SECRET = 'test-non-default-refresh';
    process.env.POSTGRES_PASSWORD = 'test-non-default-db';
    process.env.S3_SECRET_KEY = 'test-non-default-s3';
    process.env.S3_ACCESS_KEY = 'test-non-default-s3-key';
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.MAIL_HOST = 'smtp.hospital.example';

    await jest.isolateModulesAsync(async () => {
      const { MailService: SmtpMailService } = require('./mail.service');
      const audit = makeAudit();
      const svc = new SmtpMailService(audit);
      svc.onApplicationBootstrap();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
