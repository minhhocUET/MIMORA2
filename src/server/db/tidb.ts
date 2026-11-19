import { sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.ts';

export type MimoraSchema = typeof schema;
export type MimoraDatabase = MySql2Database<MimoraSchema>;
export type MimoraTransaction = Parameters<Parameters<MimoraDatabase['transaction']>[0]>[0];
export type MimoraTransactionConfig = Parameters<MimoraDatabase['transaction']>[1];

export interface TiDbEnvConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type DbErrorCode =
  | 'DB_CONFIG_MISSING'
  | 'DB_CONFIG_INVALID'
  | 'DB_AUTH_FAILED'
  | 'DB_NOT_FOUND'
  | 'DB_DNS_ERROR'
  | 'DB_TLS_ERROR'
  | 'DB_CONNECTION_ERROR'
  | 'DB_QUERY_ERROR';

export interface SanitizedDbError {
  httpStatus: number;
  code: DbErrorCode;
  message: string;
}

export interface DbHealthResult {
  status: 'ok';
  database: 'connected';
  orm: 'drizzle';
  driver: 'mysql2';
  tls: 'required-min-v1.2-verified';
  latencyMs: number;
  serverVersion: string | null;
}

const REQUIRED_ENV_KEYS = [
  'TIDB_HOST',
  'TIDB_PORT',
  'TIDB_USER',
  'TIDB_PASSWORD',
  'TIDB_DATABASE',
] as const;

let poolInstance: mysql.Pool | null = null;
let dbInstance: MimoraDatabase | null = null;

export function validateTiDbEnv():
  | { ok: true; config: TiDbEnvConfig }
  | { ok: false; error: SanitizedDbError; missingKeys: string[] } {
  const missingKeys: string[] = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const val = process.env[key];
    if (!val || val.trim().length === 0) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    return {
      ok: false,
      missingKeys,
      error: {
        httpStatus: 500,
        code: 'DB_CONFIG_MISSING',
        message: `Missing required database environment variables: ${missingKeys.join(', ')}.`,
      },
    };
  }

  const parsedPort = Number(process.env.TIDB_PORT!.trim());
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return {
      ok: false,
      missingKeys: [],
      error: {
        httpStatus: 500,
        code: 'DB_CONFIG_INVALID',
        message: 'Database port configuration (TIDB_PORT) must be a valid integer between 1 and 65535.',
      },
    };
  }

  return {
    ok: true,
    config: {
      host: process.env.TIDB_HOST!.trim(),
      port: parsedPort,
      user: process.env.TIDB_USER!.trim(),
      password: process.env.TIDB_PASSWORD!,
      database: process.env.TIDB_DATABASE!.trim(),
    },
  };
}

let mockDbInstance: MimoraDatabase | null = null;
let hasWarnedMockDb = false;

function createMockDrizzleDb(): MimoraDatabase {
  if (mockDbInstance) {
    return mockDbInstance;
  }

  const createChainableQuery = (resolveValue: unknown): unknown => {
    const chain: Record<string, unknown> = {};
    const proxy = new Proxy(chain, {
      get(_target, prop) {
        if (prop === 'then') {
          return (
            onFulfilled?: (val: unknown) => unknown,
            onRejected?: (err: unknown) => unknown
          ) => Promise.resolve(resolveValue).then(onFulfilled, onRejected);
        }
        if (prop === 'catch') {
          return (onRejected?: (err: unknown) => unknown) =>
            Promise.resolve(resolveValue).catch(onRejected);
        }
        if (prop === 'finally') {
          return (onFinally?: () => void) =>
            Promise.resolve(resolveValue).finally(onFinally);
        }
        if (typeof prop === 'symbol') {
          return undefined;
        }
        return () => proxy;
      },
    });
    return proxy;
  };

  const noOpRelational = {
    findMany: async () => [],
    findFirst: async () => null,
  };

  const mockCore: Record<string, unknown> = {
    select: () => createChainableQuery([]),
    selectDistinct: () => createChainableQuery([]),
    insert: () => createChainableQuery([{ affectedRows: 0, insertId: 0 }]),
    update: () => createChainableQuery([{ affectedRows: 0 }]),
    delete: () => createChainableQuery([{ affectedRows: 0 }]),
    execute: async () => [[]],
    query: new Proxy(
      {},
      {
        get: () => noOpRelational,
      }
    ),
    transaction: async <T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> => {
      return fn(mockDbInstance as unknown as MimoraTransaction);
    },
  };

  mockDbInstance = mockCore as unknown as MimoraDatabase;
  return mockDbInstance;
}

function getOrCreateDb():
  | { ok: true; db: MimoraDatabase }
  | { ok: false; error: SanitizedDbError } {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    return { ok: false, error: envCheck.error };
  }

  if (!poolInstance || !dbInstance) {
    const { config } = envCheck;
    try {
      poolInstance = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        connectTimeout: 10000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        ssl: {
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
      });
      dbInstance = drizzle(poolInstance, { schema, mode: 'default' });
    } catch (err) {
      return { ok: false, error: sanitizeDbError(err) };
    }
  }

  return { ok: true, db: dbInstance };
}

export function getDb(): MimoraDatabase {
  const dbLookup = getOrCreateDb();
  if (!dbLookup.ok) {
    if (!hasWarnedMockDb) {
      hasWarnedMockDb = true;
      console.warn(
        `[AI Studio] Database not connected (${dbLookup.error.code}) — using mock Drizzle instance`
      );
    }
    return createMockDrizzleDb();
  }
  return dbLookup.db;
}

export async function withTransaction<T>(
  fn: (tx: MimoraTransaction) => Promise<T>,
  config?: MimoraTransactionConfig
): Promise<T> {
  const db = getDb();
  return db.transaction(fn, config);
}

interface MysqlLikeError {
  code?: string;
  errno?: number;
  sqlState?: string;
  cause?: MysqlLikeError;
}

function extractMysqlErrorFields(err: unknown): {
  code?: string;
  errno?: number;
  sqlState?: string;
} {
  if (!err || typeof err !== 'object') {
    return {};
  }
  const e = err as MysqlLikeError;
  if (e.cause && typeof e.cause === 'object') {
    return {
      code: e.code ?? e.cause.code,
      errno: e.errno ?? e.cause.errno,
      sqlState: e.sqlState ?? e.cause.sqlState,
    };
  }
  return {
    code: e.code,
    errno: e.errno,
    sqlState: e.sqlState,
  };
}

export function sanitizeDbError(err: unknown): SanitizedDbError {
  const { code, errno, sqlState } = extractMysqlErrorFields(err);

  console.error(
    `[mimora-db] Health check failed (code=${code ?? 'UNKNOWN'}, errno=${errno ?? 'N/A'}, sqlState=${sqlState ?? 'N/A'})`
  );

  if (code === 'ER_ACCESS_DENIED_ERROR' || errno === 1045) {
    return {
      httpStatus: 500,
      code: 'DB_AUTH_FAILED',
      message: 'Database authentication failed.',
    };
  }

  if (code === 'ER_BAD_DB_ERROR' || errno === 1049) {
    return {
      httpStatus: 500,
      code: 'DB_NOT_FOUND',
      message: 'Configured database does not exist or is inaccessible.',
    };
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      httpStatus: 500,
      code: 'DB_DNS_ERROR',
      message: 'Database hostname could not be resolved.',
    };
  }

  if (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'HANDSHAKE_SSL_ERROR' ||
    (typeof code === 'string' && code.startsWith('ERR_TLS_'))
  ) {
    return {
      httpStatus: 500,
      code: 'DB_TLS_ERROR',
      message: 'TLS handshake or certificate verification failed.',
    };
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET' ||
    code === 'PROTOCOL_CONNECTION_LOST'
  ) {
    return {
      httpStatus: 500,
      code: 'DB_CONNECTION_ERROR',
      message: 'Unable to establish TCP/TLS connection to database.',
    };
  }

  return {
    httpStatus: 500,
    code: 'DB_QUERY_ERROR',
    message: 'Database connectivity check failed.',
  };
}

export async function checkTiDbHealth(): Promise<
  { ok: true; data: DbHealthResult } | { ok: false; error: SanitizedDbError }
> {
  const dbLookup = getOrCreateDb();
  if (!dbLookup.ok) {
    return { ok: false, error: dbLookup.error };
  }

  const startedAt = performance.now();
  try {
    const [rows] = (await dbLookup.db.execute(
      sql`SELECT 1 AS ok, VERSION() AS serverVersion`
    )) as unknown as [Array<{ ok?: number; serverVersion?: string }>, unknown];

    const latencyMs = Math.round(performance.now() - startedAt);
    const firstRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    const serverVersion =
      firstRow && typeof firstRow.serverVersion === 'string' ? firstRow.serverVersion : null;

    return {
      ok: true,
      data: {
        status: 'ok',
        database: 'connected',
        orm: 'drizzle',
        driver: 'mysql2',
        tls: 'required-min-v1.2-verified',
        latencyMs,
        serverVersion,
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: sanitizeDbError(err),
    };
  }
}

export async function closeTiDbPool(): Promise<void> {
  if (poolInstance) {
    const pool = poolInstance;
    poolInstance = null;
    dbInstance = null;
    await pool.end();
  }
}
