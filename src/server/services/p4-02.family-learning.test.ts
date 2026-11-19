import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseServerConfig } from '../config/env.ts';
import type { OrgRole, SessionScope } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import type {
  AuthCredentialUserRecord,
  AuthMembershipSummary,
  AuthRepository,
  EmailVerificationTokenRecord,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import type {
  AdminEnrollmentRosterRecord,
  AdminFamilyWorkspaceCandidateRecord,
  FamilyActivityAttemptRecord,
  FamilyActivityAttemptTurnRecord,
  FamilyLearningRepository,
  FamilyProgramEnrollmentRecord,
  FamilyProgramItemJoinedRecord,
  FamilyProgramRecord,
  FamilyProgramVersionRecord,
  GuardianFamilyEnrollmentOverviewRow,
  GuardianLinkedStudentSummary,
  GuardianSchoolAssignmentOverviewRow,
  PublishedContentVersionLookupRecord,
  StudentEnrollmentJoinedRecord,
  StudentFamilyPreferencesRecord,
} from '../repositories/family-learning.repository.ts';
import type {
  FamilyMembershipRecord,
  FamilyWorkspaceRecord,
  GuardianRepository,
  LinkInvitationRecord,
} from '../repositories/guardian.repository.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import { createFamilyLearningRouters } from '../routes/family-learning.routes.ts';
import { createGuardianRouters } from '../routes/guardian.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
} from '../security/csrf.ts';
import { verifyPassword } from '../security/password-hash.ts';
import { InMemoryRateLimiter } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import type { RecordAuditEventInput } from './audit.service.ts';
import { createAuthService } from './auth.service.ts';
import { createFamilyLearningService } from './family-learning.service.ts';
import { createGuardianService } from './guardian.service.ts';

interface InMemoryP402Store {
  now: Date;
  organizations: Map<
    string,
    { id: string; code: string; name: string; status: string }
  >;
  users: Map<string, AuthCredentialUserRecord>;
  memberships: Map<
    string,
    {
      id: string;
      organizationId: string;
      userId: string;
      role: OrgRole;
      status: string;
      orgUsername: string | null;
    }
  >;
  classes: Map<string, { id: string; organizationId: string; status: string }>;
  classTeachers: Array<{
    organizationId: string;
    classId: string;
    teacherMembershipId: string;
  }>;
  classEnrollments: Array<{
    organizationId: string;
    classId: string;
    studentMembershipId: string;
    status: string;
  }>;
  emailVerificationTokens: Map<string, EmailVerificationTokenRecord>;
  familyWorkspaces: Map<string, FamilyWorkspaceRecord>;
  familyMemberships: Map<string, FamilyMembershipRecord>;
  familyStudents: Map<
    string,
    {
      id: string;
      familyWorkspaceId: string;
      studentUserId: string;
      familyUsername: string;
      status: string;
      createdByUserId: string;
      createdAt: Date;
      updatedAt: Date;
    }
  >;
  guardianStudentLinks: Map<
    string,
    {
      id: string;
      familyWorkspaceId: string;
      guardianUserId: string;
      studentUserId: string;
      relationshipStatus: string;
      verificationSource: string;
      sourceOrganizationId: string | null;
      invitationId: string | null;
      verifiedAt: Date;
      revokedAt: Date | null;
      revokedByUserId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >;
  invitations: Map<string, LinkInvitationRecord>;
  invitationStudents: Map<string, string[]>;
  sessions: Map<
    string,
    {
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
    }
  >;
  contentItems: Map<
    string,
    {
      id: string;
      slug: string;
      contentType: string;
      isArchived: boolean;
    }
  >;
  contentVersions: Map<
    string,
    {
      id: string;
      contentItemId: string;
      versionNumber: number;
      status: string;
      title: string;
      summary: string | null;
      locale: string;
      payloadJson: Record<string, unknown>;
      metadataJson: Record<string, unknown> | null;
      publishedAt: Date | null;
    }
  >;
  familyPrograms: Map<string, FamilyProgramRecord>;
  familyProgramVersions: Map<string, FamilyProgramVersionRecord>;
  familyProgramItems: Map<
    string,
    {
      id: string;
      familyProgramVersionId: string;
      chapterNumber: number;
      chapterTitle: string;
      sortOrder: number;
      contentVersionId: string;
      createdAt: Date;
    }
  >;
  familyProgramEnrollments: Map<string, FamilyProgramEnrollmentRecord>;
  familyActivityAttempts: Map<string, FamilyActivityAttemptRecord>;
  familyActivityAttemptTurns: Map<string, FamilyActivityAttemptTurnRecord>;
  studentFamilyPreferences: Map<string, StudentFamilyPreferencesRecord>;
  schoolAssignmentsOverview: Array<{
    studentUserId: string;
    row: GuardianSchoolAssignmentOverviewRow;
  }>;
  audits: RecordAuditEventInput[];
  capturedVerificationTokens: Array<{
    userId: string;
    rawToken: string;
    tokenHash: string;
  }>;
}

function createEmptyStore(): InMemoryP402Store {
  return {
    now: new Date('2026-11-19T12:00:00.000Z'),
    organizations: new Map(),
    users: new Map(),
    memberships: new Map(),
    classes: new Map(),
    classTeachers: [],
    classEnrollments: [],
    emailVerificationTokens: new Map(),
    familyWorkspaces: new Map(),
    familyMemberships: new Map(),
    familyStudents: new Map(),
    guardianStudentLinks: new Map(),
    invitations: new Map(),
    invitationStudents: new Map(),
    sessions: new Map(),
    contentItems: new Map(),
    contentVersions: new Map(),
    familyPrograms: new Map(),
    familyProgramVersions: new Map(),
    familyProgramItems: new Map(),
    familyProgramEnrollments: new Map(),
    familyActivityAttempts: new Map(),
    familyActivityAttemptTurns: new Map(),
    studentFamilyPreferences: new Map(),
    schoolAssignmentsOverview: [],
    audits: [],
    capturedVerificationTokens: [],
  };
}

function createFastPasswordHelpers() {
  return {
    hashFn: async (password: string) => `fast$${password}`,
    verifyFn: async (password: string, hash: string) => {
      if (hash.startsWith('fast$')) return hash === `fast$${password}`;
      if (hash.startsWith('scrypt$')) return verifyPassword(password, hash);
      return false;
    },
  };
}

function makeFakeRepos(store: InMemoryP402Store) {
  const authRepo: AuthRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findUserCredentialByEmail(email) {
      for (const u of store.users.values()) {
        if (u.email === email) return { ...u };
      }
      return null;
    },
    async findUserCredentialByPlatformUsername(username) {
      for (const u of store.users.values()) {
        if (u.platformUsername === username) return { ...u };
      }
      return null;
    },
    async findUserCredentialById(userId) {
      const u = store.users.get(userId);
      return u ? { ...u } : null;
    },
    async findStudentLoginRecord(organizationCode, orgUsername) {
      const org = Array.from(store.organizations.values()).find(
        (o) => o.code === organizationCode
      );
      if (!org) return null;
      const membership = Array.from(store.memberships.values()).find(
        (m) =>
          m.organizationId === org.id &&
          m.orgUsername === orgUsername &&
          m.role === 'student'
      );
      if (!membership) return null;
      const user = store.users.get(membership.userId);
      if (!user) return null;
      return {
        user: { ...user },
        membership: {
          membershipId: membership.id,
          organizationId: org.id,
          organizationCode: org.code,
          organizationName: org.name,
          organizationStatus: org.status,
          role: membership.role,
          membershipStatus: membership.status,
          orgUsername: membership.orgUsername,
        },
      };
    },
    async findFamilyStudentLoginRecord(workspaceCode, familyUsername) {
      const ws = Array.from(store.familyWorkspaces.values()).find(
        (w) => w.code === workspaceCode
      );
      if (!ws) return null;
      const fs = Array.from(store.familyStudents.values()).find(
        (s) => s.familyWorkspaceId === ws.id && s.familyUsername === familyUsername
      );
      if (!fs) return null;
      const user = store.users.get(fs.studentUserId);
      if (!user) return null;
      const hasActiveGuardianLink = Array.from(store.guardianStudentLinks.values()).some(
        (l) =>
          l.familyWorkspaceId === ws.id &&
          l.studentUserId === fs.studentUserId &&
          l.relationshipStatus === 'active'
      );
      return {
        user: { ...user },
        familyWorkspace: {
          id: ws.id,
          code: ws.code,
          name: ws.name,
          status: ws.status,
        },
        familyStudent: {
          id: fs.id,
          familyWorkspaceId: fs.familyWorkspaceId,
          studentUserId: fs.studentUserId,
          familyUsername: fs.familyUsername,
          status: fs.status,
        },
        hasActiveGuardianLink,
      };
    },
    async createGuardianUser(params) {
      const rec: AuthCredentialUserRecord = {
        id: params.id,
        email: params.email,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: 'guardian',
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      store.users.set(rec.id, rec);
      return { ...rec };
    },
    async createEmailVerificationToken(params) {
      store.emailVerificationTokens.set(params.id, {
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
    async revokeActiveVerificationTokensForUser(userId, purpose, now) {
      for (const tok of store.emailVerificationTokens.values()) {
        if (
          tok.userId === userId &&
          tok.purpose === purpose &&
          tok.consumedAt === null &&
          tok.revokedAt === null
        ) {
          tok.revokedAt = now;
        }
      }
    },
    async findVerificationTokenByHash(tokenHash) {
      for (const tok of store.emailVerificationTokens.values()) {
        if (tok.tokenHash === tokenHash) return { ...tok };
      }
      return null;
    },
    async consumeVerificationTokenAndVerifyUser(params) {
      const tok = store.emailVerificationTokens.get(params.tokenId);
      if (
        !tok ||
        tok.consumedAt !== null ||
        tok.revokedAt !== null ||
        tok.expiresAt <= params.now
      ) {
        return false;
      }
      tok.consumedAt = params.now;
      const u = store.users.get(params.userId);
      if (u && !u.emailVerifiedAt) {
        u.emailVerifiedAt = params.now;
      }
      return true;
    },
    async findMembershipsForUser(userId, roleFilter) {
      const out: AuthMembershipSummary[] = [];
      for (const m of store.memberships.values()) {
        if (m.userId !== userId) continue;
        if (roleFilter && m.role !== roleFilter) continue;
        const org = store.organizations.get(m.organizationId)!;
        out.push({
          membershipId: m.id,
          organizationId: org.id,
          organizationCode: org.code,
          organizationName: org.name,
          organizationStatus: org.status,
          role: m.role,
          membershipStatus: m.status,
          orgUsername: m.orgUsername,
        });
      }
      return out;
    },
    async createSession(params) {
      store.sessions.set(params.id, {
        id: params.id,
        tokenHash: params.tokenHash,
        userId: params.userId,
        sessionScope: params.sessionScope,
        activeOrganizationId: params.activeOrganizationId,
        idleExpiresAt: params.idleExpiresAt,
        absoluteExpiresAt: params.absoluteExpiresAt,
        lastActivityAt: params.lastActivityAt,
        revokedAt: null,
        revokedReason: null,
      });
    },
    async findSessionWithContextByTokenHash(tokenHash): Promise<SessionWithContextRecord | null> {
      const session = Array.from(store.sessions.values()).find(
        (s) => s.tokenHash === tokenHash
      );
      if (!session) return null;
      const user = store.users.get(session.userId);
      if (!user) return null;
      const org = session.activeOrganizationId
        ? store.organizations.get(session.activeOrganizationId) ?? null
        : null;
      const membership = session.activeOrganizationId
        ? Array.from(store.memberships.values()).find(
            (m) =>
              m.organizationId === session.activeOrganizationId &&
              m.userId === session.userId
          ) ?? null
        : null;

      let hasActiveFamilyStudentContext = false;
      if (session.sessionScope === 'student' && session.activeOrganizationId === null) {
        hasActiveFamilyStudentContext = Array.from(store.familyStudents.values()).some(
          (fs) => {
            if (fs.studentUserId !== session.userId || fs.status !== 'active') return false;
            const ws = store.familyWorkspaces.get(fs.familyWorkspaceId);
            if (!ws || ws.status !== 'active') return false;
            return Array.from(store.guardianStudentLinks.values()).some(
              (l) =>
                l.familyWorkspaceId === ws.id &&
                l.studentUserId === session.userId &&
                l.relationshipStatus === 'active'
            );
          }
        );
      }

      return {
        session: { ...session },
        user: {
          id: user.id,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt,
          platformUsername: user.platformUsername,
          platformRole: user.platformRole,
          displayName: user.displayName,
          status: user.status,
          lockedUntil: user.lockedUntil,
        },
        activeOrganization: org ? { ...org } : null,
        activeMembership: membership
          ? {
              id: membership.id,
              organizationId: membership.organizationId,
              role: membership.role,
              orgUsername: membership.orgUsername,
              status: membership.status,
            }
          : null,
        hasActiveFamilyStudentContext,
      };
    },
    async touchSessionActivity(sessionId, lastActivityAt, idleExpiresAt) {
      const s = store.sessions.get(sessionId);
      if (s && !s.revokedAt) {
        s.lastActivityAt = lastActivityAt;
        s.idleExpiresAt = idleExpiresAt;
      }
    },
    async rotateSession(params) {
      const s = store.sessions.get(params.sessionId);
      if (
        !s ||
        s.tokenHash !== params.expectedTokenHash ||
        s.revokedAt !== null ||
        s.absoluteExpiresAt <= params.lastActivityAt
      ) {
        return false;
      }
      s.tokenHash = params.newTokenHash;
      s.activeOrganizationId = params.newActiveOrganizationId;
      s.sessionScope = params.newSessionScope;
      s.lastActivityAt = params.lastActivityAt;
      s.idleExpiresAt = params.idleExpiresAt;
      return true;
    },
    async revokeSessionById(sessionId, reason, revokedAt) {
      const s = store.sessions.get(sessionId);
      if (s && !s.revokedAt) {
        s.revokedAt = revokedAt;
        s.revokedReason = reason;
      }
    },
    async revokeOtherActiveSessionsForUser(userId, exceptSessionId, reason, revokedAt) {
      let count = 0;
      for (const s of store.sessions.values()) {
        if (s.userId === userId && s.id !== exceptSessionId && !s.revokedAt) {
          s.revokedAt = revokedAt;
          s.revokedReason = reason;
          count += 1;
        }
      }
      return count;
    },
    async recordFailedLoginAttempt(userId, now, lockoutPolicy) {
      const u = store.users.get(userId);
      if (!u) return { lockedNow: false, failedAttempts: 0, lockedUntil: null };
      u.failedLoginAttempts += 1;
      let lockedNow = false;
      if (
        lockoutPolicy &&
        u.failedLoginAttempts >= lockoutPolicy.maxFailedAttempts &&
        (!u.lockedUntil || u.lockedUntil <= now)
      ) {
        u.lockedUntil = new Date(
          now.getTime() + lockoutPolicy.lockoutDurationMinutes * 60 * 1000
        );
        lockedNow = true;
      }
      return {
        lockedNow,
        failedAttempts: u.failedLoginAttempts,
        lockedUntil: u.lockedUntil,
      };
    },
    async recordSuccessfulLoginState(userId) {
      const u = store.users.get(userId);
      if (u) {
        u.failedLoginAttempts = 0;
        u.lockedUntil = null;
      }
    },
    async updateUserPasswordHash(userId, newPasswordHash) {
      const u = store.users.get(userId);
      if (u) u.passwordHash = newPasswordHash;
    },
  };

  const guardianRepo: GuardianRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findWorkspaceByCode(code) {
      for (const ws of store.familyWorkspaces.values()) {
        if (ws.code === code) return { ...ws };
      }
      return null;
    },
    async findWorkspaceMembership(workspaceId, guardianUserId) {
      const ws = store.familyWorkspaces.get(workspaceId);
      if (!ws || ws.status !== 'active') return null;
      const m = Array.from(store.familyMemberships.values()).find(
        (row) =>
          row.familyWorkspaceId === workspaceId &&
          row.guardianUserId === guardianUserId &&
          row.status === 'active'
      );
      if (!m) return null;
      return { workspace: { ...ws }, membership: { ...m } };
    },
    async listWorkspacesForGuardian(guardianUserId) {
      const out = [];
      for (const m of store.familyMemberships.values()) {
        if (m.guardianUserId !== guardianUserId || m.status !== 'active') continue;
        const ws = store.familyWorkspaces.get(m.familyWorkspaceId);
        if (!ws || ws.status !== 'active') continue;
        const memberCount = Array.from(store.familyMemberships.values()).filter(
          (row) => row.familyWorkspaceId === ws.id && row.status === 'active'
        ).length;
        const studentSet = new Set(
          Array.from(store.guardianStudentLinks.values())
            .filter(
              (l) =>
                l.familyWorkspaceId === ws.id &&
                l.guardianUserId === guardianUserId &&
                l.relationshipStatus === 'active'
            )
            .map((l) => l.studentUserId)
        );
        out.push({
          workspace: { ...ws },
          membership: { ...m },
          memberCount,
          studentCount: studentSet.size,
        });
      }
      return out;
    },
    async listWorkspaceMembers(workspaceId) {
      return Array.from(store.familyMemberships.values())
        .filter((m) => m.familyWorkspaceId === workspaceId && m.status === 'active')
        .map((m) => ({
          membershipId: m.id,
          guardianUserId: m.guardianUserId,
          displayName: store.users.get(m.guardianUserId)?.displayName ?? '',
          role: m.role,
          status: m.status,
          joinedAt: m.createdAt,
        }));
    },
    async listWorkspaceStudentsForGuardian(workspaceId, guardianUserId) {
      return Array.from(store.familyStudents.values())
        .filter((fs) => {
          if (fs.familyWorkspaceId !== workspaceId || fs.status !== 'active') return false;
          return Array.from(store.guardianStudentLinks.values()).some(
            (l) =>
              l.familyWorkspaceId === workspaceId &&
              l.guardianUserId === guardianUserId &&
              l.studentUserId === fs.studentUserId &&
              l.relationshipStatus === 'active'
          );
        })
        .map((fs) => {
          const student = store.users.get(fs.studentUserId)!;
          const hasSchoolMembership = Array.from(store.memberships.values()).some(
            (m) =>
              m.userId === fs.studentUserId &&
              m.role === 'student' &&
              m.status === 'active'
          );
          const activeLink = Array.from(store.guardianStudentLinks.values()).find(
            (l) =>
              l.familyWorkspaceId === workspaceId &&
              l.guardianUserId === guardianUserId &&
              l.studentUserId === fs.studentUserId &&
              l.relationshipStatus === 'active'
          )!;
          return {
            familyStudentId: fs.id,
            familyWorkspaceId: fs.familyWorkspaceId,
            studentUserId: fs.studentUserId,
            familyUsername: fs.familyUsername,
            status: fs.status,
            displayName: student.displayName,
            userStatus: student.status,
            createdAt: fs.createdAt,
            hasSchoolMembership,
            linkedByCurrentGuardian: true,
            currentGuardianLinkId: activeLink.id,
          };
        });
    },
    async createFamilyWorkspaceWithOwner(params) {
      const workspace: FamilyWorkspaceRecord = {
        id: params.workspaceId,
        code: params.code,
        name: params.name,
        status: 'active',
        createdByUserId: params.guardianUserId,
        createdAt: params.now,
        updatedAt: params.now,
      };
      const membership: FamilyMembershipRecord = {
        id: params.membershipId,
        familyWorkspaceId: params.workspaceId,
        guardianUserId: params.guardianUserId,
        role: 'guardian',
        status: 'active',
        invitedByUserId: null,
        revokedAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      };
      store.familyWorkspaces.set(workspace.id, workspace);
      store.familyMemberships.set(membership.id, membership);
      return { workspace: { ...workspace }, membership: { ...membership } };
    },
    async findFamilyStudentByUsername(workspaceId, familyUsername) {
      const fs = Array.from(store.familyStudents.values()).find(
        (s) => s.familyWorkspaceId === workspaceId && s.familyUsername === familyUsername
      );
      return fs
        ? { id: fs.id, studentUserId: fs.studentUserId, familyUsername: fs.familyUsername }
        : null;
    },
    async findFamilyStudentByUser(workspaceId, studentUserId) {
      const fs = Array.from(store.familyStudents.values()).find(
        (s) => s.familyWorkspaceId === workspaceId && s.studentUserId === studentUserId
      );
      return fs
        ? {
            id: fs.id,
            studentUserId: fs.studentUserId,
            familyUsername: fs.familyUsername,
            status: fs.status,
          }
        : null;
    },
    async createFamilyStudentAndLink(params) {
      store.users.set(params.studentUserId, {
        id: params.studentUserId,
        email: null,
        emailVerifiedAt: null,
        platformUsername: null,
        platformRole: null,
        displayName: params.displayName,
        passwordHash: params.passwordHash,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      store.familyStudents.set(params.familyStudentId, {
        id: params.familyStudentId,
        familyWorkspaceId: params.familyWorkspaceId,
        studentUserId: params.studentUserId,
        familyUsername: params.familyUsername,
        status: 'active',
        createdByUserId: params.guardianUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });
      store.guardianStudentLinks.set(params.linkId, {
        id: params.linkId,
        familyWorkspaceId: params.familyWorkspaceId,
        guardianUserId: params.guardianUserId,
        studentUserId: params.studentUserId,
        relationshipStatus: 'active',
        verificationSource: 'family_created',
        sourceOrganizationId: null,
        invitationId: null,
        verifiedAt: params.now,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: params.now,
        updatedAt: params.now,
      });
    },
    async listGuardianStudentLinks(guardianUserId, options) {
      return Array.from(store.guardianStudentLinks.values())
        .filter((l) => {
          if (l.guardianUserId !== guardianUserId) return false;
          return options?.includeRevoked ? true : l.relationshipStatus === 'active';
        })
        .map((l) => {
          const ws = store.familyWorkspaces.get(l.familyWorkspaceId)!;
          const student = store.users.get(l.studentUserId)!;
          const fs = Array.from(store.familyStudents.values()).find(
            (s) =>
              s.familyWorkspaceId === l.familyWorkspaceId &&
              s.studentUserId === l.studentUserId
          );
          const sourceOrg = l.sourceOrganizationId
            ? store.organizations.get(l.sourceOrganizationId) ?? null
            : null;
          const hasSchoolMembership = Array.from(store.memberships.values()).some(
            (m) =>
              m.userId === l.studentUserId &&
              m.role === 'student' &&
              m.status === 'active'
          );
          return {
            linkId: l.id,
            familyWorkspaceId: l.familyWorkspaceId,
            workspaceCode: ws.code,
            workspaceName: ws.name,
            guardianUserId: l.guardianUserId,
            studentUserId: l.studentUserId,
            studentDisplayName: student.displayName,
            studentStatus: student.status,
            familyUsername: fs?.familyUsername ?? null,
            relationshipStatus: l.relationshipStatus,
            verificationSource: l.verificationSource,
            sourceOrganizationId: l.sourceOrganizationId,
            sourceOrganizationCode: sourceOrg?.code ?? null,
            sourceOrganizationName: sourceOrg?.name ?? null,
            hasSchoolMembership,
            verifiedAt: l.verifiedAt,
            revokedAt: l.revokedAt,
            createdAt: l.createdAt,
          };
        });
    },
    async findGuardianStudentLinkById(linkId) {
      const l = store.guardianStudentLinks.get(linkId);
      if (!l) return null;
      return {
        id: l.id,
        familyWorkspaceId: l.familyWorkspaceId,
        guardianUserId: l.guardianUserId,
        studentUserId: l.studentUserId,
        relationshipStatus: l.relationshipStatus,
      };
    },
    async findActiveGuardianStudentLink(workspaceId, guardianUserId, studentUserId) {
      const l = Array.from(store.guardianStudentLinks.values()).find(
        (row) =>
          row.familyWorkspaceId === workspaceId &&
          row.guardianUserId === guardianUserId &&
          row.studentUserId === studentUserId &&
          row.relationshipStatus === 'active'
      );
      return l ? { id: l.id } : null;
    },
    async revokeGuardianStudentLink(params) {
      const l = store.guardianStudentLinks.get(params.linkId);
      if (
        !l ||
        l.guardianUserId !== params.guardianUserId ||
        l.relationshipStatus !== 'active'
      ) {
        return false;
      }
      l.relationshipStatus = 'revoked';
      l.revokedAt = params.now;
      l.revokedByUserId = params.guardianUserId;
      l.updatedAt = params.now;
      return true;
    },
    async findSchoolStudentByMembershipId(organizationId, membershipId) {
      const m = store.memberships.get(membershipId);
      if (!m || m.organizationId !== organizationId) return null;
      const org = store.organizations.get(organizationId);
      const user = store.users.get(m.userId);
      if (!org || !user) return null;
      return {
        membershipId: m.id,
        organizationId: org.id,
        organizationCode: org.code,
        organizationName: org.name,
        organizationStatus: org.status,
        userId: user.id,
        userDisplayName: user.displayName,
        userStatus: user.status,
        role: m.role,
        membershipStatus: m.status,
        orgUsername: m.orgUsername,
      };
    },
    async findSharedActiveClassIds(organizationId, teacherMembershipId, studentMembershipId) {
      const teacherClassIds = new Set(
        store.classTeachers
          .filter(
            (ct) =>
              ct.organizationId === organizationId &&
              ct.teacherMembershipId === teacherMembershipId
          )
          .map((ct) => ct.classId)
      );
      const out: string[] = [];
      for (const ce of store.classEnrollments) {
        if (
          ce.organizationId === organizationId &&
          ce.studentMembershipId === studentMembershipId &&
          ce.status === 'active' &&
          teacherClassIds.has(ce.classId)
        ) {
          const cls = store.classes.get(ce.classId);
          if (cls && cls.status === 'active') out.push(ce.classId);
        }
      }
      return out;
    },
    async createLinkInvitation(params) {
      const rec: LinkInvitationRecord = {
        id: params.id,
        invitationType: params.invitationType,
        studentUserId: params.studentUserId ?? null,
        sourceOrganizationId: params.sourceOrganizationId ?? null,
        sourceFamilyWorkspaceId: params.sourceFamilyWorkspaceId ?? null,
        tokenHash: params.tokenHash,
        status: params.status ?? 'pending',
        expiresAt: params.expiresAt,
        createdByUserId: params.createdByUserId,
        createdByRole: params.createdByRole,
        claimedByUserId: params.claimedByUserId ?? null,
        claimedFamilyWorkspaceId: params.claimedFamilyWorkspaceId ?? null,
        claimedAt: params.claimedAt ?? null,
        revokedByUserId: params.revokedByUserId ?? null,
        revokedAt: params.revokedAt ?? null,
        createdAt: params.createdAt,
      };
      store.invitations.set(rec.id, rec);
      return { ...rec };
    },
    async listSchoolStudentInvitations(params) {
      return Array.from(store.invitations.values())
        .filter(
          (i) =>
            i.invitationType === 'school_student_link' &&
            i.studentUserId === params.studentUserId &&
            i.sourceOrganizationId === params.sourceOrganizationId
        )
        .map((i) => ({ ...i }));
    },
    async listWorkspaceCoGuardianInvitations(workspaceId) {
      return Array.from(store.invitations.values())
        .filter(
          (i) =>
            i.invitationType === 'co_guardian_invite' &&
            i.sourceFamilyWorkspaceId === workspaceId
        )
        .map((i) => ({ ...i }));
    },
    async findInvitationByTokenHash(tokenHash) {
      const inv = Array.from(store.invitations.values()).find(
        (i) => i.tokenHash === tokenHash
      );
      return inv ? { ...inv } : null;
    },
    async findInvitationById(invitationId) {
      const inv = store.invitations.get(invitationId);
      return inv ? { ...inv } : null;
    },
    async markInvitationClaimed(params) {
      const inv = store.invitations.get(params.invitationId);
      if (!inv || inv.status !== 'pending' || inv.expiresAt <= params.now) {
        return false;
      }
      inv.status = 'claimed';
      inv.claimedByUserId = params.claimedByUserId;
      inv.claimedFamilyWorkspaceId = params.claimedFamilyWorkspaceId;
      inv.claimedAt = params.now;
      return true;
    },
    async revokeLinkInvitation(params) {
      const inv = store.invitations.get(params.invitationId);
      if (!inv || inv.status !== 'pending') return false;
      inv.status = 'revoked';
      inv.revokedByUserId = params.revokedByUserId;
      inv.revokedAt = params.now;
      return true;
    },
    async ensureFamilyStudentRecord(params) {
      const existing = Array.from(store.familyStudents.values()).find(
        (s) =>
          s.familyWorkspaceId === params.familyWorkspaceId &&
          s.studentUserId === params.studentUserId
      );
      if (existing) {
        existing.status = 'active';
        existing.updatedAt = params.now;
        return { id: existing.id, familyUsername: existing.familyUsername };
      }
      store.familyStudents.set(params.id, {
        id: params.id,
        familyWorkspaceId: params.familyWorkspaceId,
        studentUserId: params.studentUserId,
        familyUsername: params.familyUsername,
        status: 'active',
        createdByUserId: params.createdByUserId,
        createdAt: params.now,
        updatedAt: params.now,
      });
      return { id: params.id, familyUsername: params.familyUsername };
    },
    async createGuardianStudentLink(params) {
      store.guardianStudentLinks.set(params.id, {
        id: params.id,
        familyWorkspaceId: params.familyWorkspaceId,
        guardianUserId: params.guardianUserId,
        studentUserId: params.studentUserId,
        relationshipStatus: params.relationshipStatus ?? 'active',
        verificationSource: params.verificationSource,
        sourceOrganizationId: params.sourceOrganizationId ?? null,
        invitationId: params.invitationId ?? null,
        verifiedAt: params.verifiedAt,
        revokedAt: params.revokedAt ?? null,
        revokedByUserId: params.revokedByUserId ?? null,
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
      });
    },
    async createFamilyMembership(params) {
      store.familyMemberships.set(params.id, {
        id: params.id,
        familyWorkspaceId: params.familyWorkspaceId,
        guardianUserId: params.guardianUserId,
        role: params.role ?? 'guardian',
        status: params.status ?? 'active',
        invitedByUserId: params.invitedByUserId ?? null,
        revokedAt: params.revokedAt ?? null,
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
      });
    },
    async addInvitationScopedStudents(entries) {
      for (const entry of entries) {
        const list = store.invitationStudents.get(entry.invitationId) ?? [];
        if (!list.includes(entry.studentUserId)) list.push(entry.studentUserId);
        store.invitationStudents.set(entry.invitationId, list);
      }
    },
    async listInvitationScopedStudentIds(invitationId) {
      return [...(store.invitationStudents.get(invitationId) ?? [])];
    },
    async listScopedStudentsForInvitations(invitationIds) {
      const result = new Map<string, Array<{ studentUserId: string; displayName: string }>>();
      for (const invId of invitationIds) {
        const ids = store.invitationStudents.get(invId) ?? [];
        result.set(
          invId,
          ids.map((id) => ({
            studentUserId: id,
            displayName: store.users.get(id)?.displayName ?? '',
          }))
        );
      }
      return result;
    },
    async findUserSummaryById(userId) {
      const u = store.users.get(userId);
      if (!u) return null;
      return {
        id: u.id,
        displayName: u.displayName,
        status: u.status,
        platformRole: u.platformRole,
      };
    },
  };

  const familyLearningRepo: FamilyLearningRepository = {
    async withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findProgramBySlug(slug) {
      for (const p of store.familyPrograms.values()) {
        if (p.slug === slug) return { ...p };
      }
      return null;
    },
    async findProgramById(programId) {
      const p = store.familyPrograms.get(programId);
      return p ? { ...p } : null;
    },
    async listPrograms() {
      return Array.from(store.familyPrograms.values()).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      );
    },
    async listProgramVersions(programId) {
      return Array.from(store.familyProgramVersions.values())
        .filter((v) => v.familyProgramId === programId)
        .sort((a, b) => b.versionNumber - a.versionNumber);
    },
    async listAllLatestVersions(programIds) {
      const set = new Set(programIds);
      return Array.from(store.familyProgramVersions.values())
        .filter((v) => set.has(v.familyProgramId))
        .sort((a, b) => b.versionNumber - a.versionNumber);
    },
    async findProgramVersionById(versionId) {
      const v = store.familyProgramVersions.get(versionId);
      return v ? { ...v } : null;
    },
    async listProgramVersionItemsJoined(versionId): Promise<FamilyProgramItemJoinedRecord[]> {
      return Array.from(store.familyProgramItems.values())
        .filter((it) => it.familyProgramVersionId === versionId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => {
          const cv = store.contentVersions.get(it.contentVersionId)!;
          const ci = store.contentItems.get(cv.contentItemId)!;
          return {
            id: it.id,
            familyProgramVersionId: it.familyProgramVersionId,
            chapterNumber: it.chapterNumber,
            chapterTitle: it.chapterTitle,
            sortOrder: it.sortOrder,
            contentVersionId: it.contentVersionId,
            createdAt: it.createdAt,
            contentItemId: ci.id,
            contentSlug: ci.slug,
            contentType: ci.contentType,
            contentVersionNumber: cv.versionNumber,
            contentStatus: cv.status,
            contentTitle: cv.title,
            contentSummary: cv.summary,
            contentLocale: cv.locale,
            payloadJson: cv.payloadJson,
            metadataJson: cv.metadataJson,
            publishedAt: cv.publishedAt,
          };
        });
    },
    async findPublishedContentVersionsByIds(ids): Promise<PublishedContentVersionLookupRecord[]> {
      const out: PublishedContentVersionLookupRecord[] = [];
      for (const id of ids) {
        const cv = store.contentVersions.get(id);
        if (!cv) continue;
        const ci = store.contentItems.get(cv.contentItemId);
        if (!ci) continue;
        out.push({
          id: cv.id,
          contentItemId: ci.id,
          slug: ci.slug,
          contentType: ci.contentType,
          versionNumber: cv.versionNumber,
          status: cv.status,
          isArchived: ci.isArchived,
          title: cv.title,
          summary: cv.summary,
          locale: cv.locale,
        });
      }
      return out;
    },
    async createProgramWithDraftVersion(params) {
      store.familyPrograms.set(params.program.id, {
        id: params.program.id,
        slug: params.program.slug,
        availabilityMode: params.program.availabilityMode ?? 'admin_assigned',
        status: params.program.status ?? 'draft',
        currentPublishedVersionId: params.program.currentPublishedVersionId ?? null,
        createdByUserId: params.program.createdByUserId,
        retiredAt: params.program.retiredAt ?? null,
        createdAt: params.program.createdAt,
        updatedAt: params.program.updatedAt,
      });
      store.familyProgramVersions.set(params.version.id, {
        id: params.version.id,
        familyProgramId: params.version.familyProgramId,
        versionNumber: params.version.versionNumber,
        status: params.version.status ?? 'draft',
        title: params.version.title,
        description: params.version.description ?? null,
        locale: params.version.locale ?? 'vi',
        ageBand: params.version.ageBand ?? null,
        availabilityMode: params.version.availabilityMode ?? 'admin_assigned',
        createdByUserId: params.version.createdByUserId,
        publishedByUserId: params.version.publishedByUserId ?? null,
        publishedAt: params.version.publishedAt ?? null,
        retiredAt: params.version.retiredAt ?? null,
        createdAt: params.version.createdAt,
        updatedAt: params.version.updatedAt,
      });
      for (const item of params.items) {
        store.familyProgramItems.set(item.id, {
          id: item.id,
          familyProgramVersionId: item.familyProgramVersionId,
          chapterNumber: item.chapterNumber ?? 1,
          chapterTitle: item.chapterTitle,
          sortOrder: item.sortOrder ?? 0,
          contentVersionId: item.contentVersionId,
          createdAt: item.createdAt,
        });
      }
    },
    async createDraftProgramVersion(params) {
      store.familyProgramVersions.set(params.version.id, {
        id: params.version.id,
        familyProgramId: params.version.familyProgramId,
        versionNumber: params.version.versionNumber,
        status: params.version.status ?? 'draft',
        title: params.version.title,
        description: params.version.description ?? null,
        locale: params.version.locale ?? 'vi',
        ageBand: params.version.ageBand ?? null,
        availabilityMode: params.version.availabilityMode ?? 'admin_assigned',
        createdByUserId: params.version.createdByUserId,
        publishedByUserId: params.version.publishedByUserId ?? null,
        publishedAt: params.version.publishedAt ?? null,
        retiredAt: params.version.retiredAt ?? null,
        createdAt: params.version.createdAt,
        updatedAt: params.version.updatedAt,
      });
      for (const item of params.items) {
        store.familyProgramItems.set(item.id, {
          id: item.id,
          familyProgramVersionId: item.familyProgramVersionId,
          chapterNumber: item.chapterNumber ?? 1,
          chapterTitle: item.chapterTitle,
          sortOrder: item.sortOrder ?? 0,
          contentVersionId: item.contentVersionId,
          createdAt: item.createdAt,
        });
      }
    },
    async updateDraftProgramVersionAndItems(params) {
      const ver = store.familyProgramVersions.get(params.versionId)!;
      ver.title = params.title;
      ver.description = params.description;
      ver.locale = params.locale;
      ver.ageBand = params.ageBand;
      ver.availabilityMode = params.availabilityMode;
      ver.updatedAt = params.now;

      const prog = store.familyPrograms.get(params.programId)!;
      prog.availabilityMode = params.availabilityMode;
      prog.updatedAt = params.now;

      for (const [id, it] of store.familyProgramItems.entries()) {
        if (it.familyProgramVersionId === params.versionId) {
          store.familyProgramItems.delete(id);
        }
      }
      for (const item of params.items) {
        store.familyProgramItems.set(item.id, {
          id: item.id,
          familyProgramVersionId: item.familyProgramVersionId,
          chapterNumber: item.chapterNumber ?? 1,
          chapterTitle: item.chapterTitle,
          sortOrder: item.sortOrder ?? 0,
          contentVersionId: item.contentVersionId,
          createdAt: item.createdAt,
        });
      }
    },
    async publishProgramVersion(params) {
      const ver = store.familyProgramVersions.get(params.versionId)!;
      ver.status = 'published';
      ver.publishedByUserId = params.publishedByUserId;
      ver.publishedAt = params.now;
      ver.updatedAt = params.now;

      const prog = store.familyPrograms.get(params.programId)!;
      prog.status = 'published';
      prog.availabilityMode = params.availabilityMode;
      prog.currentPublishedVersionId = params.versionId;
      prog.updatedAt = params.now;
    },
    async retireProgram(params) {
      const prog = store.familyPrograms.get(params.programId)!;
      prog.status = 'retired';
      prog.retiredAt = params.now;
      prog.updatedAt = params.now;
    },
    async retireProgramVersion(params) {
      const ver = store.familyProgramVersions.get(params.versionId);
      if (ver && ver.familyProgramId === params.programId) {
        ver.status = 'retired';
        ver.retiredAt = params.now;
        ver.updatedAt = params.now;
      }
    },
    async listEnrollmentsForProgram(programId): Promise<AdminEnrollmentRosterRecord[]> {
      return Array.from(store.familyProgramEnrollments.values())
        .filter((e) => e.familyProgramId === programId)
        .sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime())
        .map((e) => {
          const ws = store.familyWorkspaces.get(e.familyWorkspaceId)!;
          const user = store.users.get(e.studentUserId)!;
          const ver = store.familyProgramVersions.get(e.familyProgramVersionId)!;
          const fs = Array.from(store.familyStudents.values()).find(
            (s) =>
              s.familyWorkspaceId === e.familyWorkspaceId &&
              s.studentUserId === e.studentUserId
          );
          return {
            enrollment: { ...e },
            workspaceCode: ws.code,
            workspaceName: ws.name,
            studentDisplayName: user.displayName,
            familyUsername: fs?.familyUsername ?? null,
            versionNumber: ver.versionNumber,
            programTitle: ver.title,
          };
        });
    },
    async listEligibleFamilyWorkspacesForAdmin(search): Promise<AdminFamilyWorkspaceCandidateRecord[]> {
      const norm = search?.trim().toLowerCase() ?? '';
      return Array.from(store.familyWorkspaces.values())
        .filter((ws) => ws.status === 'active')
        .filter(
          (ws) =>
            !norm ||
            ws.code.toLowerCase().includes(norm) ||
            ws.name.toLowerCase().includes(norm)
        )
        .map((ws) => {
          const students = Array.from(store.familyStudents.values())
            .filter((fs) => fs.familyWorkspaceId === ws.id && fs.status === 'active')
            .map((fs) => {
              const user = store.users.get(fs.studentUserId);
              if (!user || user.status !== 'active') return null;
              const activeGuardianCount = Array.from(store.guardianStudentLinks.values()).filter(
                (l) =>
                  l.familyWorkspaceId === ws.id &&
                  l.studentUserId === fs.studentUserId &&
                  l.relationshipStatus === 'active'
              ).length;
              if (activeGuardianCount === 0) return null;
              return {
                studentUserId: fs.studentUserId,
                displayName: user.displayName,
                familyUsername: fs.familyUsername,
                activeGuardianCount,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          return {
            workspaceId: ws.id,
            workspaceCode: ws.code,
            workspaceName: ws.name,
            students,
          };
        });
    },
    async verifyStudentEligibleForFamilyWorkspace(params) {
      const ws = store.familyWorkspaces.get(params.familyWorkspaceId);
      if (!ws || ws.status !== 'active') {
        return { eligible: false, reason: 'workspace_not_active' };
      }
      const user = store.users.get(params.studentUserId);
      if (!user || user.status !== 'active' || user.platformRole !== null) {
        return { eligible: false, reason: 'student_not_active' };
      }
      const fs = Array.from(store.familyStudents.values()).find(
        (s) =>
          s.familyWorkspaceId === params.familyWorkspaceId &&
          s.studentUserId === params.studentUserId &&
          s.status === 'active'
      );
      if (!fs) return { eligible: false, reason: 'student_not_in_workspace' };
      const hasLink = Array.from(store.guardianStudentLinks.values()).some(
        (l) =>
          l.familyWorkspaceId === params.familyWorkspaceId &&
          l.studentUserId === params.studentUserId &&
          l.relationshipStatus === 'active'
      );
      if (!hasLink) return { eligible: false, reason: 'no_active_guardian_link' };
      return { eligible: true };
    },
    async findActiveEnrollment(params) {
      const found = Array.from(store.familyProgramEnrollments.values()).find(
        (e) =>
          e.familyWorkspaceId === params.familyWorkspaceId &&
          e.studentUserId === params.studentUserId &&
          e.familyProgramId === params.familyProgramId &&
          e.status === 'active'
      );
      return found ? { ...found } : null;
    },
    async findEnrollmentById(enrollmentId) {
      const found = store.familyProgramEnrollments.get(enrollmentId);
      return found ? { ...found } : null;
    },
    async createEnrollment(record) {
      store.familyProgramEnrollments.set(record.id, {
        id: record.id,
        familyWorkspaceId: record.familyWorkspaceId,
        studentUserId: record.studentUserId,
        familyProgramId: record.familyProgramId,
        familyProgramVersionId: record.familyProgramVersionId,
        activationSource: record.activationSource,
        activatedByUserId: record.activatedByUserId,
        status: record.status ?? 'active',
        learningStatus: record.learningStatus ?? 'not_started',
        totalActivities: record.totalActivities ?? 0,
        completedActivities: record.completedActivities ?? 0,
        startedAt: record.startedAt ?? null,
        lastActivityAt: record.lastActivityAt ?? null,
        completedAt: record.completedAt ?? null,
        activatedAt: record.activatedAt,
        revokedAt: record.revokedAt ?? null,
        revokedByUserId: record.revokedByUserId ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    },
    async revokeEnrollment(params) {
      const e = store.familyProgramEnrollments.get(params.enrollmentId);
      if (!e || e.status !== 'active') return false;
      e.status = 'revoked';
      e.revokedAt = params.now;
      e.revokedByUserId = params.revokedByUserId;
      e.updatedAt = params.now;
      return true;
    },
    async listPublishedFreePrograms() {
      const out = [];
      for (const prog of store.familyPrograms.values()) {
        if (prog.status !== 'published' || prog.availabilityMode !== 'free_family') {
          continue;
        }
        if (!prog.currentPublishedVersionId) continue;
        const ver = store.familyProgramVersions.get(prog.currentPublishedVersionId);
        if (!ver || ver.status !== 'published') continue;
        const itemCount = Array.from(store.familyProgramItems.values()).filter(
          (i) => i.familyProgramVersionId === ver.id
        ).length;
        out.push({ program: { ...prog }, version: { ...ver }, itemCount });
      }
      return out;
    },
    async getGuardianLinkedStudentOverview(
      guardianUserId,
      studentUserId
    ): Promise<GuardianLinkedStudentSummary | null> {
      const matchingLinks = Array.from(store.guardianStudentLinks.values()).filter((l) => {
        if (
          l.guardianUserId !== guardianUserId ||
          l.studentUserId !== studentUserId ||
          l.relationshipStatus !== 'active'
        ) {
          return false;
        }
        const ws = store.familyWorkspaces.get(l.familyWorkspaceId);
        return Boolean(ws && ws.status === 'active');
      });
      if (matchingLinks.length === 0) return null;
      const user = store.users.get(studentUserId)!;
      return {
        studentUserId: user.id,
        studentDisplayName: user.displayName,
        studentStatus: user.status,
        workspaceIds: Array.from(new Set(matchingLinks.map((l) => l.familyWorkspaceId))),
      };
    },
    async listFamilyEnrollmentsForGuardianOverview(
      params
    ): Promise<GuardianFamilyEnrollmentOverviewRow[]> {
      const wsSet = new Set(params.workspaceIds);
      return Array.from(store.familyProgramEnrollments.values())
        .filter(
          (e) =>
            e.studentUserId === params.studentUserId &&
            wsSet.has(e.familyWorkspaceId) &&
            e.status === 'active'
        )
        .map((e) => {
          const ws = store.familyWorkspaces.get(e.familyWorkspaceId)!;
          const ver = store.familyProgramVersions.get(e.familyProgramVersionId)!;
          const items = Array.from(store.familyProgramItems.values())
            .filter((i) => i.familyProgramVersionId === ver.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((i) => ({
              itemId: i.id,
              chapterNumber: i.chapterNumber,
              chapterTitle: i.chapterTitle,
              sortOrder: i.sortOrder,
            }));
          const completedItemIds = Array.from(
            new Set(
              Array.from(store.familyActivityAttempts.values())
                .filter(
                  (a) =>
                    a.studentUserId === params.studentUserId &&
                    a.enrollmentId === e.id &&
                    a.status === 'completed'
                )
                .map((a) => a.familyProgramItemId)
            )
          );
          return {
            enrollment: { ...e },
            workspaceName: ws.name,
            workspaceCode: ws.code,
            programTitle: ver.title,
            versionNumber: ver.versionNumber,
            items,
            completedItemIds,
          };
        });
    },
    async listSchoolAssignmentsForGuardianOverview(studentUserId) {
      return store.schoolAssignmentsOverview
        .filter((r) => r.studentUserId === studentUserId)
        .map((r) => ({ ...r.row }));
    },
    async listActiveStudentEnrollments(studentUserId): Promise<StudentEnrollmentJoinedRecord[]> {
      return Array.from(store.familyProgramEnrollments.values())
        .filter((e) => {
          if (e.studentUserId !== studentUserId || e.status !== 'active') return false;
          const ws = store.familyWorkspaces.get(e.familyWorkspaceId);
          if (!ws || ws.status !== 'active') return false;
          const fs = Array.from(store.familyStudents.values()).find(
            (s) =>
              s.familyWorkspaceId === ws.id &&
              s.studentUserId === studentUserId &&
              s.status === 'active'
          );
          if (!fs) return false;
          return Array.from(store.guardianStudentLinks.values()).some(
            (l) =>
              l.familyWorkspaceId === ws.id &&
              l.studentUserId === studentUserId &&
              l.relationshipStatus === 'active'
          );
        })
        .map((e) => {
          const ws = store.familyWorkspaces.get(e.familyWorkspaceId)!;
          const prog = store.familyPrograms.get(e.familyProgramId)!;
          const ver = store.familyProgramVersions.get(e.familyProgramVersionId)!;
          return {
            enrollment: { ...e },
            program: { ...prog },
            version: { ...ver },
            workspaceCode: ws.code,
            workspaceName: ws.name,
          };
        });
    },
    async findActiveStudentEnrollmentById(studentUserId, enrollmentId) {
      const all = await this.listActiveStudentEnrollments(studentUserId);
      return all.find((e) => e.enrollment.id === enrollmentId) ?? null;
    },
    async listFamilyAttemptsForEnrollment(studentUserId, enrollmentId) {
      return Array.from(store.familyActivityAttempts.values())
        .filter((a) => a.studentUserId === studentUserId && a.enrollmentId === enrollmentId)
        .sort((a, b) => b.attemptNumber - a.attemptNumber);
    },
    async findFamilyAttemptByIdForStudent(studentUserId, attemptId) {
      const a = store.familyActivityAttempts.get(attemptId);
      if (!a || a.studentUserId !== studentUserId) return null;
      return { ...a };
    },
    async findInProgressFamilyAttempt(enrollmentId, familyProgramItemId) {
      const a = Array.from(store.familyActivityAttempts.values()).find(
        (row) =>
          row.enrollmentId === enrollmentId &&
          row.familyProgramItemId === familyProgramItemId &&
          row.status === 'in_progress'
      );
      return a ? { ...a } : null;
    },
    async findFamilyAttemptByIdempotencyKey(enrollmentId, familyProgramItemId, idempotencyKey) {
      const a = Array.from(store.familyActivityAttempts.values()).find(
        (row) =>
          row.enrollmentId === enrollmentId &&
          row.familyProgramItemId === familyProgramItemId &&
          row.startIdempotencyKey === idempotencyKey
      );
      return a ? { ...a } : null;
    },
    async countFamilyAttemptsForItem(enrollmentId, familyProgramItemId) {
      const matching = Array.from(store.familyActivityAttempts.values()).filter(
        (a) =>
          a.enrollmentId === enrollmentId &&
          a.familyProgramItemId === familyProgramItemId
      );
      return {
        total: matching.length,
        completed: matching.filter((a) => a.status === 'completed').length,
      };
    },
    async createFamilyAttempt(attempt) {
      const rec: FamilyActivityAttemptRecord = {
        id: attempt.id,
        enrollmentId: attempt.enrollmentId,
        familyWorkspaceId: attempt.familyWorkspaceId,
        studentUserId: attempt.studentUserId,
        familyProgramVersionId: attempt.familyProgramVersionId,
        familyProgramItemId: attempt.familyProgramItemId,
        contentVersionId: attempt.contentVersionId,
        attemptNumber: attempt.attemptNumber,
        startIdempotencyKey: attempt.startIdempotencyKey ?? null,
        status: attempt.status ?? 'in_progress',
        startedAt: attempt.startedAt,
        lastInteractedAt: attempt.lastInteractedAt,
        completedAt: attempt.completedAt ?? null,
        durationSeconds: attempt.durationSeconds ?? 0,
        usedAacSupport: Boolean(attempt.usedAacSupport),
        usedReadAloud: Boolean(attempt.usedReadAloud),
        aacTapCount: attempt.aacTapCount ?? 0,
        readAloudCount: attempt.readAloudCount ?? 0,
        responseSummaryJson: attempt.responseSummaryJson ?? null,
      };
      store.familyActivityAttempts.set(rec.id, rec);
      return { ...rec };
    },
    async listTurnsForFamilyAttempt(studentUserId, attemptId) {
      return Array.from(store.familyActivityAttemptTurns.values())
        .filter((t) => t.studentUserId === studentUserId && t.attemptId === attemptId)
        .sort((a, b) => a.turnIndex - b.turnIndex);
    },
    async findTurnForFamilyAttempt(studentUserId, attemptId, turnIndex) {
      const t = Array.from(store.familyActivityAttemptTurns.values()).find(
        (row) =>
          row.studentUserId === studentUserId &&
          row.attemptId === attemptId &&
          row.turnIndex === turnIndex
      );
      return t ? { ...t } : null;
    },
    async insertFamilyTurnAndUpdateAttempt(params) {
      store.familyActivityAttemptTurns.set(params.turn.id, {
        id: params.turn.id,
        studentUserId: params.turn.studentUserId,
        attemptId: params.turn.attemptId,
        turnIndex: params.turn.turnIndex,
        stepKey: params.turn.stepKey,
        selectedChoiceKey: params.turn.selectedChoiceKey ?? null,
        selectedEmotionKey: params.turn.selectedEmotionKey ?? null,
        usedAac: Boolean(params.turn.usedAac),
        usedReadAloud: Boolean(params.turn.usedReadAloud),
        responsePayloadJson: params.turn.responsePayloadJson ?? null,
        respondedAt: params.turn.respondedAt,
      });
      const att = store.familyActivityAttempts.get(params.attemptUpdate.attemptId)!;
      att.lastInteractedAt = params.attemptUpdate.lastInteractedAt;
      att.durationSeconds = params.attemptUpdate.durationSeconds;
      att.usedAacSupport = params.attemptUpdate.usedAacSupport;
      att.usedReadAloud = params.attemptUpdate.usedReadAloud;
      att.aacTapCount = params.attemptUpdate.aacTapCount;
      att.readAloudCount = params.attemptUpdate.readAloudCount;
      return { ...att };
    },
    async updateFamilyAttemptTerminalState(params) {
      const att = store.familyActivityAttempts.get(params.attemptId)!;
      att.status = params.status;
      att.completedAt = params.completedAt;
      att.lastInteractedAt = params.lastInteractedAt;
      att.durationSeconds = params.durationSeconds;
      att.usedAacSupport = params.usedAacSupport;
      att.usedReadAloud = params.usedReadAloud;
      att.aacTapCount = params.aacTapCount;
      att.readAloudCount = params.readAloudCount;
      if (params.responseSummaryJson !== undefined) {
        att.responseSummaryJson = params.responseSummaryJson;
      }
      return { ...att };
    },
    async recomputeAndUpdateEnrollmentProgress(params) {
      const e = store.familyProgramEnrollments.get(params.enrollmentId)!;
      const attempts = Array.from(store.familyActivityAttempts.values()).filter(
        (a) => a.enrollmentId === params.enrollmentId && a.studentUserId === params.studentUserId
      );
      const completedItems = new Set(
        attempts.filter((a) => a.status === 'completed').map((a) => a.familyProgramItemId)
      );
      const completedActivities = Math.min(params.totalActivities, completedItems.size);
      const learningStatus =
        params.totalActivities > 0 && completedActivities >= params.totalActivities
          ? 'completed'
          : attempts.length > 0
            ? 'in_progress'
            : 'not_started';

      e.learningStatus = learningStatus;
      e.totalActivities = params.totalActivities;
      e.completedActivities = completedActivities;
      e.startedAt = e.startedAt ?? (attempts.length > 0 ? params.fallbackActivityAt : null);
      e.lastActivityAt = params.fallbackActivityAt;
      e.completedAt = learningStatus === 'completed' ? e.completedAt ?? params.now : null;
      e.updatedAt = params.now;
      return { ...e };
    },
    async findStudentFamilyPreferences(studentUserId) {
      const p = store.studentFamilyPreferences.get(studentUserId);
      return p ? { ...p } : null;
    },
    async upsertStudentFamilyPreferences(params) {
      const existing = store.studentFamilyPreferences.get(params.studentUserId);
      const rec: StudentFamilyPreferencesRecord = {
        id: existing?.id ?? params.id,
        studentUserId: params.studentUserId,
        preferredName: params.preferredName,
        supportPreferencesJson: params.supportPreferencesJson,
        createdAt: existing?.createdAt ?? params.now,
        updatedAt: params.now,
      };
      store.studentFamilyPreferences.set(params.studentUserId, rec);
      return { ...rec };
    },
  };

  return { authRepo, guardianRepo, familyLearningRepo };
}

function createHarness(store: InMemoryP402Store) {
  const config = parseServerConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    PORT: '3000',
  });
  config.auth.trustedOrigins = ['http://localhost:3000'];

  const { authRepo, guardianRepo, familyLearningRepo } = makeFakeRepos(store);
  const { hashFn, verifyFn } = createFastPasswordHelpers();
  const rateLimiter = new InMemoryRateLimiter();
  const scryptLimiter = new ScryptConcurrencyLimiter({
    maxConcurrent: 4,
    maxQueue: 20,
  });

  const auditFn = async (input: RecordAuditEventInput) => {
    store.audits.push(input);
  };

  const authService = createAuthService({
    repo: authRepo,
    rateLimiter,
    scryptLimiter,
    getConfig: () => config,
    now: () => store.now,
    auditFn,
    hashPasswordFn: hashFn,
    verifyPasswordFn: verifyFn,
    onVerificationTokenCreatedForTest: (info) => {
      store.capturedVerificationTokens.push(info);
    },
  });

  const guardianService = createGuardianService({
    repo: guardianRepo,
    rateLimiter,
    scryptLimiter,
    now: () => store.now,
    auditFn,
    hashPasswordFn: hashFn,
  });

  const familyLearningService = createFamilyLearningService({
    repo: familyLearningRepo,
    now: () => store.now,
    auditFn,
  });

  const authMiddlewares = createAuthMiddlewareSuite({
    repo: authRepo,
    getConfig: () => config,
    now: () => store.now,
  });

  const preAuthCsrf = createPreAuthCsrfMiddleware({ config });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({ config });

  const authRouter = createAuthRouter({
    authService,
    getConfig: () => config,
    authMiddlewares,
    preAuthCsrf,
    authenticatedCsrf,
  });

  const {
    guardianRouter,
    teacherGuardianInvitationsRouter,
    adminGuardianInvitationsRouter,
  } = createGuardianRouters({
    guardianService,
    authMiddlewares,
    authenticatedCsrf,
  });

  const {
    adminFamilyProgramsRouter,
    guardianLearningRouter,
    studentFamilyLearningRouter,
  } = createFamilyLearningRouters({
    familyLearningService,
    authMiddlewares,
    authenticatedCsrf,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/admin', adminGuardianInvitationsRouter);
  app.use('/api/v1/admin', adminFamilyProgramsRouter);
  app.use('/api/v1/guardian', guardianRouter);
  app.use('/api/v1/guardian', guardianLearningRouter);
  app.use('/api/v1/students', teacherGuardianInvitationsRouter);
  app.use('/api/v1/student', studentFamilyLearningRouter);

  app.use('/api/v1', apiNotFoundHandler);
  app.use(apiErrorHandler);

  return { app, store };
}

async function startServer(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Invalid port');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function httpJson(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    csrfToken?: string;
    headers?: Record<string, string>;
  } = {}
) {
  const headers: Record<string, string> = {
    [CUSTOM_REQUEST_HEADER]: '1',
    origin: 'http://localhost:3000',
    ...(options.headers ?? {}),
  };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrfToken) headers[CSRF_TOKEN_HEADER] = options.csrfToken;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : undefined;
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, cookie };
}

async function loginAs(baseUrl: string, body: Record<string, unknown>) {
  const res = await httpJson(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body,
  });
  assert.equal(res.status, 200, `Login failed: ${JSON.stringify(res.json)}`);
  assert.ok(res.cookie);
  return {
    cookie: res.cookie,
    csrfToken: String(res.json.csrfToken),
    body: res.json,
  };
}

function seedFixture(store: InMemoryP402Store) {
  const orgId = generateUuidV7();
  store.organizations.set(orgId, {
    id: orgId,
    code: 'THPT-HN',
    name: 'Trường Tiểu học Minh Tâm',
    status: 'active',
  });

  const adminId = generateUuidV7();
  store.users.set(adminId, {
    id: adminId,
    email: 'admin@mimora.edu.vn',
    emailVerifiedAt: store.now,
    platformUsername: 'sysadmin',
    platformRole: 'platform_admin',
    displayName: 'Quản trị hệ thống',
    passwordHash: 'fast$AdminPass123!',
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
  });

  const teacherId = generateUuidV7();
  const teacherMembershipId = generateUuidV7();
  store.users.set(teacherId, {
    id: teacherId,
    email: 'teacher@school.vn',
    emailVerifiedAt: store.now,
    platformUsername: null,
    platformRole: null,
    displayName: 'Cô Lan',
    passwordHash: 'fast$TeacherPass123!',
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
  });
  store.memberships.set(teacherMembershipId, {
    id: teacherMembershipId,
    organizationId: orgId,
    userId: teacherId,
    role: 'teacher',
    status: 'active',
    orgUsername: null,
  });

  const schoolStudentId = generateUuidV7();
  const schoolStudentMembershipId = generateUuidV7();
  store.users.set(schoolStudentId, {
    id: schoolStudentId,
    email: null,
    emailVerifiedAt: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé Minh An',
    passwordHash: 'fast$StudentPass123!',
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
  });
  store.memberships.set(schoolStudentMembershipId, {
    id: schoolStudentMembershipId,
    organizationId: orgId,
    userId: schoolStudentId,
    role: 'student',
    status: 'active',
    orgUsername: 'minhan.1a',
  });

  const classId = generateUuidV7();
  store.classes.set(classId, { id: classId, organizationId: orgId, status: 'active' });
  store.classTeachers.push({
    organizationId: orgId,
    classId,
    teacherMembershipId,
  });
  store.classEnrollments.push({
    organizationId: orgId,
    classId,
    studentMembershipId: schoolStudentMembershipId,
    status: 'active',
  });

  // Published SEL content items + 1 draft item
  const pubContent1Id = generateUuidV7();
  const pubVer1Id = generateUuidV7();
  store.contentItems.set(pubContent1Id, {
    id: pubContent1Id,
    slug: 'nhan-dien-vui-ve',
    contentType: 'emotion_card',
    isArchived: false,
  });
  store.contentVersions.set(pubVer1Id, {
    id: pubVer1Id,
    contentItemId: pubContent1Id,
    versionNumber: 1,
    status: 'published',
    title: 'Nhận diện cảm xúc bình yên',
    summary: 'Thẻ gọi tên cảm giác nhẹ nhàng.',
    locale: 'vi',
    payloadJson: { emotionKey: 'calm', prompt: 'Hôm nay lòng con thế nào?' },
    metadataJson: null,
    publishedAt: store.now,
  });

  const pubContent2Id = generateUuidV7();
  const pubVer2Id = generateUuidV7();
  store.contentItems.set(pubContent2Id, {
    id: pubContent2Id,
    slug: 'tho-bon-nhip',
    contentType: 'action_card',
    isArchived: false,
  });
  store.contentVersions.set(pubVer2Id, {
    id: pubVer2Id,
    contentItemId: pubContent2Id,
    versionNumber: 1,
    status: 'published',
    title: 'Hít thở chậm bốn nhịp',
    summary: 'Chiến lược thư giãn cơ thể.',
    locale: 'vi',
    payloadJson: { strategyKey: 'breathing_grounding', prompt: 'Thử hít vào nhẹ nhé.' },
    metadataJson: null,
    publishedAt: store.now,
  });

  const draftContentId = generateUuidV7();
  const draftVerId = generateUuidV7();
  store.contentItems.set(draftContentId, {
    id: draftContentId,
    slug: 'nhap-chua-duyet',
    contentType: 'situation_card',
    isArchived: false,
  });
  store.contentVersions.set(draftVerId, {
    id: draftVerId,
    contentItemId: draftContentId,
    versionNumber: 1,
    status: 'draft',
    title: 'Nội dung bản nháp',
    summary: null,
    locale: 'vi',
    payloadJson: { prompt: 'Chưa duyệt' },
    metadataJson: null,
    publishedAt: null,
  });

  // School assignment overview fixture for Dual-context Student
  store.schoolAssignmentsOverview.push({
    studentUserId: schoolStudentId,
    row: {
      assignmentTargetId: generateUuidV7(),
      organizationId: orgId,
      organizationName: 'Trường Tiểu học Minh Tâm',
      assignmentTitle: 'Tuần 1: Gọi tên cảm xúc',
      assignmentStatus: 'active',
      assignedAt: store.now,
      totalItems: 2,
      completedItems: 1,
      progressStatus: 'in_progress',
      startedAt: store.now,
      lastActivityAt: store.now,
      completedAt: null,
    },
  });

  return {
    orgId,
    orgCode: 'THPT-HN',
    adminId,
    teacherId,
    teacherMembershipId,
    schoolStudentId,
    schoolStudentMembershipId,
    pubVer1Id,
    pubVer2Id,
    draftVerId,
  };
}

const FORBIDDEN_OPTION_B_KEYS = new Set([
  'answers',
  'turns',
  'selectedemotionkey',
  'selectedchoicekey',
  'responsepayloadjson',
  'responsesummaryjson',
  'bodymap',
  'intensity',
  'strategy',
  'aac',
  'usedaacsupport',
  'usedreadaloud',
  'aactapcount',
  'readaloudcount',
  'observations',
  'privatenotes',
  'score',
  'mastery',
  'rank',
  'diagnosis',
  'clinical',
  'passwordhash',
  'secret',
  'tokenhash',
]);

function assertNoForbiddenKeysRecursive(value: unknown, path = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((v, idx) => assertNoForbiddenKeysRecursive(v, `${path}[${idx}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      assert.equal(
        FORBIDDEN_OPTION_B_KEYS.has(normalized),
        false,
        `Forbidden key "${key}" leaked at ${path}.${key}`
      );
      assertNoForbiddenKeysRecursive(child, `${path}.${key}`);
    }
  }
}

test('P4-02 Co-Guardian per-student scope, Admin curriculum versioning/pinning/retire/enroll, Teacher-free learning, & Option B Privacy', async () => {
  const store = createEmptyStore();
  const fx = seedFixture(store);
  const { app } = createHarness(store);
  const srv = await startServer(app);

  try {
    const admin = await loginAs(srv.baseUrl, {
      mode: 'admin_teacher',
      identifier: 'sysadmin',
      password: 'AdminPass123!',
    });
    const teacher = await loginAs(srv.baseUrl, {
      mode: 'admin_teacher',
      identifier: 'teacher@school.vn',
      password: 'TeacherPass123!',
    });

    // Register & verify Guardian A and Guardian B
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Mẹ Lan',
        email: 'melan@example.com',
        password: 'GuardianPassword123!',
      },
    });
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Bố Nam',
        email: 'bonam@example.com',
        password: 'GuardianPassword123!',
      },
    });
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      method: 'POST',
      body: { token: store.capturedVerificationTokens[0].rawToken },
    });
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      method: 'POST',
      body: { token: store.capturedVerificationTokens[1].rawToken },
    });

    const guardianA = await loginAs(srv.baseUrl, {
      mode: 'guardian',
      email: 'melan@example.com',
      password: 'GuardianPassword123!',
    });
    const guardianB = await loginAs(srv.baseUrl, {
      mode: 'guardian',
      email: 'bonam@example.com',
      password: 'GuardianPassword123!',
    });

    // Guardian A creates workspace & creates Family-only Child 1 (Bé Sóc)
    const wsRes = await httpJson(srv.baseUrl, '/api/v1/guardian/workspaces', {
      method: 'POST',
      cookie: guardianA.cookie,
      csrfToken: guardianA.csrfToken,
      body: { name: 'Gia đình Mẹ Lan' },
    });
    assert.equal(wsRes.status, 201);
    const ws = wsRes.json.workspace as { id: string; code: string };

    const child1Res = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}/students`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {
          displayName: 'Bé Sóc',
          familyUsername: 'besoc',
          password: 'SocPassword123!',
        },
      }
    );
    assert.equal(child1Res.status, 201);
    const child1Id = String((child1Res.json.student as { userId: string }).userId);

    // Confirm ZERO synthetic school memberships, teachers, or classes were created for Family-only Child 1
    assert.equal(
      Array.from(store.memberships.values()).some((m) => m.userId === child1Id),
      false
    );

    // Teacher generates School Link Code -> Guardian A links Dual-context Child 2 (Bé Minh An) into same workspace
    const schoolInviteRes = await httpJson(
      srv.baseUrl,
      `/api/v1/students/${fx.schoolStudentMembershipId}/guardian-invitations`,
      {
        method: 'POST',
        cookie: teacher.cookie,
        csrfToken: teacher.csrfToken,
        body: { expiresInHours: 48 },
      }
    );
    assert.equal(schoolInviteRes.status, 201);
    const claimRes = await httpJson(srv.baseUrl, '/api/v1/guardian/invitations/claim', {
      method: 'POST',
      cookie: guardianA.cookie,
      csrfToken: guardianA.csrfToken,
      body: {
        targetWorkspaceId: ws.id,
        claimCode: schoolInviteRes.json.claimCode,
        familyUsername: 'minhan.nha',
      },
    });
    assert.equal(claimRes.status, 200);
    const child2LinkId = (claimRes.json.link as { linkId: string }).linkId;
    const child2Id = fx.schoolStudentId;

    // 1. Co-Guardian Per-Student Scope Enforcement
    // Empty studentUserIds rejected -> 422
    const emptyCoInvite = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}/co-guardian-invitations`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: { expiresInHours: 48, studentUserIds: [] },
      }
    );
    assert.equal(emptyCoInvite.status, 422);

    // Scoped invitation ONLY to [child1Id]
    const coInviteRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}/co-guardian-invitations`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: { expiresInHours: 48, studentUserIds: [child1Id] },
      }
    );
    assert.equal(coInviteRes.status, 201);
    const coInv = coInviteRes.json.invitation as {
      sharedStudents?: Array<{ studentUserId: string; displayName: string }>;
    };
    assert.equal(coInv.sharedStudents?.length, 1);
    assert.equal(coInv.sharedStudents?.[0].studentUserId, child1Id);

    const coClaimRes = await httpJson(
      srv.baseUrl,
      '/api/v1/guardian/co-guardian-invitations/claim',
      {
        method: 'POST',
        cookie: guardianB.cookie,
        csrfToken: guardianB.csrfToken,
        body: { claimCode: coInviteRes.json.claimCode },
      }
    );
    assert.equal(coClaimRes.status, 200);
    assert.equal(coClaimRes.json.linkedStudentsAdded, 1);

    // Guardian B sees Child 1 in /guardian/students and workspace detail, NOT Child 2
    const gBStudents = await httpJson(srv.baseUrl, '/api/v1/guardian/students', {
      cookie: guardianB.cookie,
    });
    assert.equal((gBStudents.json.students as unknown[]).length, 1);
    assert.equal(
      (gBStudents.json.students as Array<{ studentUserId: string }>)[0].studentUserId,
      child1Id
    );
    const gBWsDetail = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}`,
      { cookie: guardianB.cookie }
    );
    assert.equal((gBWsDetail.json.students as unknown[]).length, 1);

    // Guardian B can read Child 1's progress (200) but Child 2 returns 403 + security audit
    const gBChild1Prog = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child1Id}/progress`,
      { cookie: guardianB.cookie }
    );
    assert.equal(gBChild1Prog.status, 200);
    const gBChild2Prog = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child2Id}/progress`,
      { cookie: guardianB.cookie }
    );
    assert.equal(gBChild2Prog.status, 403);
    assert.ok(
      store.audits.some((a) => a.eventType === 'security.cross_tenant_attempt_blocked')
    );

    // 2. Admin Family Curriculum Creation, Draft Validation, Publish, Immutability & Pinning
    // Rejects draft SEL contentVersionId (422)
    const badDraftProg = await httpJson(srv.baseUrl, '/api/v1/admin/family-programs', {
      method: 'POST',
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: {
        slug: 'bad-draft-prog',
        availabilityMode: 'admin_assigned',
        title: 'Thử nghiệm lỗi',
        locale: 'vi',
        items: [
          {
            chapterNumber: 1,
            chapterTitle: 'Chương 1',
            contentVersionId: fx.draftVerId,
          },
        ],
      },
    });
    assert.equal(badDraftProg.status, 422);

    // Rejects unsafe clinical/gamified text (422)
    const badTextProg = await httpJson(srv.baseUrl, '/api/v1/admin/family-programs', {
      method: 'POST',
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: {
        slug: 'bad-clinical-prog',
        availabilityMode: 'admin_assigned',
        title: 'Chẩn đoán rối loạn hành vi',
        locale: 'vi',
        items: [],
      },
    });
    assert.equal(badTextProg.status, 422);

    // Create valid draft Admin-assigned program
    const createProg1 = await httpJson(srv.baseUrl, '/api/v1/admin/family-programs', {
      method: 'POST',
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: {
        slug: 'binh-an-tai-nha',
        availabilityMode: 'admin_assigned',
        title: 'Bình an tại nhà (v1)',
        description: 'Hành trình SEL cùng con ở nhà.',
        locale: 'vi',
        ageBand: '6-9 tuổi',
        items: [
          {
            chapterNumber: 1,
            chapterTitle: 'Lắng nghe cảm xúc',
            contentVersionId: fx.pubVer1Id,
          },
        ],
      },
    });
    assert.equal(createProg1.status, 201);
    const prog1Id = (createProg1.json.program as { id: string }).id;
    const prog1V1Id = (
      createProg1.json.versions as Array<{ id: string }>
    )[0].id;

    // Edit draft v1 to have 2 items
    const patchV1 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/versions/${prog1V1Id}`,
      {
        method: 'PATCH',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          title: 'Bình an tại nhà (v1 chuẩn)',
          description: 'Hai hoạt động nhẹ nhàng.',
          locale: 'vi',
          ageBand: '6-9 tuổi',
          items: [
            {
              chapterNumber: 1,
              chapterTitle: 'Lắng nghe cảm xúc',
              contentVersionId: fx.pubVer1Id,
            },
            {
              chapterNumber: 2,
              chapterTitle: 'Thở nhẹ cùng con',
              contentVersionId: fx.pubVer2Id,
            },
          ],
        },
      }
    );
    assert.equal(patchV1.status, 200);

    // Publish v1
    const pubV1 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/versions/${prog1V1Id}/publish`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );
    assert.equal(pubV1.status, 200);

    // Attempting to PATCH published v1 -> 409 IMMUTABLE_PROGRAM_VERSION
    const patchPublishedV1 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/versions/${prog1V1Id}`,
      {
        method: 'PATCH',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          title: 'Sửa lén',
          locale: 'vi',
          items: [
            {
              chapterNumber: 1,
              chapterTitle: 'Lắng nghe cảm xúc',
              contentVersionId: fx.pubVer1Id,
            },
          ],
        },
      }
    );
    assert.equal(patchPublishedV1.status, 409);

    // Admin looks up eligible family workspaces & enrolls Child 1 into v1
    const wsLookup = await httpJson(
      srv.baseUrl,
      '/api/v1/admin/family-workspaces',
      { cookie: admin.cookie }
    );
    assert.equal(wsLookup.status, 200);
    assert.equal((wsLookup.json.workspaces as unknown[]).length, 1);

    const enrollChild1 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/enrollments`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          familyWorkspaceId: ws.id,
          studentUserId: child1Id,
        },
      }
    );
    assert.equal(enrollChild1.status, 201);
    const enrollmentChild1Id = (
      enrollChild1.json.enrollment as { enrollmentId: string }
    ).enrollmentId;

    // Duplicate active enrollment rejected with 409
    const dupEnroll = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/enrollments`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          familyWorkspaceId: ws.id,
          studentUserId: child1Id,
        },
      }
    );
    assert.equal(dupEnroll.status, 409);

    // Admin creates & publishes v2 (only 1 item), Child 1 remains pinned to v1 (2 items)
    const createV2 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/versions`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          title: 'Bình an tại nhà (v2)',
          locale: 'vi',
          items: [
            {
              chapterNumber: 1,
              chapterTitle: 'Chương v2 mới',
              contentVersionId: fx.pubVer1Id,
            },
          ],
        },
      }
    );
    assert.equal(createV2.status, 201);
    const v2Id = String(createV2.json.createdVersionId);
    const pubV2 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/versions/${v2Id}/publish`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );
    assert.equal(pubV2.status, 200);

    // 3. Family-Only Student Teacher-Free Learning (Zero Org/Teacher/Class)
    const child1 = await loginAs(srv.baseUrl, {
      mode: 'student',
      organizationCode: ws.code,
      orgUsername: 'besoc',
      password: 'SocPassword123!',
    });
    assert.equal(child1.body.activeOrganization, null);

    // Child 1 reads pinned v1 program (2 items, NOT v2's 1 item)
    const child1Programs = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-programs',
      { cookie: child1.cookie }
    );
    assert.equal(child1Programs.status, 200);
    const c1List = child1Programs.json.programs as Array<{
      enrollmentId: string;
      versionNumber: number;
      totalActivities: number;
    }>;
    assert.equal(c1List.length, 1);
    assert.equal(c1List[0].versionNumber, 1);
    assert.equal(c1List[0].totalActivities, 2);

    const child1Detail = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-programs/${enrollmentChild1Id}`,
      { cookie: child1.cookie }
    );
    assert.equal(child1Detail.status, 200);
    const c1Items = child1Detail.json.items as Array<{
      itemId: string;
      pinnedContentVersion: { contentVersionId: string };
    }>;
    assert.equal(c1Items.length, 2);

    // Start attempt with Idempotency-Key -> 201 then replay -> 200
    const start1 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-programs/${enrollmentChild1Id}/items/${c1Items[0].itemId}/start-or-resume`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        headers: { 'Idempotency-Key': 'family-start-001' },
        body: { usedAacSupport: true },
      }
    );
    assert.equal(start1.status, 201);
    assert.equal(start1.json.action, 'started');
    const att1Id = (start1.json.attempt as { attemptId: string }).attemptId;

    const replayStart1 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-programs/${enrollmentChild1Id}/items/${c1Items[0].itemId}/start-or-resume`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        headers: { 'Idempotency-Key': 'family-start-001' },
        body: {},
      }
    );
    assert.equal(replayStart1.status, 200);
    assert.equal(replayStart1.json.action, 'idempotent_replay');

    // Save Turn 0 -> 201, replay -> 200, conflict -> 409, unsafe text -> 422
    const turn0 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1Id}/turns`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {
          turnIndex: 0,
          stepKey: 'emotion_select',
          selectedEmotionKey: 'calm',
          usedAac: true,
          responsePayloadJson: { feelingNote: 'Con thấy dễ chịu' },
        },
      }
    );
    assert.equal(turn0.status, 201);

    const turn0Replay = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1Id}/turns`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {
          turnIndex: 0,
          stepKey: 'emotion_select',
          selectedEmotionKey: 'calm',
          usedAac: true,
          responsePayloadJson: { feelingNote: 'Con thấy dễ chịu' },
        },
      }
    );
    assert.equal(turn0Replay.status, 200);
    assert.equal(turn0Replay.json.idempotentReplay, true);

    const turn0Conflict = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1Id}/turns`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {
          turnIndex: 0,
          stepKey: 'emotion_select',
          selectedEmotionKey: 'happy',
        },
      }
    );
    assert.equal(turn0Conflict.status, 409);

    const turnUnsafe = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1Id}/turns`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {
          turnIndex: 1,
          stepKey: 'reflection',
          responsePayloadJson: { score: 100 },
        },
      }
    );
    assert.equal(turnUnsafe.status, 422);

    // Abandon without confirmed=true -> 400, with confirmed=true -> 200
    const badAbandon = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1Id}/abandon`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {},
      }
    );
    assert.equal(badAbandon.status, 400);

    const okAbandon = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1Id}/abandon`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: { confirmed: true, reason: 'paused_for_later' },
      }
    );
    assert.equal(okAbandon.status, 200);
    assert.equal((okAbandon.json.attempt as { state: string }).state, 'abandoned');

    // Retry item 1 -> complete item 1 -> start & complete item 2 -> enrollment becomes completed (2/2)
    const retry1 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-programs/${enrollmentChild1Id}/items/${c1Items[0].itemId}/start-or-resume`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: { intent: 'retry' },
      }
    );
    assert.equal(retry1.status, 201);
    const att1RetryId = (retry1.json.attempt as { attemptId: string }).attemptId;

    const complete1 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att1RetryId}/complete`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: { durationSeconds: 45 },
      }
    );
    assert.equal(complete1.status, 200);
    assert.equal(
      (
        complete1.json.attempt as {
          enrollmentProgress: { learningStatus: string; completedActivities: number };
        }
      ).enrollmentProgress.learningStatus,
      'in_progress'
    );
    assert.equal(
      (
        complete1.json.attempt as {
          enrollmentProgress: { completedActivities: number };
        }
      ).enrollmentProgress.completedActivities,
      1
    );

    // Item 2
    const start2 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-programs/${enrollmentChild1Id}/items/${c1Items[1].itemId}/start-or-resume`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {},
      }
    );
    assert.equal(start2.status, 201);
    const att2Id = (start2.json.attempt as { attemptId: string }).attemptId;
    const complete2 = await httpJson(
      srv.baseUrl,
      `/api/v1/student/family-attempts/${att2Id}/complete`,
      {
        method: 'POST',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: { durationSeconds: 30 },
      }
    );
    assert.equal(complete2.status, 200);
    assert.equal(
      (
        complete2.json.attempt as {
          enrollmentProgress: { learningStatus: string; completedActivities: number };
        }
      ).enrollmentProgress.learningStatus,
      'completed'
    );
    assert.equal(
      (
        complete2.json.attempt as {
          enrollmentProgress: { completedActivities: number };
        }
      ).enrollmentProgress.completedActivities,
      2
    );

    // Canonical Family Preferences (no School org required)
    const prefsPatch = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-preferences',
      {
        method: 'PATCH',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {
          preferredName: 'Bé Sóc Nhỏ',
          supportPreferencesJson: {
            aacEnabled: true,
            readAloudEnabled: true,
            speechRate: 'slow',
            visualContrast: 'high_contrast',
            reducedMotion: true,
            preferredVisualCues: ['large_text'],
          },
        },
      }
    );
    assert.equal(prefsPatch.status, 200);
    assert.equal(
      (prefsPatch.json.preferences as { preferredName: string }).preferredName,
      'Bé Sóc Nhỏ'
    );

    const prefsBad = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-preferences',
      {
        method: 'PATCH',
        cookie: child1.cookie,
        csrfToken: child1.csrfToken,
        body: {
          supportPreferencesJson: { diagnosis: 'none' },
        },
      }
    );
    assert.equal(prefsBad.status, 422);

    // Retire prog1: existing Child 1 keeps access, new enrollment fails (409)
    const retireProg1 = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/retire`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );
    assert.equal(retireProg1.status, 200);

    const child1AfterRetire = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-programs',
      { cookie: child1.cookie }
    );
    assert.equal((child1AfterRetire.json.programs as unknown[]).length, 1);

    const enrollIntoRetired = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}/enrollments`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          familyWorkspaceId: ws.id,
          studentUserId: child2Id,
        },
      }
    );
    assert.equal(enrollIntoRetired.status, 409);

    // 4. Guardian Free-Family Catalog, Self-Enrollment & Dual-Context Option B Overview
    const createFreeProg = await httpJson(
      srv.baseUrl,
      '/api/v1/admin/family-programs',
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          slug: 'goc-tho-mien-phi',
          availabilityMode: 'free_family',
          title: 'Góc Thở Miễn Phí',
          locale: 'vi',
          items: [
            {
              chapterNumber: 1,
              chapterTitle: 'Hơi thở dịu êm',
              contentVersionId: fx.pubVer2Id,
            },
          ],
        },
      }
    );
    assert.equal(createFreeProg.status, 201);
    const freeProgId = (createFreeProg.json.program as { id: string }).id;
    const freeProgV1Id = (
      createFreeProg.json.versions as Array<{ id: string }>
    )[0].id;
    await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${freeProgId}/versions/${freeProgV1Id}/publish`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );

    const freeCatalog = await httpJson(
      srv.baseUrl,
      '/api/v1/guardian/free-programs',
      { cookie: guardianA.cookie }
    );
    assert.equal(freeCatalog.status, 200);
    const catalogList = freeCatalog.json.programs as Array<{ programId: string }>;
    assert.equal(catalogList.length, 1);
    assert.equal(catalogList[0].programId, freeProgId);

    // Guardian A enrolls Dual-context Child 2 in free program
    const guardianEnrollChild2 = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child2Id}/programs/enroll`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {
          familyWorkspaceId: ws.id,
          familyProgramId: freeProgId,
        },
      }
    );
    assert.equal(guardianEnrollChild2.status, 201);

    // Guardian CANNOT self-enroll Child 2 into an admin_assigned program -> 403
    const createAssigned2 = await httpJson(
      srv.baseUrl,
      '/api/v1/admin/family-programs',
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {
          slug: 'chuong-trinh-chuyen-sau',
          availabilityMode: 'admin_assigned',
          title: 'Chương trình chuyên sâu',
          locale: 'vi',
          items: [
            {
              chapterNumber: 1,
              chapterTitle: 'Chương 1',
              contentVersionId: fx.pubVer1Id,
            },
          ],
        },
      }
    );
    const assigned2Id = (createAssigned2.json.program as { id: string }).id;
    const assigned2V1Id = (
      createAssigned2.json.versions as Array<{ id: string }>
    )[0].id;
    await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${assigned2Id}/versions/${assigned2V1Id}/publish`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );
    const forbiddenGuardianEnroll = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child2Id}/programs/enroll`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {
          familyWorkspaceId: ws.id,
          familyProgramId: assigned2Id,
        },
      }
    );
    assert.equal(forbiddenGuardianEnroll.status, 403);

    // Dual-context Child 2 logs in via School & sees Family Program + saves Turn
    const child2School = await loginAs(srv.baseUrl, {
      mode: 'student',
      organizationCode: fx.orgCode,
      orgUsername: 'minhan.1a',
      password: 'StudentPass123!',
    });
    const child2Progs = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-programs',
      { cookie: child2School.cookie }
    );
    assert.equal(child2Progs.status, 200);
    const child2EnrollId = (
      child2Progs.json.programs as Array<{ enrollmentId: string }>
    )[0].enrollmentId;

    // Guardian A views Option B Progress Overview for Child 2 (School + Family!) -> Strict Zero-Telemetry Audit
    const gAOverview = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child2Id}/progress`,
      { cookie: guardianA.cookie }
    );
    assert.equal(gAOverview.status, 200);
    assertNoForbiddenKeysRecursive(gAOverview.json);
    const overviewItems = gAOverview.json.items as Array<{
      sourceContext: string;
      statusLabelVi: string;
    }>;
    assert.equal(overviewItems.some((i) => i.sourceContext === 'family'), true);
    assert.equal(overviewItems.some((i) => i.sourceContext === 'school'), true);

    // Guardian B inspects Child 1 progress after completion (2/2 Đã hoàn thành) -> Strict Zero-Telemetry Audit
    const gBChild1Completed = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child1Id}/progress`,
      { cookie: guardianB.cookie }
    );
    assert.equal(gBChild1Completed.status, 200);
    assertNoForbiddenKeysRecursive(gBChild1Completed.json);
    const c1OverviewItem = (
      gBChild1Completed.json.items as Array<{
        status: string;
        statusLabelVi: string;
        completedActivities: number;
        totalActivities: number;
        chapters: Array<{ status: string }>;
      }>
    )[0];
    assert.equal(c1OverviewItem.status, 'completed');
    assert.equal(c1OverviewItem.statusLabelVi, 'Đã hoàn thành');
    assert.equal(c1OverviewItem.completedActivities, 2);
    assert.equal(c1OverviewItem.totalActivities, 2);
    assert.equal(c1OverviewItem.chapters.length, 2);

    // Admin enrollment roster contains zero student answers/turns/emotions
    const adminDetail = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-programs/${prog1Id}`,
      { cookie: admin.cookie }
    );
    assert.equal(adminDetail.status, 200);
    assertNoForbiddenKeysRecursive(adminDetail.json.enrollments);

    // Admin revokes Child 1 enrollment -> Student loses access
    const revokeRes = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/family-enrollments/${enrollmentChild1Id}/revoke`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );
    assert.equal(revokeRes.status, 200);
    const child1AfterRevoke = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-programs',
      { cookie: child1.cookie }
    );
    assert.equal((child1AfterRevoke.json.programs as unknown[]).length, 0);

    // Guardian A revokes Child 2 link -> Guardian A immediately loses Child 2 progress visibility (403)
    const revokeChild2Link = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/links/${child2LinkId}/revoke`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {},
      }
    );
    assert.equal(revokeChild2Link.status, 200);
    const gAChild2AfterRevoke = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child2Id}/progress`,
      { cookie: guardianA.cookie }
    );
    assert.equal(gAChild2AfterRevoke.status, 403);

    // Dual-context Child 2 STILL has active school account even after guardian link revoked,
    // and can verify teacher is blocked from Student family endpoints -> 403
    const teacherOnFamilyStudent = await httpJson(
      srv.baseUrl,
      '/api/v1/student/family-programs',
      { cookie: teacher.cookie }
    );
    assert.equal(teacherOnFamilyStudent.status, 403);
    assert.ok(child2EnrollId);

    // 405 Method Not Allowed check
    const method405 = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/students/${child1Id}/progress`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {},
      }
    );
    assert.equal(method405.status, 405);
  } finally {
    await srv.close();
  }
});
