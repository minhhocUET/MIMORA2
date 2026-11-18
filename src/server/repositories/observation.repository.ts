import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { activityAttempts, assignments } from '../db/schema/assignments.ts';
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
import { teacherObservations } from '../db/schema/observations.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type ObservationDbOrTx = MimoraDatabase | MimoraTransaction;

export interface TeacherObservationRecord {
  id: string;
  organizationId: string;
  authorTeacherMembershipId: string;
  studentMembershipId: string;
  classId: string | null;
  assignmentId: string | null;
  attemptId: string | null;
  noteBody: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ObservationMembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  userStatus: string;
  organizationStatus: string;
}

export interface AttemptLinkTargetRecord {
  attemptId: string;
  organizationId: string;
  assignmentId: string;
  classId: string;
  studentMembershipId: string;
}

export interface AssignmentLinkTargetRecord {
  assignmentId: string;
  organizationId: string;
  classId: string;
}

export interface ClassLinkTargetRecord {
  classId: string;
  organizationId: string;
  status: string;
}

export interface ObservationRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findMembershipInOrg(
    organizationId: string,
    membershipId: string,
    executor?: ObservationDbOrTx
  ): Promise<ObservationMembershipRecord | null>;
  isTeacherAssignedToClass(
    organizationId: string,
    teacherMembershipId: string,
    classId: string,
    executor?: ObservationDbOrTx
  ): Promise<{ assigned: boolean; classStatus: string | null }>;
  isStudentActivelyEnrolledInClass(
    organizationId: string,
    studentMembershipId: string,
    classId: string,
    executor?: ObservationDbOrTx
  ): Promise<boolean>;
  hasSharedActiveTeacherStudentClass(
    organizationId: string,
    teacherMembershipId: string,
    studentMembershipId: string,
    executor?: ObservationDbOrTx
  ): Promise<boolean>;
  findAttemptWithAssignmentInOrg(
    organizationId: string,
    attemptId: string,
    executor?: ObservationDbOrTx
  ): Promise<AttemptLinkTargetRecord | null>;
  findAssignmentInOrg(
    organizationId: string,
    assignmentId: string,
    executor?: ObservationDbOrTx
  ): Promise<AssignmentLinkTargetRecord | null>;
  findClassInOrg(
    organizationId: string,
    classId: string,
    executor?: ObservationDbOrTx
  ): Promise<ClassLinkTargetRecord | null>;
  listObservationsByAuthor(params: {
    organizationId: string;
    authorTeacherMembershipId: string;
    studentMembershipId?: string;
    classId?: string;
    assignmentId?: string;
    attemptId?: string;
    page: number;
    limit: number;
  }): Promise<{ items: TeacherObservationRecord[]; total: number }>;
  findObservationByIdForAuthor(
    organizationId: string,
    authorTeacherMembershipId: string,
    observationId: string,
    executor?: ObservationDbOrTx
  ): Promise<TeacherObservationRecord | null>;
  insertObservation(
    row: typeof teacherObservations.$inferInsert,
    executor?: ObservationDbOrTx
  ): Promise<TeacherObservationRecord>;
  updateObservationForAuthor(
    params: {
      organizationId: string;
      authorTeacherMembershipId: string;
      observationId: string;
      classId: string | null;
      assignmentId: string | null;
      attemptId: string | null;
      noteBody: string;
      updatedAt: Date;
    },
    executor?: ObservationDbOrTx
  ): Promise<TeacherObservationRecord | null>;
  softDeleteObservationForAuthor(
    params: {
      organizationId: string;
      authorTeacherMembershipId: string;
      observationId: string;
      deletedAt: Date;
      updatedAt: Date;
    },
    executor?: ObservationDbOrTx
  ): Promise<boolean>;
}

export function createObservationRepository(): ObservationRepository {
  const resolveDb = (executor?: ObservationDbOrTx) => executor ?? getDb();

  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findMembershipInOrg(organizationId, membershipId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          id: organizationMemberships.id,
          organizationId: organizationMemberships.organizationId,
          userId: organizationMemberships.userId,
          role: organizationMemberships.role,
          status: organizationMemberships.status,
          userStatus: users.status,
          organizationStatus: organizations.status,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.organizationId)
        )
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.id, membershipId)
          )
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async isTeacherAssignedToClass(
      organizationId,
      teacherMembershipId,
      classId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          assignmentId: classTeachers.id,
          classStatus: classes.status,
        })
        .from(classTeachers)
        .innerJoin(
          classes,
          and(
            eq(classes.organizationId, classTeachers.organizationId),
            eq(classes.id, classTeachers.classId)
          )
        )
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.teacherMembershipId, teacherMembershipId),
            eq(classTeachers.classId, classId)
          )
        )
        .limit(1);

      if (!rows[0]) {
        return { assigned: false, classStatus: null };
      }

      return {
        assigned: true,
        classStatus: rows[0].classStatus,
      };
    },

    async isStudentActivelyEnrolledInClass(
      organizationId,
      studentMembershipId,
      classId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select({ id: classEnrollments.id })
        .from(classEnrollments)
        .where(
          and(
            eq(classEnrollments.organizationId, organizationId),
            eq(classEnrollments.studentMembershipId, studentMembershipId),
            eq(classEnrollments.classId, classId),
            eq(classEnrollments.status, 'active')
          )
        )
        .limit(1);

      return rows.length > 0;
    },

    async hasSharedActiveTeacherStudentClass(
      organizationId,
      teacherMembershipId,
      studentMembershipId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select({ classId: classes.id })
        .from(classTeachers)
        .innerJoin(
          classes,
          and(
            eq(classes.organizationId, classTeachers.organizationId),
            eq(classes.id, classTeachers.classId),
            eq(classes.status, 'active')
          )
        )
        .innerJoin(
          classEnrollments,
          and(
            eq(classEnrollments.organizationId, classTeachers.organizationId),
            eq(classEnrollments.classId, classTeachers.classId),
            eq(classEnrollments.studentMembershipId, studentMembershipId),
            eq(classEnrollments.status, 'active')
          )
        )
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.teacherMembershipId, teacherMembershipId)
          )
        )
        .limit(1);

      return rows.length > 0;
    },

    async findAttemptWithAssignmentInOrg(organizationId, attemptId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          attemptId: activityAttempts.id,
          organizationId: activityAttempts.organizationId,
          assignmentId: activityAttempts.assignmentId,
          classId: assignments.classId,
          studentMembershipId: activityAttempts.studentMembershipId,
        })
        .from(activityAttempts)
        .innerJoin(
          assignments,
          and(
            eq(assignments.organizationId, activityAttempts.organizationId),
            eq(assignments.id, activityAttempts.assignmentId)
          )
        )
        .where(
          and(
            eq(activityAttempts.organizationId, organizationId),
            eq(activityAttempts.id, attemptId)
          )
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async findAssignmentInOrg(organizationId, assignmentId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          assignmentId: assignments.id,
          organizationId: assignments.organizationId,
          classId: assignments.classId,
        })
        .from(assignments)
        .where(
          and(
            eq(assignments.organizationId, organizationId),
            eq(assignments.id, assignmentId)
          )
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async findClassInOrg(organizationId, classId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select({
          classId: classes.id,
          organizationId: classes.organizationId,
          status: classes.status,
        })
        .from(classes)
        .where(
          and(eq(classes.organizationId, organizationId), eq(classes.id, classId))
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async listObservationsByAuthor(params) {
      const db = resolveDb();
      const conditions = [
        eq(teacherObservations.organizationId, params.organizationId),
        eq(
          teacherObservations.authorTeacherMembershipId,
          params.authorTeacherMembershipId
        ),
        isNull(teacherObservations.deletedAt),
      ];

      if (params.studentMembershipId) {
        conditions.push(
          eq(teacherObservations.studentMembershipId, params.studentMembershipId)
        );
      }
      if (params.classId) {
        conditions.push(eq(teacherObservations.classId, params.classId));
      }
      if (params.assignmentId) {
        conditions.push(eq(teacherObservations.assignmentId, params.assignmentId));
      }
      if (params.attemptId) {
        conditions.push(eq(teacherObservations.attemptId, params.attemptId));
      }

      const whereClause = and(...conditions);
      const offset = (params.page - 1) * params.limit;

      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(teacherObservations)
          .where(whereClause)
          .orderBy(desc(teacherObservations.createdAt), desc(teacherObservations.id))
          .limit(params.limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(teacherObservations)
          .where(whereClause),
      ]);

      return {
        items,
        total: Number(totalRows[0]?.total ?? 0),
      };
    },

    async findObservationByIdForAuthor(
      organizationId,
      authorTeacherMembershipId,
      observationId,
      executor
    ) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(teacherObservations)
        .where(
          and(
            eq(teacherObservations.id, observationId),
            eq(teacherObservations.organizationId, organizationId),
            eq(
              teacherObservations.authorTeacherMembershipId,
              authorTeacherMembershipId
            ),
            isNull(teacherObservations.deletedAt)
          )
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async insertObservation(row, executor) {
      const db = resolveDb(executor);
      await db.insert(teacherObservations).values(row);
      return {
        id: row.id,
        organizationId: row.organizationId,
        authorTeacherMembershipId: row.authorTeacherMembershipId,
        studentMembershipId: row.studentMembershipId,
        classId: row.classId ?? null,
        assignmentId: row.assignmentId ?? null,
        attemptId: row.attemptId ?? null,
        noteBody: row.noteBody,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt ?? null,
      };
    },

    async updateObservationForAuthor(params, executor) {
      const db = resolveDb(executor);
      const [res] = (await db
        .update(teacherObservations)
        .set({
          classId: params.classId,
          assignmentId: params.assignmentId,
          attemptId: params.attemptId,
          noteBody: params.noteBody,
          updatedAt: params.updatedAt,
        })
        .where(
          and(
            eq(teacherObservations.id, params.observationId),
            eq(teacherObservations.organizationId, params.organizationId),
            eq(
              teacherObservations.authorTeacherMembershipId,
              params.authorTeacherMembershipId
            ),
            isNull(teacherObservations.deletedAt)
          )
        )) as unknown as [{ affectedRows?: number }, unknown];

      if (!res || Number(res.affectedRows ?? 0) === 0) {
        return null;
      }

      return this.findObservationByIdForAuthor(
        params.organizationId,
        params.authorTeacherMembershipId,
        params.observationId,
        executor
      );
    },

    async softDeleteObservationForAuthor(params, executor) {
      const db = resolveDb(executor);
      const [res] = (await db
        .update(teacherObservations)
        .set({
          deletedAt: params.deletedAt,
          updatedAt: params.updatedAt,
        })
        .where(
          and(
            eq(teacherObservations.id, params.observationId),
            eq(teacherObservations.organizationId, params.organizationId),
            eq(
              teacherObservations.authorTeacherMembershipId,
              params.authorTeacherMembershipId
            ),
            isNull(teacherObservations.deletedAt)
          )
        )) as unknown as [{ affectedRows?: number }, unknown];

      return Boolean(res && Number(res.affectedRows ?? 0) > 0);
    },
  };
}
