import { and, count, desc, eq, ne } from 'drizzle-orm';
import {
  classEnrollments,
  classes,
  classTeachers,
  studentGoals,
  studentProfiles,
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

export type GoalDbOrTx = MimoraDatabase | MimoraTransaction;

export const GOAL_STATUSES = ['active', 'achieved', 'paused', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalMembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  userStatus: string;
  organizationStatus: string;
}

export interface StudentProfileRecord {
  id: string;
  organizationId: string;
  studentMembershipId: string;
  preferredName: string | null;
  supportPreferencesJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentGoalRecord {
  id: string;
  organizationId: string;
  studentMembershipId: string;
  classId: string | null;
  createdByTeacherMembershipId: string;
  title: string;
  description: string | null;
  focusArea: string | null;
  status: string;
  targetDate: string | null;
  achievedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findMembershipInOrg(
    organizationId: string,
    membershipId: string,
    executor?: GoalDbOrTx
  ): Promise<GoalMembershipRecord | null>;
  findSharedActiveClassIds(
    organizationId: string,
    teacherMembershipId: string,
    studentMembershipId: string,
    executor?: GoalDbOrTx
  ): Promise<string[]>;
  isTeacherAssignedToActiveClass(
    organizationId: string,
    teacherMembershipId: string,
    classId: string,
    executor?: GoalDbOrTx
  ): Promise<boolean>;
  isStudentEnrolledInClass(
    organizationId: string,
    studentMembershipId: string,
    classId: string,
    executor?: GoalDbOrTx
  ): Promise<boolean>;
  findStudentProfile(
    organizationId: string,
    studentMembershipId: string,
    executor?: GoalDbOrTx
  ): Promise<StudentProfileRecord | null>;
  upsertStudentProfile(
    params: {
      id: string;
      organizationId: string;
      studentMembershipId: string;
      preferredName?: string | null;
      supportPreferencesJson?: Record<string, unknown> | null;
      hasPreferredName: boolean;
      hasSupportPreferencesJson: boolean;
      now: Date;
    },
    executor?: GoalDbOrTx
  ): Promise<StudentProfileRecord>;
  listStudentGoals(
    params: {
      organizationId: string;
      studentMembershipId: string;
      status?: GoalStatus;
      includeArchived?: boolean;
      page: number;
      limit: number;
    },
    executor?: GoalDbOrTx
  ): Promise<{ items: StudentGoalRecord[]; total: number }>;
  findStudentGoalByIdInOrg(
    organizationId: string,
    goalId: string,
    executor?: GoalDbOrTx
  ): Promise<StudentGoalRecord | null>;
  insertStudentGoal(
    row: typeof studentGoals.$inferInsert,
    executor?: GoalDbOrTx
  ): Promise<StudentGoalRecord>;
  updateStudentGoalInOrg(
    params: {
      organizationId: string;
      goalId: string;
      title?: string;
      description?: string | null;
      focusArea?: string | null;
      status?: GoalStatus;
      targetDate?: string | null;
      achievedAt?: Date | null;
      hasDescription?: boolean;
      hasFocusArea?: boolean;
      hasTargetDate?: boolean;
      hasAchievedAt?: boolean;
      now: Date;
    },
    executor?: GoalDbOrTx
  ): Promise<StudentGoalRecord | null>;
}

export function createGoalRepository(): GoalRepository {
  const resolveDb = (executor?: GoalDbOrTx) => executor ?? getDb();

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

    async findSharedActiveClassIds(
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
        );

      return rows.map((r) => r.classId);
    },

    async isTeacherAssignedToActiveClass(
      organizationId,
      teacherMembershipId,
      classId,
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
        .where(
          and(
            eq(classTeachers.organizationId, organizationId),
            eq(classTeachers.teacherMembershipId, teacherMembershipId),
            eq(classTeachers.classId, classId)
          )
        )
        .limit(1);

      return rows.length > 0;
    },

    async isStudentEnrolledInClass(
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

    async findStudentProfile(organizationId, studentMembershipId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(studentProfiles)
        .where(
          and(
            eq(studentProfiles.organizationId, organizationId),
            eq(studentProfiles.studentMembershipId, studentMembershipId)
          )
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async upsertStudentProfile(params, executor) {
      const db = resolveDb(executor);
      const existing = await this.findStudentProfile(
        params.organizationId,
        params.studentMembershipId,
        executor
      );

      if (!existing) {
        const newRow: typeof studentProfiles.$inferInsert = {
          id: params.id,
          organizationId: params.organizationId,
          studentMembershipId: params.studentMembershipId,
          preferredName: params.hasPreferredName ? params.preferredName ?? null : null,
          supportPreferencesJson: params.hasSupportPreferencesJson
            ? params.supportPreferencesJson ?? null
            : null,
          createdAt: params.now,
          updatedAt: params.now,
        };
        await db.insert(studentProfiles).values(newRow);
        return {
          id: newRow.id,
          organizationId: newRow.organizationId,
          studentMembershipId: newRow.studentMembershipId,
          preferredName: newRow.preferredName ?? null,
          supportPreferencesJson: newRow.supportPreferencesJson ?? null,
          createdAt: newRow.createdAt,
          updatedAt: newRow.updatedAt,
        };
      }

      const nextPreferredName = params.hasPreferredName
        ? params.preferredName ?? null
        : existing.preferredName;
      const nextSupportPreferences = params.hasSupportPreferencesJson
        ? params.supportPreferencesJson ?? null
        : existing.supportPreferencesJson;

      await db
        .update(studentProfiles)
        .set({
          preferredName: nextPreferredName,
          supportPreferencesJson: nextSupportPreferences,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(studentProfiles.organizationId, params.organizationId),
            eq(studentProfiles.id, existing.id)
          )
        );

      return {
        ...existing,
        preferredName: nextPreferredName,
        supportPreferencesJson: nextSupportPreferences,
        updatedAt: params.now,
      };
    },

    async listStudentGoals(params, executor) {
      const db = resolveDb(executor);
      const conditions = [
        eq(studentGoals.organizationId, params.organizationId),
        eq(studentGoals.studentMembershipId, params.studentMembershipId),
      ];

      if (params.status) {
        conditions.push(eq(studentGoals.status, params.status));
      } else if (!params.includeArchived) {
        conditions.push(ne(studentGoals.status, 'archived'));
      }

      const whereClause = and(...conditions);
      const offset = (params.page - 1) * params.limit;

      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(studentGoals)
          .where(whereClause)
          .orderBy(desc(studentGoals.createdAt), desc(studentGoals.id))
          .limit(params.limit)
          .offset(offset),
        db.select({ total: count() }).from(studentGoals).where(whereClause),
      ]);

      return {
        items,
        total: Number(totalRows[0]?.total ?? 0),
      };
    },

    async findStudentGoalByIdInOrg(organizationId, goalId, executor) {
      const db = resolveDb(executor);
      const rows = await db
        .select()
        .from(studentGoals)
        .where(
          and(
            eq(studentGoals.organizationId, organizationId),
            eq(studentGoals.id, goalId)
          )
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async insertStudentGoal(row, executor) {
      const db = resolveDb(executor);
      await db.insert(studentGoals).values(row);
      return {
        id: row.id,
        organizationId: row.organizationId,
        studentMembershipId: row.studentMembershipId,
        classId: row.classId ?? null,
        createdByTeacherMembershipId: row.createdByTeacherMembershipId,
        title: row.title,
        description: row.description ?? null,
        focusArea: row.focusArea ?? null,
        status: row.status ?? 'active',
        targetDate: row.targetDate ?? null,
        achievedAt: row.achievedAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async updateStudentGoalInOrg(params, executor) {
      const db = resolveDb(executor);
      const existing = await this.findStudentGoalByIdInOrg(
        params.organizationId,
        params.goalId,
        executor
      );
      if (!existing) {
        return null;
      }

      const nextTitle = params.title !== undefined ? params.title : existing.title;
      const nextDescription = params.hasDescription
        ? params.description ?? null
        : existing.description;
      const nextFocusArea = params.hasFocusArea
        ? params.focusArea ?? null
        : existing.focusArea;
      const nextStatus = params.status !== undefined ? params.status : existing.status;
      const nextTargetDate = params.hasTargetDate
        ? params.targetDate ?? null
        : existing.targetDate;
      const nextAchievedAt = params.hasAchievedAt
        ? params.achievedAt ?? null
        : existing.achievedAt;

      await db
        .update(studentGoals)
        .set({
          title: nextTitle,
          description: nextDescription,
          focusArea: nextFocusArea,
          status: nextStatus,
          targetDate: nextTargetDate,
          achievedAt: nextAchievedAt,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(studentGoals.organizationId, params.organizationId),
            eq(studentGoals.id, params.goalId)
          )
        );

      return {
        ...existing,
        title: nextTitle,
        description: nextDescription,
        focusArea: nextFocusArea,
        status: nextStatus,
        targetDate: nextTargetDate,
        achievedAt: nextAchievedAt,
        updatedAt: params.now,
      };
    },
  };
}
