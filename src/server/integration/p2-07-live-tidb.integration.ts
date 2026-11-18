import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import { parseServerConfig } from '../config/env.ts';
import {
  activityAttempts,
  activityAttemptTurns,
  assignmentItems,
  assignmentProgress,
  assignments,
  assignmentTargets,
} from '../db/schema/assignments.ts';
import { auditLogs } from '../db/schema/audit.ts';
import {
  classEnrollments,
  classes,
  classTeachers,
  studentGoals,
  studentProfiles,
} from '../db/schema/classes.ts';
import {
  contentApprovals,
  contentItems,
  contentVersions,
} from '../db/schema/content.ts';
import {
  organizationMemberships,
  organizations,
  sessions,
  users,
} from '../db/schema/identity.ts';
import { orgInsightDailySnapshots } from '../db/schema/insights.ts';
import { teacherObservations } from '../db/schema/observations.ts';
import { checkTiDbHealth, getDb, validateTiDbEnv } from '../db/tidb.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { extractDatabaseErrorMeta } from '../http/errors.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAuthRepository } from '../repositories/auth.repository.ts';
import { createAdminInsightsRouter } from '../routes/admin-insights.routes.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import { createGoalsRouters } from '../routes/goals.routes.ts';
import { createObservationsRouter } from '../routes/observations.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import { hashPassword } from '../security/password-hash.ts';
import {
  generateSessionToken,
  hashSessionToken,
} from '../security/session.ts';
import { createInsightService } from '../services/insight.service.ts';

const ALL_22_APPLICATION_TABLES = [
  'organizations',
  'users',
  'organization_memberships',
  'sessions',
  'classes',
  'class_teachers',
  'class_enrollments',
  'student_profiles',
  'student_goals',
  'csv_import_jobs',
  'content_items',
  'content_versions',
  'content_approvals',
  'assignments',
  'assignment_items',
  'assignment_targets',
  'activity_attempts',
  'activity_attempt_turns',
  'assignment_progress',
  'teacher_observations',
  'org_insight_daily_snapshots',
  'audit_logs',
] as const;

export interface P207TableCountsSnapshot {
  organizations: number;
  users: number;
  organizationMemberships: number;
  sessions: number;
  classes: number;
  classTeachers: number;
  classEnrollments: number;
  studentProfiles: number;
  studentGoals: number;
  contentItems: number;
  contentVersions: number;
  contentApprovals: number;
  assignments: number;
  assignmentItems: number;
  assignmentTargets: number;
  activityAttempts: number;
  activityAttemptTurns: number;
  assignmentProgress: number;
  teacherObservations: number;
  orgInsightDailySnapshots: number;
  auditLogs: number;
}

export interface TableSchemaParityResult {
  tableName: string;
  present: boolean;
  columnsMatched: boolean;
  primaryKeyMatched: boolean;
  uniqueKeysMatched: boolean;
  foreignKeysMatched: boolean;
  explicitIndexesMatched: boolean;
  virtualColumnsMatched: boolean;
  tidbAutoBackingIndexesCount: number;
  notes: string[];
}

export interface P207LiveTiDbReport {
  ok: boolean;
  runTag: string;
  executedAt: string;
  healthStatus: string;
  preFlightCounts: P207TableCountsSnapshot;
  postCleanupCounts: P207TableCountsSnapshot;
  residualSyntheticRows: P207TableCountsSnapshot;
  countsMatchedPreFlight: boolean;
  schemaParitySummary: {
    all22TablesVerified: boolean;
    allColumnsMatched: boolean;
    allConstraintsMatched: boolean;
    tables: TableSchemaParityResult[];
  };
  checks: Array<{
    name: string;
    status: 'PASS' | 'FAIL';
    detail: string;
  }>;
}

async function readP207TableCounts(): Promise<P207TableCountsSnapshot> {
  const db = getDb();
  const [
    [orgsRow],
    [usersRow],
    [memRow],
    [sessRow],
    [classesRow],
    [ctRow],
    [ceRow],
    [spRow],
    [sgRow],
    [ciRow],
    [cvRow],
    [caRow],
    [assignRow],
    [aiRow],
    [atRow],
    [aaRow],
    [aatRow],
    [apRow],
    [obsRow],
    [insRow],
    [auditRow],
  ] = await Promise.all([
    db.select({ n: count() }).from(organizations),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(organizationMemberships),
    db.select({ n: count() }).from(sessions),
    db.select({ n: count() }).from(classes),
    db.select({ n: count() }).from(classTeachers),
    db.select({ n: count() }).from(classEnrollments),
    db.select({ n: count() }).from(studentProfiles),
    db.select({ n: count() }).from(studentGoals),
    db.select({ n: count() }).from(contentItems),
    db.select({ n: count() }).from(contentVersions),
    db.select({ n: count() }).from(contentApprovals),
    db.select({ n: count() }).from(assignments),
    db.select({ n: count() }).from(assignmentItems),
    db.select({ n: count() }).from(assignmentTargets),
    db.select({ n: count() }).from(activityAttempts),
    db.select({ n: count() }).from(activityAttemptTurns),
    db.select({ n: count() }).from(assignmentProgress),
    db.select({ n: count() }).from(teacherObservations),
    db.select({ n: count() }).from(orgInsightDailySnapshots),
    db.select({ n: count() }).from(auditLogs),
  ]);

  return {
    organizations: Number(orgsRow?.n ?? 0),
    users: Number(usersRow?.n ?? 0),
    organizationMemberships: Number(memRow?.n ?? 0),
    sessions: Number(sessRow?.n ?? 0),
    classes: Number(classesRow?.n ?? 0),
    classTeachers: Number(ctRow?.n ?? 0),
    classEnrollments: Number(ceRow?.n ?? 0),
    studentProfiles: Number(spRow?.n ?? 0),
    studentGoals: Number(sgRow?.n ?? 0),
    contentItems: Number(ciRow?.n ?? 0),
    contentVersions: Number(cvRow?.n ?? 0),
    contentApprovals: Number(caRow?.n ?? 0),
    assignments: Number(assignRow?.n ?? 0),
    assignmentItems: Number(aiRow?.n ?? 0),
    assignmentTargets: Number(atRow?.n ?? 0),
    activityAttempts: Number(aaRow?.n ?? 0),
    activityAttemptTurns: Number(aatRow?.n ?? 0),
    assignmentProgress: Number(apRow?.n ?? 0),
    teacherObservations: Number(obsRow?.n ?? 0),
    orgInsightDailySnapshots: Number(insRow?.n ?? 0),
    auditLogs: Number(auditRow?.n ?? 0),
  };
}

interface ExpectedTableSpec {
  columns: Set<string>;
  virtualColumns: Set<string>;
  primaryKeyColumns: string;
  uniqueKeys: Set<string>;
  foreignKeys: Set<string>;
  explicitIndexes: Set<string>;
}

function parseMigrationExpectedSpecs(sqlContent: string): Map<string, ExpectedTableSpec> {
  const specs = new Map<string, ExpectedTableSpec>();
  const createTableRegex = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\);/g;
  let m: RegExpExecArray | null;
  while ((m = createTableRegex.exec(sqlContent)) !== null) {
    const tableName = m[1];
    const body = m[2];
    const columns = new Set<string>();
    const virtualColumns = new Set<string>();
    let primaryKeyColumns = '';
    const uniqueKeys = new Set<string>();
    const foreignKeys = new Set<string>();
    const explicitIndexes = new Set<string>();

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('`')) {
        const colMatch = /^`([^`]+)`/.exec(line);
        if (colMatch) {
          columns.add(colMatch[1]);
          if (line.includes('GENERATED ALWAYS AS')) {
            virtualColumns.add(colMatch[1]);
          }
        }
      } else if (line.includes('PRIMARY KEY')) {
        const pkMatch = /PRIMARY KEY\(([^)]+)\)/.exec(line);
        if (pkMatch) {
          primaryKeyColumns = pkMatch[1].replace(/`/g, '').replace(/\s+/g, '');
        }
      } else if (line.includes('UNIQUE(')) {
        const uqMatch = /CONSTRAINT `([^`]+)`/.exec(line);
        if (uqMatch) {
          uniqueKeys.add(uqMatch[1]);
        }
      }
    }

    specs.set(tableName, {
      columns,
      virtualColumns,
      primaryKeyColumns,
      uniqueKeys,
      foreignKeys,
      explicitIndexes,
    });
  }

  const fkRegex =
    /ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY/g;
  while ((m = fkRegex.exec(sqlContent)) !== null) {
    specs.get(m[1])?.foreignKeys.add(m[2]);
  }

  const idxRegex = /CREATE INDEX `([^`]+)` ON `([^`]+)`/g;
  while ((m = idxRegex.exec(sqlContent)) !== null) {
    specs.get(m[2])?.explicitIndexes.add(m[1]);
  }

  return specs;
}

async function inspectReadOnly22TableSchemaParity(): Promise<
  P207LiveTiDbReport['schemaParitySummary']
> {
  const db = getDb();
  const migrationPath = path.resolve(
    process.cwd(),
    'drizzle/0000_mimora_mvp_init.sql'
  );
  const migrationSql = await fs.readFile(migrationPath, 'utf8');
  const expectedSpecs = parseMigrationExpectedSpecs(migrationSql);

  const tables: TableSchemaParityResult[] = [];

  for (const tableName of ALL_22_APPLICATION_TABLES) {
    const expected = expectedSpecs.get(tableName);
    assert.ok(expected, `Expected SQL spec missing for table ${tableName}`);

    const [rows] = (await db.execute(
      sql.raw(`SHOW CREATE TABLE \`${tableName}\``)
    )) as unknown as [Array<Record<string, string>>, unknown];

    const createSql = rows?.[0]?.['Create Table'] ?? '';
    if (!createSql) {
      tables.push({
        tableName,
        present: false,
        columnsMatched: false,
        primaryKeyMatched: false,
        uniqueKeysMatched: false,
        foreignKeysMatched: false,
        explicitIndexesMatched: false,
        virtualColumnsMatched: false,
        tidbAutoBackingIndexesCount: 0,
        notes: ['SHOW CREATE TABLE returned empty'],
      });
      continue;
    }

    const liveCols = new Set<string>();
    const liveVirtual = new Set<string>();
    let livePk = '';
    const liveUqs = new Set<string>();
    const liveKeys = new Set<string>();
    const liveFks = new Set<string>();

    for (const rawLine of createSql.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('`')) {
        const colMatch = /^`([^`]+)`/.exec(line);
        if (colMatch) {
          liveCols.add(colMatch[1]);
          if (line.includes('GENERATED ALWAYS AS')) {
            liveVirtual.add(colMatch[1]);
          }
        }
      } else if (line.startsWith('PRIMARY KEY')) {
        const pkMatch = /PRIMARY KEY \(([^)]+)\)/.exec(line);
        if (pkMatch) {
          livePk = pkMatch[1].replace(/`/g, '').replace(/\s+/g, '');
        }
      } else if (line.startsWith('UNIQUE KEY')) {
        const uqMatch = /^UNIQUE KEY `([^`]+)`/.exec(line);
        if (uqMatch) {
          liveUqs.add(uqMatch[1]);
        }
      } else if (line.startsWith('KEY ')) {
        const keyMatch = /^KEY `([^`]+)`/.exec(line);
        if (keyMatch) {
          liveKeys.add(keyMatch[1]);
        }
      } else if (line.includes('FOREIGN KEY')) {
        const fkMatch = /CONSTRAINT `([^`]+)` FOREIGN KEY/.exec(line);
        if (fkMatch) {
          liveFks.add(fkMatch[1]);
        }
      }
    }

    const missingCols = Array.from(expected.columns).filter((c) => !liveCols.has(c));
    const extraCols = Array.from(liveCols).filter((c) => !expected.columns.has(c));
    const missingVirtual = Array.from(expected.virtualColumns).filter(
      (c) => !liveVirtual.has(c)
    );
    const missingUqs = Array.from(expected.uniqueKeys).filter((u) => !liveUqs.has(u));
    const missingFks = Array.from(expected.foreignKeys).filter((f) => !liveFks.has(f));
    const missingIdxs = Array.from(expected.explicitIndexes).filter(
      (i) => !liveKeys.has(i)
    );

    const autoBackingKeys = Array.from(liveKeys).filter(
      (k) => !expected.explicitIndexes.has(k)
    );

    const notes: string[] = [];
    if (missingCols.length) notes.push(`Missing cols: ${missingCols.join(', ')}`);
    if (extraCols.length) notes.push(`Extra cols: ${extraCols.join(', ')}`);
    if (missingVirtual.length)
      notes.push(`Missing virtual cols: ${missingVirtual.join(', ')}`);
    if (missingUqs.length) notes.push(`Missing UQs: ${missingUqs.join(', ')}`);
    if (missingFks.length) notes.push(`Missing FKs: ${missingFks.join(', ')}`);
    if (missingIdxs.length)
      notes.push(`Missing indexes: ${missingIdxs.join(', ')}`);
    if (livePk !== expected.primaryKeyColumns)
      notes.push(`PK mismatch: expected ${expected.primaryKeyColumns}, got ${livePk}`);

    tables.push({
      tableName,
      present: true,
      columnsMatched: missingCols.length === 0 && extraCols.length === 0,
      primaryKeyMatched: livePk === expected.primaryKeyColumns,
      uniqueKeysMatched: missingUqs.length === 0,
      foreignKeysMatched: missingFks.length === 0,
      explicitIndexesMatched: missingIdxs.length === 0,
      virtualColumnsMatched: missingVirtual.length === 0,
      tidbAutoBackingIndexesCount: autoBackingKeys.length,
      notes,
    });
  }

  return {
    all22TablesVerified: tables.length === 22 && tables.every((t) => t.present),
    allColumnsMatched: tables.every((t) => t.columnsMatched && t.virtualColumnsMatched),
    allConstraintsMatched: tables.every(
      (t) =>
        t.primaryKeyMatched &&
        t.uniqueKeysMatched &&
        t.foreignKeysMatched &&
        t.explicitIndexesMatched
    ),
    tables,
  };
}

function createCookieSessionClient(
  baseUrl: string,
  sessionToken: string,
  sessionId: string,
  csrfSecret?: string
) {
  const cookieHeader = `mimora_session=${encodeURIComponent(sessionToken)}`;
  const csrfToken = deriveSessionCsrfToken(sessionToken, sessionId, csrfSecret);

  return {
    async get(urlPath: string) {
      return fetch(`${baseUrl}${urlPath}`, {
        headers: {
          cookie: cookieHeader,
          [CUSTOM_REQUEST_HEADER]: '1',
          origin: baseUrl,
        },
      });
    },
    async post(urlPath: string, body?: unknown) {
      return fetch(`${baseUrl}${urlPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
          [CUSTOM_REQUEST_HEADER]: '1',
          [CSRF_TOKEN_HEADER]: csrfToken,
          origin: baseUrl,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    },
    async patch(urlPath: string, body?: unknown) {
      return fetch(`${baseUrl}${urlPath}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
          [CUSTOM_REQUEST_HEADER]: '1',
          [CSRF_TOKEN_HEADER]: csrfToken,
          origin: baseUrl,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    },
    async del(urlPath: string) {
      return fetch(`${baseUrl}${urlPath}`, {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader,
          [CUSTOM_REQUEST_HEADER]: '1',
          [CSRF_TOKEN_HEADER]: csrfToken,
          origin: baseUrl,
        },
      });
    },
  };
}

export async function runP207LiveTiDbSuite(): Promise<P207LiveTiDbReport> {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    throw new Error(`Missing TiDB env: ${envCheck.missingKeys.join(', ')}`);
  }

  const health = await checkTiDbHealth();
  if (!health.ok) {
    throw new Error(`TiDB health check failed: ${health.error.message}`);
  }

  const config = parseServerConfig();
  const db = getDb();
  const runTag = `p207test-${crypto.randomBytes(4).toString('hex')}`;
  const preFlightCounts = await readP207TableCounts();
  const checks: P207LiveTiDbReport['checks'] = [];

  const trackedOrgIds: string[] = [];
  const trackedUserIds: string[] = [];
  const trackedMembershipIds: string[] = [];
  const trackedClassIds: string[] = [];
  const trackedContentItemIds: string[] = [];
  const trackedVersionIds: string[] = [];
  const trackedAssignmentIds: string[] = [];
  const trackedAttemptIds: string[] = [];
  const trackedObservationIds: string[] = [];
  const trackedGoalIds: string[] = [];

  const now = new Date();
  const passwordHash = await hashPassword('P207-Test-Only!234');

  // 1. Read-only 22-table SHOW CREATE TABLE parity inspection
  const schemaParitySummary = await inspectReadOnly22TableSchemaParity();
  checks.push({
    name: 'READONLY_22_TABLE_SHOW_CREATE_TABLE_PARITY',
    status:
      schemaParitySummary.all22TablesVerified &&
      schemaParitySummary.allColumnsMatched &&
      schemaParitySummary.allConstraintsMatched
        ? 'PASS'
        : 'FAIL',
    detail: `Verified ${schemaParitySummary.tables.filter((t) => t.present).length}/22 tables; cols=${schemaParitySummary.allColumnsMatched}; constraints=${schemaParitySummary.allConstraintsMatched}`,
  });

  // Synthetic IDs
  const orgSmallId = generateUuidV7();
  const orgCoId = generateUuidV7();
  trackedOrgIds.push(orgSmallId, orgCoId);

  const adminUserId = generateUuidV7();
  const teacherAUserId = generateUuidV7();
  const teacherBUserId = generateUuidV7();
  const teacherUnassignedUserId = generateUuidV7();
  trackedUserIds.push(
    adminUserId,
    teacherAUserId,
    teacherBUserId,
    teacherUnassignedUserId
  );

  // 5 students in orgCoId so we can hit cohort k=5 cleanly; 4 in orgSmallId for k<5 suppression
  const smallStudentUserIds = Array.from({ length: 4 }, () => generateUuidV7());
  const cohortStudentUserIds = Array.from({ length: 5 }, () => generateUuidV7());
  trackedUserIds.push(...smallStudentUserIds, ...cohortStudentUserIds);

  const teacherAMemId = generateUuidV7();
  const teacherBMemId = generateUuidV7();
  const teacherUnassignedMemId = generateUuidV7();
  trackedMembershipIds.push(teacherAMemId, teacherBMemId, teacherUnassignedMemId);

  const smallStudentMemIds = smallStudentUserIds.map(() => generateUuidV7());
  const cohortStudentMemIds = cohortStudentUserIds.map(() => generateUuidV7());
  trackedMembershipIds.push(...smallStudentMemIds, ...cohortStudentMemIds);

  const class1Id = generateUuidV7();
  const class2Id = generateUuidV7();
  const classSmallId = generateUuidV7();
  trackedClassIds.push(class1Id, class2Id, classSmallId);

  const itemEmotionId = generateUuidV7();
  const verEmotionId = generateUuidV7();
  trackedContentItemIds.push(itemEmotionId);
  trackedVersionIds.push(verEmotionId);

  const assignAId = generateUuidV7();
  const assignBId = generateUuidV7();
  trackedAssignmentIds.push(assignAId, assignBId);

  const assignAItemId = generateUuidV7();
  const assignBItemId = generateUuidV7();
  const assignATargetId = generateUuidV7();
  const assignBTargetId = generateUuidV7();

  const attemptAId = generateUuidV7();
  const attemptBId = generateUuidV7();
  const cohortAttemptIds = cohortStudentMemIds.map(() => generateUuidV7());
  trackedAttemptIds.push(attemptAId, attemptBId, ...cohortAttemptIds);

  // Build ephemeral same-origin Express app for real HTTP + DB verification
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const liveCfg = {
    ...config,
    auth: {
      ...config.auth,
      csrfSecret:
        config.auth.csrfSecret ?? `p2-07-live-csrf-${runTag}-00000000000000`,
      trustedOrigins: [baseUrl],
    },
  };
  const authRepo = createAuthRepository();
  const authMiddlewares = createAuthMiddlewareSuite({
    repo: authRepo,
    getConfig: () => liveCfg,
  });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
    config: liveCfg,
  });

  app.use('/api/v1/auth', createAuthRouter({ getConfig: () => liveCfg }));
  app.use(
    '/api/v1/observations',
    createObservationsRouter({ authMiddlewares, authenticatedCsrf })
  );
  const { teacherStudentGoalsRouter, teacherGoalsRouter, studentGoalsRouter } =
    createGoalsRouters({ authMiddlewares, authenticatedCsrf });
  app.use('/api/v1/students', teacherStudentGoalsRouter);
  app.use('/api/v1/goals', teacherGoalsRouter);
  app.use('/api/v1/student', studentGoalsRouter);
  app.use(
    '/api/v1/admin/insights',
    createAdminInsightsRouter({ authMiddlewares })
  );
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  try {
    // Seed synthetic fixtures
    await db.insert(organizations).values([
      {
        id: orgSmallId,
        code: `${runTag.toUpperCase()}S`,
        name: `Synthetic Small ${runTag}`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: orgCoId,
        code: `${runTag.toUpperCase()}C`,
        name: `Synthetic Cohort ${runTag}`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const userRows: Array<typeof users.$inferInsert> = [
      {
        id: adminUserId,
        email: `${runTag}-admin@test.invalid`,
        platformUsername: `${runTag}_admin`,
        platformRole: 'platform_admin',
        displayName: `Admin ${runTag}`,
        passwordHash,
        passwordUpdatedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: teacherAUserId,
        email: `${runTag}-ta@test.invalid`,
        platformUsername: null,
        platformRole: null,
        displayName: `Teacher A ${runTag}`,
        passwordHash,
        passwordUpdatedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: teacherBUserId,
        email: `${runTag}-tb@test.invalid`,
        platformUsername: null,
        platformRole: null,
        displayName: `Teacher B ${runTag}`,
        passwordHash,
        passwordUpdatedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: teacherUnassignedUserId,
        email: `${runTag}-tu@test.invalid`,
        platformUsername: null,
        platformRole: null,
        displayName: `Teacher U ${runTag}`,
        passwordHash,
        passwordUpdatedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      ...smallStudentUserIds.map((id, i) => ({
        id,
        email: null,
        platformUsername: null,
        platformRole: null,
        displayName: `Small S${i} ${runTag}`,
        passwordHash,
        passwordUpdatedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })),
      ...cohortStudentUserIds.map((id, i) => ({
        id,
        email: null,
        platformUsername: null,
        platformRole: null,
        displayName: `Cohort S${i} ${runTag}`,
        passwordHash,
        passwordUpdatedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })),
    ];
    await db.insert(users).values(userRows);

    const memRows: Array<typeof organizationMemberships.$inferInsert> = [
      {
        id: teacherAMemId,
        organizationId: orgCoId,
        userId: teacherAUserId,
        role: 'teacher',
        orgUsername: null,
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: teacherBMemId,
        organizationId: orgCoId,
        userId: teacherBUserId,
        role: 'teacher',
        orgUsername: null,
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: teacherUnassignedMemId,
        organizationId: orgCoId,
        userId: teacherUnassignedUserId,
        role: 'teacher',
        orgUsername: null,
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
      ...smallStudentMemIds.map((id, i) => ({
        id,
        organizationId: orgSmallId,
        userId: smallStudentUserIds[i],
        role: 'student',
        orgUsername: `${runTag}_ss${i}`,
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      })),
      ...cohortStudentMemIds.map((id, i) => ({
        id,
        organizationId: orgCoId,
        userId: cohortStudentUserIds[i],
        role: 'student',
        orgUsername: `${runTag}_cs${i}`,
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      })),
    ];
    await db.insert(organizationMemberships).values(memRows);

    await db.insert(classes).values([
      {
        id: class1Id,
        organizationId: orgCoId,
        name: `Class 1 ${runTag}`,
        academicYear: '2026-2027',
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: class2Id,
        organizationId: orgCoId,
        name: `Class 2 ${runTag}`,
        academicYear: '2026-2027',
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: classSmallId,
        organizationId: orgSmallId,
        name: `Class Small ${runTag}`,
        academicYear: '2026-2027',
        status: 'active',
        createdByUserId: adminUserId,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(classTeachers).values([
      {
        id: generateUuidV7(),
        organizationId: orgCoId,
        classId: class1Id,
        teacherMembershipId: teacherAMemId,
        assignedByUserId: adminUserId,
        createdAt: now,
      },
      {
        id: generateUuidV7(),
        organizationId: orgCoId,
        classId: class1Id,
        teacherMembershipId: teacherBMemId,
        assignedByUserId: adminUserId,
        createdAt: now,
      },
    ]);

    await db.insert(classEnrollments).values([
      ...cohortStudentMemIds.map((memId) => ({
        id: generateUuidV7(),
        organizationId: orgCoId,
        classId: class1Id,
        studentMembershipId: memId,
        status: 'active',
        enrolledAt: now,
        updatedByUserId: adminUserId,
      })),
      ...smallStudentMemIds.map((memId) => ({
        id: generateUuidV7(),
        organizationId: orgSmallId,
        classId: classSmallId,
        studentMembershipId: memId,
        status: 'active',
        enrolledAt: now,
        updatedByUserId: adminUserId,
      })),
    ]);

    await db.insert(contentItems).values({
      id: itemEmotionId,
      slug: `${runTag}-emotion-card`,
      contentType: 'emotion_card',
      currentPublishedVersionId: null,
      createdByUserId: adminUserId,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(contentVersions).values({
      id: verEmotionId,
      contentItemId: itemEmotionId,
      versionNumber: 1,
      status: 'published',
      title: `Emotion Card ${runTag}`,
      summary: 'Synthetic emotion card',
      locale: 'vi',
      payloadJson: {
        displayTitle: 'Bình tĩnh',
        childText: 'Mình hít thở nhẹ',
        emotionKey: 'calm',
        emotionLabel: 'Bình tĩnh',
        accessibleDescription: 'Thẻ cảm xúc bình tĩnh',
      },
      metadataJson: null,
      createdByUserId: adminUserId,
      publishedByUserId: adminUserId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(contentItems)
      .set({ currentPublishedVersionId: verEmotionId })
      .where(eq(contentItems.id, itemEmotionId));

    await db.insert(assignments).values([
      {
        id: assignAId,
        organizationId: orgCoId,
        classId: class1Id,
        createdByTeacherMembershipId: teacherAMemId,
        title: `Assign A ${runTag}`,
        homePracticeInstructions: null,
        dueAt: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: assignBId,
        organizationId: orgCoId,
        classId: class1Id,
        createdByTeacherMembershipId: teacherAMemId,
        title: `Assign B ${runTag}`,
        homePracticeInstructions: null,
        dueAt: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(assignmentItems).values([
      {
        id: assignAItemId,
        organizationId: orgCoId,
        assignmentId: assignAId,
        contentVersionId: verEmotionId,
        sortOrder: 0,
        createdAt: now,
      },
      {
        id: assignBItemId,
        organizationId: orgCoId,
        assignmentId: assignBId,
        contentVersionId: verEmotionId,
        sortOrder: 0,
        createdAt: now,
      },
    ]);

    const extraCohortTargetIds = cohortStudentMemIds
      .slice(1)
      .map(() => generateUuidV7());

    await db.insert(assignmentTargets).values([
      {
        id: assignATargetId,
        organizationId: orgCoId,
        assignmentId: assignAId,
        studentMembershipId: cohortStudentMemIds[0],
        assignedAt: now,
      },
      {
        id: assignBTargetId,
        organizationId: orgCoId,
        assignmentId: assignBId,
        studentMembershipId: cohortStudentMemIds[0],
        assignedAt: now,
      },
      ...extraCohortTargetIds.map((tId, idx) => ({
        id: tId,
        organizationId: orgCoId,
        assignmentId: assignAId,
        studentMembershipId: cohortStudentMemIds[idx + 1],
        assignedAt: now,
      })),
    ]);

    const snapshotDayStr = now.toISOString().slice(0, 10);
    const snapshotTime = now;

    await db.insert(activityAttempts).values([
      {
        id: attemptAId,
        organizationId: orgCoId,
        assignmentId: assignAId,
        assignmentTargetId: assignATargetId,
        assignmentItemId: assignAItemId,
        studentMembershipId: cohortStudentMemIds[0],
        contentVersionId: verEmotionId,
        attemptNumber: 1,
        startIdempotencyKey: `${runTag}-a0`,
        status: 'completed',
        startedAt: snapshotTime,
        lastInteractedAt: snapshotTime,
        completedAt: snapshotTime,
        durationSeconds: 30,
        usedAacSupport: true,
        usedReadAloud: true,
        aacTapCount: 1,
        readAloudCount: 1,
        responseSummaryJson: null,
      },
      {
        id: attemptBId,
        organizationId: orgCoId,
        assignmentId: assignBId,
        assignmentTargetId: assignBTargetId,
        assignmentItemId: assignBItemId,
        studentMembershipId: cohortStudentMemIds[0],
        contentVersionId: verEmotionId,
        attemptNumber: 1,
        startIdempotencyKey: `${runTag}-b0`,
        status: 'completed',
        startedAt: snapshotTime,
        lastInteractedAt: snapshotTime,
        completedAt: snapshotTime,
        durationSeconds: 25,
        usedAacSupport: false,
        usedReadAloud: true,
        aacTapCount: 0,
        readAloudCount: 1,
        responseSummaryJson: null,
      },
      ...extraCohortTargetIds.map((tId, idx) => ({
        id: cohortAttemptIds[idx + 1],
        organizationId: orgCoId,
        assignmentId: assignAId,
        assignmentTargetId: tId,
        assignmentItemId: assignAItemId,
        studentMembershipId: cohortStudentMemIds[idx + 1],
        contentVersionId: verEmotionId,
        attemptNumber: 1,
        startIdempotencyKey: `${runTag}-a${idx + 1}`,
        status: 'completed',
        startedAt: snapshotTime,
        lastInteractedAt: snapshotTime,
        completedAt: snapshotTime,
        durationSeconds: 20,
        usedAacSupport: false,
        usedReadAloud: false,
        aacTapCount: 0,
        readAloudCount: 0,
        responseSummaryJson: null,
      })),
    ]);

    await db.insert(activityAttemptTurns).values({
      id: generateUuidV7(),
      organizationId: orgCoId,
      attemptId: attemptAId,
      turnIndex: 0,
      stepKey: 'reflect',
      selectedChoiceKey: 'breathe_slowly',
      selectedEmotionKey: 'calm',
      usedAac: true,
      usedReadAloud: true,
      responsePayloadJson: null,
      respondedAt: snapshotTime,
    });

    // Sessions for HTTP testing
    const rawAdminToken = generateSessionToken();
    const rawTeacherAToken = generateSessionToken();
    const rawTeacherBToken = generateSessionToken();
    const rawTeacherUToken = generateSessionToken();
    const rawStudentToken = generateSessionToken();
    const adminSessionId = generateUuidV7();
    const teacherASessionId = generateUuidV7();
    const teacherBSessionId = generateUuidV7();
    const teacherUSessionId = generateUuidV7();
    const studentSessionId = generateUuidV7();
    const idleExp = new Date(Date.now() + 3600_000);
    const absExp = new Date(Date.now() + 7200_000);

    await db.insert(sessions).values([
      {
        id: adminSessionId,
        tokenHash: hashSessionToken(rawAdminToken),
        userId: adminUserId,
        sessionScope: 'platform_admin',
        activeOrganizationId: null,
        idleExpiresAt: idleExp,
        absoluteExpiresAt: absExp,
        lastActivityAt: now,
        createdAt: now,
      },
      {
        id: teacherASessionId,
        tokenHash: hashSessionToken(rawTeacherAToken),
        userId: teacherAUserId,
        sessionScope: 'teacher',
        activeOrganizationId: orgCoId,
        idleExpiresAt: idleExp,
        absoluteExpiresAt: absExp,
        lastActivityAt: now,
        createdAt: now,
      },
      {
        id: teacherBSessionId,
        tokenHash: hashSessionToken(rawTeacherBToken),
        userId: teacherBUserId,
        sessionScope: 'teacher',
        activeOrganizationId: orgCoId,
        idleExpiresAt: idleExp,
        absoluteExpiresAt: absExp,
        lastActivityAt: now,
        createdAt: now,
      },
      {
        id: teacherUSessionId,
        tokenHash: hashSessionToken(rawTeacherUToken),
        userId: teacherUnassignedUserId,
        sessionScope: 'teacher',
        activeOrganizationId: orgCoId,
        idleExpiresAt: idleExp,
        absoluteExpiresAt: absExp,
        lastActivityAt: now,
        createdAt: now,
      },
      {
        id: studentSessionId,
        tokenHash: hashSessionToken(rawStudentToken),
        userId: cohortStudentUserIds[0],
        sessionScope: 'student',
        activeOrganizationId: orgCoId,
        idleExpiresAt: idleExp,
        absoluteExpiresAt: absExp,
        lastActivityAt: now,
        createdAt: now,
      },
    ]);

    const adminClient = createCookieSessionClient(
      baseUrl,
      rawAdminToken,
      adminSessionId,
      liveCfg.auth.csrfSecret
    );
    const teacherAClient = createCookieSessionClient(
      baseUrl,
      rawTeacherAToken,
      teacherASessionId,
      liveCfg.auth.csrfSecret
    );
    const teacherBClient = createCookieSessionClient(
      baseUrl,
      rawTeacherBToken,
      teacherBSessionId,
      liveCfg.auth.csrfSecret
    );
    const teacherUClient = createCookieSessionClient(
      baseUrl,
      rawTeacherUToken,
      teacherUSessionId,
      liveCfg.auth.csrfSecret
    );
    const studentClient = createCookieSessionClient(
      baseUrl,
      rawStudentToken,
      studentSessionId,
      liveCfg.auth.csrfSecret
    );

    // 2. Observations live HTTP + DB FK T-OBS-01..04
    const obsRes = await teacherAClient.post('/api/v1/observations', {
      studentMembershipId: cohortStudentMemIds[0],
      attemptId: attemptAId,
      noteBody: `Live TiDB observation ${runTag}`,
    });
    assert.equal(obsRes.status, 201);
    const obsBody = (await obsRes.json()) as {
      observation: { id: string; assignmentId: string; classId: string };
    };
    trackedObservationIds.push(obsBody.observation.id);
    assert.equal(obsBody.observation.assignmentId, assignAId);
    assert.equal(obsBody.observation.classId, class1Id);

    // T-OBS-01 Service rejection + DB composite FK fk_obs_attempt_assignment verification
    const badServiceObs = await teacherAClient.post('/api/v1/observations', {
      studentMembershipId: cohortStudentMemIds[0],
      assignmentId: assignAId,
      attemptId: attemptBId,
      noteBody: 'Should fail service mismatch',
    });
    assert.equal(badServiceObs.status, 422);

    let dbFkBlocked = false;
    try {
      await db.insert(teacherObservations).values({
        id: generateUuidV7(),
        organizationId: orgCoId,
        authorTeacherMembershipId: teacherAMemId,
        studentMembershipId: cohortStudentMemIds[0],
        classId: class1Id,
        assignmentId: assignAId,
        attemptId: attemptBId,
        noteBody: 'Direct SQL FK breach attempt',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    } catch (err) {
      const meta = extractDatabaseErrorMeta(err);
      if (
        meta?.code === 'ER_NO_REFERENCED_ROW_2' ||
        meta?.errno === 1452
      ) {
        dbFkBlocked = true;
      }
    }
    assert.equal(dbFkBlocked, true);

    // T-OBS-04 Co-teacher / Admin / Student isolation + soft delete
    assert.equal(
      (await teacherBClient.get(`/api/v1/observations/${obsBody.observation.id}`))
        .status,
      404
    );
    assert.equal(
      (await adminClient.get(`/api/v1/observations/${obsBody.observation.id}`))
        .status,
      403
    );
    assert.equal(
      (await studentClient.get(`/api/v1/observations/${obsBody.observation.id}`))
        .status,
      403
    );
    assert.equal(
      (await teacherAClient.del(`/api/v1/observations/${obsBody.observation.id}`))
        .status,
      200
    );
    assert.equal(
      (await teacherAClient.get(`/api/v1/observations/${obsBody.observation.id}`))
        .status,
      404
    );

    checks.push({
      name: 'LIVE_OBSERVATIONS_AUTHOR_ONLY_FK_AND_SOFT_DELETE',
      status: 'PASS',
      detail:
        'Verified attempt-linked derivation, service + TiDB fk_obs_attempt_assignment rejection (1452), co-teacher 404, admin/student 403, soft delete.',
    });

    // 3. Profiles & Goals live verification
    const profRes = await teacherAClient.patch(
      `/api/v1/students/${cohortStudentMemIds[0]}/profile`,
      {
        preferredName: `Minh ${runTag}`,
        supportPreferencesJson: { aacEnabled: true, readAloudEnabled: true },
      }
    );
    assert.equal(profRes.status, 200);

    const goalRes = await teacherAClient.post(
      `/api/v1/students/${cohortStudentMemIds[0]}/goals`,
      {
        classId: class1Id,
        title: `Live SEL Goal ${runTag}`,
        focusArea: 'emotion_awareness',
        targetDate: '2026-12-20',
      }
    );
    assert.equal(goalRes.status, 201);
    const goalJson = (await goalRes.json()) as { goal: { id: string } };
    trackedGoalIds.push(goalJson.goal.id);

    assert.equal(
      (
        await teacherUClient.get(
          `/api/v1/students/${cohortStudentMemIds[0]}/profile`
        )
      ).status,
      403
    );
    const selfProf = await studentClient.get('/api/v1/student/profile');
    assert.equal(selfProf.status, 200);
    const selfGoals = await studentClient.get('/api/v1/student/goals');
    assert.equal(selfGoals.status, 200);
    assert.equal(((await selfGoals.json()) as { items: unknown[] }).items.length, 1);

    checks.push({
      name: 'LIVE_PROFILES_AND_SEL_GOALS',
      status: 'PASS',
      detail:
        'Verified assigned teacher profile/goal write, unassigned teacher 403, and student self-only read endpoints.',
    });

    // 4. Live Insights snapshot calculation + k=5 cohort threshold + anti-differencing
    const insightSvc = createInsightService();
    await insightSvc.computeAndUpsertOrgInsightSnapshots({
      organizationId: orgSmallId,
      periodType: 'daily',
      snapshotDate: snapshotDayStr,
    });
    await insightSvc.computeAndUpsertOrgInsightSnapshots({
      organizationId: orgCoId,
      periodType: 'daily',
      snapshotDate: snapshotDayStr,
    });

    // Small org (4 eligible) suppressed
    const smallRes = await adminClient.get(
      `/api/v1/admin/insights?organizationId=${orgSmallId}&periodType=daily&snapshotDate=${snapshotDayStr}`
    );
    assert.equal(smallRes.status, 200);
    const smallJson = (await smallRes.json()) as {
      insights: {
        platformSummary: {
          suppression: { isSuppressed: boolean };
          participation: { activeStudentsCount: number | null };
        };
      };
    };
    assert.equal(smallJson.insights.platformSummary.suppression.isSuppressed, true);
    assert.equal(
      smallJson.insights.platformSummary.participation.activeStudentsCount,
      null
    );

    // Cohort org (5 eligible, 5 active) passes overall, suppresses breakdown
    const coRes = await adminClient.get(
      `/api/v1/admin/insights?organizationId=${orgCoId}&periodType=daily&snapshotDate=${snapshotDayStr}`
    );
    assert.equal(coRes.status, 200);
    const coJson = (await coRes.json()) as {
      insights: {
        platformSummary: {
          suppression: { isSuppressed: boolean };
          participation: { activeStudentsCount: number | null };
          goals: { activeGoalsCount: number | null };
        };
        organizations: Array<{
          byContentType: Array<{ suppression: { isSuppressed: boolean } }>;
        }>;
      };
    };
    assert.equal(coJson.insights.platformSummary.suppression.isSuppressed, false);
    assert.equal(
      coJson.insights.platformSummary.participation.activeStudentsCount,
      5
    );
    assert.equal(coJson.insights.platformSummary.goals.activeGoalsCount, 1);
    assert.equal(
      coJson.insights.organizations[0].byContentType.every(
        (c) => c.suppression.isSuppressed
      ),
      true
    );

    // Non-admin blocked + anti-differencing rejected
    assert.equal(
      (await teacherAClient.get('/api/v1/admin/insights')).status,
      403
    );
    assert.equal(
      (
        await adminClient.get(
          `/api/v1/admin/insights?studentId=${cohortStudentMemIds[0]}`
        )
      ).status,
      422
    );

    checks.push({
      name: 'LIVE_ADMIN_INSIGHTS_K5_AND_ANTI_DIFFERENCING',
      status: 'PASS',
      detail:
        'Verified live snapshot rollup, org cohort=4 suppressed (null), org cohort=5 visible, non-admin 403, anti-differencing filter 422.',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Reverse-FK cleanup of all synthetic rows
    if (trackedOrgIds.length > 0) {
      await db
        .delete(orgInsightDailySnapshots)
        .where(inArray(orgInsightDailySnapshots.organizationId, trackedOrgIds));
      await db
        .delete(teacherObservations)
        .where(inArray(teacherObservations.organizationId, trackedOrgIds));
      await db
        .delete(studentGoals)
        .where(inArray(studentGoals.organizationId, trackedOrgIds));
      await db
        .delete(studentProfiles)
        .where(inArray(studentProfiles.organizationId, trackedOrgIds));
      await db
        .delete(auditLogs)
        .where(
          or(
            inArray(auditLogs.organizationId, trackedOrgIds),
            inArray(auditLogs.actorUserId, trackedUserIds)
          )
        );
      await db
        .delete(assignmentProgress)
        .where(inArray(assignmentProgress.organizationId, trackedOrgIds));
      await db
        .delete(activityAttemptTurns)
        .where(inArray(activityAttemptTurns.organizationId, trackedOrgIds));
      await db
        .delete(activityAttempts)
        .where(inArray(activityAttempts.organizationId, trackedOrgIds));
      await db
        .delete(assignmentTargets)
        .where(inArray(assignmentTargets.organizationId, trackedOrgIds));
      await db
        .delete(assignmentItems)
        .where(inArray(assignmentItems.organizationId, trackedOrgIds));
      await db
        .delete(assignments)
        .where(inArray(assignments.organizationId, trackedOrgIds));
    }
    if (trackedUserIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
    }
    if (trackedContentItemIds.length > 0) {
      await db
        .update(contentItems)
        .set({ currentPublishedVersionId: null })
        .where(inArray(contentItems.id, trackedContentItemIds));
    }
    if (trackedVersionIds.length > 0) {
      await db
        .delete(contentApprovals)
        .where(inArray(contentApprovals.contentVersionId, trackedVersionIds));
      await db
        .delete(contentVersions)
        .where(inArray(contentVersions.id, trackedVersionIds));
    }
    if (trackedContentItemIds.length > 0) {
      await db
        .delete(contentItems)
        .where(inArray(contentItems.id, trackedContentItemIds));
    }
    if (trackedClassIds.length > 0) {
      await db
        .delete(classEnrollments)
        .where(inArray(classEnrollments.classId, trackedClassIds));
      await db
        .delete(classTeachers)
        .where(inArray(classTeachers.classId, trackedClassIds));
      await db.delete(classes).where(inArray(classes.id, trackedClassIds));
    }
    if (trackedMembershipIds.length > 0) {
      await db
        .delete(organizationMemberships)
        .where(inArray(organizationMemberships.id, trackedMembershipIds));
    }
    if (trackedUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, trackedUserIds));
    }
    if (trackedOrgIds.length > 0) {
      await db
        .delete(organizations)
        .where(inArray(organizations.id, trackedOrgIds));
    }
  }

  // Residual synthetic verification
  const [
    [rOrgs],
    [rUsers],
    [rMem],
    [rSess],
    [rClasses],
    [rCt],
    [rCe],
    [rSp],
    [rSg],
    [rCi],
    [rCv],
    [rCa],
    [rAssign],
    [rAi],
    [rAt],
    [rAa],
    [rAat],
    [rAp],
    [rObs],
    [rIns],
    [rAudit],
  ] = await Promise.all([
    db.select({ n: count() }).from(organizations).where(inArray(organizations.id, trackedOrgIds)),
    db.select({ n: count() }).from(users).where(inArray(users.id, trackedUserIds)),
    db.select({ n: count() }).from(organizationMemberships).where(inArray(organizationMemberships.id, trackedMembershipIds)),
    db.select({ n: count() }).from(sessions).where(inArray(sessions.userId, trackedUserIds)),
    db.select({ n: count() }).from(classes).where(inArray(classes.id, trackedClassIds)),
    db.select({ n: count() }).from(classTeachers).where(inArray(classTeachers.classId, trackedClassIds)),
    db.select({ n: count() }).from(classEnrollments).where(inArray(classEnrollments.classId, trackedClassIds)),
    db.select({ n: count() }).from(studentProfiles).where(inArray(studentProfiles.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(studentGoals).where(inArray(studentGoals.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(contentItems).where(inArray(contentItems.id, trackedContentItemIds)),
    db.select({ n: count() }).from(contentVersions).where(inArray(contentVersions.id, trackedVersionIds)),
    db.select({ n: count() }).from(contentApprovals).where(inArray(contentApprovals.contentVersionId, trackedVersionIds)),
    db.select({ n: count() }).from(assignments).where(inArray(assignments.id, trackedAssignmentIds)),
    db.select({ n: count() }).from(assignmentItems).where(inArray(assignmentItems.assignmentId, trackedAssignmentIds)),
    db.select({ n: count() }).from(assignmentTargets).where(inArray(assignmentTargets.assignmentId, trackedAssignmentIds)),
    db.select({ n: count() }).from(activityAttempts).where(inArray(activityAttempts.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(activityAttemptTurns).where(inArray(activityAttemptTurns.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(assignmentProgress).where(inArray(assignmentProgress.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(teacherObservations).where(inArray(teacherObservations.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(orgInsightDailySnapshots).where(inArray(orgInsightDailySnapshots.organizationId, trackedOrgIds)),
    db.select({ n: count() }).from(auditLogs).where(or(inArray(auditLogs.organizationId, trackedOrgIds), inArray(auditLogs.actorUserId, trackedUserIds))),
  ]);

  const residualSyntheticRows: P207TableCountsSnapshot = {
    organizations: Number(rOrgs?.n ?? 0),
    users: Number(rUsers?.n ?? 0),
    organizationMemberships: Number(rMem?.n ?? 0),
    sessions: Number(rSess?.n ?? 0),
    classes: Number(rClasses?.n ?? 0),
    classTeachers: Number(rCt?.n ?? 0),
    classEnrollments: Number(rCe?.n ?? 0),
    studentProfiles: Number(rSp?.n ?? 0),
    studentGoals: Number(rSg?.n ?? 0),
    contentItems: Number(rCi?.n ?? 0),
    contentVersions: Number(rCv?.n ?? 0),
    contentApprovals: Number(rCa?.n ?? 0),
    assignments: Number(rAssign?.n ?? 0),
    assignmentItems: Number(rAi?.n ?? 0),
    assignmentTargets: Number(rAt?.n ?? 0),
    activityAttempts: Number(rAa?.n ?? 0),
    activityAttemptTurns: Number(rAat?.n ?? 0),
    assignmentProgress: Number(rAp?.n ?? 0),
    teacherObservations: Number(rObs?.n ?? 0),
    orgInsightDailySnapshots: Number(rIns?.n ?? 0),
    auditLogs: Number(rAudit?.n ?? 0),
  };

  const postCleanupCounts = await readP207TableCounts();
  const countsMatchedPreFlight =
    JSON.stringify(preFlightCounts) === JSON.stringify(postCleanupCounts);
  const zeroResiduals = Object.values(residualSyntheticRows).every(
    (v) => v === 0
  );

  return {
    ok:
      checks.every((c) => c.status === 'PASS') &&
      countsMatchedPreFlight &&
      zeroResiduals,
    runTag,
    executedAt: new Date().toISOString(),
    healthStatus: health.data.serverVersion ?? 'connected',
    preFlightCounts,
    postCleanupCounts,
    residualSyntheticRows,
    countsMatchedPreFlight,
    schemaParitySummary,
    checks,
  };
}
