export type ReplaceHistoryUrlFn = (nextUrl: string) => void;

/**
 * Safely reads `?verifyToken=` from a browser URL and removes ONLY that parameter
 * from the visible browser URL without logging the token or mutating server state.
 */
export function extractAndCleanVerifyToken(
  currentHref?: string,
  replaceHistoryUrl?: ReplaceHistoryUrlFn
): string | null {
  const href =
    currentHref ?? (typeof window !== 'undefined' ? window.location.href : '');
  if (!href) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }

  const rawToken = parsed.searchParams.get('verifyToken');
  if (!rawToken || rawToken.trim().length === 0) {
    return null;
  }

  const cleanedToken = rawToken.trim();
  parsed.searchParams.delete('verifyToken');

  const remainingSearch = parsed.searchParams.toString();
  const nextRelativeUrl = `${parsed.pathname}${remainingSearch ? `?${remainingSearch}` : ''}${parsed.hash}`;

  if (replaceHistoryUrl) {
    replaceHistoryUrl(nextRelativeUrl);
  } else if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', nextRelativeUrl);
  }

  return cleanedToken;
}
