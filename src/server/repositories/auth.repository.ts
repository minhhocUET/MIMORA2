import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { OrgRole, SessionScope } from '../db/schema/_shared.ts';
import {
  emailVerificationTokens,
  familyStudents,
  familyWorkspaces,
  guardianStudentLinks,
} from '../db/schema/family.ts';
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
  emailVerifiedAt?: Date | null;
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

export interface FamilyStudentLoginLookupRecord {
  user: AuthCredentialUserRecord;
  familyWorkspace: {
    id: string;
    code: string;
    name: string;
    status: string;
  };
  familyStudent: {
    id: string;
    familyWorkspaceId: string;
    studentUserId: string;
    familyUsername: string;
    status: string;
  };
  hasActiveGuardianLink: boolean;
}

export interface EmailVerificationTokenRecord {
  id: string;
  userId: string;
  purpose: string;
  emailSnapshot: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
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
    emailVerifiedAt?: Date | null;
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
  hasActiveFamilyStudentContext?: boolean;
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
  findFamilyStudentLoginRecord?(
    workspaceCode: string,
    familyUsername: string
  ): Promise<FamilyStudentLoginLookupRecord | null>;
  createGuardianUser?(
    params: {
      id: string;
      email: string;
      displayName: string;
      passwordHash: string;
      now: Date;
    },
    executor?: DbOrTx
  ): Promise<AuthCredentialUserRecord>;
  createEmailVerificationToken?(
    params: {
      id: string;
      userId: string;
      purpose: string;
      emailSnapshot: string;
      tokenHash: string;
      expiresAt: Date;
      createdAt: Date;
    },
    executor?: DbOrTx
  ): Promise<void>;
  revokeActiveVerificationTokensForUser?(
    userId: string,
    purpose: string,
    now: Date,
    executor?: DbOrTx
  ): Promise<void>;
  findVerificationTokenByHash?(
    tokenHash: string,
    executor?: DbOrTx
  ): Promise<EmailVerificationTokenRecord | null>;
  consumeVerificationTokenAndVerifyUser?(
    params: {
      tokenId: string;
      userId: string;
      now: Date;
    },
    executor?: DbOrTx
  ): Promise<boolean>;
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
          emailVerifiedAt: users.emailVerifiedAt,
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
          emailVerifiedAt: users.emailVerifiedAt,
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
          emailVerifiedAt: users.emailVerifiedAt,
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
          emailVerifiedAt: users.emailVerifiedAt,
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
          emailVerifiedAt: row.emailVerifiedAt,
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

    async findFamilyStudentLoginRecord(
      workspaceCode: string,
      familyUsername: string
    ): Promise<FamilyStudentLoginLookupRecord | null> {
      const db = getDb();
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          emailVerifiedAt: users.emailVerifiedAt,
          platformUsername: users.platformUsername,
          platformRole: users.platformRole,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          userStatus: users.status,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
          workspaceId: familyWorkspaces.id,
          workspaceCode: familyWorkspaces.code,
          workspaceName: familyWorkspaces.name,
          workspaceStatus: familyWorkspaces.status,
          familyStudentId: familyStudents.id,
          familyWorkspaceId: familyStudents.familyWorkspaceId,
          studentUserId: familyStudents.studentUserId,
          familyUsername: familyStudents.familyUsername,
          familyStudentStatus: familyStudents.status,
        })
        .from(familyWorkspaces)
        .innerJoin(
          familyStudents,
          and(
            eq(familyStudents.familyWorkspaceId, familyWorkspaces.id),
            eq(familyStudents.familyUsername, familyUsername)
          )
        )
        .innerJoin(users, eq(users.id, familyStudents.studentUserId))
        .where(eq(familyWorkspaces.code, workspaceCode))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      const activeLinks = await db
        .select({ id: guardianStudentLinks.id })
        .from(guardianStudentLinks)
        .where(
          and(
            eq(guardianStudentLinks.familyWorkspaceId, row.workspaceId),
            eq(guardianStudentLinks.studentUserId, row.userId),
            eq(guardianStudentLinks.relationshipStatus, 'active')
          )
        )
        .limit(1);

      return {
        user: {
          id: row.userId,
          email: row.email,
          emailVerifiedAt: row.emailVerifiedAt,
          platformUsername: row.platformUsername,
          platformRole: row.platformRole,
          displayName: row.displayName,
          passwordHash: row.passwordHash,
          status: row.userStatus,
          failedLoginAttempts: row.failedLoginAttempts,
          lockedUntil: row.lockedUntil,
        },
        familyWorkspace: {
          id: row.workspaceId,
          code: row.workspaceCode,
          name: row.workspaceName,
          status: row.workspaceStatus,
        },
        familyStudent: {
          id: row.familyStudentId,
          familyWorkspaceId: row.familyWorkspaceId,
          studentUserId: row.studentUserId,
          familyUsername: row.familyUsername,
          status: row.familyStudentStatus,
        },
        hasActiveGuardianLink: activeLinks.length > 0,
      };
    },

    async createGuardianUser(params, executor) {
      const db = getExecutor(executor);
      const row: typeof users.$inferInsert = {
        id: params.id,
        email: params.email,
        emailVerifiedAt: null,
        platformUsername: null,
        displayName: params.displayName,
        platformRole: 'guardian',
        passwordHash: params.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        passwordUpdatedAt: params.now,
        createdAt: params.now,
        updatedAt: params.now,
      };
      await db.insert(users).values(row);
      return {
        id: row.id,
        email: row.email ?? null,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: 'guardian',
        displayName: row.displayName,
        passwordHash: row.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
    },

    async createEmailVerificationToken(params, executor) {
      const db = getExecutor(executor);
      await db.insert(emailVerificationTokens).values({
        id: params.id,
        userId: params.userId,
        purpose: params.purpose,
        emailSnapshot: params.emailSnapshot,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
        consumedAt: null,
        revokedAt: null,
        createdAt: params.createdAt,
      });
    },

    async revokeActiveVerificationTokensForUser(userId, purpose, now, executor) {
      const db = getExecutor(executor);
      await db
        .update(emailVerificationTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(emailVerificationTokens.userId, userId),
            eq(emailVerificationTokens.purpose, purpose),
            isNull(emailVerificationTokens.consumedAt),
            isNull(emailVerificationTokens.revokedAt)
          )
        );
    },

    async findVerificationTokenByHash(tokenHash, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ?? null;
    },

    async consumeVerificationTokenAndVerifyUser(params, executor) {
      const db = getExecutor(executor);
      const [tokenResult] = await db
        .update(emailVerificationTokens)
        .set({ consumedAt: params.now })
        .where(
          and(
            eq(emailVerificationTokens.id, params.tokenId),
            isNull(emailVerificationTokens.consumedAt),
            isNull(emailVerificationTokens.revokedAt),
            gt(emailVerificationTokens.expiresAt, params.now)
          )
        );
      if ((tokenResult.affectedRows ?? 0) === 0) {
        return false;
      }

      await db
        .update(users)
        .set({
          emailVerifiedAt: params.now,
          updatedAt: params.now,
        })
        .where(and(eq(users.id, params.userId), isNull(users.emailVerifiedAt)));

      return true;
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
          emailVerifiedAt: users.emailVerifiedAt,
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
        row.sessionScope !== 'student' &&
        row.sessionScope !== 'guardian'
      ) {
        return null;
      }

      let hasActiveFamilyStudentContext = false;
      if (row.sessionScope === 'student' && row.activeOrganizationId === null) {
        const famRows = await db
          .select({ id: familyStudents.id })
          .from(familyStudents)
          .innerJoin(
            familyWorkspaces,
            eq(familyWorkspaces.id, familyStudents.familyWorkspaceId)
          )
          .innerJoin(
            guardianStudentLinks,
            and(
              eq(guardianStudentLinks.familyWorkspaceId, familyWorkspaces.id),
              eq(guardianStudentLinks.studentUserId, row.userId),
              eq(guardianStudentLinks.relationshipStatus, 'active')
            )
          )
          .where(
            and(
              eq(familyStudents.studentUserId, row.userId),
              eq(familyStudents.status, 'active'),
              eq(familyWorkspaces.status, 'active')
            )
          )
          .limit(1);
        hasActiveFamilyStudentContext = famRows.length > 0;
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
          emailVerifiedAt: row.emailVerifiedAt,
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
        hasActiveFamilyStudentContext,
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
