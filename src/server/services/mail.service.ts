import { getServerConfig, type MailProvider, type ServerConfig } from '../config/env.ts';

export const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails' as const;
export const DEFAULT_MAIL_TIMEOUT_MS = 8_000 as const;

export interface MailDeliveryStatus {
  configured: boolean;
  provider: MailProvider | null;
  delivered: boolean;
  verificationState: 'pending_verification';
}

export interface SendGuardianVerificationEmailInput {
  to: string;
  displayName: string;
  rawToken: string;
  appUrl?: string;
}

export interface MailLogger {
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface MailServiceDeps {
  getConfig?: () => ServerConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: MailLogger;
}

export interface MailService {
  isConfigured: () => boolean;
  getProvider: () => MailProvider | null;
  sendGuardianVerificationEmail: (
    input: SendGuardianVerificationEmailInput
  ) => Promise<MailDeliveryStatus>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeVerificationBaseUrl(rawUrl?: string): string | null {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildGuardianVerificationLink(
  rawToken: string,
  appUrl?: string
): string | null {
  const baseOrigin = normalizeVerificationBaseUrl(appUrl);
  if (!baseOrigin) {
    return null;
  }
  return `${baseOrigin}/?verifyToken=${encodeURIComponent(rawToken)}`;
}

function sanitizeForLog(
  rawText: string,
  secrets: Array<string | undefined | null>
): string {
  let sanitized = rawText;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
  }
  sanitized = sanitized
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bre_[A-Za-z0-9_]{6,}\b/g, '[REDACTED_RESEND_KEY]')
    .replace(/verifyToken=[^\s"'&<>]+/gi, 'verifyToken=[REDACTED]');

  return sanitized.slice(0, 240);
}

export function buildGuardianVerificationEmailContent(input: {
  displayName: string;
  rawToken: string;
  verificationLink: string | null;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const safeDisplayName = input.displayName.trim() || 'Quý phụ huynh';
  const escapedDisplayName = escapeHtml(safeDisplayName);
  const escapedToken = escapeHtml(input.rawToken);
  const escapedLink = input.verificationLink ? escapeHtml(input.verificationLink) : null;

  const subject = '[MIMORA] Xác minh email tài khoản Phụ huynh / Người giám hộ';

  const linkHtmlBlock = escapedLink
    ? `<p style="margin:20px 0;">
        <a href="${escapedLink}" style="display:inline-block;background-color:#26695d;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;font-size:15px;">
          Xác minh email tài khoản MIMORA
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#4a5a56;line-height:1.5;">
        Nếu nút bấm không hoạt động, bạn có thể mở liên kết sau trên trình duyệt:<br />
        <a href="${escapedLink}" style="color:#26695d;word-break:break-all;">${escapedLink}</a>
      </p>`
    : '';

  const html = `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background-color:#f6f9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a26;">
    <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid #d9e7e2;border-radius:16px;padding:28px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.06em;color:#26695d;text-transform:uppercase;">
        MIMORA · Học tập Cảm xúc &amp; Xã hội
      </p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:#13211e;">
        Xác minh email tài khoản Phụ huynh / Người giám hộ
      </h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
        Chào <strong>${escapedDisplayName}</strong>,
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        Bạn vừa đăng ký hoặc yêu cầu xác minh email cho tài khoản Phụ huynh / Người giám hộ trên <strong>MIMORA</strong>. Việc xác minh giúp bảo vệ an toàn cho không gian gia đình và hồ sơ học sinh.
      </p>
      ${linkHtmlBlock}
      <div style="margin:18px 0;padding:14px 16px;background-color:#f3f7f5;border:1px solid #d9e7e2;border-radius:10px;">
        <p style="margin:0 0 8px;font-size:13px;color:#4a5a56;">
          Hoặc sao chép toàn bộ chuỗi mã token xác minh dưới đây và dán vào màn hình xác minh (lưu ý đây là chuỗi ký tự dài, không phải mã OTP 6 chữ số):
        </p>
        <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all;color:#13211e;">
          ${escapedToken}
        </p>
      </div>
      <p style="margin:0 0 10px;font-size:13px;color:#4a5a56;line-height:1.5;">
        Liên kết và mã xác minh này có hiệu lực trong <strong>24 giờ</strong> kể từ lúc được tạo.
      </p>
      <p style="margin:0;font-size:13px;color:#62736e;line-height:1.5;">
        Nếu bạn không thực hiện đăng ký tài khoản MIMORA, bạn có thể yên tâm bỏ qua email này.
      </p>
    </div>
  </body>
</html>`;

  const textLines = [
    'MIMORA - Học tập Cảm xúc & Xã hội',
    '',
    `Chào ${safeDisplayName},`,
    '',
    'Bạn đang thực hiện xác minh email cho tài khoản Phụ huynh / Người giám hộ trên MIMORA.',
    '',
    ...(input.verificationLink
      ? [`Mở liên kết xác minh (hiệu lực 24 giờ): ${input.verificationLink}`, '']
      : []),
    'Hoặc sao chép toàn bộ chuỗi mã token xác minh (không phải mã OTP 6 chữ số) và dán vào trang xác minh:',
    input.rawToken,
    '',
    'Lưu ý: Liên kết và mã xác minh sẽ hết hạn sau 24 giờ.',
    'Nếu bạn không đăng ký tài khoản MIMORA, vui lòng bỏ qua email này.',
  ];

  return {
    subject,
    html,
    text: textLines.join('\n'),
  };
}

export function createMailService(deps?: MailServiceDeps): MailService {
  const getConfig = deps?.getConfig ?? getServerConfig;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_MAIL_TIMEOUT_MS;
  const logger: MailLogger = deps?.logger ?? {
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
  };

  function resolveProvider(): MailProvider | null {
    return getConfig().mail.provider;
  }

  return {
    isConfigured(): boolean {
      const config = getConfig();
      return (
        config.mail.provider === 'resend' &&
        Boolean(config.mail.resendApiKey) &&
        Boolean(config.mail.mailFrom)
      );
    },

    getProvider(): MailProvider | null {
      return resolveProvider();
    },

    async sendGuardianVerificationEmail(
      input: SendGuardianVerificationEmailInput
    ): Promise<MailDeliveryStatus> {
      const config = getConfig();
      if (config.mail.provider !== 'resend') {
        return {
          configured: false,
          provider: null,
          delivered: false,
          verificationState: 'pending_verification',
        };
      }

      const apiKey = config.mail.resendApiKey?.trim();
      const mailFrom = config.mail.mailFrom?.trim();
      if (!apiKey || !mailFrom) {
        logger.error('[mimora-mail] Resend provider missing required credentials or sender.');
        return {
          configured: false,
          provider: null,
          delivered: false,
          verificationState: 'pending_verification',
        };
      }

      const verificationLink = buildGuardianVerificationLink(
        input.rawToken,
        input.appUrl ?? config.appUrl
      );
      const { subject, html, text } = buildGuardianVerificationEmailContent({
        displayName: input.displayName,
        rawToken: input.rawToken,
        verificationLink,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: mailFrom,
            to: input.to,
            subject,
            html,
            text,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let providerDetail = `HTTP ${response.status}`;
          try {
            const errText = await response.text();
            if (errText) {
              try {
                const parsedErr = JSON.parse(errText) as Record<string, unknown>;
                const errName =
                  typeof parsedErr.name === 'string' ? parsedErr.name : undefined;
                const errMessage =
                  typeof parsedErr.message === 'string' ? parsedErr.message : undefined;
                if (errName || errMessage) {
                  providerDetail = `${providerDetail} (${[errName, errMessage]
                    .filter(Boolean)
                    .join(': ')})`;
                }
              } catch {
                providerDetail = `${providerDetail} (${errText.slice(0, 120)})`;
              }
            }
          } catch {
            // Ignore unreadable response body
          }

          logger.warn(
            `[mimora-mail] Resend delivery rejected: ${sanitizeForLog(providerDetail, [
              apiKey,
              input.rawToken,
            ])}`
          );
          return {
            configured: true,
            provider: 'resend',
            delivered: false,
            verificationState: 'pending_verification',
          };
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          logger.warn('[mimora-mail] Resend returned malformed non-JSON success response.');
          return {
            configured: true,
            provider: 'resend',
            delivered: false,
            verificationState: 'pending_verification',
          };
        }

        const emailId =
          payload &&
          typeof payload === 'object' &&
          typeof (payload as Record<string, unknown>).id === 'string'
            ? ((payload as Record<string, unknown>).id as string).trim()
            : '';

        if (!emailId) {
          logger.warn('[mimora-mail] Resend response missing valid email id.');
          return {
            configured: true,
            provider: 'resend',
            delivered: false,
            verificationState: 'pending_verification',
          };
        }

        return {
          configured: true,
          provider: 'resend',
          delivered: true,
          verificationState: 'pending_verification',
        };
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.name === 'AbortError' || err.name === 'TimeoutError');
        const reason = isTimeout
          ? `request timed out after ${timeoutMs}ms`
          : err instanceof Error
            ? `${err.name}: ${err.message}`
            : 'network failure';

        logger.warn(
          `[mimora-mail] Resend delivery failed: ${sanitizeForLog(reason, [
            apiKey,
            input.rawToken,
          ])}`
        );
        return {
          configured: true,
          provider: 'resend',
          delivered: false,
          verificationState: 'pending_verification',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
