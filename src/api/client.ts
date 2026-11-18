import type {
  ApiErrorEnvelope,
  ApiErrorInfo,
  AuthContextPayload,
  ChangePasswordRequest,
  LoginRequest,
} from '../types/auth.ts';

const API_BASE = '/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiClientError extends Error {
  public readonly info: ApiErrorInfo;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = 'ApiClientError';
    this.info = info;
  }
}

/**
 * Application-memory-only CSRF token store.
 * Raw session tokens or cookies are NEVER stored in localStorage or sessionStorage.
 */
let inMemoryCsrfToken: string | null = null;

export function getInMemoryCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function setInMemoryCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token && token.trim().length > 0 ? token.trim() : null;
}

export function clearInMemoryCsrfToken(): void {
  inMemoryCsrfToken = null;
}

type UnauthorizedListener = (info: ApiErrorInfo, requestPath: string) => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function subscribeUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function isHtmlLikeBody(rawText: string, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return true;
  }
  const trimmed = rawText.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function tryParseJson(rawText: string): Record<string, unknown> | null {
  if (!rawText || rawText.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function buildApiErrorInfo(
  httpStatus: number,
  rawText: string,
  contentType: string | null
): ApiErrorInfo {
  const parsed = isHtmlLikeBody(rawText, contentType) ? null : tryParseJson(rawText);

  if (parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
    const envelope = parsed as unknown as ApiErrorEnvelope;
    return {
      httpStatus,
      code: envelope.code,
      messageKey: envelope.messageKey || 'error.http.unknown',
      message: envelope.message,
      locale: envelope.locale || 'vi-VN',
      details: Array.isArray(envelope.details) ? envelope.details : undefined,
      requestId: typeof envelope.requestId === 'string' ? envelope.requestId : undefined,
    };
  }

  // Handle AI Studio nginx:8080 Preview proxy HTML 403 interception safely
  if (httpStatus === 403) {
    return {
      httpStatus: 403,
      code: 'FORBIDDEN_PROXY_HTML',
      messageKey: 'error.http.forbidden_proxy',
      message:
        'Yêu cầu bị từ chối ở lớp bảo mật hoặc proxy (HTTP 403). Vui lòng kiểm tra quyền truy cập.',
      locale: 'vi-VN',
      isForbiddenProxyHtml: true,
    };
  }

  if (httpStatus === 401) {
    return {
      httpStatus: 401,
      code: 'UNAUTHORIZED',
      messageKey: 'error.auth.unauthorized',
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      locale: 'vi-VN',
    };
  }

  if (httpStatus === 429) {
    return {
      httpStatus: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      messageKey: 'error.security.rate_limit_exceeded',
      message: 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.',
      locale: 'vi-VN',
    };
  }

  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return {
      httpStatus,
      code: 'SERVICE_UNAVAILABLE_PROXY',
      messageKey: 'error.http.service_unavailable',
      message: 'Hệ thống tạm thời đang bận hoặc khởi động. Vui lòng thử lại sau ít giây.',
      locale: 'vi-VN',
    };
  }

  return {
    httpStatus,
    code: `HTTP_${httpStatus}`,
    messageKey: 'error.http.unexpected',
    message: 'Hệ thống gặp sự cố khi xử lý yêu cầu. Vui lòng thử lại.',
    locale: 'vi-VN',
  };
}

/**
 * Low-level same-origin API request helper.
 * Inspects HTTP status before parsing JSON, preserves all status codes,
 * attaches CSRF / X-Requested-With headers for unsafe methods, and
 * safely decodes Preview nginx HTML error intercepts.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const url = path.startsWith(API_BASE) ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  if (!SAFE_METHODS.has(method)) {
    headers['X-Requested-With'] = 'MIMORA-Web';
    if (inMemoryCsrfToken) {
      headers['X-CSRF-Token'] = inMemoryCsrfToken;
    }
  }

  let bodyPayload: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyPayload = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: bodyPayload,
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError({
      httpStatus: 0,
      code: 'NETWORK_ERROR',
      messageKey: 'error.network.unreachable',
      message: 'Không thể kết nối tới máy chủ MIMORA. Vui lòng kiểm tra kết nối mạng.',
      locale: 'vi-VN',
      isNetworkError: true,
    });
  }

  // Always inspect HTTP status BEFORE assuming a JSON success payload
  const status = response.status;
  const contentType = response.headers.get('content-type');
  const rawText = await response.text().catch(() => '');

  if (status < 200 || status >= 300) {
    const errInfo = buildApiErrorInfo(status, rawText, contentType);
    if (status === 401) {
      clearInMemoryCsrfToken();
      const normalizedPath = url.replace(/^\/api\/v1/, '');
      if (
        normalizedPath !== '/auth/login' &&
        normalizedPath !== '/auth/me' &&
        normalizedPath !== '/auth/logout'
      ) {
        for (const listener of unauthorizedListeners) {
          listener(errInfo, normalizedPath);
        }
      }
    }
    throw new ApiClientError(errInfo);
  }

  if (isHtmlLikeBody(rawText, contentType)) {
    throw new ApiClientError({
      httpStatus: status,
      code: 'UNEXPECTED_HTML_RESPONSE',
      messageKey: 'error.http.unexpected_html',
      message: 'Phản hồi từ máy chủ không đúng định dạng dữ liệu mong đợi.',
      locale: 'vi-VN',
    });
  }

  if (!rawText || rawText.trim().length === 0) {
    return {} as T;
  }

  const json = tryParseJson(rawText);
  if (!json) {
    throw new ApiClientError({
      httpStatus: status,
      code: 'INVALID_JSON_RESPONSE',
      messageKey: 'error.http.invalid_json',
      message: 'Dữ liệu phản hồi từ máy chủ không hợp lệ.',
      locale: 'vi-VN',
    });
  }

  return json as unknown as T;
}

export interface HealthApiResponse {
  status: string;
  service: string;
}

export type AuthEnvelopeResponse = { status: 'ok' } & AuthContextPayload;

export interface LogoutEnvelopeResponse {
  status: 'ok';
  loggedOut: boolean;
}

export interface ChangePasswordEnvelopeResponse {
  status: 'ok';
  passwordChanged: boolean;
  csrfToken: string;
}

export const authApi = {
  async getHealth(fetchImpl?: typeof fetch): Promise<HealthApiResponse> {
    return apiRequest<HealthApiResponse>('/health', { method: 'GET', fetchImpl });
  },

  async getMe(fetchImpl?: typeof fetch): Promise<AuthContextPayload> {
    const res = await apiRequest<AuthEnvelopeResponse>('/auth/me', {
      method: 'GET',
      fetchImpl,
    });
    setInMemoryCsrfToken(res.csrfToken);
    return res;
  },

  async login(
    input: LoginRequest,
    fetchImpl?: typeof fetch
  ): Promise<AuthContextPayload> {
    const res = await apiRequest<AuthEnvelopeResponse>('/auth/login', {
      method: 'POST',
      body: input,
      fetchImpl,
    });
    setInMemoryCsrfToken(res.csrfToken);
    return res;
  },

  async switchOrganization(
    organizationId: string,
    fetchImpl?: typeof fetch
  ): Promise<AuthContextPayload> {
    const res = await apiRequest<AuthEnvelopeResponse>('/auth/switch-organization', {
      method: 'POST',
      body: { organizationId },
      fetchImpl,
    });
    setInMemoryCsrfToken(res.csrfToken);
    return res;
  },

  async changePassword(
    input: ChangePasswordRequest,
    fetchImpl?: typeof fetch
  ): Promise<{ passwordChanged: boolean; csrfToken: string }> {
    const res = await apiRequest<ChangePasswordEnvelopeResponse>(
      '/auth/change-password',
      {
        method: 'POST',
        body: input,
        fetchImpl,
      }
    );
    setInMemoryCsrfToken(res.csrfToken);
    return {
      passwordChanged: res.passwordChanged,
      csrfToken: res.csrfToken,
    };
  },

  async logout(fetchImpl?: typeof fetch): Promise<void> {
    try {
      await apiRequest<LogoutEnvelopeResponse>('/auth/logout', {
        method: 'POST',
        body: {},
        fetchImpl,
      });
    } finally {
      clearInMemoryCsrfToken();
    }
  },
};
