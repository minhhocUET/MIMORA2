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
  FamilyMembershipRecord,
  FamilyWorkspaceRecord,
  GuardianRepository,
  LinkInvitationRecord,
} from '../repositories/guardian.repository.ts';
import { createAuthRouter } from '../routes/auth.routes.ts';
import { createGuardianRouters } from '../routes/guardian.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  createPreAuthCsrfMiddleware,
} from '../security/csrf.ts';
import { hashPassword, verifyPassword } from '../security/password-hash.ts';
import { InMemoryRateLimiter } from '../security/rate-limit.ts';
import { ScryptConcurrencyLimiter } from '../security/scrypt-limiter.ts';
import { hashSessionToken } from '../security/session.ts';
import type { RecordAuditEventInput } from './audit.service.ts';
import { createAuthService } from './auth.service.ts';
import { createGuardianService } from './guardian.service.ts';

interface InMemoryP4Store {
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
  audits: RecordAuditEventInput[];
  capturedVerificationTokens: Array<{
    userId: string;
    rawToken: string;
    tokenHash: string;
  }>;
}

function createEmptyP4Store(): InMemoryP4Store {
  return {
    now: new Date('2026-11-19T10:00:00.000Z'),
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
    audits: [],
    capturedVerificationTokens: [],
  };
}

function createFastPasswordHelpers() {
  return {
    hashFn: async (password: string) => `fast$${password}`,
    verifyFn: async (password: string, hash: string) => {
      if (hash.startsWith('fast$')) {
        return hash === `fast$${password}`;
      }
      if (hash.startsWith('scrypt$')) {
        return verifyPassword(password, hash);
      }
      return false;
    },
  };
}

function makeFakeRepos(store: InMemoryP4Store) {
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
      if (u) {
        u.passwordHash = newPasswordHash;
      }
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
        ? {
            id: fs.id,
            studentUserId: fs.studentUserId,
            familyUsername: fs.familyUsername,
          }
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
    async findSharedActiveClassIds(
      organizationId,
      teacherMembershipId,
      studentMembershipId
    ) {
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
          if (cls && cls.status === 'active') {
            out.push(ce.classId);
          }
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
        if (!list.includes(entry.studentUserId)) {
          list.push(entry.studentUserId);
        }
        store.invitationStudents.set(entry.invitationId, list);
      }
    },
    async listInvitationScopedStudentIds(invitationId) {
      return [...(store.invitationStudents.get(invitationId) ?? [])];
    },
    async listScopedStudentsForInvitations(invitationIds) {
      const result = new Map<
        string,
        Array<{ studentUserId: string; displayName: string }>
      >();
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

  return { authRepo, guardianRepo };
}

function createTestHarness(store: InMemoryP4Store) {
  const config = parseServerConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    PORT: '3000',
  });
  config.auth.trustedOrigins = ['http://localhost:3000'];
  const { authRepo, guardianRepo } = makeFakeRepos(store);
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

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/guardian', guardianRouter);
  app.use('/api/v1/students', teacherGuardianInvitationsRouter);
  app.use('/api/v1/admin', adminGuardianInvitationsRouter);

  // Representative P2 guarded routes verifying guardian/student RBAC isolation
  app.get(
    '/api/v1/admin/organizations',
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
    (_req, res) => res.json({ status: 'ok' })
  );
  app.get(
    '/api/v1/classes',
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
    (_req, res) => res.json({ status: 'ok' })
  );
  app.get(
    '/api/v1/student/assignments',
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('student'),
    authMiddlewares.requireOrgContext,
    (_req, res) => res.json({ status: 'ok' })
  );
  app.get(
    '/api/v1/observations',
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
    (_req, res) => res.json({ status: 'ok' })
  );

  app.use('/api/v1', apiNotFoundHandler);
  app.use(apiErrorHandler);

  return { app, store, guardianService, authService };
}

async function startServer(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface SessionClient {
  cookie: string;
  csrfToken: string;
  body: Record<string, unknown>;
}

async function httpJson(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    csrfToken?: string;
    origin?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    [CUSTOM_REQUEST_HEADER]: '1',
    origin: options.origin ?? 'http://localhost:3000',
  };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.csrfToken) {
    headers[CSRF_TOKEN_HEADER] = options.csrfToken;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const setCookieHeader = res.headers.get('set-cookie');
  const cookie = setCookieHeader ? setCookieHeader.split(';')[0] : undefined;
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, cookie };
}

async function loginAs(
  baseUrl: string,
  body: Record<string, unknown>
): Promise<SessionClient> {
  const res = await httpJson(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body,
  });
  assert.equal(res.status, 200, `Login failed: ${JSON.stringify(res.json)}`);
  assert.ok(res.cookie, 'Expected session cookie on login');
  return {
    cookie: res.cookie,
    csrfToken: String(res.json.csrfToken),
    body: res.json,
  };
}

function seedSchoolFixture(store: InMemoryP4Store) {
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

  const teacher1Id = generateUuidV7();
  const teacher1MembershipId = generateUuidV7();
  store.users.set(teacher1Id, {
    id: teacher1Id,
    email: 'teacher1@school.vn',
    emailVerifiedAt: store.now,
    platformUsername: null,
    platformRole: null,
    displayName: 'Cô Lan',
    passwordHash: 'fast$TeacherPass123!',
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
  });
  store.memberships.set(teacher1MembershipId, {
    id: teacher1MembershipId,
    organizationId: orgId,
    userId: teacher1Id,
    role: 'teacher',
    status: 'active',
    orgUsername: null,
  });

  const teacher2Id = generateUuidV7();
  const teacher2MembershipId = generateUuidV7();
  store.users.set(teacher2Id, {
    id: teacher2Id,
    email: 'teacher2@school.vn',
    emailVerifiedAt: store.now,
    platformUsername: null,
    platformRole: null,
    displayName: 'Thầy Hùng (lớp khác)',
    passwordHash: 'fast$TeacherPass123!',
    status: 'active',
    failedLoginAttempts: 0,
    lockedUntil: null,
  });
  store.memberships.set(teacher2MembershipId, {
    id: teacher2MembershipId,
    organizationId: orgId,
    userId: teacher2Id,
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
  store.classes.set(classId, {
    id: classId,
    organizationId: orgId,
    status: 'active',
  });
  store.classTeachers.push({
    organizationId: orgId,
    classId,
    teacherMembershipId: teacher1MembershipId,
  });
  store.classEnrollments.push({
    organizationId: orgId,
    classId,
    studentMembershipId: schoolStudentMembershipId,
    status: 'active',
  });

  return {
    orgId,
    orgCode: 'THPT-HN',
    adminId,
    teacher1Id,
    teacher1MembershipId,
    teacher2Id,
    teacher2MembershipId,
    schoolStudentId,
    schoolStudentMembershipId,
    classId,
  };
}

test('P4-01 Guardian registration, explicit email verification, honest mailDelivery, and login modes', async () => {
  const store = createEmptyP4Store();
  seedSchoolFixture(store);
  const { app } = createTestHarness(store);
  const srv = await startServer(app);

  try {
    // 1. Cannot pass extra privilege escalation fields on registration
    const escalationRes = await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Mẹ Hoa',
        email: 'hoa@example.com',
        password: 'GuardianPassword123!',
        platformRole: 'platform_admin',
      },
    });
    assert.equal(escalationRes.status, 422);

    // 2. Valid public Guardian registration -> 201, unverified, honest mailDelivery, NO raw token leaked
    const regRes = await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Mẹ Hoa',
        email: '  Hoa@Example.com ',
        password: 'GuardianPassword123!',
      },
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.json.requiresEmailVerification, true);
    assert.deepEqual(regRes.json.mailDelivery, {
      configured: false,
      provider: null,
      delivered: false,
      verificationState: 'pending_verification',
    });
    const regJsonText = JSON.stringify(regRes.json);
    assert.equal(store.capturedVerificationTokens.length, 1);
    const firstRawToken = store.capturedVerificationTokens[0].rawToken;
    assert.equal(regJsonText.includes(firstRawToken), false);
    assert.equal((regRes.json.user as Record<string, unknown>).platformRole, 'guardian');
    assert.equal((regRes.json.user as Record<string, unknown>).emailVerified, false);

    // Duplicate email rejected with 409
    const dupRes = await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Mẹ Hoa 2',
        email: 'hoa@example.com',
        password: 'GuardianPassword123!',
      },
    });
    assert.equal(dupRes.status, 409);

    // 3. Guardian cannot log in via admin_teacher mode
    const wrongModeRes = await httpJson(srv.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        mode: 'admin_teacher',
        identifier: 'hoa@example.com',
        password: 'GuardianPassword123!',
      },
    });
    assert.equal(wrongModeRes.status, 401);

    // 4. Unverified Guardian can log in with mode: 'guardian', but protected guardian actions return 403 GUARDIAN_EMAIL_VERIFICATION_REQUIRED
    const unverifiedSession = await loginAs(srv.baseUrl, {
      mode: 'guardian',
      email: 'hoa@example.com',
      password: 'GuardianPassword123!',
    });
    assert.equal(unverifiedSession.body.requiresEmailVerification, true);
    assert.equal(
      (unverifiedSession.body.session as Record<string, unknown>).scope,
      'guardian'
    );

    const blockedWsRes = await httpJson(srv.baseUrl, '/api/v1/guardian/workspaces', {
      method: 'POST',
      cookie: unverifiedSession.cookie,
      csrfToken: unverifiedSession.csrfToken,
      body: { name: 'Nhà Hoa' },
    });
    assert.equal(blockedWsRes.status, 403);
    assert.equal(blockedWsRes.json.code, 'GUARDIAN_EMAIL_VERIFICATION_REQUIRED');

    // 5. Resend verification invalidates old token and creates a new token without leaking rawToken
    const resendRes = await httpJson(
      srv.baseUrl,
      '/api/v1/auth/guardian/resend-verification',
      {
        method: 'POST',
        cookie: unverifiedSession.cookie,
        csrfToken: unverifiedSession.csrfToken,
        body: {},
      }
    );
    assert.equal(resendRes.status, 200);
    assert.equal(store.capturedVerificationTokens.length, 2);
    const secondRawToken = store.capturedVerificationTokens[1].rawToken;
    assert.equal(JSON.stringify(resendRes.json).includes(secondRawToken), false);

    // First token was revoked and fails verification
    const verifyOldRes = await httpJson(
      srv.baseUrl,
      '/api/v1/auth/guardian/verify-email',
      {
        method: 'POST',
        body: { token: firstRawToken },
      }
    );
    assert.equal(verifyOldRes.status, 400);

    // Verify with latest token -> 200 and session /me immediately reflects emailVerified: true
    const verifyOkRes = await httpJson(
      srv.baseUrl,
      '/api/v1/auth/guardian/verify-email',
      {
        method: 'POST',
        body: { token: secondRawToken },
      }
    );
    assert.equal(verifyOkRes.status, 200);
    assert.equal(verifyOkRes.json.verified, true);

    // Single-use token cannot be reused
    const reuseRes = await httpJson(
      srv.baseUrl,
      '/api/v1/auth/guardian/verify-email',
      {
        method: 'POST',
        body: { token: secondRawToken },
      }
    );
    assert.equal(reuseRes.status, 409);

    const meRes = await httpJson(srv.baseUrl, '/api/v1/auth/me', {
      cookie: unverifiedSession.cookie,
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.json.requiresEmailVerification, false);
    assert.equal((meRes.json.user as Record<string, unknown>).emailVerified, true);
  } finally {
    await srv.close();
  }
});

test('P4-01 Family Workspace creation, Student creation without Teacher/School, and Family-only Student login', async () => {
  const store = createEmptyP4Store();
  const { app } = createTestHarness(store);
  const srv = await startServer(app);

  try {
    // Register & verify Guardian
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Bố Nam',
        email: 'nam@example.com',
        password: 'GuardianPassword123!',
      },
    });
    const rawTok = store.capturedVerificationTokens[0].rawToken;
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      method: 'POST',
      body: { token: rawTok },
    });

    const guardian = await loginAs(srv.baseUrl, {
      mode: 'guardian',
      email: 'nam@example.com',
      password: 'GuardianPassword123!',
    });

    // Create Family Workspace
    const wsRes = await httpJson(srv.baseUrl, '/api/v1/guardian/workspaces', {
      method: 'POST',
      cookie: guardian.cookie,
      csrfToken: guardian.csrfToken,
      body: { name: 'Gia đình Bố Nam' },
    });
    assert.equal(wsRes.status, 201);
    const ws = wsRes.json.workspace as { id: string; code: string; name: string };
    assert.match(ws.code, /^FAM-[A-Z0-9]{6}$/);

    // Reject clinical / diagnosis wording and extra unpermitted fields (like child email) on Student creation
    const extraEmailRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}/students`,
      {
        method: 'POST',
        cookie: guardian.cookie,
        csrfToken: guardian.csrfToken,
        body: {
          displayName: 'Bé Sóc',
          familyUsername: 'soc.nho',
          password: 'StudentPassword1!',
          email: 'child@example.com',
        },
      }
    );
    assert.equal(extraEmailRes.status, 422);

    const clinicalRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}/students`,
      {
        method: 'POST',
        cookie: guardian.cookie,
        csrfToken: guardian.csrfToken,
        body: {
          displayName: 'Bé chẩn đoán rối loạn',
          familyUsername: 'soc.nho',
          password: 'StudentPassword1!',
        },
      }
    );
    assert.equal(clinicalRes.status, 422);

    // Valid Family Student creation without any School/Teacher/Class
    const studentCreateRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${ws.id}/students`,
      {
        method: 'POST',
        cookie: guardian.cookie,
        csrfToken: guardian.csrfToken,
        body: {
          displayName: 'Bé Sóc',
          familyUsername: 'soc.nho',
          password: 'StudentPassword1!',
        },
      }
    );
    assert.equal(studentCreateRes.status, 201);
    const createdStudent = studentCreateRes.json.student as {
      userId: string;
      familyUsername: string;
      workspaceCode: string;
    };
    assert.equal(createdStudent.familyUsername, 'soc.nho');
    assert.equal(createdStudent.workspaceCode, ws.code);
    assert.equal(store.organizations.size, 0);

    // Student logs in with Family Workspace Code + familyUsername + password via mode: 'student'
    const studentSession = await loginAs(srv.baseUrl, {
      mode: 'student',
      organizationCode: ws.code,
      orgUsername: 'soc.nho',
      password: 'StudentPassword1!',
    });
    assert.equal(
      (studentSession.body.session as Record<string, unknown>).scope,
      'student'
    );
    assert.equal(studentSession.body.activeOrganization, null);
    assert.deepEqual(studentSession.body.organizations, []);

    // Family-only Student gets 403 ORGANIZATION_CONTEXT_REQUIRED on org-scoped student endpoints
    const orgStudentEndpointRes = await httpJson(
      srv.baseUrl,
      '/api/v1/student/assignments',
      {
        cookie: studentSession.cookie,
      }
    );
    assert.equal(orgStudentEndpointRes.status, 403);
    assert.equal(orgStudentEndpointRes.json.code, 'ORGANIZATION_CONTEXT_REQUIRED');
  } finally {
    await srv.close();
  }
});

test('P4-01 School Student linking, canonical identity preservation, multi-guardian co-link & non-destructive revocation', async () => {
  const store = createEmptyP4Store();
  const school = seedSchoolFixture(store);
  const { app } = createTestHarness(store);
  const srv = await startServer(app);

  try {
    const teacher1 = await loginAs(srv.baseUrl, {
      mode: 'admin_teacher',
      identifier: 'teacher1@school.vn',
      password: 'TeacherPass123!',
    });
    const teacher2 = await loginAs(srv.baseUrl, {
      mode: 'admin_teacher',
      identifier: 'teacher2@school.vn',
      password: 'TeacherPass123!',
    });
    const admin = await loginAs(srv.baseUrl, {
      mode: 'admin_teacher',
      identifier: 'sysadmin',
      password: 'AdminPass123!',
    });

    // Unrelated Teacher (teacher2) cannot issue or list invitations for student not in their class
    const unrelatedCreateRes = await httpJson(
      srv.baseUrl,
      `/api/v1/students/${school.schoolStudentMembershipId}/guardian-invitations`,
      {
        method: 'POST',
        cookie: teacher2.cookie,
        csrfToken: teacher2.csrfToken,
        body: { expiresInHours: 72 },
      }
    );
    assert.equal(unrelatedCreateRes.status, 403);

    // Assigned Teacher (teacher1) issues one-time School Student invitation
    const inviteRes = await httpJson(
      srv.baseUrl,
      `/api/v1/students/${school.schoolStudentMembershipId}/guardian-invitations`,
      {
        method: 'POST',
        cookie: teacher1.cookie,
        csrfToken: teacher1.csrfToken,
        body: { expiresInHours: 72 },
      }
    );
    assert.equal(inviteRes.status, 201);
    const claimCode1 = String(inviteRes.json.claimCode);
    assert.match(claimCode1, /^MIM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // Subsequent GET listing by Teacher/Admin NEVER exposes plaintext claimCode or Guardian PII
    const teacherListInvRes = await httpJson(
      srv.baseUrl,
      `/api/v1/students/${school.schoolStudentMembershipId}/guardian-invitations`,
      { cookie: teacher1.cookie }
    );
    assert.equal(teacherListInvRes.status, 200);
    assert.equal(JSON.stringify(teacherListInvRes.json).includes(claimCode1), false);

    // Register & verify Guardian A and Guardian B
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Mẹ Mai',
        email: 'mai@example.com',
        password: 'GuardianPassword123!',
      },
    });
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Bố Khoa',
        email: 'khoa@example.com',
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
      email: 'mai@example.com',
      password: 'GuardianPassword123!',
    });
    const guardianB = await loginAs(srv.baseUrl, {
      mode: 'guardian',
      email: 'khoa@example.com',
      password: 'GuardianPassword123!',
    });

    // Guardian A creates Family Workspace and claims School invitation
    const wsRes = await httpJson(srv.baseUrl, '/api/v1/guardian/workspaces', {
      method: 'POST',
      cookie: guardianA.cookie,
      csrfToken: guardianA.csrfToken,
      body: { name: 'Gia đình Minh An' },
    });
    const wsId = (wsRes.json.workspace as { id: string }).id;

    // Cross-workspace check: Guardian B is NOT a member of Guardian A's workspace -> 403
    const crossWsRes = await httpJson(srv.baseUrl, `/api/v1/guardian/workspaces/${wsId}`, {
      cookie: guardianB.cookie,
    });
    assert.equal(crossWsRes.status, 403);

    // Invalid claim code fails cleanly (zero discovery)
    const badClaimRes = await httpJson(srv.baseUrl, '/api/v1/guardian/invitations/claim', {
      method: 'POST',
      cookie: guardianA.cookie,
      csrfToken: guardianA.csrfToken,
      body: {
        targetWorkspaceId: wsId,
        claimCode: 'MIM-XXXX-YYYY-ZZZZ',
      },
    });
    assert.equal(badClaimRes.status, 400);

    // Claim valid School invitation -> canonical users.id reused!
    const claimRes = await httpJson(srv.baseUrl, '/api/v1/guardian/invitations/claim', {
      method: 'POST',
      cookie: guardianA.cookie,
      csrfToken: guardianA.csrfToken,
      body: {
        targetWorkspaceId: wsId,
        claimCode: claimCode1,
        familyUsername: 'minhan.home',
      },
    });
    assert.equal(claimRes.status, 200);
    const linkInfoA = claimRes.json.link as { linkId: string; studentUserId: string };
    assert.equal(linkInfoA.studentUserId, school.schoolStudentId);

    // Claiming same single-use code again fails with 409
    const reuseClaimRes = await httpJson(srv.baseUrl, '/api/v1/guardian/invitations/claim', {
      method: 'POST',
      cookie: guardianB.cookie,
      csrfToken: guardianB.csrfToken,
      body: {
        targetWorkspaceId: wsId,
        claimCode: claimCode1,
      },
    });
    assert.ok(reuseClaimRes.status === 403 || reuseClaimRes.status === 409);

    // Teacher view after claim STILL contains zero Guardian PII
    const teacherAfterClaimRes = await httpJson(
      srv.baseUrl,
      `/api/v1/students/${school.schoolStudentMembershipId}/guardian-invitations`,
      { cookie: teacher1.cookie }
    );
    const teacherJsonStr = JSON.stringify(teacherAfterClaimRes.json);
    assert.equal(teacherJsonStr.includes('mai@example.com'), false);
    assert.equal(teacherJsonStr.includes('Mẹ Mai'), false);

    // Admin creates & revokes a pending invitation (verifies Admin flow + revocation blocking)
    const adminInviteRes = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/organizations/${school.orgId}/students/${school.schoolStudentMembershipId}/guardian-invitations`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: { expiresInHours: 24 },
      }
    );
    assert.equal(adminInviteRes.status, 201);
    const adminInvId = (adminInviteRes.json.invitation as { id: string }).id;
    const adminInvCode = String(adminInviteRes.json.claimCode);

    const adminRevokeRes = await httpJson(
      srv.baseUrl,
      `/api/v1/admin/organizations/${school.orgId}/guardian-invitations/${adminInvId}/revoke`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: {},
      }
    );
    assert.equal(adminRevokeRes.status, 200);

    const claimRevokedRes = await httpJson(
      srv.baseUrl,
      '/api/v1/guardian/invitations/claim',
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {
          targetWorkspaceId: wsId,
          claimCode: adminInvCode,
        },
      }
    );
    assert.equal(claimRevokedRes.status, 409);

    // Co-guardian flow: Guardian A invites Guardian B into same Family Workspace with explicit student scope
    const coInviteRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/workspaces/${wsId}/co-guardian-invitations`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: { expiresInHours: 48, studentUserIds: [school.schoolStudentId] },
      }
    );
    assert.equal(coInviteRes.status, 201);
    const coCode = String(coInviteRes.json.claimCode);
    assert.match(coCode, /^CGU-/);

    const coClaimRes = await httpJson(
      srv.baseUrl,
      '/api/v1/guardian/co-guardian-invitations/claim',
      {
        method: 'POST',
        cookie: guardianB.cookie,
        csrfToken: guardianB.csrfToken,
        body: { claimCode: coCode },
      }
    );
    assert.equal(coClaimRes.status, 200);
    assert.equal(coClaimRes.json.linkedStudentsAdded, 1);

    // Guardian B lists my students -> sees Bé Minh An linked to canonical ID, ZERO private student telemetry fields
    const listBRes = await httpJson(srv.baseUrl, '/api/v1/guardian/students', {
      cookie: guardianB.cookie,
    });
    assert.equal(listBRes.status, 200);
    const studentsB = listBRes.json.students as Array<Record<string, unknown>>;
    assert.equal(studentsB.length, 1);
    assert.equal(studentsB[0].studentUserId, school.schoolStudentId);
    const studentBKeys = Object.keys(studentsB[0]);
    for (const forbiddenKey of [
      'answers',
      'turns',
      'emotion',
      'bodyMap',
      'intensity',
      'strategy',
      'aacLogs',
      'observations',
    ]) {
      assert.equal(studentBKeys.includes(forbiddenKey), false);
    }

    // Guardian B cannot revoke Guardian A's link -> 403
    const revokeOtherRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/links/${linkInfoA.linkId}/revoke`,
      {
        method: 'POST',
        cookie: guardianB.cookie,
        csrfToken: guardianB.csrfToken,
        body: {},
      }
    );
    assert.equal(revokeOtherRes.status, 403);

    // Guardian A revokes own link -> Student user, School membership, and Guardian B's link all remain active!
    const revokeOwnRes = await httpJson(
      srv.baseUrl,
      `/api/v1/guardian/links/${linkInfoA.linkId}/revoke`,
      {
        method: 'POST',
        cookie: guardianA.cookie,
        csrfToken: guardianA.csrfToken,
        body: {},
      }
    );
    assert.equal(revokeOwnRes.status, 200);

    const listAAfterRevoke = await httpJson(srv.baseUrl, '/api/v1/guardian/students', {
      cookie: guardianA.cookie,
    });
    assert.equal((listAAfterRevoke.json.students as unknown[]).length, 0);

    const listBAfterRevoke = await httpJson(srv.baseUrl, '/api/v1/guardian/students', {
      cookie: guardianB.cookie,
    });
    assert.equal((listBAfterRevoke.json.students as unknown[]).length, 1);

    // School membership and Student login remain untouched
    assert.equal(store.users.get(school.schoolStudentId)?.status, 'active');
    assert.equal(store.memberships.get(school.schoolStudentMembershipId)?.status, 'active');
    const studentSchoolLogin = await loginAs(srv.baseUrl, {
      mode: 'student',
      organizationCode: school.orgCode,
      orgUsername: 'minhan.1a',
      password: 'StudentPass123!',
    });
    assert.equal(
      (studentSchoolLogin.body.activeOrganization as { code: string }).code,
      school.orgCode
    );
  } finally {
    await srv.close();
  }
});

test('P4-01 Strict RBAC boundaries, claim rate-limiting, and 405 Method Not Allowed', async () => {
  const store = createEmptyP4Store();
  seedSchoolFixture(store);
  const { app } = createTestHarness(store);
  const srv = await startServer(app);

  try {
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/register', {
      method: 'POST',
      body: {
        displayName: 'Cô Thu',
        email: 'thu@example.com',
        password: 'GuardianPassword123!',
      },
    });
    await httpJson(srv.baseUrl, '/api/v1/auth/guardian/verify-email', {
      method: 'POST',
      body: { token: store.capturedVerificationTokens[0].rawToken },
    });
    const guardian = await loginAs(srv.baseUrl, {
      mode: 'guardian',
      email: 'thu@example.com',
      password: 'GuardianPassword123!',
    });

    const teacher = await loginAs(srv.baseUrl, {
      mode: 'admin_teacher',
      identifier: 'teacher1@school.vn',
      password: 'TeacherPass123!',
    });

    // Guardian blocked from Admin, Teacher, Classes, Observations, and Student portals
    for (const path of [
      '/api/v1/admin/organizations',
      '/api/v1/classes',
      '/api/v1/observations',
      '/api/v1/student/assignments',
    ]) {
      const r = await httpJson(srv.baseUrl, path, { cookie: guardian.cookie });
      assert.equal(r.status, 403, `Expected 403 for guardian on ${path}`);
    }

    // Teacher cannot call Guardian endpoints
    const teacherOnGuardian = await httpJson(srv.baseUrl, '/api/v1/guardian/profile', {
      cookie: teacher.cookie,
    });
    assert.equal(teacherOnGuardian.status, 403);

    // 405 on invalid method
    const badMethodRes = await httpJson(srv.baseUrl, '/api/v1/guardian/profile', {
      method: 'POST',
      cookie: guardian.cookie,
      csrfToken: guardian.csrfToken,
      body: {},
    });
    assert.equal(badMethodRes.status, 405);

    // Create workspace and verify rate limiting on repeated invalid invitation claims -> 429
    const wsRes = await httpJson(srv.baseUrl, '/api/v1/guardian/workspaces', {
      method: 'POST',
      cookie: guardian.cookie,
      csrfToken: guardian.csrfToken,
      body: { name: 'Gia đình Cô Thu' },
    });
    const wsId = (wsRes.json.workspace as { id: string }).id;

    let hit429 = false;
    for (let i = 0; i < 12; i += 1) {
      const claimAttempt = await httpJson(
        srv.baseUrl,
        '/api/v1/guardian/invitations/claim',
        {
          method: 'POST',
          cookie: guardian.cookie,
          csrfToken: guardian.csrfToken,
          body: {
            targetWorkspaceId: wsId,
            claimCode: `MIM-0000-0000-000${i}`,
          },
        }
      );
      if (claimAttempt.status === 429) {
        hit429 = true;
        break;
      }
    }
    assert.equal(hit429, true, 'Expected 429 rate limit after repeated claim attempts');
  } finally {
    await srv.close();
  }
});

test('P4-01 Hash compatibility check with real scrypt password hashing', async () => {
  const hash = await hashPassword('GuardianRealScrypt1!');
  assert.match(hash, /^scrypt\$v1\$/);
  const ok = await verifyPassword('GuardianRealScrypt1!', hash);
  assert.equal(ok, true);
});
