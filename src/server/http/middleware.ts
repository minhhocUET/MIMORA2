import type { NextFunction, Request, Response } from 'express';
import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, normalizeToAppError, toApiErrorEnvelope } from './errors.ts';

const SAFE_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function getRequestId(res: Response): string | undefined {
  return typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
}

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id')?.trim();
  const requestId =
    incoming && SAFE_REQUEST_ID_REGEX.test(incoming) ? incoming : generateUuidV7();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export function baselineSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

export function apiNotFoundHandler(_req: Request, res: Response): void {
  const requestId = getRequestId(res);
  const notFoundError = ApiErrors.notFound('Đường dẫn API không tồn tại.');
  res.status(notFoundError.httpStatus).json(toApiErrorEnvelope(notFoundError, requestId));
}

export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = getRequestId(res);
  const appError = normalizeToAppError(err);

  if (
    err &&
    typeof err === 'object' &&
    'retryAfterSeconds' in err &&
    typeof (err as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number'
  ) {
    res.setHeader(
      'Retry-After',
      String(Math.max(1, Math.ceil((err as { retryAfterSeconds: number }).retryAfterSeconds)))
    );
  }

  if (appError.httpStatus >= 500) {
    const safeName = err instanceof Error ? err.name : typeof err;
    console.error(
      `[mimora-api] Error ${appError.code} (${appError.httpStatus}) requestId=${requestId ?? 'none'} type=${safeName}`
    );
  }

  res.status(appError.httpStatus).json(toApiErrorEnvelope(appError, requestId));
}
