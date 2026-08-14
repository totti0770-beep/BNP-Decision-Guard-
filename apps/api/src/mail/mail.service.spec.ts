import { LogMailProvider, MailMessage, MailService } from './mail.service';

describe('MailService', () => {
  it('defaults to the log provider when MAIL_PROVIDER is unset', () => {
    expect(new MailService().name).toBe('log');
  });

  it('sendQuietly swallows provider failures so callers cannot leak state', async () => {
    const svc = new MailService();
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
