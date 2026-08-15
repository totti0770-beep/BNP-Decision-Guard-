import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { loadEnv, type MailProviderName } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailProvider {
  readonly name: MailProviderName;
  /** Resolves once the message is handed off; rejects if it cannot be sent. */
  send(message: MailMessage): Promise<void>;
  /** Best-effort reachability check run at boot. */
  verify?(): Promise<void>;
}

/**
 * Local-development provider: writes the message to the server log instead of
 * sending it, so the reset flow can be exercised end to end without an SMTP
 * server. `config/env.ts` refuses to boot with this provider in production,
 * because the log line contains a working reset link.
 */
export class ConsoleMailProvider implements MailProvider {
  readonly name = 'console' as const;
  private readonly logger = new Logger('ConsoleMailProvider');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `\n─── email (not sent; MAIL_PROVIDER=console) ───\n` +
        `To:      ${message.to}\n` +
        `Subject: ${message.subject}\n\n` +
        `${message.text}\n` +
        `───────────────────────────────────────────────`,
    );
  }
}

/**
 * Explicitly disabled email. Self-service password reset is turned off; an
 * administrator rotates the password from the Users screen instead. Sending
 * rejects rather than silently succeeding, so the attempt is audited as
 * undeliverable rather than looking like it worked.
 */
export class DisabledMailProvider implements MailProvider {
  readonly name = 'none' as const;

  async send(): Promise<void> {
    throw new Error(
      'Email delivery is disabled (MAIL_PROVIDER=none); message not sent',
    );
  }
}

/** SMTP delivery. Timeouts are bounded so a dead relay cannot hang a request. */
export class SmtpMailProvider implements MailProvider {
  readonly name = 'smtp' as const;
  private transporter: Transporter | null = null;

  private transport(): Transporter {
    if (this.transporter) return this.transporter;
    const { smtp } = loadEnv().mail;
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      // An unauthenticated relay is a legitimate hospital setup, so only pass
      // credentials when they are actually configured.
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport().sendMail({
      from: loadEnv().mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  verify(): Promise<void> {
    return this.transport().verify().then(() => undefined);
  }
}

@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: MailProvider;

  constructor() {
    const provider = loadEnv().mail.provider;
    this.provider =
      provider === 'smtp'
        ? new SmtpMailProvider()
        : provider === 'none'
          ? new DisabledMailProvider()
          : new ConsoleMailProvider();
  }

  get name(): MailProviderName {
    return this.provider.name;
  }

  /** True when this deployment can actually deliver a message. */
  get enabled(): boolean {
    return this.provider.name !== 'none';
  }

  /**
   * Surface a misconfigured relay at deploy time rather than the first time a
   * nurse is locked out. Never blocks startup — a transient SMTP outage must
   * not stop the clinical API from serving answers.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.provider.verify) {
      if (!this.enabled) {
        this.logger.warn(
          'MAIL_PROVIDER=none — self-service password reset is disabled. ' +
            'Administrators must rotate passwords from the Users screen.',
        );
      }
      return;
    }
    try {
      await this.provider.verify();
      this.logger.log(`Mail provider "${this.provider.name}" verified`);
    } catch (err) {
      this.logger.warn(
        `Mail provider "${this.provider.name}" failed verification: ${err}. ` +
          'Password-reset emails will not be delivered until this is fixed.',
      );
    }
  }

  send(message: MailMessage): Promise<void> {
    return this.provider.send(message);
  }

  /**
   * Password-reset email. Bilingual Arabic/English: the platform serves
   * Arabic-speaking nursing staff, and this message is read under time
   * pressure by someone already locked out.
   *
   * The link carries the token as a query parameter so the recipient never
   * has to copy it by hand.
   */
  sendPasswordReset(to: string, fullName: string, token: string): Promise<void> {
    const { webUrl } = loadEnv().mail;
    const minutes = loadEnv().passwordResetTokenMinutes;
    const link = `${webUrl}/login/forgot?token=${encodeURIComponent(token)}`;

    const text =
      `مرحباً ${fullName}،\n\n` +
      `تلقّينا طلباً لإعادة تعيين كلمة المرور لحسابك في BNP Decision Guard.\n` +
      `افتح الرابط التالي لاختيار كلمة مرور جديدة (صالح لمدة ${minutes} دقيقة، ويُستخدم مرة واحدة):\n\n` +
      `${link}\n\n` +
      `إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ لن يتغيّر شيء.\n\n` +
      `———\n\n` +
      `Hello ${fullName},\n\n` +
      `We received a request to reset the password for your BNP Decision Guard account.\n` +
      `Open the link below to choose a new password. It expires in ${minutes} minutes and can only be used once:\n\n` +
      `${link}\n\n` +
      `If you did not request this, ignore this message — nothing will change.\n`;

    // Deliberately plain: no tracking pixels, no remote images, no external
    // CSS. Clinical mail clients are locked down, and this must render.
    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#11181b">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dfe6e6;border-radius:10px;padding:24px">
      <h1 style="margin:0 0 16px;font-size:18px;font-weight:600">BNP Decision Guard</h1>

      <div dir="rtl" lang="ar" style="text-align:right;line-height:1.7">
        <p style="margin:0 0 12px">مرحباً ${escapeHtml(fullName)}،</p>
        <p style="margin:0 0 12px">تلقّينا طلباً لإعادة تعيين كلمة المرور لحسابك.</p>
        <p style="margin:0 0 16px">الرابط صالح لمدة ${minutes} دقيقة ويُستخدم مرة واحدة.</p>
      </div>

      <p style="margin:20px 0;text-align:center">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#0d6a63;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Reset your password</a>
      </p>

      <div dir="ltr" lang="en" style="line-height:1.6">
        <p style="margin:0 0 12px">Hello ${escapeHtml(fullName)},</p>
        <p style="margin:0 0 12px">We received a request to reset the password for your account. This link expires in ${minutes} minutes and can only be used once.</p>
        <p style="margin:0 0 12px">If you did not request this, ignore this message — nothing will change.</p>
      </div>

      <p style="margin:20px 0 0;font-size:12px;color:#6f7f85;word-break:break-all">
        ${escapeHtml(link)}
      </p>
    </div>
  </body>
</html>`;

    return this.send({
      to,
      subject: 'إعادة تعيين كلمة المرور · Reset your password',
      text,
      html,
    });
  }
}

/** The name is operator-supplied, so it is not trusted in an HTML context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
