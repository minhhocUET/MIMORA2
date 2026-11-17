import { ZodError } from 'zod';
import { DEFAULT_LOCALE } from '../config/env.ts';

export interface ApiErrorDetail {
  field: string;
  code: string;
  messageKey: string;
  message: string;
}

export interface ApiErrorEnvelope {
  status: 'error';
  code: string;
  messageKey: string;
  message: string;
  locale: typeof DEFAULT_LOCALE;
  details?: ApiErrorDetail[];
  requestId?: string;
}

export interface AppErrorOptions {
  httpStatus: number;
  code: string;
  messageKey: string;
  message: string;
  details?: ApiErrorDetail[];
  expose?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly httpStatus: number;
  public readonly code: string;
  public readonly messageKey: string;
  public readonly locale = DEFAULT_LOCALE;
  public readonly details?: ApiErrorDetail[];
  public readonly expose: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.httpStatus = options.httpStatus;
    this.code = options.code;
    this.messageKey = options.messageKey;
    this.details = options.details;
    this.expose = options.expose ?? options.httpStatus < 500;
  }
}

export const ApiErrors = {
  malformedJson(cause?: unknown): AppError {
    return new AppError({
      httpStatus: 400,
      code: 'MALFORMED_JSON',
      messageKey: 'error.http.malformed_json',
      message: 'Dữ liệu JSON gửi lên không đúng định dạng.',
      cause,
    });
  },

  payloadTooLarge(cause?: unknown): AppError {
    return new AppError({
      httpStatus: 413,
      code: 'PAYLOAD_TOO_LARGE',
      messageKey: 'error.http.payload_too_large',
      message: 'Dung lượng dữ liệu gửi lên vượt quá giới hạn cho phép (1 MB).',
      cause,
    });
  },

  unauthorized(message = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'): AppError {
    return new AppError({
      httpStatus: 401,
      code: 'UNAUTHORIZED',
      messageKey: 'error.auth.unauthorized',
      message,
    });
  },

  forbidden(message = 'Bạn không có quyền thực hiện thao tác này.'): AppError {
    return new AppError({
      httpStatus: 403,
      code: 'FORBIDDEN',
      messageKey: 'error.auth.forbidden',
      message,
    });
  },

  notFound(message = 'Không tìm thấy tài nguyên được yêu cầu.'): AppError {
    return new AppError({
      httpStatus: 404,
      code: 'NOT_FOUND',
      messageKey: 'error.http.not_found',
      message,
    });
  },

  methodNotAllowed(): AppError {
    return new AppError({
      httpStatus: 405,
      code: 'METHOD_NOT_ALLOWED',
      messageKey: 'error.http.method_not_allowed',
      message: 'Phương thức HTTP không được hỗ trợ cho đường dẫn này.',
    });
  },

  conflict(
    code = 'CONFLICT',
    messageKey = 'error.http.conflict',
    message = 'Yêu cầu xung đột với trạng thái dữ liệu hiện tại.'
  ): AppError {
    return new AppError({
      httpStatus: 409,
      code,
      messageKey,
      message,
    });
  },

  validation(details: ApiErrorDetail[]): AppError {
    return new AppError({
      httpStatus: 422,
      code: 'VALIDATION_ERROR',
      messageKey: 'error.validation.failed',
      message: 'Dữ liệu đầu vào không hợp lệ. Vui lòng kiểm tra lại.',
      details,
    });
  },

  internal(cause?: unknown): AppError {
    return new AppError({
      httpStatus: 500,
      code: 'INTERNAL_ERROR',
      messageKey: 'error.internal.unexpected',
      message: 'Hệ thống gặp lỗi ngoài ý muốn. Vui lòng thử lại sau.',
      expose: false,
      cause,
    });
  },
};

interface DriverErrorShape {
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
  cause?: unknown;
}

export interface ExtractedDatabaseErrorMeta {
  code?: string;
  errno?: number;
  sqlState?: string;
}

export function extractDatabaseErrorMeta(err: unknown): ExtractedDatabaseErrorMeta | null {
  if (!err || typeof err !== 'object') {
    return null;
  }

  let current: unknown = err;
  let code: string | undefined;
  let errno: number | undefined;
  let sqlState: string | undefined;

  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const obj = current as DriverErrorShape;
    if (code === undefined && typeof obj.code === 'string') {
      code = obj.code;
    }
    if (errno === undefined && typeof obj.errno === 'number') {
      errno = obj.errno;
    }
    if (sqlState === undefined && typeof obj.sqlState === 'string') {
      sqlState = obj.sqlState;
    }
    current = obj.cause;
  }

  if (code === undefined && errno === undefined && sqlState === undefined) {
    return null;
  }

  return { code, errno, sqlState };
}

const KNOWN_DB_CODES = new Set([
  'ER_DUP_ENTRY',
  'ER_NO_REFERENCED_ROW',
  'ER_NO_REFERENCED_ROW_2',
  'ER_ROW_IS_REFERENCED',
  'ER_ROW_IS_REFERENCED_2',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_LOCK_DEADLOCK',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'HANDSHAKE_SSL_ERROR',
]);

export function isDatabaseError(err: unknown): boolean {
  const meta = extractDatabaseErrorMeta(err);
  if (!meta) {
    return false;
  }
  if (meta.sqlState !== undefined || meta.errno !== undefined) {
    return true;
  }
  return typeof meta.code === 'string' && (KNOWN_DB_CODES.has(meta.code) || meta.code.startsWith('ER_'));
}

export function translateDatabaseError(err: unknown): AppError {
  const meta = extractDatabaseErrorMeta(err);
  const code = meta?.code;
  const errno = meta?.errno;
  const sqlState = meta?.sqlState;

  console.error(
    `[mimora-db] Database operation error (code=${code ?? 'UNKNOWN'}, errno=${errno ?? 'N/A'}, sqlState=${sqlState ?? 'N/A'})`
  );

  if (code === 'ER_DUP_ENTRY' || errno === 1062) {
    return new AppError({
      httpStatus: 409,
      code: 'CONFLICT_DUPLICATE',
      messageKey: 'error.db.duplicate_entry',
      message: 'Dữ liệu đã tồn tại hoặc vi phạm ràng buộc duy nhất.',
    });
  }

  if (
    code === 'ER_NO_REFERENCED_ROW' ||
    code === 'ER_NO_REFERENCED_ROW_2' ||
    errno === 1216 ||
    errno === 1452
  ) {
    return new AppError({
      httpStatus: 409,
      code: 'CONFLICT_FOREIGN_KEY',
      messageKey: 'error.db.foreign_key_missing',
      message: 'Dữ liệu tham chiếu liên kết không hợp lệ hoặc không tồn tại.',
    });
  }

  if (
    code === 'ER_ROW_IS_REFERENCED' ||
    code === 'ER_ROW_IS_REFERENCED_2' ||
    errno === 1217 ||
    errno === 1451
  ) {
    return new AppError({
      httpStatus: 409,
      code: 'CONFLICT_FOREIGN_KEY_IN_USE',
      messageKey: 'error.db.foreign_key_in_use',
      message: 'Không thể cập nhật hoặc xóa dữ liệu đang được liên kết.',
    });
  }

  if (
    code === 'ER_LOCK_WAIT_TIMEOUT' ||
    code === 'ER_LOCK_DEADLOCK' ||
    errno === 1205 ||
    errno === 1213 ||
    errno === 9007 ||
    errno === 8028
  ) {
    return new AppError({
      httpStatus: 409,
      code: 'CONFLICT_RETRYABLE',
      messageKey: 'error.db.concurrent_conflict',
      message: 'Dữ liệu đang được xử lý đồng thời, vui lòng thử lại.',
    });
  }

  return new AppError({
    httpStatus: 500,
    code: 'INTERNAL_DATABASE_ERROR',
    messageKey: 'error.db.unavailable',
    message: 'Không thể xử lý yêu cầu cơ sở dữ liệu vào lúc này.',
    expose: false,
  });
}

function isBodyParserError(
  err: unknown
): err is { type?: string; status?: number; statusCode?: number } {
  return Boolean(err && typeof err === 'object');
}

export function normalizeToAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (err instanceof ZodError) {
    const details: ApiErrorDetail[] = err.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '_root',
      code: `INVALID_${issue.code.toUpperCase()}`,
      messageKey: 'error.validation.invalid_field',
      message: 'Giá trị trường dữ liệu không hợp lệ.',
    }));
    return ApiErrors.validation(details);
  }

  if (isBodyParserError(err)) {
    const status = err.status ?? err.statusCode;
    if (err.type === 'entity.too.large' || status === 413) {
      return ApiErrors.payloadTooLarge();
    }
    if (
      err.type === 'entity.parse.failed' ||
      (err instanceof SyntaxError && status === 400 && 'body' in err)
    ) {
      return ApiErrors.malformedJson();
    }
  }

  if (isDatabaseError(err)) {
    return translateDatabaseError(err);
  }

  return ApiErrors.internal();
}

export function toApiErrorEnvelope(
  appError: AppError,
  requestId?: string
): ApiErrorEnvelope {
  const envelope: ApiErrorEnvelope = {
    status: 'error',
    code: appError.code,
    messageKey: appError.messageKey,
    message: appError.message,
    locale: appError.locale,
  };

  if (appError.details && appError.details.length > 0) {
    envelope.details = appError.details;
  }

  if (requestId) {
    envelope.requestId = requestId;
  }

  return envelope;
}
