import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { parseServerConfig, type ServerConfig } from '../config/env.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import { AppError } from '../http/errors.ts';
import { apiErrorHandler, apiNotFoundHandler } from '../http/middleware.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import type {
  AuthRepository,
  SessionWithContextRecord,
} from '../repositories/auth.repository.ts';
import type {
  ContentApprovalRecord,
  ContentItemRecord,
  ContentRepository,
  ContentVersionRecord,
  PublishedLibraryRecord,
} from '../repositories/content.repository.ts';
import { createAdminContentRouter } from '../routes/admin-content.routes.ts';
import { createLibraryRouter } from '../routes/library.routes.ts';
import {
  CSRF_TOKEN_HEADER,
  CUSTOM_REQUEST_HEADER,
  createAuthenticatedCsrfMiddleware,
  deriveSessionCsrfToken,
} from '../security/csrf.ts';
import { generateSessionToken, hashSessionToken } from '../security/session.ts';
import { validateContentPayloadAndMetadata } from '../validators/content-payload.schema.ts';
import { recordAuditEvent } from './audit.service.ts';
import { createContentService } from './content.service.ts';

type AuditEventInput = Parameters<typeof recordAuditEvent>[0];

interface InMemoryP204Store {
  users: Map<
    string,
    {
      id: string;
      email: string | null;
      platformUsername: string | null;
      platformRole: string | null;
      displayName: string;
      status: string;
    }
  >;
  memberships: Map<
    string,
    {
      id: string;
      organizationId: string;
      userId: string;
      role: 'teacher' | 'student';
      status: 'active' | 'disabled';
    }
  >;
  organizations: Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      status: 'active' | 'suspended';
    }
  >;
  sessions: Map<
    string,
    {
      id: string;
      tokenHash: string;
      userId: string;
      sessionScope: 'platform_admin' | 'teacher' | 'student';
      activeOrganizationId: string | null;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      lastActivityAt: Date;
      revokedAt: Date | null;
      revokedReason: string | null;
    }
  >;
  contentItems: Map<string, ContentItemRecord>;
  contentVersions: Map<string, ContentVersionRecord>;
  contentApprovals: Map<string, ContentApprovalRecord>;
  audits: AuditEventInput[];
  txQueue: Promise<unknown>;
}

function createEmptyP204Store(): InMemoryP204Store {
  return {
    users: new Map(),
    memberships: new Map(),
    organizations: new Map(),
    sessions: new Map(),
    contentItems: new Map(),
    contentVersions: new Map(),
    contentApprovals: new Map(),
    audits: [],
    txQueue: Promise.resolve(),
  };
}

function cloneItem(r: ContentItemRecord): ContentItemRecord {
  return {
    ...r,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function cloneVersion(r: ContentVersionRecord): ContentVersionRecord {
  return {
    ...r,
    payloadJson: structuredClone(r.payloadJson),
    metadataJson: r.metadataJson ? structuredClone(r.metadataJson) : null,
    publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function cloneApproval(r: ContentApprovalRecord): ContentApprovalRecord {
  return {
    ...r,
    submittedAt: new Date(r.submittedAt),
    decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
  };
}

function makeFakeContentRepo(store: InMemoryP204Store): ContentRepository {
  return {
    withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      // Serialize in-memory transactions to simulate InnoDB/TiDB FOR UPDATE row locking faithfully
      const next = store.txQueue.then(() => fn({} as never));
      store.txQueue = next.catch(() => undefined);
      return next;
    },

    async listContentItems(params) {
      let items = Array.from(store.contentItems.values());
      if (params.contentType) {
        items = items.filter((i) => i.contentType === params.contentType);
      }
      if (params.isArchived !== undefined) {
        items = items.filter((i) => i.isArchived === params.isArchived);
      }
      if (params.search && params.search.trim().length > 0) {
        const needle = params.search.trim().toLowerCase();
        items = items.filter((i) => i.slug.toLowerCase().includes(needle));
      }
      items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const offset = (params.page - 1) * params.limit;
      return {
        items: items.slice(offset, offset + params.limit).map(cloneItem),
        total: items.length,
      };
    },

    async findContentItemById(itemId) {
      const found = store.contentItems.get(itemId);
      return found ? cloneItem(found) : null;
    },

    async findContentItemByIdForUpdate(itemId) {
      const found = store.contentItems.get(itemId);
      return found ? cloneItem(found) : null;
    },

    async findContentItemBySlug(slug) {
      for (const item of store.contentItems.values()) {
        if (item.slug === slug) {
          return cloneItem(item);
        }
      }
      return null;
    },

    async createContentItem(params) {
      for (const existing of store.contentItems.values()) {
        if (existing.slug === params.slug) {
          const err = new Error('Duplicate entry for key uq_content_items_slug') as Error & {
            code: string;
            errno: number;
          };
          err.code = 'ER_DUP_ENTRY';
          err.errno = 1062;
          throw err;
        }
      }
      const record: ContentItemRecord = {
        id: params.id,
        slug: params.slug,
        contentType: params.contentType,
        currentPublishedVersionId: null,
        createdByUserId: params.createdByUserId,
        isArchived: false,
        createdAt: new Date(params.now),
        updatedAt: new Date(params.now),
      };
      store.contentItems.set(record.id, cloneItem(record));
      return cloneItem(record);
    },

    async updateContentItem(params) {
      const existing = store.contentItems.get(params.itemId);
      if (!existing) {
        return null;
      }
      const next: ContentItemRecord = {
        ...existing,
        slug: params.slug ?? existing.slug,
        isArchived:
          params.isArchived !== undefined ? params.isArchived : existing.isArchived,
        currentPublishedVersionId:
          params.currentPublishedVersionId !== undefined
            ? params.currentPublishedVersionId
            : existing.currentPublishedVersionId,
        updatedAt: new Date(params.now),
      };
      store.contentItems.set(next.id, cloneItem(next));
      return cloneItem(next);
    },

    async listVersionsForItem(itemId) {
      return Array.from(store.contentVersions.values())
        .filter((v) => v.contentItemId === itemId)
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map(cloneVersion);
    },

    async findVersionById(versionId) {
      const v = store.contentVersions.get(versionId);
      return v ? cloneVersion(v) : null;
    },

    async findVersionByIdForUpdate(versionId) {
      const v = store.contentVersions.get(versionId);
      return v ? cloneVersion(v) : null;
    },

    async getNextVersionNumber(itemId) {
      let maxNum = 0;
      for (const v of store.contentVersions.values()) {
        if (v.contentItemId === itemId && v.versionNumber > maxNum) {
          maxNum = v.versionNumber;
        }
      }
      return maxNum + 1;
    },

    async createContentVersion(params) {
      const record: ContentVersionRecord = {
        id: params.id,
        contentItemId: params.contentItemId,
        versionNumber: params.versionNumber,
        status: params.status,
        title: params.title,
        summary: params.summary,
        locale: params.locale,
        payloadJson: structuredClone(params.payloadJson),
        metadataJson: params.metadataJson ? structuredClone(params.metadataJson) : null,
        createdByUserId: params.createdByUserId,
        publishedByUserId: null,
        publishedAt: null,
        createdAt: new Date(params.now),
        updatedAt: new Date(params.now),
      };
      store.contentVersions.set(record.id, cloneVersion(record));
      return cloneVersion(record);
    },

    async updateMutableDraftVersion(params) {
      const existing = store.contentVersions.get(params.versionId);
      if (
        !existing ||
        (existing.status !== 'draft' && existing.status !== 'rejected')
      ) {
        return null;
      }
      const next: ContentVersionRecord = {
        ...existing,
        title: params.title ?? existing.title,
        summary: params.summary !== undefined ? params.summary : existing.summary,
        locale: params.locale ?? existing.locale,
        payloadJson: params.payloadJson
          ? structuredClone(params.payloadJson)
          : existing.payloadJson,
        metadataJson:
          params.metadataJson !== undefined
            ? params.metadataJson
              ? structuredClone(params.metadataJson)
              : null
            : existing.metadataJson,
        status: params.nextStatus,
        updatedAt: new Date(params.now),
      };
      store.contentVersions.set(next.id, cloneVersion(next));
      return cloneVersion(next);
    },

    async updateVersionWorkflowStatus(params) {
      const existing = store.contentVersions.get(params.versionId);
      if (!existing) return;
      const next: ContentVersionRecord = {
        ...existing,
        status: params.status,
        publishedByUserId:
          params.publishedByUserId !== undefined
            ? params.publishedByUserId
            : existing.publishedByUserId,
        publishedAt:
          params.publishedAt !== undefined
            ? params.publishedAt
            : existing.publishedAt,
        updatedAt: new Date(params.now),
      };
      store.contentVersions.set(next.id, cloneVersion(next));
    },

    async listApprovalsForVersionIds(versionIds) {
      const idSet = new Set(versionIds);
      return Array.from(store.contentApprovals.values())
        .filter((a) => idSet.has(a.contentVersionId))
        .sort((a, b) => a.submissionRound - b.submissionRound)
        .map(cloneApproval);
    },

    async findPendingApprovalForVersionForUpdate(versionId) {
      for (const a of store.contentApprovals.values()) {
        if (a.contentVersionId === versionId && a.decision === 'pending') {
          return cloneApproval(a);
        }
      }
      return null;
    },

    async getNextSubmissionRoundForVersion(versionId) {
      let maxRound = 0;
      for (const a of store.contentApprovals.values()) {
        if (a.contentVersionId === versionId && a.submissionRound > maxRound) {
          maxRound = a.submissionRound;
        }
      }
      return maxRound + 1;
    },

    async createApprovalSubmission(params) {
      // Simulate uq_approvals_single_pending unique index
      for (const existing of store.contentApprovals.values()) {
        if (
          existing.contentVersionId === params.contentVersionId &&
          existing.decision === 'pending'
        ) {
          const err = new Error('Duplicate entry for key uq_approvals_single_pending') as Error & {
            code: string;
            errno: number;
          };
          err.code = 'ER_DUP_ENTRY';
          err.errno = 1062;
          throw err;
        }
      }

      const record: ContentApprovalRecord = {
        id: params.id,
        contentVersionId: params.contentVersionId,
        submissionRound: params.submissionRound,
        submittedByUserId: params.submittedByUserId,
        submittedAt: new Date(params.submittedAt),
        reviewerUserId: null,
        decision: 'pending',
        decisionNote: null,
        isSelfApproval: false,
        activeAdminCountAtDecision: null,
        decidedAt: null,
      };
      store.contentApprovals.set(record.id, cloneApproval(record));
      return cloneApproval(record);
    },

    async decideApproval(params) {
      const existing = store.contentApprovals.get(params.approvalId);
      if (!existing || existing.decision !== 'pending') {
        return false;
      }
      const next: ContentApprovalRecord = {
        ...existing,
        reviewerUserId: params.reviewerUserId,
        decision: params.decision,
        decisionNote: params.decisionNote,
        isSelfApproval: params.isSelfApproval,
        activeAdminCountAtDecision: params.activeAdminCountAtDecision,
        decidedAt: new Date(params.decidedAt),
      };
      store.contentApprovals.set(next.id, cloneApproval(next));
      return true;
    },

    async countActivePlatformAdmins() {
      let n = 0;
      for (const u of store.users.values()) {
        if (u.platformRole === 'platform_admin' && u.status === 'active') {
          n += 1;
        }
      }
      return n;
    },

    async listPublishedLibraryContent(params) {
      let rows: PublishedLibraryRecord[] = [];
      for (const item of store.contentItems.values()) {
        if (item.isArchived || !item.currentPublishedVersionId) continue;
        const version = store.contentVersions.get(item.currentPublishedVersionId);
        if (
          !version ||
          version.contentItemId !== item.id ||
          version.status !== 'published' ||
          !version.publishedAt
        ) {
          continue;
        }
        rows.push({
          contentItemId: item.id,
          slug: item.slug,
          contentType: item.contentType,
          publishedVersionId: version.id,
          versionNumber: version.versionNumber,
          title: version.title,
          summary: version.summary,
          locale: version.locale,
          payloadJson: structuredClone(version.payloadJson),
          metadataJson: version.metadataJson ? structuredClone(version.metadataJson) : null,
          publishedAt: new Date(version.publishedAt),
        });
      }
      if (params.contentType) {
        rows = rows.filter((r) => r.contentType === params.contentType);
      }
      if (params.locale) {
        rows = rows.filter((r) => r.locale === params.locale);
      }
      if (params.search && params.search.trim().length > 0) {
        const needle = params.search.trim().toLowerCase();
        rows = rows.filter(
          (r) =>
            r.title.toLowerCase().includes(needle) ||
            r.slug.toLowerCase().includes(needle)
        );
      }
      rows.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      const offset = (params.page - 1) * params.limit;
      return {
        items: rows.slice(offset, offset + params.limit),
        total: rows.length,
      };
    },

    async findPublishedLibraryContentByItemId(itemId) {
      const item = store.contentItems.get(itemId);
      if (!item || item.isArchived || !item.currentPublishedVersionId) {
        return null;
      }
      const version = store.contentVersions.get(item.currentPublishedVersionId);
      if (
        !version ||
        version.contentItemId !== item.id ||
        version.status !== 'published' ||
        !version.publishedAt
      ) {
        return null;
      }
      return {
        contentItemId: item.id,
        slug: item.slug,
        contentType: item.contentType,
        publishedVersionId: version.id,
        versionNumber: version.versionNumber,
        title: version.title,
        summary: version.summary,
        locale: version.locale,
        payloadJson: structuredClone(version.payloadJson),
        metadataJson: version.metadataJson ? structuredClone(version.metadataJson) : null,
        publishedAt: new Date(version.publishedAt),
      };
    },
  };
}

function makeFakeAuthRepo(store: InMemoryP204Store): AuthRepository {
  return {
    withTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn({} as never);
    },
    async findUserCredentialByEmail() {
      return null;
    },
    async findUserCredentialByPlatformUsername() {
      return null;
    },
    async findUserCredentialById() {
      return null;
    },
    async findStudentLoginRecord() {
      return null;
    },
    async findMembershipsForUser(userId: string) {
      return Array.from(store.memberships.values())
        .filter((m) => m.userId === userId)
        .map((m) => {
          const org = store.organizations.get(m.organizationId)!;
          return {
            membershipId: m.id,
            organizationId: m.organizationId,
            organizationCode: org.code,
            organizationName: org.name,
            organizationStatus: org.status,
            role: m.role,
            membershipStatus: m.status,
            orgUsername: null,
          };
        });
    },
    async createSession() {},
    async findSessionWithContextByTokenHash(tokenHash) {
      const s = Array.from(store.sessions.values()).find(
        (x) => x.tokenHash === tokenHash
      );
      if (!s) return null;
      const u = store.users.get(s.userId);
      if (!u) return null;

      let activeOrganization: SessionWithContextRecord['activeOrganization'] = null;
      let activeMembership: SessionWithContextRecord['activeMembership'] = null;
      if (s.activeOrganizationId) {
        const org = store.organizations.get(s.activeOrganizationId);
        if (org) {
          activeOrganization = {
            id: org.id,
            code: org.code,
            name: org.name,
            status: org.status,
          };
        }
        const m = Array.from(store.memberships.values()).find(
          (x) => x.userId === u.id && x.organizationId === s.activeOrganizationId
        );
        if (m) {
          activeMembership = {
            id: m.id,
            organizationId: m.organizationId,
            role: m.role,
            orgUsername: null,
            status: m.status,
          };
        }
      }

      return {
        session: { ...s },
        user: {
          id: u.id,
          email: u.email,
          platformUsername: u.platformUsername,
          platformRole: u.platformRole,
          displayName: u.displayName,
          status: u.status,
          lockedUntil: null,
        },
        activeOrganization,
        activeMembership,
      };
    },
    async touchSessionActivity() {},
    async rotateSession() {
      return true;
    },
    async revokeSessionById() {},
    async revokeOtherActiveSessionsForUser() {
      return 0;
    },
    async recordFailedLoginAttempt() {
      return { lockedNow: false, failedAttempts: 0, lockedUntil: null };
    },
    async recordSuccessfulLoginState() {},
    async updateUserPasswordHash() {},
  };
}

function createSamplePayloads() {
  return {
    emotion_card: {
      displayTitle: 'Cảm giác vui khi chia sẻ',
      childText: 'Hôm nay mình cảm thấy ấm áp và vui vẻ.',
      emotionKey: 'happy',
      emotionLabel: 'Vui vẻ',
      accessibleDescription: 'Thẻ cảm xúc minh họa gương mặt tươi cười dịu nhẹ.',
      supportiveBodyCue: 'Vai thả lỏng và khóe miệng mỉm cười nhẹ.',
      reflectionPrompts: ['Điều gì hôm nay làm con mỉm cười?'],
      readAloud: {
        text: 'Hôm nay mình cảm thấy vui vẻ.',
        speechRateHint: 'slow',
      },
      aacSupport: {
        symbolLabel: 'Vui vẻ',
        coreVocabulary: ['vui', 'cùng bạn'],
      },
    },
    situation_card: {
      displayTitle: 'Khi bạn đang buồn',
      situationText: 'Bạn cùng bàn ngồi im lặng và nhìn xuống bàn.',
      narrativeContext: 'Giờ ra chơi trong lớp học yên tĩnh.',
      accessibleDescription: 'Tình huống gợi mở sự quan tâm nhẹ nhàng với bạn bè.',
      discussionPrompts: ['Mình có thể hỏi bạn điều gì thật nhẹ nhàng?'],
    },
    action_card: {
      displayTitle: 'Hít thở chậm',
      actionPhrase: 'Mình hít vào chậm và thở ra nhẹ như thổi bong bóng.',
      accessibleDescription: 'Thẻ hành động hỗ trợ điều hòa cảm xúc bình tĩnh.',
      possibleOutcomes: ['Nhịp tim chậm lại', 'Cảm thấy an toàn hơn'],
    },
    social_story_card: {
      displayTitle: 'Giờ chuyển tiết ở lớp',
      storyIntro: 'Khi chuông reo, lớp mình chuẩn bị đổi sang hoạt động mới.',
      scenes: [
        {
          sceneNumber: 1,
          text: 'Mình nghe thấy tiếng chuông báo hiệu.',
          accessibleDescription: 'Cảnh 1: Nhận biết tín hiệu chuyển tiết nhẹ nhàng.',
        },
        {
          sceneNumber: 2,
          text: 'Mình cất bút vào hộp và nhìn lên cô giáo.',
          accessibleDescription: 'Cảnh 2: Thu dọn đồ dùng từ tốn và chờ hướng dẫn.',
        },
      ],
      closingReflection: 'Mỗi bạn có thể chuyển tiết theo nhịp của mình.',
    },
    communication_card: {
      displayTitle: 'Xin nghỉ ngơi một chút',
      communicationIntent: 'request_break',
      phrase: 'Cô ơi, con cần nghỉ ngơi ở góc yên tĩnh một lát ạ.',
      accessibleDescription: 'Thẻ giao tiếp hỗ trợ trẻ diễn đạt nhu cầu nghỉ ngơi.',
      aacSupport: {
        symbolLabel: 'Nghỉ ngơi',
        coreVocabulary: ['con', 'nghỉ ngơi', 'một lát'],
      },
    },
  };
}

function seedSession(
  store: InMemoryP204Store,
  params: {
    userId: string;
    scope: 'platform_admin' | 'teacher' | 'student';
    organizationId: string | null;
  },
  config: ServerConfig
): { rawToken: string; csrfToken: string } {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const sessionId = generateUuidV7();
  store.sessions.set(tokenHash, {
    id: sessionId,
    tokenHash,
    userId: params.userId,
    sessionScope: params.scope,
    activeOrganizationId: params.organizationId,
    idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
    lastActivityAt: now,
    revokedAt: null,
    revokedReason: null,
  });
  return {
    rawToken,
    csrfToken: deriveSessionCsrfToken(rawToken, sessionId, config.auth.csrfSecret),
  };
}

async function startTestServer(store: InMemoryP204Store, config: ServerConfig) {
  const app = express();
  app.use('/api', express.json({ limit: config.jsonBodyLimit }));

  const contentRepo = makeFakeContentRepo(store);
  const contentService = createContentService({
    repo: contentRepo,
    auditFn: async (evt) => {
      store.audits.push(evt);
    },
  });
  const authMiddlewares = createAuthMiddlewareSuite({
    repo: makeFakeAuthRepo(store),
    getConfig: () => config,
  });
  const authenticatedCsrf = createAuthenticatedCsrfMiddleware({
    config,
  });

  app.use(
    '/api/v1/admin',
    createAdminContentRouter({
      contentService,
      authMiddlewares,
      authenticatedCsrf,
    })
  );
  app.use(
    '/api/v1/library',
    createLibraryRouter({
      contentService,
      authMiddlewares,
    })
  );
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  config.auth.trustedOrigins.push(baseUrl);
  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function requestJson(
  url: string,
  options: {
    method: string;
    cookie?: string;
    csrf?: string;
    origin?: string;
    includeCustomHeader?: boolean;
    body?: unknown;
  }
): Promise<{ status: number; data: Record<string, unknown>; allow?: string }> {
  const headers: Record<string, string> = {};
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.origin) {
    headers.origin = options.origin;
  }
  if (options.includeCustomHeader !== false && options.csrf) {
    headers[CUSTOM_REQUEST_HEADER] = '1';
  }
  if (options.csrf) {
    headers[CSRF_TOKEN_HEADER] = options.csrf;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return {
    status: res.status,
    data,
    allow: res.headers.get('allow') ?? undefined,
  };
}

test('P2-04 Payload & Safety Validator: validates all 5 canonical types, allows optional audio/AAC omission, and allows calm SEL emotion vocabulary', () => {
  const payloads = createSamplePayloads();

  for (const [contentType, payload] of Object.entries(payloads)) {
    const ok = validateContentPayloadAndMetadata({
      contentType: contentType as keyof typeof payloads,
      locale: 'vi-VN',
      payloadJson: payload,
      metadataJson: { ageBand: '6-8', selThemes: ['empathy', 'self_awareness'] },
    });
    assert.equal(ok.locale, 'vi-VN');
  }

  // Omitting readAloud & aacSupport MUST NOT fail
  const minimalEmotion = validateContentPayloadAndMetadata({
    contentType: 'emotion_card',
    locale: 'en',
    payloadJson: {
      displayTitle: 'Feeling nervous before class',
      childText: 'Sometimes I feel worried or sad before trying something new, and that is okay.',
      emotionKey: 'worried',
      emotionLabel: 'Lo lắng / Buồn nhẹ',
      accessibleDescription: 'Calm illustration showing someone taking a gentle pause.',
      supportiveBodyCue: 'Tummy feels fluttery.',
    },
  });
  assert.equal(minimalEmotion.locale, 'en');
  assert.equal(minimalEmotion.metadataJson, null);
});

test('P2-04 Payload & Safety Validator: rejects timers, leaderboards, scoring, correct-answer keys, shaming, diagnosis claims, unsafe URIs, and non-sequential story scenes', () => {
  const payloads = createSamplePayloads();

  // Forbidden keys
  const badKeys = [
    { timerSeconds: 30 },
    { leaderboard: true },
    { points: 100 },
    { isCorrect: true },
    { correctExpression: 'smile' },
    { clinicalDiagnosis: 'ASD' },
  ];

  for (const extra of badKeys) {
    assert.throws(
      () =>
        validateContentPayloadAndMetadata({
          contentType: 'emotion_card',
          locale: 'vi',
          payloadJson: { ...payloads.emotion_card, ...extra },
        }),
      (err: unknown) => err instanceof AppError && err.httpStatus === 422
    );
  }

  // Shaming text & diagnosis text
  assert.throws(
    () =>
      validateContentPayloadAndMetadata({
        contentType: 'situation_card',
        locale: 'vi',
        payloadJson: {
          ...payloads.situation_card,
          situationText: 'Nếu chọn sai là bạn quá tệ và đứng hạng nhất bảng xếp hạng sẽ mất điểm.',
        },
      }),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );

  // Unsafe URI
  assert.throws(
    () =>
      validateContentPayloadAndMetadata({
        contentType: 'communication_card',
        locale: 'vi',
        payloadJson: {
          ...payloads.communication_card,
          visualSupport: {
            assetRef: 'javascript:alert(1)',
            altText: 'Minh họa',
          },
        },
      }),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );

  // Non-sequential scenes in social_story_card
  assert.throws(
    () =>
      validateContentPayloadAndMetadata({
        contentType: 'social_story_card',
        locale: 'vi',
        payloadJson: {
          ...payloads.social_story_card,
          scenes: [
            {
              sceneNumber: 1,
              text: 'Cảnh 1',
              accessibleDescription: 'Mô tả 1',
            },
            {
              sceneNumber: 3,
              text: 'Cảnh 3 nhảy cóc',
              accessibleDescription: 'Mô tả 3',
            },
          ],
        },
      }),
    (err: unknown) => err instanceof AppError && err.httpStatus === 422
  );
});

test('P2-04 ContentService: multi-round reject/resubmit, immutable published/superseded versions, single-Admin vs multi-Admin self-approval, version author check, and concurrent approval conflict', async () => {
  const store = createEmptyP204Store();
  const repo = makeFakeContentRepo(store);
  const service = createContentService({
    repo,
    auditFn: async (evt) => {
      store.audits.push(evt);
    },
  });

  const admin1 = generateUuidV7();
  store.users.set(admin1, {
    id: admin1,
    email: 'admin1@mimora.local',
    platformUsername: 'admin1',
    platformRole: 'platform_admin',
    displayName: 'Admin One',
    status: 'active',
  });

  const payloads = createSamplePayloads();

  // 1. Single active Admin: create item -> submit -> self-approve -> publish
  const singleCreated = await service.createContentItem(
    {
      slug: 'single-admin-card',
      contentType: 'emotion_card',
      title: 'Thẻ cảm xúc vui',
      locale: 'vi',
      payloadJson: payloads.emotion_card,
    },
    { actorUserId: admin1, ipPrefix: '127.0.0' }
  );
  assert.equal(singleCreated.version.versionNumber, 1);
  assert.equal(singleCreated.version.status, 'draft');

  // Duplicate slug blocked
  await assert.rejects(
    () =>
      service.createContentItem(
        {
          slug: 'SINGLE-ADMIN-CARD',
          contentType: 'emotion_card',
          title: 'Trùng slug',
          payloadJson: payloads.emotion_card,
        },
        { actorUserId: admin1, ipPrefix: '127.0.0' }
      ),
    (err: unknown) => err instanceof AppError && err.code === 'CONTENT_SLUG_EXISTS'
  );

  // Publish before approval MUST fail
  await assert.rejects(
    () =>
      service.publishVersion(singleCreated.version.id, {
        actorUserId: admin1,
        ipPrefix: '127.0.0',
      }),
    (err: unknown) => err instanceof AppError && err.code === 'VERSION_NOT_APPROVED'
  );

  await service.submitVersionForReview(singleCreated.version.id, {
    actorUserId: admin1,
    ipPrefix: '127.0.0',
  });

  // Duplicate pending submit blocked
  await assert.rejects(
    () =>
      service.submitVersionForReview(singleCreated.version.id, {
        actorUserId: admin1,
        ipPrefix: '127.0.0',
      }),
    (err: unknown) =>
      err instanceof AppError && err.code === 'SUBMISSION_ALREADY_PENDING'
  );

  const selfApproved = await service.approveVersion(
    singleCreated.version.id,
    { decisionNote: 'Single active admin bootstrap review' },
    { actorUserId: admin1, ipPrefix: '127.0.0' }
  );
  assert.equal(selfApproved.approval.isSelfApproval, true);
  assert.equal(selfApproved.approval.activeAdminCountAtDecision, 1);
  assert.ok(store.audits.some((a) => a.eventType === 'content.self_approved'));

  const publishedV1 = await service.publishVersion(singleCreated.version.id, {
    actorUserId: admin1,
    ipPrefix: '127.0.0',
  });
  assert.equal(publishedV1.version.status, 'published');
  assert.equal(publishedV1.item.currentPublishedVersionId, singleCreated.version.id);

  // Published version MUST be immutable
  await assert.rejects(
    () =>
      service.updateDraftVersion(
        singleCreated.version.id,
        { title: 'Cố sửa bản đã xuất bản' },
        { actorUserId: admin1, ipPrefix: '127.0.0' }
      ),
    (err: unknown) => err instanceof AppError && err.code === 'VERSION_IMMUTABLE'
  );

  // 2. Add Admin 2 -> Multi-Admin mode enforced!
  const admin2 = generateUuidV7();
  store.users.set(admin2, {
    id: admin2,
    email: 'admin2@mimora.local',
    platformUsername: 'admin2',
    platformRole: 'platform_admin',
    displayName: 'Admin Two',
    status: 'active',
  });

  // Admin 2 creates v2 on item authored by Admin 1
  const v2 = await service.createDraftVersion(
    singleCreated.item.id,
    {
      title: 'Thẻ cảm xúc vui (phiên bản 2)',
      locale: 'vi-VN',
      payloadJson: {
        ...payloads.emotion_card,
        childText: 'Hôm nay mình thấy vui và nhẹ nhõm.',
      },
    },
    { actorUserId: admin2, ipPrefix: '127.0.0' }
  );
  assert.equal(v2.versionNumber, 2);
  assert.equal(v2.createdByUserId, admin2);

  // Submit round 1 -> Admin 1 rejects round 1 -> check payload preserved & decisionNote stored
  await service.submitVersionForReview(v2.id, {
    actorUserId: admin2,
    ipPrefix: '127.0.0',
  });
  const rejectedR1 = await service.rejectVersion(
    v2.id,
    { decisionNote: 'Vui lòng bổ sung câu gợi ý thân thiện hơn.' },
    { actorUserId: admin1, ipPrefix: '127.0.0' }
  );
  assert.equal(rejectedR1.version.status, 'rejected');
  assert.equal(rejectedR1.approval.submissionRound, 1);

  // Rejected version CANNOT be published
  await assert.rejects(
    () => service.publishVersion(v2.id, { actorUserId: admin1, ipPrefix: '127.0.0' }),
    (err: unknown) => err instanceof AppError && err.code === 'VERSION_NOT_APPROVED'
  );

  // Author revises rejected version (transitions back to draft) and resubmits round 2
  const revisedV2 = await service.updateDraftVersion(
    v2.id,
    {
      payloadJson: {
        ...payloads.emotion_card,
        childText: 'Mình có thể chia sẻ niềm vui nhẹ nhàng cùng bạn.',
      },
    },
    { actorUserId: admin2, ipPrefix: '127.0.0' }
  );
  assert.equal(revisedV2.status, 'draft');

  const resubmittedR2 = await service.submitVersionForReview(v2.id, {
    actorUserId: admin2,
    ipPrefix: '127.0.0',
  });
  assert.equal(resubmittedR2.approval.submissionRound, 2);

  // Admin 2 (author of v2) CANNOT self-approve with 2 active admins!
  await assert.rejects(
    () =>
      service.approveVersion(
        v2.id,
        { decisionNote: 'Tự duyệt' },
        { actorUserId: admin2, ipPrefix: '127.0.0' }
      ),
    (err: unknown) => err instanceof AppError && err.httpStatus === 403
  );
  assert.ok(
    store.audits.some((a) => a.eventType === 'security.unauthorized_access_denied')
  );

  // Concurrent approval race: Admin 1 vs Admin 3 -> 1 wins, 1 receives 409 ALREADY_REVIEWED
  const admin3 = generateUuidV7();
  store.users.set(admin3, {
    id: admin3,
    email: 'admin3@mimora.local',
    platformUsername: 'admin3',
    platformRole: 'platform_admin',
    displayName: 'Admin Three',
    status: 'active',
  });

  // Note: Admin 1 authored the ITEM, NOT v2 -> Admin 1 MUST be allowed to approve v2!
  const [race1, race2] = await Promise.allSettled([
    service.approveVersion(
      v2.id,
      { decisionNote: 'Admin 1 approves' },
      { actorUserId: admin1, ipPrefix: '127.0.0' }
    ),
    service.approveVersion(
      v2.id,
      { decisionNote: 'Admin 3 approves' },
      { actorUserId: admin3, ipPrefix: '127.0.0' }
    ),
  ]);

  const fulfilled = [race1, race2].filter((r) => r.status === 'fulfilled');
  const rejectedRace = [race1, race2].filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejectedRace.length, 1);
  const raceErr = (rejectedRace[0] as PromiseRejectedResult).reason;
  assert.ok(raceErr instanceof AppError && raceErr.code === 'ALREADY_REVIEWED');

  // Publish v2 -> v1 transitions to 'superseded', v1 payload stays immutable
  const publishedV2 = await service.publishVersion(v2.id, {
    actorUserId: admin1,
    ipPrefix: '127.0.0',
  });
  assert.equal(publishedV2.item.currentPublishedVersionId, v2.id);

  const detail = await service.getContentItemDetail(singleCreated.item.id);
  const v1Snapshot = detail.versions.find((v) => v.versionNumber === 1)!;
  const v2Snapshot = detail.versions.find((v) => v.versionNumber === 2)!;
  assert.equal(v1Snapshot.status, 'superseded');
  assert.equal(
    v1Snapshot.payloadJson.childText,
    'Hôm nay mình cảm thấy ấm áp và vui vẻ.'
  );
  assert.equal(v2Snapshot.status, 'published');
  assert.equal(v2Snapshot.approvals?.length, 2);
  assert.equal(v2Snapshot.approvals?.[0].decision, 'rejected');
  assert.equal(v2Snapshot.approvals?.[1].decision, 'approved');

  // Superseded v1 MUST remain immutable
  await assert.rejects(
    () =>
      service.updateDraftVersion(
        v1Snapshot.id,
        { title: 'Sửa bản superseded' },
        { actorUserId: admin1, ipPrefix: '127.0.0' }
      ),
    (err: unknown) => err instanceof AppError && err.code === 'VERSION_IMMUTABLE'
  );
});

test('P2-04 HTTP Routes & RBAC/CSRF: Admin authoring/workflow + Teacher published-only library + Student denied + 403/401/405/404 enforcement', async () => {
  const store = createEmptyP204Store();
  const config = parseServerConfig({
    NODE_ENV: 'test',
    AUTH_CSRF_SECRET: 'p2_04_http_csrf_secret_0123456789abcdef',
  });

  const orgId = generateUuidV7();
  store.organizations.set(orgId, {
    id: orgId,
    code: 'MIMORA_SCH1',
    name: 'Trường Mầm Non 1',
    status: 'active',
  });

  const adminA = generateUuidV7();
  const adminB = generateUuidV7();
  const teacherId = generateUuidV7();
  const studentId = generateUuidV7();

  store.users.set(adminA, {
    id: adminA,
    email: 'a@mimora.local',
    platformUsername: 'admin_a',
    platformRole: 'platform_admin',
    displayName: 'Admin A',
    status: 'active',
  });
  store.users.set(adminB, {
    id: adminB,
    email: 'b@mimora.local',
    platformUsername: 'admin_b',
    platformRole: 'platform_admin',
    displayName: 'Admin B',
    status: 'active',
  });
  store.users.set(teacherId, {
    id: teacherId,
    email: 'teacher@mimora.local',
    platformUsername: null,
    platformRole: null,
    displayName: 'Cô Mai',
    status: 'active',
  });
  store.users.set(studentId, {
    id: studentId,
    email: null,
    platformUsername: null,
    platformRole: null,
    displayName: 'Bé An',
    status: 'active',
  });

  store.memberships.set('m-teacher', {
    id: 'm-teacher',
    organizationId: orgId,
    userId: teacherId,
    role: 'teacher',
    status: 'active',
  });
  store.memberships.set('m-student', {
    id: 'm-student',
    organizationId: orgId,
    userId: studentId,
    role: 'student',
    status: 'active',
  });

  const adminASess = seedSession(
    store,
    { userId: adminA, scope: 'platform_admin', organizationId: null },
    config
  );
  const adminBSess = seedSession(
    store,
    { userId: adminB, scope: 'platform_admin', organizationId: null },
    config
  );
  const teacherSess = seedSession(
    store,
    { userId: teacherId, scope: 'teacher', organizationId: orgId },
    config
  );
  const studentSess = seedSession(
    store,
    { userId: studentId, scope: 'student', organizationId: orgId },
    config
  );

  const server = await startTestServer(store, config);
  try {
    const adminACookie = `${config.cookie.name}=${adminASess.rawToken}`;
    const adminBCookie = `${config.cookie.name}=${adminBSess.rawToken}`;
    const teacherCookie = `${config.cookie.name}=${teacherSess.rawToken}`;
    const studentCookie = `${config.cookie.name}=${studentSess.rawToken}`;
    const payloads = createSamplePayloads();

    // Unauthenticated -> 401
    const unauthAdmin = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-items`,
      { method: 'GET' }
    );
    assert.equal(unauthAdmin.status, 401);

    const unauthLib = await requestJson(
      `${server.baseUrl}/api/v1/library/content`,
      { method: 'GET' }
    );
    assert.equal(unauthLib.status, 401);

    // 405 Method Not Allowed check
    const badMethod = await requestJson(
      `${server.baseUrl}/api/v1/library/content`,
      { method: 'POST', cookie: teacherCookie }
    );
    assert.equal(badMethod.status, 405);
    assert.equal(badMethod.allow, 'GET');

    // Missing CSRF token / custom header -> 403
    const noCsrf = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-items`,
      {
        method: 'POST',
        cookie: adminACookie,
        origin: server.baseUrl,
        body: {
          slug: 'no-csrf',
          contentType: 'emotion_card',
          title: 'Test',
          payloadJson: payloads.emotion_card,
        },
      }
    );
    assert.equal(noCsrf.status, 403);

    // Teacher & Student denied on Admin content APIs -> 403
    const teacherAdminDenied = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-items`,
      { method: 'GET', cookie: teacherCookie }
    );
    assert.equal(teacherAdminDenied.status, 403);

    const studentAdminDenied = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-items`,
      { method: 'GET', cookie: studentCookie }
    );
    assert.equal(studentAdminDenied.status, 403);

    // Student denied on Teacher library -> 403
    const studentLibDenied = await requestJson(
      `${server.baseUrl}/api/v1/library/content`,
      { method: 'GET', cookie: studentCookie }
    );
    assert.equal(studentLibDenied.status, 403);

    // Admin A creates Draft Item (social_story_card)
    const createdRes = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-items`,
      {
        method: 'POST',
        cookie: adminACookie,
        csrf: adminASess.csrfToken,
        origin: server.baseUrl,
        body: {
          slug: 'chuyen-tiet-nhe-nhang',
          contentType: 'social_story_card',
          title: 'Giờ chuyển tiết ở lớp',
          summary: 'Hướng dẫn từng bước khi chuyển tiết học',
          locale: 'vi',
          payloadJson: payloads.social_story_card,
        },
      }
    );
    assert.equal(createdRes.status, 201);
    const createdItem = createdRes.data.item as { id: string };
    const createdVersion = createdRes.data.version as { id: string };

    // Teacher CANNOT see draft item in library
    const libDraftCheck = await requestJson(
      `${server.baseUrl}/api/v1/library/content/${createdItem.id}`,
      { method: 'GET', cookie: teacherCookie }
    );
    assert.equal(libDraftCheck.status, 404);

    // Admin A submits -> Admin A self-approval blocked (2 active admins) -> Admin B approves -> Admin A publishes
    const submitRes = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-versions/${createdVersion.id}/submit`,
      {
        method: 'POST',
        cookie: adminACookie,
        csrf: adminASess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(submitRes.status, 200);

    const selfApproveBlocked = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-versions/${createdVersion.id}/approve`,
      {
        method: 'POST',
        cookie: adminACookie,
        csrf: adminASess.csrfToken,
        origin: server.baseUrl,
        body: { decisionNote: 'Try self' },
      }
    );
    assert.equal(selfApproveBlocked.status, 403);

    const adminBApprove = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-versions/${createdVersion.id}/approve`,
      {
        method: 'POST',
        cookie: adminBCookie,
        csrf: adminBSess.csrfToken,
        origin: server.baseUrl,
        body: { decisionNote: 'Đạt chuẩn SEL.' },
      }
    );
    assert.equal(adminBApprove.status, 200);

    // Approved-but-not-yet-published item MUST NOT appear in Teacher library
    const libApprovedOnly = await requestJson(
      `${server.baseUrl}/api/v1/library/content`,
      { method: 'GET', cookie: teacherCookie }
    );
    assert.equal(libApprovedOnly.status, 200);
    assert.equal((libApprovedOnly.data.items as unknown[]).length, 0);

    const publishRes = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-versions/${createdVersion.id}/publish`,
      {
        method: 'POST',
        cookie: adminACookie,
        csrf: adminASess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(publishRes.status, 200);

    // Teacher sees published item with exact publishedVersionId and NO internal approval notes
    const libList = await requestJson(
      `${server.baseUrl}/api/v1/library/content?contentType=social_story_card&locale=vi`,
      { method: 'GET', cookie: teacherCookie }
    );
    assert.equal(libList.status, 200);
    const libItems = libList.data.items as Array<Record<string, unknown>>;
    assert.equal(libItems.length, 1);
    assert.equal(libItems[0].publishedVersionId, createdVersion.id);
    assert.equal('approvals' in libItems[0], false);
    assert.equal('decisionNote' in libItems[0], false);

    const libSingle = await requestJson(
      `${server.baseUrl}/api/v1/library/content/${createdItem.id}`,
      { method: 'GET', cookie: teacherCookie }
    );
    assert.equal(libSingle.status, 200);

    // Archive item -> Teacher library hides it immediately
    const archiveRes = await requestJson(
      `${server.baseUrl}/api/v1/admin/content-items/${createdItem.id}/archive`,
      {
        method: 'POST',
        cookie: adminACookie,
        csrf: adminASess.csrfToken,
        origin: server.baseUrl,
      }
    );
    assert.equal(archiveRes.status, 200);

    const libAfterArchive = await requestJson(
      `${server.baseUrl}/api/v1/library/content/${createdItem.id}`,
      { method: 'GET', cookie: teacherCookie }
    );
    assert.equal(libAfterArchive.status, 404);
  } finally {
    await server.close();
  }
});
