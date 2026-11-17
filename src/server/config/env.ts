import { z } from 'zod';

export const DEFAULT_LOCALE = 'vi-VN' as const;
export const DEFAULT_JSON_BODY_LIMIT = '1mb' as const;
export const DEFAULT_SESSION_COOKIE_NAME = 'mimora_session' as const;
export const MAX_ALLOWED_SCRYPT_CONCURRENT = 4 as const;

export type SameSitePolicy = 'lax' | 'none' | 'strict';
export type NodeEnvironment = 'development' | 'production' | 'test';

export interface CookieConfig {
  name: string;
  secure: boolean;
  sameSite: SameSitePolicy;
  httpOnly: true;
  path: '/';
}

export interface AuthSecurityConfig {
  csrfSecret?: string;
  trustedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitIpMax: number;
  rateLimitIdentifierMax: number;
  scryptMaxConcurrent: number;
  scryptMaxQueue: number;
  lockoutMaxFailedAttempts?: number;
  lockoutDurationMinutes?: number;
}

export interface CsvImportConfig {
  maxBytes: number;
  maxRows: number;
}

export interface ServerConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  host: string;
  appUrl?: string;
  defaultLocale: typeof DEFAULT_LOCALE;
  jsonBodyLimit: typeof DEFAULT_JSON_BODY_LIMIT;
  cookie: CookieConfig;
  auth: AuthSecurityConfig;
  csv: CsvImportConfig;
}

const booleanStringSchema = z
  .string()
  .trim()
  .transform((val) => val.toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((val) => val === 'true');

const sameSiteSchema = z
  .string()
  .trim()
  .transform((val) => val.toLowerCase())
  .pipe(z.enum(['lax', 'none', 'strict']));

function parseExactOrigin(rawValue: string): string | null {
  try {
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed.includes('*')) {
      return null;
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      return null;
    }
    if (parsed.search || parsed.hash || parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseOptionalPositiveInt(
  rawValue: string | undefined,
  maxAllowed?: number
): { valid: boolean; value?: number } {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return { valid: true, value: undefined };
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { valid: false };
  }
  if (maxAllowed !== undefined && parsed > maxAllowed) {
    return { valid: false };
  }
  return { valid: true, value: parsed };
}

const rawServerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
    PORT: z.string().trim().optional(),
    HOST: z.string().trim().optional(),
    APP_URL: z.string().trim().optional(),
    COOKIE_SECURE: z.string().optional(),
    COOKIE_SAMESITE: z.string().optional(),
    SESSION_COOKIE_NAME: z.string().trim().optional(),
    AUTH_CSRF_SECRET: z.string().optional(),
    TRUSTED_ORIGINS: z.string().optional(),
    RATE_LIMIT_WINDOW_MS: z.string().optional(),
    RATE_LIMIT_IP_MAX: z.string().optional(),
    RATE_LIMIT_IDENTIFIER_MAX: z.string().optional(),
    SCRYPT_MAX_CONCURRENT: z.string().optional(),
    SCRYPT_MAX_QUEUE: z.string().optional(),
    LOCKOUT_MAX_FAILED_ATTEMPTS: z.string().optional(),
    LOCKOUT_DURATION_MINUTES: z.string().optional(),
    CSV_MAX_BYTES: z.string().optional(),
    CSV_MAX_ROWS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const nodeEnv = env.NODE_ENV ?? 'development';

    if (env.PORT !== undefined && env.PORT.length > 0) {
      const parsedPort = Number(env.PORT);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        ctx.addIssue({
          code: 'custom',
          path: ['PORT'],
          message: 'PORT must be an integer between 1 and 65535.',
        });
      }
    }

    if (env.APP_URL !== undefined && env.APP_URL.length > 0) {
      try {
        const url = new URL(env.APP_URL);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['APP_URL'],
            message: 'APP_URL must use http or https protocol.',
          });
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_URL'],
          message: 'APP_URL must be a valid URL.',
        });
      }
    }

    let cookieSecure = true;
    if (env.COOKIE_SECURE !== undefined && env.COOKIE_SECURE.trim().length > 0) {
      const parsedSecure = booleanStringSchema.safeParse(env.COOKIE_SECURE);
      if (!parsedSecure.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be "true" or "false".',
        });
      } else {
        cookieSecure = parsedSecure.data;
      }
    }

    let cookieSameSite: SameSitePolicy = 'lax';
    if (env.COOKIE_SAMESITE !== undefined && env.COOKIE_SAMESITE.trim().length > 0) {
      const parsedSameSite = sameSiteSchema.safeParse(env.COOKIE_SAMESITE);
      if (!parsedSameSite.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SAMESITE'],
          message: 'COOKIE_SAMESITE must be one of "lax", "none", or "strict".',
        });
      } else {
        cookieSameSite = parsedSameSite.data;
      }
    }

    if (cookieSameSite === 'none' && !cookieSecure) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true when COOKIE_SAMESITE is "none".',
      });
    }

    if (nodeEnv === 'production' && !cookieSecure) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production.',
      });
    }

    if (env.SESSION_COOKIE_NAME !== undefined && env.SESSION_COOKIE_NAME.length > 0) {
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(env.SESSION_COOKIE_NAME)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_COOKIE_NAME'],
          message: 'SESSION_COOKIE_NAME must be 3-64 safe cookie characters.',
        });
      }
    }

    if (env.AUTH_CSRF_SECRET !== undefined && env.AUTH_CSRF_SECRET.trim().length > 0) {
      if (env.AUTH_CSRF_SECRET.trim().length < 16) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_CSRF_SECRET'],
          message: 'AUTH_CSRF_SECRET must be at least 16 characters when provided.',
        });
      }
    }

    if (env.TRUSTED_ORIGINS !== undefined && env.TRUSTED_ORIGINS.trim().length > 0) {
      const entries = env.TRUSTED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const entry of entries) {
        if (!parseExactOrigin(entry)) {
          ctx.addIssue({
            code: 'custom',
            path: ['TRUSTED_ORIGINS'],
            message: 'TRUSTED_ORIGINS must contain exact http/https origins without wildcards or paths.',
          });
          break;
        }
      }
    }

    const intChecks: Array<[keyof typeof env, string | undefined, number | undefined]> = [
      ['RATE_LIMIT_WINDOW_MS', env.RATE_LIMIT_WINDOW_MS, undefined],
      ['RATE_LIMIT_IP_MAX', env.RATE_LIMIT_IP_MAX, undefined],
      ['RATE_LIMIT_IDENTIFIER_MAX', env.RATE_LIMIT_IDENTIFIER_MAX, undefined],
      ['SCRYPT_MAX_CONCURRENT', env.SCRYPT_MAX_CONCURRENT, MAX_ALLOWED_SCRYPT_CONCURRENT],
      ['SCRYPT_MAX_QUEUE', env.SCRYPT_MAX_QUEUE, 128],
      ['LOCKOUT_MAX_FAILED_ATTEMPTS', env.LOCKOUT_MAX_FAILED_ATTEMPTS, undefined],
      ['LOCKOUT_DURATION_MINUTES', env.LOCKOUT_DURATION_MINUTES, undefined],
      ['CSV_MAX_BYTES', env.CSV_MAX_BYTES, 1_048_576],
      ['CSV_MAX_ROWS', env.CSV_MAX_ROWS, 5_000],
    ];

    for (const [key, val, max] of intChecks) {
      if (!parseOptionalPositiveInt(val, max).valid) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${String(key)} must be a valid positive integer.`,
        });
      }
    }

    const hasLockoutMax = Boolean(env.LOCKOUT_MAX_FAILED_ATTEMPTS?.trim());
    const hasLockoutMins = Boolean(env.LOCKOUT_DURATION_MINUTES?.trim());
    if (hasLockoutMax !== hasLockoutMins) {
      ctx.addIssue({
        code: 'custom',
        path: [hasLockoutMax ? 'LOCKOUT_DURATION_MINUTES' : 'LOCKOUT_MAX_FAILED_ATTEMPTS'],
        message: 'Lockout max attempts and lockout duration must be configured together.',
      });
    }
  });

export function parseServerConfig(envSource: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = rawServerEnvSchema.safeParse({
    NODE_ENV: envSource.NODE_ENV?.trim() || undefined,
    PORT: envSource.PORT,
    HOST: envSource.HOST,
    APP_URL: envSource.APP_URL,
    COOKIE_SECURE: envSource.COOKIE_SECURE,
    COOKIE_SAMESITE: envSource.COOKIE_SAMESITE,
    SESSION_COOKIE_NAME: envSource.SESSION_COOKIE_NAME,
    AUTH_CSRF_SECRET: envSource.AUTH_CSRF_SECRET,
    TRUSTED_ORIGINS: envSource.TRUSTED_ORIGINS,
    RATE_LIMIT_WINDOW_MS: envSource.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_IP_MAX: envSource.RATE_LIMIT_IP_MAX,
    RATE_LIMIT_IDENTIFIER_MAX: envSource.RATE_LIMIT_IDENTIFIER_MAX,
    SCRYPT_MAX_CONCURRENT: envSource.SCRYPT_MAX_CONCURRENT,
    SCRYPT_MAX_QUEUE: envSource.SCRYPT_MAX_QUEUE,
    LOCKOUT_MAX_FAILED_ATTEMPTS: envSource.LOCKOUT_MAX_FAILED_ATTEMPTS,
    LOCKOUT_DURATION_MINUTES: envSource.LOCKOUT_DURATION_MINUTES,
    CSV_MAX_BYTES: envSource.CSV_MAX_BYTES,
    CSV_MAX_ROWS: envSource.CSV_MAX_ROWS,
  });

  if (!parsed.success) {
    const keys = Array.from(
      new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'ENV'))
    );
    throw new Error(`Invalid server configuration for: ${keys.join(', ')}.`);
  }

  const data = parsed.data;
  const port = data.PORT && data.PORT.length > 0 ? Number(data.PORT) : 3000;
  const host = data.HOST && data.HOST.length > 0 ? data.HOST : '0.0.0.0';
  const appUrl = data.APP_URL && data.APP_URL.length > 0 ? data.APP_URL : undefined;

  const cookieSecure =
    data.COOKIE_SECURE !== undefined && data.COOKIE_SECURE.trim().length > 0
      ? booleanStringSchema.parse(data.COOKIE_SECURE)
      : true;

  const cookieSameSite: SameSitePolicy =
    data.COOKIE_SAMESITE !== undefined && data.COOKIE_SAMESITE.trim().length > 0
      ? sameSiteSchema.parse(data.COOKIE_SAMESITE)
      : 'lax';

  const cookieName =
    data.SESSION_COOKIE_NAME && data.SESSION_COOKIE_NAME.length > 0
      ? data.SESSION_COOKIE_NAME
      : DEFAULT_SESSION_COOKIE_NAME;

  const trustedOriginSet = new Set<string>();
  if (appUrl) {
    trustedOriginSet.add(new URL(appUrl).origin);
  }
  if (data.TRUSTED_ORIGINS) {
    for (const rawEntry of data.TRUSTED_ORIGINS.split(',')) {
      const origin = parseExactOrigin(rawEntry);
      if (origin) {
        trustedOriginSet.add(origin);
      }
    }
  }

  return {
    nodeEnv: data.NODE_ENV ?? 'development',
    port,
    host,
    appUrl,
    defaultLocale: DEFAULT_LOCALE,
    jsonBodyLimit: DEFAULT_JSON_BODY_LIMIT,
    cookie: {
      name: cookieName,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      httpOnly: true,
      path: '/',
    },
    auth: {
      csrfSecret: data.AUTH_CSRF_SECRET?.trim() || undefined,
      trustedOrigins: Array.from(trustedOriginSet),
      rateLimitWindowMs:
        parseOptionalPositiveInt(data.RATE_LIMIT_WINDOW_MS).value ?? 60_000,
      rateLimitIpMax: parseOptionalPositiveInt(data.RATE_LIMIT_IP_MAX).value ?? 30,
      rateLimitIdentifierMax:
        parseOptionalPositiveInt(data.RATE_LIMIT_IDENTIFIER_MAX).value ?? 10,
      scryptMaxConcurrent:
        parseOptionalPositiveInt(data.SCRYPT_MAX_CONCURRENT, MAX_ALLOWED_SCRYPT_CONCURRENT)
          .value ?? MAX_ALLOWED_SCRYPT_CONCURRENT,
      scryptMaxQueue:
        parseOptionalPositiveInt(data.SCRYPT_MAX_QUEUE, 128).value ?? 16,
      lockoutMaxFailedAttempts: parseOptionalPositiveInt(
        data.LOCKOUT_MAX_FAILED_ATTEMPTS
      ).value,
      lockoutDurationMinutes: parseOptionalPositiveInt(
        data.LOCKOUT_DURATION_MINUTES
      ).value,
    },
    csv: {
      maxBytes:
        parseOptionalPositiveInt(data.CSV_MAX_BYTES, 1_048_576).value ?? 524_288,
      maxRows:
        parseOptionalPositiveInt(data.CSV_MAX_ROWS, 5_000).value ?? 500,
    },
  };
}

let cachedConfig: ServerConfig | null = null;

export function getServerConfig(envSource?: NodeJS.ProcessEnv): ServerConfig {
  if (envSource) {
    return parseServerConfig(envSource);
  }
  if (!cachedConfig) {
    cachedConfig = parseServerConfig(process.env);
  }
  return cachedConfig;
}

export function getCookieConfig(envSource?: NodeJS.ProcessEnv): CookieConfig {
  return getServerConfig(envSource).cookie;
}

export function resetServerConfigCache(): void {
  cachedConfig = null;
}
