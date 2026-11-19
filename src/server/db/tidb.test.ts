import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { sql } from 'drizzle-orm';
import test from 'node:test';
import { parseServerConfig } from '../config/env.ts';
import { AppError } from '../http/errors.ts';
import { apiErrorHandler } from '../http/middleware.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import { CUSTOM_REQUEST_HEADER } from '../security/csrf.ts';
import {
  checkTiDbHealth,
  closeTiDbPool,
  getDatabaseMode,
  getDb,
  isMockDatabase,
  resolveDatabasePolicy,
  validateTiDbEnv,
  withTransaction,
} from './tidb.ts';

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
  'emailVerificationTokens',
  'familyWorkspaces',
  'familyMemberships',
  'familyStudents',
  'studentLinkInvitations',
  'guardianStudentLinks',
  'studentLinkInvitationStudents',
  'familyPrograms',
  'familyProgramVersions',
  'familyProgramItems',
  'familyProgramEnrollments',
  'familyActivityAttempts',
  'familyActivityAttemptTurns',
  'studentFamilyPreferences',
] as const;

const DB_ENV_KEYS = [
  'TIDB_HOST',
  'TIDB_PORT',
  'TIDB_USER',
  'TIDB_PASSWORD',
  'TIDB_DATABASE',
  'MIMORA_DB_MODE',
  'NODE_ENV',
] as const;

async function withDbEnv(
  overrides: Partial<Record<(typeof DB_ENV_KEYS)[number], string | undefined>>,
  fn: () => Promise<void> | void
): Promise<void> {
  await closeTiDbPool();
  const saved: Record<string, string | undefined> = {};
  for (const key of DB_ENV_KEYS) {
    saved[key] = process.env[key];
    if (key in overrides) {
      const val = overrides[key];
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }

  try {
    await fn();
  } finally {
    await closeTiDbPool();
    for (const key of DB_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('unconfigured mode: missing all TiDB env vars throws sanitized DB_CONFIG_MISSING without silent mock fallback', async () => {
  await withDbEnv(
    {
      TIDB_HOST: undefined,
      TIDB_PORT: undefined,
      TIDB_USER: undefined,
      TIDB_PASSWORD: undefined,
      TIDB_DATABASE: undefined,
      MIMORA_DB_MODE: undefined,
    },
    async () => {
      assert.equal(getDatabaseMode(), 'unconfigured');

      assert.throws(
        () => getDb(),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.httpStatus, 500);
          assert.equal(err.code, 'DB_CONFIG_MISSING');
          return true;
        }
      );

      await assert.rejects(
        () => withTransaction(async () => 'should-not-run'),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, 'DB_CONFIG_MISSING');
          return true;
        }
      );

      const health = await checkTiDbHealth();
      assert.equal(health.ok, false);
      if (!health.ok) {
        assert.equal(health.mode, 'unconfigured');
        assert.equal(health.database, 'disconnected');
        assert.equal(health.durablePersistence, false);
        assert.equal(health.error.code, 'DB_CONFIG_MISSING');
      }
    }
  );
});

test('partial config and invalid port/mode fail explicitly without mock fallback', async () => {
  await withDbEnv(
    {
      TIDB_HOST: 'gateway01.example.tidbcloud.com',
      TIDB_PORT: undefined,
      TIDB_USER: undefined,
      TIDB_PASSWORD: undefined,
      TIDB_DATABASE: undefined,
      MIMORA_DB_MODE: undefined,
    },
    async () => {
      const policy = resolveDatabasePolicy();
      assert.equal(policy.mode, 'unconfigured');
      assert.equal(policy.ok, false);
      if (!policy.ok) {
        assert.equal(policy.error.code, 'DB_CONFIG_MISSING');
        assert.deepEqual(policy.missingKeys, [
          'TIDB_PORT',
          'TIDB_USER',
          'TIDB_PASSWORD',
          'TIDB_DATABASE',
        ]);
      }
      assert.throws(() => getDb(), (err: unknown) => {
        return err instanceof AppError && err.code === 'DB_CONFIG_MISSING';
      });
    }
  );

  await withDbEnv(
    {
      TIDB_HOST: '127.0.0.1',
      TIDB_PORT: 'not-a-port',
      TIDB_USER: 'unit-user',
      TIDB_PASSWORD: 'unit-password',
      TIDB_DATABASE: 'test',
      MIMORA_DB_MODE: undefined,
    },
    async () => {
      assert.throws(() => getDb(), (err: unknown) => {
        return err instanceof AppError && err.code === 'DB_CONFIG_INVALID';
      });
    }
  );

  await withDbEnv(
    {
      MIMORA_DB_MODE: 'sqlite',
    },
    async () => {
      assert.throws(() => getDb(), (err: unknown) => {
        return err instanceof AppError && err.code === 'DB_CONFIG_INVALID';
      });
    }
  );
});

test('unconfigured mode never returns fake HTTP write success on persistence endpoints', async () => {
  await withDbEnv(
    {
      TIDB_HOST: undefined,
      TIDB_PORT: undefined,
      TIDB_USER: undefined,
      TIDB_PASSWORD: undefined,
      TIDB_DATABASE: undefined,
      MIMORA_DB_MODE: undefined,
    },
    async () => {
      const app = express();
      app.use('/api', express.json());

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const config = parseServerConfig({
          NODE_ENV: 'test',
          TRUSTED_ORIGINS: baseUrl,
        });

        app.use(
          '/api/v1/auth',
          createAuthRouter({
            getConfig: () => config,
          })
        );
        app.use('/api', apiErrorHandler);

        const res = await fetch(`${baseUrl}/api/v1/auth/guardian/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: baseUrl,
            [CUSTOM_REQUEST_HEADER]: '1',
          },
          body: JSON.stringify({
            displayName: 'Phụ huynh Test',
            email: 'guardian-unconfigured@example.com',
            password: 'StrongPassword123!',
          }),
        });

        assert.equal(res.status, 500);
        const body = (await res.json()) as { status: string; code: string };
        assert.equal(body.status, 'error');
        assert.equal(body.code, 'DB_CONFIG_MISSING');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );
});

test('explicit mock mode activates only via MIMORA_DB_MODE=mock outside production and health never reports TiDB connected', async () => {
  await withDbEnv(
    {
      TIDB_HOST: undefined,
      TIDB_PORT: undefined,
      TIDB_USER: undefined,
      TIDB_PASSWORD: undefined,
      TIDB_DATABASE: undefined,
      MIMORA_DB_MODE: 'mock',
      NODE_ENV: 'test',
    },
    async () => {
      assert.equal(getDatabaseMode(), 'mock');
      const db = getDb();
      assert.equal(isMockDatabase(db), true);

      const health = await checkTiDbHealth();
      assert.equal(health.ok, false);
      if (!health.ok) {
        assert.equal(health.mode, 'mock');
        assert.equal(health.database, 'mock_ephemeral');
        assert.equal(health.durablePersistence, false);
        assert.equal(health.error.code, 'DB_MOCK_MODE_ACTIVE');
        assert.equal(health.error.httpStatus, 500);
      }
    }
  );

  await withDbEnv(
    {
      MIMORA_DB_MODE: 'mock',
      NODE_ENV: 'production',
    },
    async () => {
      assert.equal(getDatabaseMode(), 'unconfigured');
      assert.throws(
        () => getDb(),
        (err: unknown) => err instanceof AppError && err.code === 'DB_CONFIG_INVALID'
      );
    }
  );
});

test('complete real TiDB config attaches all 36 schema tables and reuses singleton instance without second pool', async () => {
  await withDbEnv(
    {
      TIDB_HOST: '127.0.0.1',
      TIDB_PORT: '4000',
      TIDB_USER: 'unit-test-user',
      TIDB_PASSWORD: 'unit-test-placeholder',
      TIDB_DATABASE: 'test',
      MIMORA_DB_MODE: undefined,
    },
    async () => {
      assert.equal(getDatabaseMode(), 'tidb');
      const db = getDb();
      const dbAgain = getDb();
      assert.equal(isMockDatabase(db), false);
      assert.strictEqual(db, dbAgain, 'getDb must reuse the singleton Drizzle instance');
      assert.equal(typeof db.transaction, 'function');
      assert.equal(typeof withTransaction, 'function');

      for (const key of EXPECTED_QUERY_SCHEMA_KEYS) {
        assert.ok(key in db.query, `db.query must expose schema table '${key}'`);
      }
    }
  );
});

test('withTransaction executes read-only SELECT 1 cleanly when live TiDB env is present', async (t) => {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok || getDatabaseMode() !== 'tidb') {
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
