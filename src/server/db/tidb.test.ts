import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import test from 'node:test';
import { AppError } from '../http/errors.ts';
import { closeTiDbPool, getDb, validateTiDbEnv, withTransaction } from './tidb.ts';

const EXPECTED_QUERY_SCHEMA_KEYS = [
  'organizations',
  'users',
  'organizationMemberships',
  'sessions',
  'classes',
  'classTeachers',
  'classEnrollments',
  'studentProfiles',
  'studentGoals',
  'csvImportJobs',
  'contentItems',
  'contentVersions',
  'contentApprovals',
  'assignments',
  'assignmentItems',
  'assignmentTargets',
  'activityAttempts',
  'activityAttemptTurns',
  'assignmentProgress',
  'teacherObservations',
  'orgInsightDailySnapshots',
  'auditLogs',
] as const;

test('getDb throws sanitized AppError when TiDB env configuration is missing', async () => {
  await closeTiDbPool();
  const savedHost = process.env.TIDB_HOST;
  delete process.env.TIDB_HOST;

  try {
    assert.throws(
      () => getDb(),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.httpStatus, 500);
        assert.equal(err.code, 'DB_CONFIG_MISSING');
        return true;
      }
    );
  } finally {
    if (savedHost !== undefined) {
      process.env.TIDB_HOST = savedHost;
    }
  }
});

test('getDb attaches all 22 schema tables and reuses singleton instance without second pool', async () => {
  await closeTiDbPool();
  const saved = {
    host: process.env.TIDB_HOST,
    port: process.env.TIDB_PORT,
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE,
  };

  process.env.TIDB_HOST = '127.0.0.1';
  process.env.TIDB_PORT = '4000';
  process.env.TIDB_USER = 'unit-test-user';
  process.env.TIDB_PASSWORD = 'unit-test-placeholder';
  process.env.TIDB_DATABASE = 'test';

  try {
    const db = getDb();
    const dbAgain = getDb();
    assert.strictEqual(db, dbAgain, 'getDb must reuse the singleton Drizzle instance');
    assert.equal(typeof db.transaction, 'function');
    assert.equal(typeof withTransaction, 'function');

    for (const key of EXPECTED_QUERY_SCHEMA_KEYS) {
      assert.ok(key in db.query, `db.query must expose schema table '${key}'`);
    }
  } finally {
    await closeTiDbPool();
    if (saved.host === undefined) delete process.env.TIDB_HOST;
    else process.env.TIDB_HOST = saved.host;
    if (saved.port === undefined) delete process.env.TIDB_PORT;
    else process.env.TIDB_PORT = saved.port;
    if (saved.user === undefined) delete process.env.TIDB_USER;
    else process.env.TIDB_USER = saved.user;
    if (saved.password === undefined) delete process.env.TIDB_PASSWORD;
    else process.env.TIDB_PASSWORD = saved.password;
    if (saved.database === undefined) delete process.env.TIDB_DATABASE;
    else process.env.TIDB_DATABASE = saved.database;
  }
});

test('withTransaction executes read-only SELECT 1 cleanly when live TiDB env is present', async (t) => {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    t.skip('Live TiDB env not configured in this test subshell');
    return;
  }

  try {
    const txResult = await withTransaction(async (tx) => {
      const [rows] = (await tx.execute(sql`SELECT 1 AS ok`)) as unknown as [
        Array<{ ok?: number }>,
        unknown,
      ];
      return rows[0]?.ok;
    });
    assert.equal(txResult, 1);
  } finally {
    await closeTiDbPool();
  }
});
