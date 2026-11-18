import { viMessages } from './vi.ts';
import { enMessages } from './en.ts';
import type { ApiErrorInfo } from '../types/auth.ts';

export type AppLocale = 'vi-VN' | 'en';
export const DEFAULT_APP_LOCALE: AppLocale = 'vi-VN';

export type MessagesCatalog = typeof viMessages;

export function getMessages(locale: AppLocale = DEFAULT_APP_LOCALE): MessagesCatalog {
  return (locale === 'en' ? enMessages : viMessages) as unknown as MessagesCatalog;
}

/**
 * Resolves a human-friendly localized error message while strictly preserving
 * the backend's Vietnamese `message` fallback and semantic meaning.
 */
export function resolveLocalizedErrorMessage(
  error: ApiErrorInfo,
  locale: AppLocale = DEFAULT_APP_LOCALE
): string {
  const dict = getMessages(locale).errors as Record<string, string>;

  // Always prefer the explicit Vietnamese backend message when locale is vi-VN and backend provided one
  if (locale === 'vi-VN' && error.message && error.message.trim().length > 0 && !error.isForbiddenProxyHtml) {
    return error.message;
  }

  if (error.code && dict[error.code]) {
    return dict[error.code];
  }

  if (error.message && error.message.trim().length > 0) {
    return error.message;
  }

  return dict.UNKNOWN;
}
