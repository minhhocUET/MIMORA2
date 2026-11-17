import { and, asc, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { CanonicalContentType } from '../db/schema/_shared.ts';
import {
  contentApprovals,
  contentItems,
  contentVersions,
} from '../db/schema/content.ts';
import { users } from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';
import { escapeSqlLikePattern } from './org.repository.ts';

export type ContentDbOrTx = MimoraDatabase | MimoraTransaction;

export const CONTENT_VERSION_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'published',
  'rejected',
  'superseded',
] as const;
export type ContentVersionStatus = (typeof CONTENT_VERSION_STATUSES)[number];

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export interface ContentItemRecord {
  id: string;
  slug: string;
  contentType: string;
  currentPublishedVersionId: string | null;
  createdByUserId: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentVersionRecord {
  id: string;
  contentItemId: string;
  versionNumber: number;
  status: string;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  createdByUserId: string;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentApprovalRecord {
  id: string;
  contentVersionId: string;
  submissionRound: number;
  submittedByUserId: string;
  submittedAt: Date;
  reviewerUserId: string | null;
  decision: string;
  decisionNote: string | null;
  isSelfApproval: boolean;
  activeAdminCountAtDecision: number | null;
  decidedAt: Date | null;
}

export interface PublishedLibraryRecord {
  contentItemId: string;
  slug: string;
  contentType: string;
  publishedVersionId: string;
  versionNumber: number;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  publishedAt: Date;
}

export interface ContentRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  listContentItems(params: {
    page: number;
    limit: number;
    contentType?: CanonicalContentType;
    isArchived?: boolean;
    search?: string;
  }): Promise<{ items: ContentItemRecord[]; total: number }>;
  findContentItemById(
    itemId: string,
    executor?: ContentDbOrTx
  ): Promise<ContentItemRecord | null>;
  findContentItemByIdForUpdate(
    itemId: string,
    tx: MimoraTransaction
  ): Promise<ContentItemRecord | null>;
  findContentItemBySlug(
    slug: string,
    executor?: ContentDbOrTx
  ): Promise<ContentItemRecord | null>;
  createContentItem(
    params: {
      id: string;
      slug: string;
      contentType: CanonicalContentType;
      createdByUserId: string;
      now: Date;
    },
    executor?: ContentDbOrTx
  ): Promise<ContentItemRecord>;
  updateContentItem(
    params: {
      itemId: string;
      slug?: string;
      isArchived?: boolean;
      currentPublishedVersionId?: string | null;
      now: Date;
    },
    executor?: ContentDbOrTx
  ): Promise<ContentItemRecord | null>;
  listVersionsForItem(
    itemId: string,
    executor?: ContentDbOrTx
  ): Promise<ContentVersionRecord[]>;
  findVersionById(
    versionId: string,
    executor?: ContentDbOrTx
  ): Promise<ContentVersionRecord | null>;
  findVersionByIdForUpdate(
    versionId: string,
    tx: MimoraTransaction
  ): Promise<ContentVersionRecord | null>;
  getNextVersionNumber(itemId: string, tx: MimoraTransaction): Promise<number>;
  createContentVersion(
    params: {
      id: string;
      contentItemId: string;
      versionNumber: number;
      status: ContentVersionStatus;
      title: string;
      summary: string | null;
      locale: string;
      payloadJson: Record<string, unknown>;
      metadataJson: Record<string, unknown> | null;
      createdByUserId: string;
      now: Date;
    },
    executor?: ContentDbOrTx
  ): Promise<ContentVersionRecord>;
  updateMutableDraftVersion(
    params: {
      versionId: string;
      title?: string;
      summary?: string | null;
      locale?: string;
      payloadJson?: Record<string, unknown>;
      metadataJson?: Record<string, unknown> | null;
      nextStatus: 'draft';
      now: Date;
    },
    executor?: ContentDbOrTx
  ): Promise<ContentVersionRecord | null>;
  updateVersionWorkflowStatus(
    params: {
      versionId: string;
      status: ContentVersionStatus;
      publishedByUserId?: string | null;
      publishedAt?: Date | null;
      now: Date;
    },
    executor?: ContentDbOrTx
  ): Promise<void>;
  listApprovalsForVersionIds(
    versionIds: string[],
    executor?: ContentDbOrTx
  ): Promise<ContentApprovalRecord[]>;
  findPendingApprovalForVersionForUpdate(
    versionId: string,
    tx: MimoraTransaction
  ): Promise<ContentApprovalRecord | null>;
  getNextSubmissionRoundForVersion(
    versionId: string,
    tx: MimoraTransaction
  ): Promise<number>;
  createApprovalSubmission(
    params: {
      id: string;
      contentVersionId: string;
      submissionRound: number;
      submittedByUserId: string;
      submittedAt: Date;
    },
    tx: MimoraTransaction
  ): Promise<ContentApprovalRecord>;
  decideApproval(
    params: {
      approvalId: string;
      reviewerUserId: string;
      decision: 'approved' | 'rejected';
      decisionNote: string | null;
      isSelfApproval: boolean;
      activeAdminCountAtDecision: number;
      decidedAt: Date;
    },
    tx: MimoraTransaction
  ): Promise<boolean>;
  countActivePlatformAdmins(tx: MimoraTransaction): Promise<number>;
  listPublishedLibraryContent(params: {
    page: number;
    limit: number;
    contentType?: CanonicalContentType;
    locale?: string;
    search?: string;
  }): Promise<{ items: PublishedLibraryRecord[]; total: number }>;
  findPublishedLibraryContentByItemId(
    itemId: string
  ): Promise<PublishedLibraryRecord | null>;
}

function getExecutor(executor?: ContentDbOrTx): ContentDbOrTx {
  return executor ?? getDb();
}

export function createContentRepository(): ContentRepository {
  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async listContentItems(params) {
      const db = getDb();
      const filters = [];
      if (params.contentType) {
        filters.push(eq(contentItems.contentType, params.contentType));
      }
      if (params.isArchived !== undefined) {
        filters.push(eq(contentItems.isArchived, params.isArchived));
      }
      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${escapeSqlLikePattern(params.search.trim())}%`;
        filters.push(like(contentItems.slug, pattern));
      }

      const whereClause = filters.length > 0 ? and(...filters) : undefined;
      const offset = (params.page - 1) * params.limit;

      const [countRows, items] = await Promise.all([
        db.select({ total: count() }).from(contentItems).where(whereClause),
        db
          .select()
          .from(contentItems)
          .where(whereClause)
          .orderBy(desc(contentItems.updatedAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return { items, total: Number(countRows[0]?.total ?? 0) };
    },

    async findContentItemById(itemId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, itemId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findContentItemByIdForUpdate(itemId, tx) {
      const rows = await tx
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, itemId))
        .limit(1)
        .for('update');
      return rows[0] ?? null;
    },

    async findContentItemBySlug(slug, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async createContentItem(params, executor) {
      const db = getExecutor(executor);
      await db.insert(contentItems).values({
        id: params.id,
        slug: params.slug,
        contentType: params.contentType,
        currentPublishedVersionId: null,
        createdByUserId: params.createdByUserId,
        isArchived: false,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        slug: params.slug,
        contentType: params.contentType,
        currentPublishedVersionId: null,
        createdByUserId: params.createdByUserId,
        isArchived: false,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },

    async updateContentItem(params, executor) {
      const db = getExecutor(executor);
      const existing = await this.findContentItemById(params.itemId, db);
      if (!existing) {
        return null;
      }

      const nextSlug = params.slug ?? existing.slug;
      const nextArchived =
        params.isArchived !== undefined ? params.isArchived : existing.isArchived;
      const nextPublishedVersionId =
        params.currentPublishedVersionId !== undefined
          ? params.currentPublishedVersionId
          : existing.currentPublishedVersionId;

      await db
        .update(contentItems)
        .set({
          slug: nextSlug,
          isArchived: nextArchived,
          currentPublishedVersionId: nextPublishedVersionId,
          updatedAt: params.now,
        })
        .where(eq(contentItems.id, params.itemId));

      return {
        ...existing,
        slug: nextSlug,
        isArchived: nextArchived,
        currentPublishedVersionId: nextPublishedVersionId,
        updatedAt: params.now,
      };
    },

    async listVersionsForItem(itemId, executor) {
      const db = getExecutor(executor);
      return db
        .select()
        .from(contentVersions)
        .where(eq(contentVersions.contentItemId, itemId))
        .orderBy(desc(contentVersions.versionNumber));
    },

    async findVersionById(versionId, executor) {
      const db = getExecutor(executor);
      const rows = await db
        .select()
        .from(contentVersions)
        .where(eq(contentVersions.id, versionId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findVersionByIdForUpdate(versionId, tx) {
      const rows = await tx
        .select()
        .from(contentVersions)
        .where(eq(contentVersions.id, versionId))
        .limit(1)
        .for('update');
      return rows[0] ?? null;
    },

    async getNextVersionNumber(itemId, tx) {
      const rows = await tx
        .select({
          maxNum: sql<number>`COALESCE(MAX(${contentVersions.versionNumber}), 0)`,
        })
        .from(contentVersions)
        .where(eq(contentVersions.contentItemId, itemId))
        .for('update');
      return Number(rows[0]?.maxNum ?? 0) + 1;
    },

    async createContentVersion(params, executor) {
      const db = getExecutor(executor);
      await db.insert(contentVersions).values({
        id: params.id,
        contentItemId: params.contentItemId,
        versionNumber: params.versionNumber,
        status: params.status,
        title: params.title,
        summary: params.summary,
        locale: params.locale,
        payloadJson: params.payloadJson,
        metadataJson: params.metadataJson,
        createdByUserId: params.createdByUserId,
        publishedByUserId: null,
        publishedAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        contentItemId: params.contentItemId,
        versionNumber: params.versionNumber,
        status: params.status,
        title: params.title,
        summary: params.summary,
        locale: params.locale,
        payloadJson: params.payloadJson,
        metadataJson: params.metadataJson,
        createdByUserId: params.createdByUserId,
        publishedByUserId: null,
        publishedAt: null,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },

    async updateMutableDraftVersion(params, executor) {
      const db = getExecutor(executor);
      const existing = await this.findVersionById(params.versionId, db);
      if (
        !existing ||
        (existing.status !== 'draft' && existing.status !== 'rejected')
      ) {
        return null;
      }

      const nextTitle = params.title ?? existing.title;
      const nextSummary =
        params.summary !== undefined ? params.summary : existing.summary;
      const nextLocale = params.locale ?? existing.locale;
      const nextPayload = params.payloadJson ?? existing.payloadJson;
      const nextMetadata =
        params.metadataJson !== undefined
          ? params.metadataJson
          : existing.metadataJson;

      // DB-level WHERE guard prevents ever overwriting published, superseded, approved, or pending_review rows.
      const [result] = await db
        .update(contentVersions)
        .set({
          title: nextTitle,
          summary: nextSummary,
          locale: nextLocale,
          payloadJson: nextPayload,
          metadataJson: nextMetadata,
          status: params.nextStatus,
          updatedAt: params.now,
        })
        .where(
          and(
            eq(contentVersions.id, params.versionId),
            inArray(contentVersions.status, ['draft', 'rejected'])
          )
        );

      if ((result.affectedRows ?? 0) !== 1) {
        return null;
      }

      return {
        ...existing,
        title: nextTitle,
        summary: nextSummary,
        locale: nextLocale,
        payloadJson: nextPayload,
        metadataJson: nextMetadata,
        status: params.nextStatus,
        updatedAt: params.now,
      };
    },

    async updateVersionWorkflowStatus(params, executor) {
      const db = getExecutor(executor);
      const setValues: {
        status: string;
        updatedAt: Date;
        publishedByUserId?: string | null;
        publishedAt?: Date | null;
      } = {
        status: params.status,
        updatedAt: params.now,
      };
      if (params.publishedByUserId !== undefined) {
        setValues.publishedByUserId = params.publishedByUserId;
      }
      if (params.publishedAt !== undefined) {
        setValues.publishedAt = params.publishedAt;
      }

      await db
        .update(contentVersions)
        .set(setValues)
        .where(eq(contentVersions.id, params.versionId));
    },

    async listApprovalsForVersionIds(versionIds, executor) {
      if (versionIds.length === 0) {
        return [];
      }
      const db = getExecutor(executor);
      return db
        .select({
          id: contentApprovals.id,
          contentVersionId: contentApprovals.contentVersionId,
          submissionRound: contentApprovals.submissionRound,
          submittedByUserId: contentApprovals.submittedByUserId,
          submittedAt: contentApprovals.submittedAt,
          reviewerUserId: contentApprovals.reviewerUserId,
          decision: contentApprovals.decision,
          decisionNote: contentApprovals.decisionNote,
          isSelfApproval: contentApprovals.isSelfApproval,
          activeAdminCountAtDecision: contentApprovals.activeAdminCountAtDecision,
          decidedAt: contentApprovals.decidedAt,
        })
        .from(contentApprovals)
        .where(inArray(contentApprovals.contentVersionId, versionIds))
        .orderBy(asc(contentApprovals.submissionRound));
    },

    async findPendingApprovalForVersionForUpdate(versionId, tx) {
      const rows = await tx
        .select({
          id: contentApprovals.id,
          contentVersionId: contentApprovals.contentVersionId,
          submissionRound: contentApprovals.submissionRound,
          submittedByUserId: contentApprovals.submittedByUserId,
          submittedAt: contentApprovals.submittedAt,
          reviewerUserId: contentApprovals.reviewerUserId,
          decision: contentApprovals.decision,
          decisionNote: contentApprovals.decisionNote,
          isSelfApproval: contentApprovals.isSelfApproval,
          activeAdminCountAtDecision: contentApprovals.activeAdminCountAtDecision,
          decidedAt: contentApprovals.decidedAt,
        })
        .from(contentApprovals)
        .where(
          and(
            eq(contentApprovals.contentVersionId, versionId),
            eq(contentApprovals.decision, 'pending')
          )
        )
        .limit(1)
        .for('update');
      return rows[0] ?? null;
    },

    async getNextSubmissionRoundForVersion(versionId, tx) {
      const rows = await tx
        .select({
          maxRound: sql<number>`COALESCE(MAX(${contentApprovals.submissionRound}), 0)`,
        })
        .from(contentApprovals)
        .where(eq(contentApprovals.contentVersionId, versionId))
        .for('update');
      return Number(rows[0]?.maxRound ?? 0) + 1;
    },

    async createApprovalSubmission(params, tx) {
      await tx.insert(contentApprovals).values({
        id: params.id,
        contentVersionId: params.contentVersionId,
        submissionRound: params.submissionRound,
        submittedByUserId: params.submittedByUserId,
        submittedAt: params.submittedAt,
        reviewerUserId: null,
        decision: 'pending',
        decisionNote: null,
        isSelfApproval: false,
        activeAdminCountAtDecision: null,
        decidedAt: null,
      });

      return {
        id: params.id,
        contentVersionId: params.contentVersionId,
        submissionRound: params.submissionRound,
        submittedByUserId: params.submittedByUserId,
        submittedAt: params.submittedAt,
        reviewerUserId: null,
        decision: 'pending',
        decisionNote: null,
        isSelfApproval: false,
        activeAdminCountAtDecision: null,
        decidedAt: null,
      };
    },

    async decideApproval(params, tx) {
      const [result] = await tx
        .update(contentApprovals)
        .set({
          reviewerUserId: params.reviewerUserId,
          decision: params.decision,
          decisionNote: params.decisionNote,
          isSelfApproval: params.isSelfApproval,
          activeAdminCountAtDecision: params.activeAdminCountAtDecision,
          decidedAt: params.decidedAt,
        })
        .where(
          and(
            eq(contentApprovals.id, params.approvalId),
            eq(contentApprovals.decision, 'pending')
          )
        );
      return (result.affectedRows ?? 0) === 1;
    },

    async countActivePlatformAdmins(tx) {
      const rows = await tx
        .select({ total: count() })
        .from(users)
        .where(
          and(eq(users.platformRole, 'platform_admin'), eq(users.status, 'active'))
        );
      return Number(rows[0]?.total ?? 0);
    },

    async listPublishedLibraryContent(params) {
      const db = getDb();
      const filters = [
        eq(contentItems.isArchived, false),
        eq(contentVersions.status, 'published'),
      ];
      if (params.contentType) {
        filters.push(eq(contentItems.contentType, params.contentType));
      }
      if (params.locale) {
        filters.push(eq(contentVersions.locale, params.locale));
      }
      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${escapeSqlLikePattern(params.search.trim())}%`;
        filters.push(
          or(
            like(contentVersions.title, pattern),
            like(contentItems.slug, pattern)
          )!
        );
      }

      const whereClause = and(...filters);
      const offset = (params.page - 1) * params.limit;

      const [countRows, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(contentItems)
          .innerJoin(
            contentVersions,
            and(
              eq(contentVersions.contentItemId, contentItems.id),
              eq(contentVersions.id, contentItems.currentPublishedVersionId)
            )
          )
          .where(whereClause),
        db
          .select({
            contentItemId: contentItems.id,
            slug: contentItems.slug,
            contentType: contentItems.contentType,
            publishedVersionId: contentVersions.id,
            versionNumber: contentVersions.versionNumber,
            title: contentVersions.title,
            summary: contentVersions.summary,
            locale: contentVersions.locale,
            payloadJson: contentVersions.payloadJson,
            metadataJson: contentVersions.metadataJson,
            publishedAt: contentVersions.publishedAt,
          })
          .from(contentItems)
          .innerJoin(
            contentVersions,
            and(
              eq(contentVersions.contentItemId, contentItems.id),
              eq(contentVersions.id, contentItems.currentPublishedVersionId)
            )
          )
          .where(whereClause)
          .orderBy(desc(contentVersions.publishedAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return {
        items: rows
          .filter((r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null)
          .map((r) => ({
            contentItemId: r.contentItemId,
            slug: r.slug,
            contentType: r.contentType,
            publishedVersionId: r.publishedVersionId,
            versionNumber: r.versionNumber,
            title: r.title,
            summary: r.summary,
            locale: r.locale,
            payloadJson: r.payloadJson,
            metadataJson: r.metadataJson,
            publishedAt: r.publishedAt,
          })),
        total: Number(countRows[0]?.total ?? 0),
      };
    },

    async findPublishedLibraryContentByItemId(itemId) {
      const db = getDb();
      const rows = await db
        .select({
          contentItemId: contentItems.id,
          slug: contentItems.slug,
          contentType: contentItems.contentType,
          publishedVersionId: contentVersions.id,
          versionNumber: contentVersions.versionNumber,
          title: contentVersions.title,
          summary: contentVersions.summary,
          locale: contentVersions.locale,
          payloadJson: contentVersions.payloadJson,
          metadataJson: contentVersions.metadataJson,
          publishedAt: contentVersions.publishedAt,
        })
        .from(contentItems)
        .innerJoin(
          contentVersions,
          and(
            eq(contentVersions.contentItemId, contentItems.id),
            eq(contentVersions.id, contentItems.currentPublishedVersionId)
          )
        )
        .where(
          and(
            eq(contentItems.id, itemId),
            eq(contentItems.isArchived, false),
            eq(contentVersions.status, 'published')
          )
        )
        .limit(1);

      const row = rows[0];
      if (!row || !row.publishedAt) {
        return null;
      }

      return {
        contentItemId: row.contentItemId,
        slug: row.slug,
        contentType: row.contentType,
        publishedVersionId: row.publishedVersionId,
        versionNumber: row.versionNumber,
        title: row.title,
        summary: row.summary,
        locale: row.locale,
        payloadJson: row.payloadJson,
        metadataJson: row.metadataJson,
        publishedAt: row.publishedAt,
      };
    },
  };
}
