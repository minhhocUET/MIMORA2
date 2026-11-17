import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm';
import {
  classEnrollments,
  classes,
  classTeachers,
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
import { escapeSqlLikePattern } from './org.repository.ts';

export type ClassDbOrTx = MimoraDatabase | MimoraTransaction;

export const CLASS_STATUSES = ['active', 'archived'] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

export const ENROLLMENT_STATUSES = ['active', 'transferred_out', 'archived'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export type EnrollmentEndStatus = 'transferred_out' | 'archived';

export interface ClassRecord {
  id: string;
  organizationId: string;
  name: string;
  academicYear: string | null;
  status: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassTeacherEntryRecord {
  assignmentId: string;
  teacherMembershipId: string;
  userId: string;
  displayName: string;
  email: string | null;
  membershipStatus: string;
  assignedAt: Date;
}

export interface ClassStudentRosterRecord {
  enrollmentId: string;
  studentMembershipId: string;
  userId: string;
  orgUsername: string | null;
  displayName: string;
  enrollmentStatus: string;
  membershipStatus: string;
  userStatus: string;
  enrolledAt: Date;
}

export interface MembershipRoleStatusRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  userStatus: string;
  displayName: string;
  email: string | null;
  orgUsername: string | null;
}

export interface ClassRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findOrganizationById(
    organizationId: string,
    executor?: ClassDbOrTx
  ): Promise<{ id: string; code: string; name: string; status: string } | null>;
  listClassesInOrg(params: {
    organizationId: string;
    page: number;
    limit: number;
    status?: ClassStatus;
    search?: string;
  }): Promise<{ items: ClassRecord[]; total: number }>;
  findClassByIdInOrg(
    organizationId: string,
    classId: string,
    executor?: ClassDbOrTx
  ): Promise<ClassRecord | null>;
  createClass(
    params: {
      id: string;
      organizationId: string;
      name: string;
      academicYear: string | null;
      status: ClassStatus;
      createdByUserId: string;
      now: Date;
    },
    executor?: ClassDbOrTx
  ): Promise<ClassRecord>;
  updateClass(
    params: {
      organizationId: string;
      classId: string;
      name?: string;
      academicYear?: string | null;
      status?: ClassStatus;
      now: Date;
    },
    executor?: ClassDbOrTx
  ): Promise<ClassRecord | null>;
  findMembershipsInOrgByIds(
    organizationId: string,
    membershipIds: string[],
    executor?: ClassDbOrTx
  ): Promise<MembershipRoleStatusRecord[]>;
  listClassTeachers(
    organizationId: string,
    classId: string,
    executor?: ClassDbOrTx
  ): Promise<ClassTeacherEntryRecord[]>;
  insertClassTeachers(
    rows: Array<{
      id: string;
      organizationId: string;
      classId: string;
      teacherMembershipId: string;
      assignedByUserId: string;
      createdAt: Date;
    }>,
    executor?: ClassDbOrTx
  ): Promise<void>;
  deleteClassTeachersByMembershipIds(
    organizationId: string,
    classId: string,
    teacherMembershipIds: string[],
    executor?: ClassDbOrTx
  ): Promise<void>;
  listActiveClassStudents(
    organizationId: string,
    classId: string,
    executor?: ClassDbOrTx
  ): Promise<ClassStudentRosterRecord[]>;
  insertClassEnrollments(
    rows: Array<{
      id: string;
      organizationId: string;
      classId: string;
      studentMembershipId: string;
      enrolledAt: Date;
      updatedByUserId: string;
    }>,
    executor?: ClassDbOrTx
  ): Promise<void>;
  endActiveEnrollments(
    params: {
      organizationId: string;
      classId: string;
      studentMembershipIds: string[];
      endStatus: EnrollmentEndStatus;
      endedAt: Date;
      updatedByUserId: string;
    },
    executor?: ClassDbOrTx
  ): Promise<void>;
  listAssignedClassesForTeacher(params: {
    organizationId: string;
    teacherMembershipId: string;
    page: number;
    limit: number;
    status?: ClassStatus;
  }): Promise<{ items: ClassRecord[]; total: number }>;
  isTeacherAssignedToClassInOrg(
    organizationId: string,
    classId: string,
    teacherMembershipId: string,
    executor?: ClassDbOrTx
  ): Promise<boolean>;
}

function getExecutor(executor?: ClassDbOrTx): ClassDbOrTx {
  return executor ?? getDb();
}

export function createClassRepository(): ClassRepository {
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

    async listClassesInOrg(params) {
      const db = getDb();
      const filters = [eq(classes.organizationId, params.organizationId)];
      if (params.status) {
        filters.push(eq(classes.status, params.status));
      }
      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${escapeSqlLikePattern(params.search.trim())}%`;
        filters.push(like(classes.name, pattern));
      }

      const whereClause = and(...filters);
      const offset = (params.page - 1) * params.limit;

      const [countRows, items] = await Promise.all([
        db.select({ total: count() }).from(classes).where(whereClause),
        db
          .select()
          .from(classes)
          .where(whereClause)
          .orderBy(desc(classes.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return { items, total: Number(countRows[0]?.total ?? 0) };
    },

    async findClassByIdInOrg(organizationId, classId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(classes)
        .where(and(eq(classes.organizationId, organizationId), eq(classes.id, classId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async createClass(params, executor) {
      const db = getExecutor(executor);
      await db.insert(classes).values({
        id: params.id,
        organizationId: params.organizationId,
        name: params.name,
        academicYear: params.academicYear,
        status: params.status,
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        organizationId: params.organizationId,
        name: params.name,
        academicYear: params.academicYear,
        status: params.status,
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },

    async updateClass(params, executor) {
      const db = getExecutor(executor);
      const existing = await this.findClassByIdInOrg(
        params.organizationId,
        params.classId,
        db
      );
      if (!existing) {
        return null;
      }

      const nextName = params.name ?? existing.name;
      const nextAcademicYear =
        params.academicYear !== undefined ? params.academicYear : existing.academicYear;
      const nextStatus = params.status ?? existing.status;

      await db
        .update(classes)
        .set({
          name: nextName,
          academicYear: nextAcademicYear,
          status: nextStatus,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(classes.organizationId, params.organizationId),
            eq(classes.id, params.classId)
          )
        );

      return {
        ...existing,
        name: nextName,
        academicYear: nextAcademicYear,
        status: nextStatus,
        updatedAt: params.now,
      };
    },

    async findMembershipsInOrgByIds(organizationId, membershipIds, executor) {
      if (membershipIds.length === 0) {
        return [];
      }
      const db = getExecutor(executor);
      return db
        .select({
          id: organizationMemberships.id,
          organizationId: organizationMemberships.organizationId,
          userId: organizationMemberships.userId,
          role: organizationMemberships.role,
          status: organizationMemberships.status,
          userStatus: users.status,
          displayName: users.displayName,
          email: users.email,
          orgUsername: organizationMemberships.orgUsername,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            inArray(organizationMemberships.id, membershipIds)
          )
        );
    },

    async listClassTeachers(organizationId, classId, executor) {
      const db = getExecutor(executor);
      return db
        .select({
          assignmentId: classTeachers.id,
          teacherMembershipId: classTeachers.teacherMembershipId,
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
          membershipStatus: organizationMemberships.status,
          assignedAt: classTeachers.createdAt,
        })
        .from(classTeachers)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, classTeachers.organizationId),
            eq(organizationMemberships.id, classTeachers.teacherMembershipId)
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.classId, classId)
          )
        )
        .orderBy(asc(users.displayName));
    },

    async insertClassTeachers(rows, executor) {
      if (rows.length === 0) {
        return;
      }
      const db = getExecutor(executor);
      await db.insert(classTeachers).values(rows);
    },

    async deleteClassTeachersByMembershipIds(
      organizationId,
      classId,
      teacherMembershipIds,
      executor
    ) {
      if (teacherMembershipIds.length === 0) {
        return;
      }
      const db = getExecutor(executor);
      await db
        .delete(classTeachers)
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.classId, classId),
            inArray(classTeachers.teacherMembershipId, teacherMembershipIds)
          )
        );
    },

    async listActiveClassStudents(organizationId, classId, executor) {
      const db = getExecutor(executor);
      return db
        .select({
          enrollmentId: classEnrollments.id,
          studentMembershipId: classEnrollments.studentMembershipId,
          userId: users.id,
          orgUsername: organizationMemberships.orgUsername,
          displayName: users.displayName,
          enrollmentStatus: classEnrollments.status,
          membershipStatus: organizationMemberships.status,
          userStatus: users.status,
          enrolledAt: classEnrollments.enrolledAt,
        })
        .from(classEnrollments)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, classEnrollments.organizationId),
            eq(organizationMemberships.id, classEnrollments.studentMembershipId)
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(classEnrollments.organizationId, organizationId),
            eq(classEnrollments.classId, classId),
            eq(classEnrollments.status, 'active')
          )
        )
        .orderBy(asc(users.displayName));
    },

    async insertClassEnrollments(rows, executor) {
      if (rows.length === 0) {
        return;
      }
      const db = getExecutor(executor);
      await db.insert(classEnrollments).values(
        rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          classId: r.classId,
          studentMembershipId: r.studentMembershipId,
          status: 'active',
          enrolledAt: r.enrolledAt,
          endedAt: null,
          updatedByUserId: r.updatedByUserId,
        }))
      );
    },

    async endActiveEnrollments(params, executor) {
      if (params.studentMembershipIds.length === 0) {
        return;
      }
      const db = getExecutor(executor);
      await db
        .update(classEnrollments)
        .set({
          status: params.endStatus,
          endedAt: params.endedAt,
          updatedByUserId: params.updatedByUserId,
        })
        .where(
          and(
            eq(classEnrollments.organizationId, params.organizationId),
            eq(classEnrollments.classId, params.classId),
            eq(classEnrollments.status, 'active'),
            inArray(classEnrollments.studentMembershipId, params.studentMembershipIds)
          )
        );
    },

    async listAssignedClassesForTeacher(params) {
      const db = getDb();
      const filters = [
        eq(classes.organizationId, params.organizationId),
        eq(classTeachers.teacherMembershipId, params.teacherMembershipId),
      ];
      if (params.status) {
        filters.push(eq(classes.status, params.status));
      }

      const whereClause = and(...filters);
      const offset = (params.page - 1) * params.limit;

      const [countRows, items] = await Promise.all([
        db
          .select({ total: count() })
          .from(classes)
          .innerJoin(
            classTeachers,
            and(
              eq(classTeachers.organizationId, classes.organizationId),
              eq(classTeachers.classId, classes.id)
            )
          )
          .where(whereClause),
        db
          .select({
            id: classes.id,
            organizationId: classes.organizationId,
            name: classes.name,
            academicYear: classes.academicYear,
            status: classes.status,
            createdByUserId: classes.createdByUserId,
            createdAt: classes.createdAt,
            updatedAt: classes.updatedAt,
          })
          .from(classes)
          .innerJoin(
            classTeachers,
            and(
              eq(classTeachers.organizationId, classes.organizationId),
              eq(classTeachers.classId, classes.id)
            )
          )
          .where(whereClause)
          .orderBy(desc(classes.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return { items, total: Number(countRows[0]?.total ?? 0) };
    },

    async isTeacherAssignedToClassInOrg(
      organizationId,
      classId,
      teacherMembershipId,
      executor
    ) {
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
  };
}
