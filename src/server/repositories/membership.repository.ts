import { and, count, desc, eq, isNull, like, or } from 'drizzle-orm';
import type { OrgRole } from '../db/schema/_shared.ts';
import {
  classEnrollments,
  classes,
  classTeachers,
} from '../db/schema/classes.ts';
import {
  organizationMemberships,
  organizations,
  sessions,
  users,
} from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';
import { escapeSqlLikePattern } from './org.repository.ts';

export type MembershipDbOrTx = MimoraDatabase | MimoraTransaction;

export const USER_STATUSES = ['active', 'locked', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'disabled', 'transferred'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface SafeUserRecord {
  id: string;
  email: string | null;
  platformUsername: string | null;
  platformRole: string | null;
  displayName: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  orgUsername: string | null;
  status: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembershipWithUserRecord {
  membership: OrganizationMembershipRecord;
  user: {
    id: string;
    email: string | null;
    platformUsername: string | null;
    displayName: string;
    status: string;
  };
}

export interface CreateUserParams {
  id: string;
  email: string | null;
  platformUsername: string | null;
  platformRole: 'platform_admin' | null;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  now: Date;
}

export interface UpdateUserParams {
  id: string;
  displayName?: string;
  email?: string | null;
  status?: UserStatus;
  resetLockout?: boolean;
  now: Date;
}

export interface CreateMembershipParams {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  orgUsername: string | null;
  status: 'active' | 'disabled';
  createdByUserId: string | null;
  now: Date;
}

export interface UpdateMembershipParams {
  organizationId: string;
  membershipId: string;
  orgUsername?: string | null;
  status?: 'active' | 'disabled';
  now: Date;
}

export interface MembershipRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  listUsers(params: {
    page: number;
    limit: number;
    status?: UserStatus;
    platformRole?: 'platform_admin';
    search?: string;
  }): Promise<{ items: SafeUserRecord[]; total: number }>;
  findUserById(userId: string, executor?: MembershipDbOrTx): Promise<SafeUserRecord | null>;
  findUserByEmail(email: string, executor?: MembershipDbOrTx): Promise<SafeUserRecord | null>;
  findUserByPlatformUsername(
    username: string,
    executor?: MembershipDbOrTx
  ): Promise<SafeUserRecord | null>;
  createUser(params: CreateUserParams, executor?: MembershipDbOrTx): Promise<SafeUserRecord>;
  updateUser(
    params: UpdateUserParams,
    executor?: MembershipDbOrTx
  ): Promise<SafeUserRecord | null>;
  listOrganizationMemberships(params: {
    organizationId: string;
    page: number;
    limit: number;
    role?: OrgRole;
    status?: MembershipStatus;
    search?: string;
  }): Promise<{ items: OrganizationMembershipWithUserRecord[]; total: number }>;
  findMembershipById(
    organizationId: string,
    membershipId: string,
    executor?: MembershipDbOrTx
  ): Promise<OrganizationMembershipWithUserRecord | null>;
  findMembershipByOrgAndUser(
    organizationId: string,
    userId: string,
    executor?: MembershipDbOrTx
  ): Promise<OrganizationMembershipRecord | null>;
  findMembershipByOrgAndUsername(
    organizationId: string,
    orgUsername: string,
    executor?: MembershipDbOrTx
  ): Promise<OrganizationMembershipRecord | null>;
  findMembershipsByUserId(
    userId: string,
    executor?: MembershipDbOrTx
  ): Promise<OrganizationMembershipRecord[]>;
  createMembership(
    params: CreateMembershipParams,
    executor?: MembershipDbOrTx
  ): Promise<OrganizationMembershipRecord>;
  updateMembership(
    params: UpdateMembershipParams,
    executor?: MembershipDbOrTx
  ): Promise<OrganizationMembershipRecord | null>;
  revokeSessionsForUser(
    userId: string,
    reason: string,
    revokedAt: Date,
    executor?: MembershipDbOrTx
  ): Promise<number>;
  revokeSessionsForUserInOrg(
    organizationId: string,
    userId: string,
    reason: string,
    revokedAt: Date,
    executor?: MembershipDbOrTx
  ): Promise<number>;
  findOrganizationById(
    organizationId: string,
    executor?: MembershipDbOrTx
  ): Promise<{ id: string; code: string; name: string; status: string } | null>;
  findClassInOrg(
    organizationId: string,
    classId: string,
    executor?: MembershipDbOrTx
  ): Promise<{ id: string; organizationId: string; name: string; status: string } | null>;
  isTeacherAssignedToClass(
    organizationId: string,
    classId: string,
    teacherMembershipId: string,
    executor?: MembershipDbOrTx
  ): Promise<boolean>;
  createClassEnrollment(
    params: {
      id: string;
      organizationId: string;
      classId: string;
      studentMembershipId: string;
      enrolledAt: Date;
      updatedByUserId: string;
    },
    executor?: MembershipDbOrTx
  ): Promise<void>;
}

function getExecutor(executor?: MembershipDbOrTx): MembershipDbOrTx {
  return executor ?? getDb();
}

const safeUserColumns = {
  id: users.id,
  email: users.email,
  platformUsername: users.platformUsername,
  platformRole: users.platformRole,
  displayName: users.displayName,
  status: users.status,
  failedLoginAttempts: users.failedLoginAttempts,
  lockedUntil: users.lockedUntil,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export function createMembershipRepository(): MembershipRepository {
  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async listUsers(params) {
      const db = getDb();
      const filters = [];
      if (params.status) {
        filters.push(eq(users.status, params.status));
      }
      if (params.platformRole) {
        filters.push(eq(users.platformRole, params.platformRole));
      }
      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${escapeSqlLikePattern(params.search.trim())}%`;
        filters.push(
          or(
            like(users.displayName, pattern),
            like(users.email, pattern),
            like(users.platformUsername, pattern)
          )!
        );
      }

      const whereClause = filters.length > 0 ? and(...filters) : undefined;
      const offset = (params.page - 1) * params.limit;

      const [countRows, items] = await Promise.all([
        db.select({ total: count() }).from(users).where(whereClause),
        db
          .select(safeUserColumns)
          .from(users)
          .where(whereClause)
          .orderBy(desc(users.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return { items, total: Number(countRows[0]?.total ?? 0) };
    },

    async findUserById(userId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select(safeUserColumns)
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserByEmail(email, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select(safeUserColumns)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserByPlatformUsername(username, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select(safeUserColumns)
        .from(users)
        .where(eq(users.platformUsername, username))
        .limit(1);
      return rows[0] ?? null;
    },

    async createUser(params, executor) {
      const db = getExecutor(executor);
      await db.insert(users).values({
        id: params.id,
        email: params.email,
        platformUsername: params.platformUsername,
        platformRole: params.platformRole,
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        passwordUpdatedAt: params.now,
        status: params.status,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        email: params.email,
        platformUsername: params.platformUsername,
        platformRole: params.platformRole,
        displayName: params.displayName,
        status: params.status,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },

    async updateUser(params, executor) {
      const db = getExecutor(executor);
      const existing = await this.findUserById(params.id, db);
      if (!existing) {
        return null;
      }

      const nextDisplayName = params.displayName ?? existing.displayName;
      const nextEmail = params.email !== undefined ? params.email : existing.email;
      const nextStatus = params.status ?? existing.status;
      const nextFailed = params.resetLockout ? 0 : existing.failedLoginAttempts;
      const nextLockedUntil = params.resetLockout ? null : existing.lockedUntil;

      await db
        .update(users)
        .set({
          displayName: nextDisplayName,
          email: nextEmail,
          status: nextStatus,
          failedLoginAttempts: nextFailed,
          lockedUntil: nextLockedUntil,
          updatedAt: params.now,
        })
        .where(eq(users.id, params.id));

      return {
        ...existing,
        displayName: nextDisplayName,
        email: nextEmail,
        status: nextStatus,
        failedLoginAttempts: nextFailed,
        lockedUntil: nextLockedUntil,
        updatedAt: params.now,
      };
    },

    async listOrganizationMemberships(params) {
      const db = getDb();
      const filters = [eq(organizationMemberships.organizationId, params.organizationId)];
      if (params.role) {
        filters.push(eq(organizationMemberships.role, params.role));
      }
      if (params.status) {
        filters.push(eq(organizationMemberships.status, params.status));
      }
      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${escapeSqlLikePattern(params.search.trim())}%`;
        filters.push(
          or(
            like(organizationMemberships.orgUsername, pattern),
            like(users.displayName, pattern),
            like(users.email, pattern)
          )!
        );
      }

      const whereClause = and(...filters);
      const offset = (params.page - 1) * params.limit;

      const [countRows, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(organizationMemberships)
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .where(whereClause),
        db
          .select({
            id: organizationMemberships.id,
            organizationId: organizationMemberships.organizationId,
            userId: organizationMemberships.userId,
            role: organizationMemberships.role,
            orgUsername: organizationMemberships.orgUsername,
            status: organizationMemberships.status,
            createdByUserId: organizationMemberships.createdByUserId,
            createdAt: organizationMemberships.createdAt,
            updatedAt: organizationMemberships.updatedAt,
            userEmail: users.email,
            userPlatformUsername: users.platformUsername,
            userDisplayName: users.displayName,
            userStatus: users.status,
          })
          .from(organizationMemberships)
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .where(whereClause)
          .orderBy(desc(organizationMemberships.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return {
        total: Number(countRows[0]?.total ?? 0),
        items: rows.map((row) => ({
          membership: {
            id: row.id,
            organizationId: row.organizationId,
            userId: row.userId,
            role: row.role,
            orgUsername: row.orgUsername,
            status: row.status,
            createdByUserId: row.createdByUserId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          user: {
            id: row.userId,
            email: row.userEmail,
            platformUsername: row.userPlatformUsername,
            displayName: row.userDisplayName,
            status: row.userStatus,
          },
        })),
      };
    },

    async findMembershipById(organizationId, membershipId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: organizationMemberships.id,
          organizationId: organizationMemberships.organizationId,
          userId: organizationMemberships.userId,
          role: organizationMemberships.role,
          orgUsername: organizationMemberships.orgUsername,
          status: organizationMemberships.status,
          createdByUserId: organizationMemberships.createdByUserId,
          createdAt: organizationMemberships.createdAt,
          updatedAt: organizationMemberships.updatedAt,
          userEmail: users.email,
          userPlatformUsername: users.platformUsername,
          userDisplayName: users.displayName,
          userStatus: users.status,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.id, membershipId)
          )
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        membership: {
          id: row.id,
          organizationId: row.organizationId,
          userId: row.userId,
          role: row.role,
          orgUsername: row.orgUsername,
          status: row.status,
          createdByUserId: row.createdByUserId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        user: {
          id: row.userId,
          email: row.userEmail,
          platformUsername: row.userPlatformUsername,
          displayName: row.userDisplayName,
          status: row.userStatus,
        },
      };
    },

    async findMembershipByOrgAndUser(organizationId, userId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findMembershipByOrgAndUsername(organizationId, orgUsername, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.orgUsername, orgUsername)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findMembershipsByUserId(userId, executor) {
      const db = getExecutor(executor);
      return db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, userId));
    },

    async createMembership(params, executor) {
      const db = getExecutor(executor);
      await db.insert(organizationMemberships).values({
        id: params.id,
        organizationId: params.organizationId,
        userId: params.userId,
        role: params.role,
        orgUsername: params.orgUsername,
        status: params.status,
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        organizationId: params.organizationId,
        userId: params.userId,
        role: params.role,
        orgUsername: params.orgUsername,
        status: params.status,
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },

    async updateMembership(params, executor) {
      const db = getExecutor(executor);
      const existingRows = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, params.organizationId),
            eq(organizationMemberships.id, params.membershipId)
          )
        )
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        return null;
      }

      const nextOrgUsername =
        params.orgUsername !== undefined ? params.orgUsername : existing.orgUsername;
      const nextStatus = params.status ?? existing.status;

      await db
        .update(organizationMemberships)
        .set({
          orgUsername: nextOrgUsername,
          status: nextStatus,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(organizationMemberships.organizationId, params.organizationId),
            eq(organizationMemberships.id, params.membershipId)
          )
        );

      return {
        ...existing,
        orgUsername: nextOrgUsername,
        status: nextStatus,
        updatedAt: params.now,
      };
    },

    async revokeSessionsForUser(userId, reason, revokedAt, executor) {
      const db = getExecutor(executor);
      const [result] = await db
        .update(sessions)
        .set({ revokedAt, revokedReason: reason })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      return result.affectedRows ?? 0;
    },

    async revokeSessionsForUserInOrg(organizationId, userId, reason, revokedAt, executor) {
      const db = getExecutor(executor);
      const [result] = await db
        .update(sessions)
        .set({ revokedAt, revokedReason: reason })
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.activeOrganizationId, organizationId),
            isNull(sessions.revokedAt)
          )
        );
      return result.affectedRows ?? 0;
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

    async createClassEnrollment(params, executor) {
      const db = getExecutor(executor);
      await db.insert(classEnrollments).values({
        id: params.id,
        organizationId: params.organizationId,
        classId: params.classId,
        studentMembershipId: params.studentMembershipId,
        status: 'active',
        enrolledAt: params.enrolledAt,
        endedAt: null,
        updatedByUserId: params.updatedByUserId,
      });
    },
  };
}
