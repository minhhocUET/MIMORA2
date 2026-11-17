import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  classEnrollments,
  classes,
  classTeachers,
  csvImportJobs,
} from '../db/schema/classes.ts';
import {
  organizationMemberships,
  organizations,
  users,
} from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type CsvDbOrTx = MimoraDatabase | MimoraTransaction;

export const CSV_IMPORT_STATUSES = [
  'pending',
  'validated',
  'completed',
  'failed',
] as const;
export type CsvImportJobStatus = (typeof CSV_IMPORT_STATUSES)[number];

export interface CsvImportJobRecord {
  id: string;
  organizationId: string;
  uploadedByUserId: string;
  targetClassId: string | null;
  sourceFilename: string;
  status: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  errorSummaryJson: Record<string, unknown> | Array<Record<string, unknown>> | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CsvImportRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findOrganizationById(
    organizationId: string,
    executor?: CsvDbOrTx
  ): Promise<{ id: string; code: string; name: string; status: string } | null>;
  findClassInOrg(
    organizationId: string,
    classId: string,
    executor?: CsvDbOrTx
  ): Promise<{ id: string; organizationId: string; name: string; status: string } | null>;
  isTeacherAssignedToClass(
    organizationId: string,
    classId: string,
    teacherMembershipId: string,
    executor?: CsvDbOrTx
  ): Promise<boolean>;
  findExistingOrgUsernames(
    organizationId: string,
    usernames: string[],
    executor?: CsvDbOrTx
  ): Promise<Set<string>>;
  findExistingEmails(emails: string[], executor?: CsvDbOrTx): Promise<Set<string>>;
  createImportJob(
    params: {
      id: string;
      organizationId: string;
      uploadedByUserId: string;
      targetClassId: string | null;
      sourceFilename: string;
      status: CsvImportJobStatus;
      totalRows: number;
      succeededRows: number;
      failedRows: number;
      errorSummaryJson: Record<string, unknown> | Array<Record<string, unknown>> | null;
      createdAt: Date;
      completedAt: Date | null;
    },
    executor?: CsvDbOrTx
  ): Promise<CsvImportJobRecord>;
  updateImportJob(
    params: {
      id: string;
      organizationId: string;
      status: CsvImportJobStatus;
      totalRows: number;
      succeededRows: number;
      failedRows: number;
      errorSummaryJson: Record<string, unknown> | Array<Record<string, unknown>> | null;
      completedAt: Date | null;
    },
    executor?: CsvDbOrTx
  ): Promise<void>;
  findImportJobById(
    organizationId: string,
    jobId: string
  ): Promise<CsvImportJobRecord | null>;
  listImportJobsInOrg(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<{ items: CsvImportJobRecord[]; total: number }>;
  createImportedStudent(
    params: {
      userId: string;
      membershipId: string;
      enrollmentId: string | null;
      organizationId: string;
      targetClassId: string | null;
      orgUsername: string;
      displayName: string;
      email: string | null;
      passwordHash: string;
      createdByUserId: string;
      now: Date;
    },
    executor?: CsvDbOrTx
  ): Promise<void>;
}

function getExecutor(executor?: CsvDbOrTx): CsvDbOrTx {
  return executor ?? getDb();
}

export function createCsvImportRepository(): CsvImportRepository {
  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findOrganizationById(organizationId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: organizations.id,
          code: organizations.code,
          name: organizations.name,
          status: organizations.status,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findClassInOrg(organizationId, classId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: classes.id,
          organizationId: classes.organizationId,
          name: classes.name,
          status: classes.status,
        })
        .from(classes)
        .where(and(eq(classes.organizationId, organizationId), eq(classes.id, classId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async isTeacherAssignedToClass(organizationId, classId, teacherMembershipId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select({ id: classTeachers.id })
        .from(classTeachers)
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.classId, classId),
            eq(classTeachers.teacherMembershipId, teacherMembershipId)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async findExistingOrgUsernames(organizationId, usernames, executor) {
      if (usernames.length === 0) {
        return new Set();
      }
      const db = getExecutor(executor);
      const rows = await db
        .select({ orgUsername: organizationMemberships.orgUsername })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            inArray(organizationMemberships.orgUsername, usernames)
          )
        );
      return new Set(
        rows
          .map((r) => r.orgUsername)
          .filter((val): val is string => typeof val === 'string' && val.length > 0)
      );
    },

    async findExistingEmails(emails, executor) {
      if (emails.length === 0) {
        return new Set();
      }
      const db = getExecutor(executor);
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(inArray(users.email, emails));
      return new Set(
        rows
          .map((r) => r.email?.toLowerCase())
          .filter((val): val is string => typeof val === 'string' && val.length > 0)
      );
    },

    async createImportJob(params, executor) {
      const db = getExecutor(executor);
      await db.insert(csvImportJobs).values({
        id: params.id,
        organizationId: params.organizationId,
        uploadedByUserId: params.uploadedByUserId,
        targetClassId: params.targetClassId,
        sourceFilename: params.sourceFilename,
        status: params.status,
        totalRows: params.totalRows,
        succeededRows: params.succeededRows,
        failedRows: params.failedRows,
        errorSummaryJson: params.errorSummaryJson,
        createdAt: params.createdAt,
        completedAt: params.completedAt,
      });

      return { ...params };
    },

    async updateImportJob(params, executor) {
      const db = getExecutor(executor);
      await db
        .update(csvImportJobs)
        .set({
          status: params.status,
          totalRows: params.totalRows,
          succeededRows: params.succeededRows,
          failedRows: params.failedRows,
          errorSummaryJson: params.errorSummaryJson,
          completedAt: params.completedAt,
        })
        .where(
          and(
            eq(csvImportJobs.organizationId, params.organizationId),
            eq(csvImportJobs.id, params.id)
          )
        );
    },

    async findImportJobById(organizationId, jobId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(csvImportJobs)
        .where(
          and(
            eq(csvImportJobs.organizationId, organizationId),
            eq(csvImportJobs.id, jobId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async listImportJobsInOrg(params) {
      const db = getDb();
      const whereClause = eq(csvImportJobs.organizationId, params.organizationId);
      const offset = (params.page - 1) * params.limit;

      const [countRows, items] = await Promise.all([
        db.select({ total: count() }).from(csvImportJobs).where(whereClause),
        db
          .select()
          .from(csvImportJobs)
          .where(whereClause)
          .orderBy(desc(csvImportJobs.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return { items, total: Number(countRows[0]?.total ?? 0) };
    },

    async createImportedStudent(params, executor) {
      const db = getExecutor(executor);
      await db.insert(users).values({
        id: params.userId,
        email: params.email,
        platformUsername: null,
        platformRole: null,
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        passwordUpdatedAt: params.now,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      });

      await db.insert(organizationMemberships).values({
        id: params.membershipId,
        organizationId: params.organizationId,
        userId: params.userId,
        role: 'student',
        orgUsername: params.orgUsername,
        status: 'active',
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });

      if (params.targetClassId && params.enrollmentId) {
        await db.insert(classEnrollments).values({
          id: params.enrollmentId,
          organizationId: params.organizationId,
          classId: params.targetClassId,
          studentMembershipId: params.membershipId,
          status: 'active',
          enrolledAt: params.now,
          endedAt: null,
          updatedByUserId: params.createdByUserId,
        });
      }
    },
  };
}
