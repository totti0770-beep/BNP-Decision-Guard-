import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

/**
 * Default provider: writes the message to the application log instead of
 * delivering it. Mirrors the mock LLM/embedding providers — the whole
 * password-reset flow is exercisable with zero external configuration, and a
 * pilot operator can read the reset link out of the API logs.
 *
 * Not suitable for real users: anyone with log access can read reset links.
 * `config/env.ts` refuses to boot production with this provider selected.
 */
export class LogMailProvider implements MailProvider {
  readonly name = 'log';
  private readonly logger = new Logger('MailLog');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `[not delivered] to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  }
}

/** SMTP delivery via nodemailer. Configured entirely from the environment. */
export class SmtpMailProvider implements MailProvider {
  readonly name = 'smtp';
  private transport: import('nodemailer').Transporter | null = null;

  /**
   * Built lazily so a missing/broken SMTP dependency cannot take down API
   * boot — a hospital should not lose the whole clinical assistant because
   * its mail relay is misconfigured.
   */
  private async getTransport() {
    if (!this.transport) {
      const { mail } = loadEnv();
      const nodemailer = await import('nodemailer');
      this.transport = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.port === 465,
        auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
      });
    }
    return this.transport;
  }

  async send(message: MailMessage): Promise<void> {
    const { mail } = loadEnv();
    const transport = await this.getTransport();
    await transport.sendMail({
      from: mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

@Injectable()
export class MailService implements MailProvider {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: MailProvider;

  constructor() {
    this.provider =
      loadEnv().mail.provider === 'smtp'
        ? new SmtpMailProvider()
        : new LogMailProvider();
  }

  get name() {
    return this.provider.name;
  }

  send(message: MailMessage): Promise<void> {
    return this.provider.send(message);
  }

  /**
   * Fire-and-forget send for flows whose HTTP response must not depend on the
   * mail relay. Password reset is the motivating case: surfacing a delivery
   * failure there would turn response time into an account-enumeration
   * oracle, and would fail a request that already did its real work.
   */
  async sendQuietly(message: MailMessage): Promise<void> {
    try {
      await this.provider.send(message);
    } catch (err) {
      this.logger.error(
        `Mail delivery failed (to=${message.to}, subject="${message.subject}"): ${err}`,
      );
    }
  }
}
