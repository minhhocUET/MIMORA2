import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { OrgRole, SessionScope } from '../db/schema/_shared.ts';
import {
  organizationMemberships,
  organizations,
  sessions,
  users,
} from '../db/schema/identity.ts';
import { getDb, withTransaction, type MimoraDatabase, type MimoraTransaction } from '../db/tidb.ts';

export type DbOrTx = MimoraDatabase | MimoraTransaction;

export interface AuthCredentialUserRecord {
  id: string;
  email: string | null;
  platformUsername: string | null;
  platformRole: string | null;
  displayName: string;
  passwordHash: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface AuthMembershipSummary {
  membershipId: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  organizationStatus: string;
  role: string;
  membershipStatus: string;
  orgUsername: string | null;
}

export interface StudentLoginLookupRecord {
  user: AuthCredentialUserRecord;
  membership: AuthMembershipSummary;
}

export interface SessionWithContextRecord {
  session: {
    id: string;
    tokenHash: string;
    userId: string;
    sessionScope: SessionScope;
    activeOrganizationId: string | null;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    lastActivityAt: Date;
    revokedAt: Date | null;
    revokedReason: string | null;
  };
  user: {
    id: string;
    email: string | null;
    platformUsername: string | null;
    platformRole: string | null;
    displayName: string;
    status: string;
    lockedUntil: Date | null;
  };
  activeOrganization: {
    id: string;
    code: string;
    name: string;
    status: string;
  } | null;
  activeMembership: {
    id: string;
    organizationId: string;
    role: string;
    orgUsername: string | null;
    status: string;
  } | null;
}

export interface CreateSessionParams {
  id: string;
  tokenHash: string;
  userId: string;
  sessionScope: SessionScope;
  activeOrganizationId: string | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  lastActivityAt: Date;
  ipPrefix: string | null;
  userAgentHash: string | null;
  createdAt: Date;
}

export interface RotateSessionParams {
  sessionId: string;
  expectedTokenHash: string;
  newTokenHash: string;
  newActiveOrganizationId: string | null;
  newSessionScope: SessionScope;
  lastActivityAt: Date;
  idleExpiresAt: Date;
}

export interface AuthRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  findUserCredentialByEmail(email: string): Promise<AuthCredentialUserRecord | null>;
  findUserCredentialByPlatformUsername(username: string): Promise<AuthCredentialUserRecord | null>;
  findUserCredentialById(userId: string): Promise<AuthCredentialUserRecord | null>;
  findStudentLoginRecord(
    organizationCode: string,
    orgUsername: string
  ): Promise<StudentLoginLookupRecord | null>;
  findMembershipsForUser(
    userId: string,
    roleFilter?: OrgRole,
    executor?: DbOrTx
  ): Promise<AuthMembershipSummary[]>;
  createSession(params: CreateSessionParams, executor?: DbOrTx): Promise<void>;
  findSessionWithContextByTokenHash(tokenHash: string): Promise<SessionWithContextRecord | null>;
  touchSessionActivity(
    sessionId: string,
    lastActivityAt: Date,
    idleExpiresAt: Date,
    executor?: DbOrTx
  ): Promise<void>;
  rotateSession(params: RotateSessionParams, executor?: DbOrTx): Promise<boolean>;
  revokeSessionById(
    sessionId: string,
    reason: string,
    revokedAt: Date,
    executor?: DbOrTx
  ): Promise<void>;
  revokeOtherActiveSessionsForUser(
    userId: string,
    exceptSessionId: string,
    reason: string,
    revokedAt: Date,
    executor?: DbOrTx
  ): Promise<number>;
  recordFailedLoginAttempt(
    userId: string,
    now: Date,
    lockoutPolicy?: { maxFailedAttempts: number; lockoutDurationMinutes: number },
    executor?: DbOrTx
  ): Promise<{ lockedNow: boolean; failedAttempts: number; lockedUntil: Date | null }>;
  recordSuccessfulLoginState(userId: string, now: Date, executor?: DbOrTx): Promise<void>;
  updateUserPasswordHash(
    userId: string,
    newPasswordHash: string,
    now: Date,
    executor?: DbOrTx
  ): Promise<void>;
}

function getExecutor(executor?: DbOrTx): DbOrTx {
  return executor ?? getDb();
}

export function createAuthRepository(): AuthRepository {
  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async findUserCredentialByEmail(email: string): Promise<AuthCredentialUserRecord | null> {
      const db = getDb();
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          platformUsername: users.platformUsername,
          platformRole: users.platformRole,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          status: users.status,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserCredentialByPlatformUsername(
      username: string
    ): Promise<AuthCredentialUserRecord | null> {
      const db = getDb();
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          platformUsername: users.platformUsername,
          platformRole: users.platformRole,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          status: users.status,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(eq(users.platformUsername, username))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserCredentialById(userId: string): Promise<AuthCredentialUserRecord | null> {
      const db = getDb();
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          platformUsername: users.platformUsername,
          platformRole: users.platformRole,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          status: users.status,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findStudentLoginRecord(
      organizationCode: string,
      orgUsername: string
    ): Promise<StudentLoginLookupRecord | null> {
      const db = getDb();
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          platformUsername: users.platformUsername,
          platformRole: users.platformRole,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          userStatus: users.status,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
          membershipId: organizationMemberships.id,
          organizationId: organizations.id,
          organizationCode: organizations.code,
          organizationName: organizations.name,
          organizationStatus: organizations.status,
          role: organizationMemberships.role,
          membershipStatus: organizationMemberships.status,
          orgUsername: organizationMemberships.orgUsername,
        })
        .from(organizations)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, organizations.id),
            eq(organizationMemberships.orgUsername, orgUsername)
          )
        )
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(eq(organizations.code, organizationCode))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        user: {
          id: row.userId,
          email: row.email,
          platformUsername: row.platformUsername,
          platformRole: row.platformRole,
          displayName: row.displayName,
          passwordHash: row.passwordHash,
          status: row.userStatus,
          failedLoginAttempts: row.failedLoginAttempts,
          lockedUntil: row.lockedUntil,
        },
        membership: {
          membershipId: row.membershipId,
          organizationId: row.organizationId,
          organizationCode: row.organizationCode,
          organizationName: row.organizationName,
          organizationStatus: row.organizationStatus,
          role: row.role,
          membershipStatus: row.membershipStatus,
          orgUsername: row.orgUsername,
        },
      };
    },

    async findMembershipsForUser(
      userId: string,
      roleFilter?: OrgRole,
      executor?: DbOrTx
    ): Promise<AuthMembershipSummary[]> {
      const db = getExecutor(executor);
      const condition = roleFilter
        ? and(
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.role, roleFilter)
          )
        : eq(organizationMemberships.userId, userId);

      return db
        .select({
          membershipId: organizationMemberships.id,
          organizationId: organizations.id,
          organizationCode: organizations.code,
          organizationName: organizations.name,
          organizationStatus: organizations.status,
          role: organizationMemberships.role,
          membershipStatus: organizationMemberships.status,
          orgUsername: organizationMemberships.orgUsername,
        })
        .from(organizationMemberships)
        .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
        .where(condition);
    },

    async createSession(params: CreateSessionParams, executor?: DbOrTx): Promise<void> {
      const db = getExecutor(executor);
      await db.insert(sessions).values({
        id: params.id,
        tokenHash: params.tokenHash,
        userId: params.userId,
        sessionScope: params.sessionScope,
        activeOrganizationId: params.activeOrganizationId,
        idleExpiresAt: params.idleExpiresAt,
        absoluteExpiresAt: params.absoluteExpiresAt,
        lastActivityAt: params.lastActivityAt,
        ipPrefix: params.ipPrefix,
        userAgentHash: params.userAgentHash,
        createdAt: params.createdAt,
      });
    },

    async findSessionWithContextByTokenHash(
      tokenHash: string
    ): Promise<SessionWithContextRecord | null> {
      const db = getDb();
      const rows = await db
        .select({
          sessionId: sessions.id,
          tokenHash: sessions.tokenHash,
          sessionUserId: sessions.userId,
          sessionScope: sessions.sessionScope,
          activeOrganizationId: sessions.activeOrganizationId,
          idleExpiresAt: sessions.idleExpiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          lastActivityAt: sessions.lastActivityAt,
          revokedAt: sessions.revokedAt,
          revokedReason: sessions.revokedReason,
          userId: users.id,
          email: users.email,
          platformUsername: users.platformUsername,
          platformRole: users.platformRole,
          displayName: users.displayName,
          userStatus: users.status,
          lockedUntil: users.lockedUntil,
          orgId: organizations.id,
          orgCode: organizations.code,
          orgName: organizations.name,
          orgStatus: organizations.status,
          membershipId: organizationMemberships.id,
          membershipOrgId: organizationMemberships.organizationId,
          membershipRole: organizationMemberships.role,
          membershipOrgUsername: organizationMemberships.orgUsername,
          membershipStatus: organizationMemberships.status,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .leftJoin(organizations, eq(organizations.id, sessions.activeOrganizationId))
        .leftJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, sessions.activeOrganizationId),
            eq(organizationMemberships.userId, sessions.userId)
          )
        )
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      if (
        row.sessionScope !== 'platform_admin' &&
        row.sessionScope !== 'teacher' &&
        row.sessionScope !== 'student'
      ) {
        return null;
      }

      return {
        session: {
          id: row.sessionId,
          tokenHash: row.tokenHash,
          userId: row.sessionUserId,
          sessionScope: row.sessionScope,
          activeOrganizationId: row.activeOrganizationId,
          idleExpiresAt: row.idleExpiresAt,
          absoluteExpiresAt: row.absoluteExpiresAt,
          lastActivityAt: row.lastActivityAt,
          revokedAt: row.revokedAt,
          revokedReason: row.revokedReason,
        },
        user: {
          id: row.userId,
          email: row.email,
          platformUsername: row.platformUsername,
          platformRole: row.platformRole,
          displayName: row.displayName,
          status: row.userStatus,
          lockedUntil: row.lockedUntil,
        },
        activeOrganization: row.orgId
          ? {
              id: row.orgId,
              code: row.orgCode!,
              name: row.orgName!,
              status: row.orgStatus!,
            }
          : null,
        activeMembership: row.membershipId
          ? {
              id: row.membershipId,
              organizationId: row.membershipOrgId!,
              role: row.membershipRole!,
              orgUsername: row.membershipOrgUsername,
              status: row.membershipStatus!,
            }
          : null,
      };
    },

    async touchSessionActivity(
      sessionId: string,
      lastActivityAt: Date,
      idleExpiresAt: Date,
      executor?: DbOrTx
    ): Promise<void> {
      const db = getExecutor(executor);
      await db
        .update(sessions)
        .set({
          lastActivityAt,
          idleExpiresAt,
        })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    },

    async rotateSession(params: RotateSessionParams, executor?: DbOrTx): Promise<boolean> {
      const db = getExecutor(executor);
      const [result] = await db
        .update(sessions)
        .set({
          tokenHash: params.newTokenHash,
          activeOrganizationId: params.newActiveOrganizationId,
          sessionScope: params.newSessionScope,
          lastActivityAt: params.lastActivityAt,
          idleExpiresAt: params.idleExpiresAt,
        })
        .where(
          and(
            eq(sessions.id, params.sessionId),
            eq(sessions.tokenHash, params.expectedTokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.absoluteExpiresAt, params.lastActivityAt)
          )
        );
      return (result.affectedRows ?? 0) > 0;
    },

    async revokeSessionById(
      sessionId: string,
      reason: string,
      revokedAt: Date,
      executor?: DbOrTx
    ): Promise<void> {
      const db = getExecutor(executor);
      await db
        .update(sessions)
        .set({
          revokedAt,
          revokedReason: reason,
        })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    },

    async revokeOtherActiveSessionsForUser(
      userId: string,
      exceptSessionId: string,
      reason: string,
      revokedAt: Date,
      executor?: DbOrTx
    ): Promise<number> {
      const db = getExecutor(executor);
      const [result] = await db
        .update(sessions)
        .set({
          revokedAt,
          revokedReason: reason,
        })
        .where(
          and(
            eq(sessions.userId, userId),
            ne(sessions.id, exceptSessionId),
            isNull(sessions.revokedAt)
          )
        );
      return result.affectedRows ?? 0;
    },

    async recordFailedLoginAttempt(
      userId: string,
      now: Date,
      lockoutPolicy?: { maxFailedAttempts: number; lockoutDurationMinutes: number },
      executor?: DbOrTx
    ): Promise<{ lockedNow: boolean; failedAttempts: number; lockedUntil: Date | null }> {
      const db = getExecutor(executor);
      await db
        .update(users)
        .set({
          failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
          updatedAt: now,
        })
        .where(eq(users.id, userId));

      const updatedRows = await db
        .select({
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const currentAttempts = updatedRows[0]?.failedLoginAttempts ?? 0;
      let lockedUntil = updatedRows[0]?.lockedUntil ?? null;
      let lockedNow = false;

      if (
        lockoutPolicy &&
        currentAttempts >= lockoutPolicy.maxFailedAttempts &&
        (!lockedUntil || lockedUntil <= now)
      ) {
        lockedUntil = new Date(
          now.getTime() + lockoutPolicy.lockoutDurationMinutes * 60 * 1000
        );
        await db
          .update(users)
          .set({
            lockedUntil,
            updatedAt: now,
          })
          .where(eq(users.id, userId));
        lockedNow = true;
      }

      return {
        lockedNow,
        failedAttempts: currentAttempts,
        lockedUntil,
      };
    },

    async recordSuccessfulLoginState(
      userId: string,
      now: Date,
      executor?: DbOrTx
    ): Promise<void> {
      const db = getExecutor(executor);
      await db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
    },

    async updateUserPasswordHash(
      userId: string,
      newPasswordHash: string,
      now: Date,
      executor?: DbOrTx
    ): Promise<void> {
      const db = getExecutor(executor);
      await db
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          passwordUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
    },
  };
}
