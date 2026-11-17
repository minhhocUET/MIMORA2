import type { CanonicalContentType } from '../db/schema/_shared.ts';
import { generateUuidV7 } from '../db/uuid.ts';
import {
  ApiErrors,
  AppError,
  extractDatabaseErrorMeta,
  isDatabaseError,
  translateDatabaseError,
} from '../http/errors.ts';
import {
  createContentRepository,
  type ContentApprovalRecord,
  type ContentDbOrTx,
  type ContentItemRecord,
  type ContentRepository,
  type ContentVersionRecord,
  type PublishedLibraryRecord,
} from '../repositories/content.repository.ts';
import {
  isCanonicalContentType,
  validateContentPayloadAndMetadata,
} from '../validators/content-payload.schema.ts';
import {
  recordAuditEvent,
  type AuditInsertExecutor,
} from './audit.service.ts';

export const CONTENT_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,127}$/;

export function normalizeContentSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface ContentActorContext {
  actorUserId: string;
  ipPrefix: string | null;
}

export interface SafeContentItemView {
  id: string;
  slug: string;
  contentType: CanonicalContentType;
  currentPublishedVersionId: string | null;
  createdByUserId: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SafeContentApprovalView {
  id: string;
  contentVersionId: string;
  submissionRound: number;
  submittedByUserId: string;
  submittedAt: string;
  reviewerUserId: string | null;
  decision: string;
  decisionNote: string | null;
  isSelfApproval: boolean;
  activeAdminCountAtDecision: number | null;
  decidedAt: string | null;
}

export interface SafeContentVersionView {
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
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvals?: SafeContentApprovalView[];
}

export interface SafeTeacherLibraryContentView {
  contentItemId: string;
  slug: string;
  contentType: CanonicalContentType;
  publishedVersionId: string;
  versionNumber: number;
  title: string;
  summary: string | null;
  locale: string;
  payloadJson: Record<string, unknown>;
  metadataJson: Record<string, unknown> | null;
  publishedAt: string;
}

function toSafeItemView(row: ContentItemRecord): SafeContentItemView {
  const contentType: CanonicalContentType = isCanonicalContentType(row.contentType)
    ? row.contentType
    : 'emotion_card';
  return {
    id: row.id,
    slug: row.slug,
    contentType,
    currentPublishedVersionId: row.currentPublishedVersionId,
    createdByUserId: row.createdByUserId,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSafeApprovalView(row: ContentApprovalRecord): SafeContentApprovalView {
  return {
    id: row.id,
    contentVersionId: row.contentVersionId,
    submissionRound: row.submissionRound,
    submittedByUserId: row.submittedByUserId,
    submittedAt: row.submittedAt.toISOString(),
    reviewerUserId: row.reviewerUserId,
    decision: row.decision,
    decisionNote: row.decisionNote,
    isSelfApproval: row.isSelfApproval,
    activeAdminCountAtDecision: row.activeAdminCountAtDecision,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

function toSafeVersionView(
  row: ContentVersionRecord,
  approvals?: ContentApprovalRecord[]
): SafeContentVersionView {
  return {
    id: row.id,
    contentItemId: row.contentItemId,
    versionNumber: row.versionNumber,
    status: row.status,
    title: row.title,
    summary: row.summary,
    locale: row.locale,
    payloadJson: row.payloadJson,
    metadataJson: row.metadataJson,
    createdByUserId: row.createdByUserId,
    publishedByUserId: row.publishedByUserId,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(approvals ? { approvals: approvals.map(toSafeApprovalView) } : {}),
  };
}

function toTeacherLibraryView(
  row: PublishedLibraryRecord
): SafeTeacherLibraryContentView {
  const contentType: CanonicalContentType = isCanonicalContentType(row.contentType)
    ? row.contentType
    : 'emotion_card';
  return {
    contentItemId: row.contentItemId,
    slug: row.slug,
    contentType,
    publishedVersionId: row.publishedVersionId,
    versionNumber: row.versionNumber,
    title: row.title,
    summary: row.summary,
    locale: row.locale,
    payloadJson: row.payloadJson,
    metadataJson: row.metadataJson,
    publishedAt: row.publishedAt.toISOString(),
  };
}

export interface ContentServiceDeps {
  repo?: ContentRepository;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createContentService(deps?: ContentServiceDeps) {
  const repo = deps?.repo ?? createContentRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: ContentDbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  function validateSlugOrThrow(rawSlug: string, field = 'body.slug'): string {
    const normalized = normalizeContentSlug(rawSlug);
    if (!CONTENT_SLUG_REGEX.test(normalized)) {
      throw ApiErrors.validation([
        {
          field,
          code: 'INVALID_SLUG',
          messageKey: 'error.content.invalid_slug',
          message:
            'Slug nội dung chỉ được gồm chữ thường, số, gạch ngang hoặc gạch dưới (2-128 ký tự).',
        },
      ]);
    }
    return normalized;
  }

  return {
    async listContentItems(params: {
      page: number;
      limit: number;
      contentType?: CanonicalContentType;
      isArchived?: boolean;
      search?: string;
    }) {
      const result = await repo.listContentItems(params);
      return {
        items: result.items.map(toSafeItemView),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async getContentItemDetail(itemId: string) {
      const item = await repo.findContentItemById(itemId);
      if (!item) {
        throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
      }

      const versions = await repo.listVersionsForItem(itemId);
      const approvals = await repo.listApprovalsForVersionIds(
        versions.map((v) => v.id)
      );

      const approvalsByVersion = new Map<string, ContentApprovalRecord[]>();
      for (const approval of approvals) {
        const list = approvalsByVersion.get(approval.contentVersionId) ?? [];
        list.push(approval);
        approvalsByVersion.set(approval.contentVersionId, list);
      }

      return {
        item: toSafeItemView(item),
        versions: versions.map((v) =>
          toSafeVersionView(v, approvalsByVersion.get(v.id) ?? [])
        ),
      };
    },

    async listItemVersions(itemId: string) {
      const item = await repo.findContentItemById(itemId);
      if (!item) {
        throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
      }

      const versions = await repo.listVersionsForItem(itemId);
      const approvals = await repo.listApprovalsForVersionIds(
        versions.map((v) => v.id)
      );
      const approvalsByVersion = new Map<string, ContentApprovalRecord[]>();
      for (const approval of approvals) {
        const list = approvalsByVersion.get(approval.contentVersionId) ?? [];
        list.push(approval);
        approvalsByVersion.set(approval.contentVersionId, list);
      }

      return {
        itemId: item.id,
        contentType: isCanonicalContentType(item.contentType)
          ? item.contentType
          : 'emotion_card',
        currentPublishedVersionId: item.currentPublishedVersionId,
        versions: versions.map((v) =>
          toSafeVersionView(v, approvalsByVersion.get(v.id) ?? [])
        ),
      };
    },

    async createContentItem(
      input: {
        slug: string;
        contentType: CanonicalContentType;
        title: string;
        summary?: string | null;
        locale?: string;
        payloadJson: unknown;
        metadataJson?: unknown;
      },
      actor: ContentActorContext
    ) {
      const normalizedSlug = validateSlugOrThrow(input.slug, 'body.slug');
      if (!isCanonicalContentType(input.contentType)) {
        throw ApiErrors.validation([
          {
            field: 'body.contentType',
            code: 'INVALID_CONTENT_TYPE',
            messageKey: 'error.content.invalid_type',
            message: 'Loại nội dung không nằm trong 5 loại chuẩn của hệ thống.',
          },
        ]);
      }

      const validatedPayload = validateContentPayloadAndMetadata({
        contentType: input.contentType,
        locale: input.locale ?? 'vi',
        payloadJson: input.payloadJson,
        metadataJson: input.metadataJson,
      });

      const title = input.title.trim();
      const summary = input.summary?.trim() ? input.summary.trim() : null;
      const now = nowFn();
      const itemId = generateUuidV7();
      const versionId = generateUuidV7();

      try {
        const created = await repo.withTransaction(async (tx) => {
          const existing = await repo.findContentItemBySlug(normalizedSlug, tx);
          if (existing) {
            throw ApiErrors.conflict(
              'CONTENT_SLUG_EXISTS',
              'error.content.slug_exists',
              'Slug nội dung đã tồn tại trong hệ thống.'
            );
          }

          const item = await repo.createContentItem(
            {
              id: itemId,
              slug: normalizedSlug,
              contentType: input.contentType,
              createdByUserId: actor.actorUserId,
              now,
            },
            tx
          );

          const version = await repo.createContentVersion(
            {
              id: versionId,
              contentItemId: item.id,
              versionNumber: 1,
              status: 'draft',
              title,
              summary,
              locale: validatedPayload.locale,
              payloadJson: validatedPayload.payloadJson,
              metadataJson: validatedPayload.metadataJson,
              createdByUserId: actor.actorUserId,
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.item_created',
              targetType: 'content_item',
              targetId: item.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                slug: item.slug,
                contentType: item.contentType,
              },
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.version_created',
              targetType: 'content_version',
              targetId: version.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                contentItemId: item.id,
                versionNumber: 1,
                locale: version.locale,
              },
            },
            tx
          );

          return { item, version };
        });

        return {
          item: toSafeItemView(created.item),
          version: toSafeVersionView(created.version, []),
        };
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async updateContentItemMetadata(
      itemId: string,
      input: { slug?: string; isArchived?: boolean },
      actor: ContentActorContext
    ): Promise<SafeContentItemView> {
      if (input.slug === undefined && input.isArchived === undefined) {
        throw ApiErrors.validation([
          {
            field: 'body',
            code: 'EMPTY_UPDATE',
            messageKey: 'error.validation.empty_update',
            message: 'Cần cung cấp ít nhất một trường để cập nhật.',
          },
        ]);
      }

      const normalizedSlug =
        input.slug !== undefined
          ? validateSlugOrThrow(input.slug, 'body.slug')
          : undefined;
      const now = nowFn();

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findContentItemByIdForUpdate(itemId, tx);
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }

          if (
            normalizedSlug !== undefined &&
            normalizedSlug !== existing.slug
          ) {
            if (existing.currentPublishedVersionId !== null) {
              throw ApiErrors.conflict(
                'PUBLISHED_ITEM_SLUG_LOCKED',
                'error.content.slug_locked',
                'Không thể thay đổi slug của nội dung đã từng xuất bản.'
              );
            }
            const conflict = await repo.findContentItemBySlug(normalizedSlug, tx);
            if (conflict && conflict.id !== existing.id) {
              throw ApiErrors.conflict(
                'CONTENT_SLUG_EXISTS',
                'error.content.slug_exists',
                'Slug nội dung đã tồn tại trong hệ thống.'
              );
            }
          }

          const next = await repo.updateContentItem(
            {
              itemId,
              slug: normalizedSlug,
              isArchived: input.isArchived,
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }

          if (!existing.isArchived && next.isArchived) {
            await safeAudit(
              {
                organizationId: null,
                actorUserId: actor.actorUserId,
                actorRole: 'platform_admin',
                eventType: 'content.archived',
                targetType: 'content_item',
                targetId: next.id,
                ipPrefix: actor.ipPrefix,
                metadata: {
                  slug: next.slug,
                  contentType: next.contentType,
                  isArchived: true,
                },
              },
              tx
            );
          }

          return next;
        });

        return toSafeItemView(updated);
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async archiveContentItem(
      itemId: string,
      actor: ContentActorContext
    ): Promise<SafeContentItemView> {
      const now = nowFn();
      try {
        const archived = await repo.withTransaction(async (tx) => {
          const existing = await repo.findContentItemByIdForUpdate(itemId, tx);
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }
          if (existing.isArchived) {
            return existing;
          }

          const next = await repo.updateContentItem(
            {
              itemId,
              isArchived: true,
              now,
            },
            tx
          );
          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.archived',
              targetType: 'content_item',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                slug: next.slug,
                contentType: next.contentType,
                isArchived: true,
              },
            },
            tx
          );

          return next;
        });

        return toSafeItemView(archived);
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async createDraftVersion(
      itemId: string,
      input: {
        title: string;
        summary?: string | null;
        locale?: string;
        payloadJson: unknown;
        metadataJson?: unknown;
      },
      actor: ContentActorContext
    ): Promise<SafeContentVersionView> {
      const now = nowFn();
      const versionId = generateUuidV7();

      try {
        const created = await repo.withTransaction(async (tx) => {
          const item = await repo.findContentItemByIdForUpdate(itemId, tx);
          if (!item) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }
          if (item.isArchived) {
            throw ApiErrors.conflict(
              'CONTENT_ITEM_ARCHIVED',
              'error.content.item_archived',
              'Mục nội dung đã được lưu trữ, không thể tạo phiên bản mới.'
            );
          }

          const contentType: CanonicalContentType = isCanonicalContentType(
            item.contentType
          )
            ? item.contentType
            : 'emotion_card';

          const validatedPayload = validateContentPayloadAndMetadata({
            contentType,
            locale: input.locale ?? 'vi',
            payloadJson: input.payloadJson,
            metadataJson: input.metadataJson,
          });

          const nextVersionNumber = await repo.getNextVersionNumber(item.id, tx);
          const version = await repo.createContentVersion(
            {
              id: versionId,
              contentItemId: item.id,
              versionNumber: nextVersionNumber,
              status: 'draft',
              title: input.title.trim(),
              summary: input.summary?.trim() ? input.summary.trim() : null,
              locale: validatedPayload.locale,
              payloadJson: validatedPayload.payloadJson,
              metadataJson: validatedPayload.metadataJson,
              createdByUserId: actor.actorUserId,
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.version_created',
              targetType: 'content_version',
              targetId: version.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                contentItemId: item.id,
                versionNumber: nextVersionNumber,
                locale: version.locale,
              },
            },
            tx
          );

          return version;
        });

        return toSafeVersionView(created, []);
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async updateDraftVersion(
      versionId: string,
      input: {
        title?: string;
        summary?: string | null;
        locale?: string;
        payloadJson?: unknown;
        metadataJson?: unknown;
      },
      _actor: ContentActorContext
    ): Promise<SafeContentVersionView> {
      if (
        input.title === undefined &&
        input.summary === undefined &&
        input.locale === undefined &&
        input.payloadJson === undefined &&
        input.metadataJson === undefined
      ) {
        throw ApiErrors.validation([
          {
            field: 'body',
            code: 'EMPTY_UPDATE',
            messageKey: 'error.validation.empty_update',
            message: 'Cần cung cấp ít nhất một trường để cập nhật phiên bản.',
          },
        ]);
      }

      const now = nowFn();

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findVersionByIdForUpdate(versionId, tx);
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy phiên bản nội dung.');
          }

          if (
            existing.status === 'published' ||
            existing.status === 'superseded'
          ) {
            throw ApiErrors.conflict(
              'VERSION_IMMUTABLE',
              'error.content.version_immutable',
              'Phiên bản đã xuất bản hoặc đã được thay thế là bất biến; hãy tạo phiên bản nháp mới.'
            );
          }

          if (
            existing.status === 'pending_review' ||
            existing.status === 'approved'
          ) {
            throw ApiErrors.conflict(
              'VERSION_LOCKED_IN_WORKFLOW',
              'error.content.version_locked_in_workflow',
              'Không thể chỉnh sửa phiên bản đang chờ duyệt hoặc đã được phê duyệt.'
            );
          }

          const item = await repo.findContentItemById(existing.contentItemId, tx);
          if (!item) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung cha.');
          }

          const contentType: CanonicalContentType = isCanonicalContentType(
            item.contentType
          )
            ? item.contentType
            : 'emotion_card';

          const validatedPayload = validateContentPayloadAndMetadata({
            contentType,
            locale: input.locale ?? existing.locale,
            payloadJson:
              input.payloadJson !== undefined
                ? input.payloadJson
                : existing.payloadJson,
            metadataJson:
              input.metadataJson !== undefined
                ? input.metadataJson
                : existing.metadataJson,
          });

          const next = await repo.updateMutableDraftVersion(
            {
              versionId: existing.id,
              title:
                input.title !== undefined ? input.title.trim() : undefined,
              summary:
                input.summary === undefined
                  ? undefined
                  : input.summary === null
                    ? null
                    : input.summary.trim() || null,
              locale: validatedPayload.locale,
              payloadJson: validatedPayload.payloadJson,
              metadataJson: validatedPayload.metadataJson,
              nextStatus: 'draft',
              now,
            },
            tx
          );

          if (!next) {
            throw ApiErrors.conflict(
              'VERSION_IMMUTABLE',
              'error.content.version_immutable',
              'Không thể cập nhật phiên bản do trạng thái đã thay đổi.'
            );
          }

          return next;
        });

        const approvals = await repo.listApprovalsForVersionIds([updated.id]);
        return toSafeVersionView(updated, approvals);
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async submitVersionForReview(
      versionId: string,
      actor: ContentActorContext
    ): Promise<{
      version: SafeContentVersionView;
      approval: SafeContentApprovalView;
    }> {
      const now = nowFn();
      const approvalId = generateUuidV7();

      try {
        const submitted = await repo.withTransaction(async (tx) => {
          const version = await repo.findVersionByIdForUpdate(versionId, tx);
          if (!version) {
            throw ApiErrors.notFound('Không tìm thấy phiên bản nội dung.');
          }

          const item = await repo.findContentItemByIdForUpdate(
            version.contentItemId,
            tx
          );
          if (!item) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }
          if (item.isArchived) {
            throw ApiErrors.conflict(
              'CONTENT_ITEM_ARCHIVED',
              'error.content.item_archived',
              'Mục nội dung đã lưu trữ, không thể gửi duyệt.'
            );
          }

          if (version.status === 'pending_review') {
            throw ApiErrors.conflict(
              'SUBMISSION_ALREADY_PENDING',
              'error.content.submission_already_pending',
              'Phiên bản này đang có một yêu cầu phê duyệt chờ xử lý.'
            );
          }

          if (version.status !== 'draft' && version.status !== 'rejected') {
            throw ApiErrors.conflict(
              'INVALID_VERSION_STATUS',
              'error.content.invalid_status_for_submit',
              'Chỉ phiên bản nháp hoặc bị từ chối mới có thể gửi duyệt.'
            );
          }

          const existingPending =
            await repo.findPendingApprovalForVersionForUpdate(version.id, tx);
          if (existingPending) {
            throw ApiErrors.conflict(
              'SUBMISSION_ALREADY_PENDING',
              'error.content.submission_already_pending',
              'Phiên bản này đang có một yêu cầu phê duyệt chờ xử lý.'
            );
          }

          // Re-verify payload & safety rules before entering review queue
          const contentType: CanonicalContentType = isCanonicalContentType(
            item.contentType
          )
            ? item.contentType
            : 'emotion_card';
          validateContentPayloadAndMetadata({
            contentType,
            locale: version.locale,
            payloadJson: version.payloadJson,
            metadataJson: version.metadataJson,
          });

          const nextRound = await repo.getNextSubmissionRoundForVersion(
            version.id,
            tx
          );

          await repo.updateVersionWorkflowStatus(
            {
              versionId: version.id,
              status: 'pending_review',
              now,
            },
            tx
          );

          const approval = await repo.createApprovalSubmission(
            {
              id: approvalId,
              contentVersionId: version.id,
              submissionRound: nextRound,
              submittedByUserId: actor.actorUserId,
              submittedAt: now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.submitted_for_review',
              targetType: 'content_version',
              targetId: version.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                contentItemId: item.id,
                versionNumber: version.versionNumber,
                submissionRound: nextRound,
              },
            },
            tx
          );

          return {
            version: { ...version, status: 'pending_review', updatedAt: now },
            approval,
          };
        });

        return {
          version: toSafeVersionView(submitted.version),
          approval: toSafeApprovalView(submitted.approval),
        };
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          const meta = extractDatabaseErrorMeta(err);
          if (meta?.code === 'ER_DUP_ENTRY' || meta?.errno === 1062) {
            throw ApiErrors.conflict(
              'SUBMISSION_ALREADY_PENDING',
              'error.content.submission_already_pending',
              'Phiên bản này đang có một yêu cầu phê duyệt chờ xử lý.'
            );
          }
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async approveVersion(
      versionId: string,
      input: { decisionNote?: string | null },
      actor: ContentActorContext
    ): Promise<{
      version: SafeContentVersionView;
      approval: SafeContentApprovalView;
    }> {
      const now = nowFn();
      const decisionNote = input.decisionNote?.trim()
        ? input.decisionNote.trim()
        : null;

      let rejectSelfApprovalAuditContext: {
        contentItemId: string;
        versionId: string;
        activeAdminCount: number;
      } | null = null;

      try {
        const result = await repo.withTransaction(async (tx) => {
          const version = await repo.findVersionByIdForUpdate(versionId, tx);
          if (!version) {
            throw ApiErrors.notFound('Không tìm thấy phiên bản nội dung.');
          }

          if (version.status !== 'pending_review') {
            throw ApiErrors.conflict(
              'ALREADY_REVIEWED',
              'error.content.already_reviewed',
              'Phiên bản không ở trạng thái chờ phê duyệt hoặc đã được xử lý trước đó.'
            );
          }

          const pendingApproval =
            await repo.findPendingApprovalForVersionForUpdate(version.id, tx);
          if (!pendingApproval || pendingApproval.decision !== 'pending') {
            throw ApiErrors.conflict(
              'ALREADY_REVIEWED',
              'error.content.already_reviewed',
              'Vòng phê duyệt đang chờ không tồn tại hoặc đã được xử lý bởi quản trị viên khác.'
            );
          }

          const activeAdminCount = await repo.countActivePlatformAdmins(tx);
          if (activeAdminCount < 1) {
            throw ApiErrors.forbidden(
              'Không có tài khoản quản trị viên nền tảng hợp lệ để phê duyệt.'
            );
          }

          // Compare reviewer against content_versions.created_by_user_id per DATABASE_SCHEMA.md §7.1
          const isSelfApproval = version.createdByUserId === actor.actorUserId;
          if (isSelfApproval && activeAdminCount >= 2) {
            rejectSelfApprovalAuditContext = {
              contentItemId: version.contentItemId,
              versionId: version.id,
              activeAdminCount,
            };
            throw ApiErrors.forbidden(
              'Khi hệ thống có từ 2 quản trị viên nền tảng đang hoạt động trở lên, tác giả phiên bản không được tự phê duyệt.'
            );
          }

          const decided = await repo.decideApproval(
            {
              approvalId: pendingApproval.id,
              reviewerUserId: actor.actorUserId,
              decision: 'approved',
              decisionNote,
              isSelfApproval,
              activeAdminCountAtDecision: activeAdminCount,
              decidedAt: now,
            },
            tx
          );
          if (!decided) {
            throw ApiErrors.conflict(
              'ALREADY_REVIEWED',
              'error.content.already_reviewed',
              'Yêu cầu phê duyệt đã được xử lý đồng thời bởi quản trị viên khác.'
            );
          }

          await repo.updateVersionWorkflowStatus(
            {
              versionId: version.id,
              status: 'approved',
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: isSelfApproval
                ? 'content.self_approved'
                : 'content.approved',
              targetType: 'content_version',
              targetId: version.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                contentItemId: version.contentItemId,
                versionNumber: version.versionNumber,
                submissionRound: pendingApproval.submissionRound,
                isSelfApproval,
                activeAdminCountAtDecision: activeAdminCount,
              },
            },
            tx
          );

          const updatedApproval: ContentApprovalRecord = {
            ...pendingApproval,
            reviewerUserId: actor.actorUserId,
            decision: 'approved',
            decisionNote,
            isSelfApproval,
            activeAdminCountAtDecision: activeAdminCount,
            decidedAt: now,
          };

          return {
            version: { ...version, status: 'approved', updatedAt: now },
            approval: updatedApproval,
          };
        });

        return {
          version: toSafeVersionView(result.version),
          approval: toSafeApprovalView(result.approval),
        };
      } catch (err: unknown) {
        if (rejectSelfApprovalAuditContext) {
          const ctx: {
            contentItemId: string;
            versionId: string;
            activeAdminCount: number;
          } = rejectSelfApprovalAuditContext;
          await safeAudit({
            organizationId: null,
            actorUserId: actor.actorUserId,
            actorRole: 'platform_admin',
            eventType: 'security.unauthorized_access_denied',
            targetType: 'content_version',
            targetId: ctx.versionId,
            ipPrefix: actor.ipPrefix,
            metadata: {
              reason: 'self_approval_blocked_multi_admin',
              contentItemId: ctx.contentItemId,
              activeAdminCount: ctx.activeAdminCount,
            },
          }).catch(() => undefined);
        }

        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async rejectVersion(
      versionId: string,
      input: { decisionNote?: string | null },
      actor: ContentActorContext
    ): Promise<{
      version: SafeContentVersionView;
      approval: SafeContentApprovalView;
    }> {
      const now = nowFn();
      const decisionNote = input.decisionNote?.trim()
        ? input.decisionNote.trim()
        : null;

      try {
        const result = await repo.withTransaction(async (tx) => {
          const version = await repo.findVersionByIdForUpdate(versionId, tx);
          if (!version) {
            throw ApiErrors.notFound('Không tìm thấy phiên bản nội dung.');
          }

          if (version.status !== 'pending_review') {
            throw ApiErrors.conflict(
              'ALREADY_REVIEWED',
              'error.content.already_reviewed',
              'Phiên bản không ở trạng thái chờ phê duyệt hoặc đã được xử lý trước đó.'
            );
          }

          const pendingApproval =
            await repo.findPendingApprovalForVersionForUpdate(version.id, tx);
          if (!pendingApproval || pendingApproval.decision !== 'pending') {
            throw ApiErrors.conflict(
              'ALREADY_REVIEWED',
              'error.content.already_reviewed',
              'Vòng phê duyệt đang chờ không tồn tại hoặc đã được xử lý.'
            );
          }

          const activeAdminCount = await repo.countActivePlatformAdmins(tx);

          const decided = await repo.decideApproval(
            {
              approvalId: pendingApproval.id,
              reviewerUserId: actor.actorUserId,
              decision: 'rejected',
              decisionNote,
              isSelfApproval: false,
              activeAdminCountAtDecision: activeAdminCount,
              decidedAt: now,
            },
            tx
          );
          if (!decided) {
            throw ApiErrors.conflict(
              'ALREADY_REVIEWED',
              'error.content.already_reviewed',
              'Yêu cầu phê duyệt đã được xử lý đồng thời bởi quản trị viên khác.'
            );
          }

          await repo.updateVersionWorkflowStatus(
            {
              versionId: version.id,
              status: 'rejected',
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.rejected',
              targetType: 'content_version',
              targetId: version.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                contentItemId: version.contentItemId,
                versionNumber: version.versionNumber,
                submissionRound: pendingApproval.submissionRound,
                hasDecisionNote: decisionNote !== null,
              },
            },
            tx
          );

          const updatedApproval: ContentApprovalRecord = {
            ...pendingApproval,
            reviewerUserId: actor.actorUserId,
            decision: 'rejected',
            decisionNote,
            isSelfApproval: false,
            activeAdminCountAtDecision: activeAdminCount,
            decidedAt: now,
          };

          return {
            version: { ...version, status: 'rejected', updatedAt: now },
            approval: updatedApproval,
          };
        });

        return {
          version: toSafeVersionView(result.version),
          approval: toSafeApprovalView(result.approval),
        };
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async publishVersion(
      versionId: string,
      actor: ContentActorContext
    ): Promise<{
      item: SafeContentItemView;
      version: SafeContentVersionView;
    }> {
      const now = nowFn();

      try {
        const published = await repo.withTransaction(async (tx) => {
          const version = await repo.findVersionByIdForUpdate(versionId, tx);
          if (!version) {
            throw ApiErrors.notFound('Không tìm thấy phiên bản nội dung.');
          }

          const item = await repo.findContentItemByIdForUpdate(
            version.contentItemId,
            tx
          );
          if (!item) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }
          if (item.isArchived) {
            throw ApiErrors.conflict(
              'CONTENT_ITEM_ARCHIVED',
              'error.content.item_archived',
              'Không thể xuất bản mục nội dung đã lưu trữ.'
            );
          }

          if (version.status === 'published') {
            throw ApiErrors.conflict(
              'ALREADY_PUBLISHED',
              'error.content.already_published',
              'Phiên bản này đã được xuất bản.'
            );
          }

          if (version.status !== 'approved') {
            throw ApiErrors.conflict(
              'VERSION_NOT_APPROVED',
              'error.content.version_not_approved',
              'Chỉ phiên bản đã được phê duyệt mới có thể xuất bản.'
            );
          }

          const approvals = await repo.listApprovalsForVersionIds([version.id], tx);
          const latestApproval = approvals[approvals.length - 1];
          if (!latestApproval || latestApproval.decision !== 'approved') {
            throw ApiErrors.conflict(
              'VERSION_NOT_APPROVED',
              'error.content.version_not_approved',
              'Phiên bản chưa có quyết định phê duyệt hợp lệ.'
            );
          }

          const previousPublishedId = item.currentPublishedVersionId;
          if (previousPublishedId && previousPublishedId !== version.id) {
            await repo.updateVersionWorkflowStatus(
              {
                versionId: previousPublishedId,
                status: 'superseded',
                now,
              },
              tx
            );
          }

          await repo.updateVersionWorkflowStatus(
            {
              versionId: version.id,
              status: 'published',
              publishedByUserId: actor.actorUserId,
              publishedAt: now,
              now,
            },
            tx
          );

          const updatedItem = await repo.updateContentItem(
            {
              itemId: item.id,
              currentPublishedVersionId: version.id,
              now,
            },
            tx
          );
          if (!updatedItem) {
            throw ApiErrors.notFound('Không tìm thấy mục nội dung.');
          }

          await safeAudit(
            {
              organizationId: null,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'content.published',
              targetType: 'content_version',
              targetId: version.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                contentItemId: item.id,
                versionNumber: version.versionNumber,
                previousPublishedVersionId: previousPublishedId,
              },
            },
            tx
          );

          return {
            item: updatedItem,
            version: {
              ...version,
              status: 'published',
              publishedByUserId: actor.actorUserId,
              publishedAt: now,
              updatedAt: now,
            },
          };
        });

        return {
          item: toSafeItemView(published.item),
          version: toSafeVersionView(published.version),
        };
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }
        if (isDatabaseError(err)) {
          throw translateDatabaseError(err);
        }
        throw err;
      }
    },

    async listPublishedLibrary(params: {
      page: number;
      limit: number;
      contentType?: CanonicalContentType;
      locale?: string;
      search?: string;
    }) {
      const result = await repo.listPublishedLibraryContent(params);
      return {
        items: result.items.map(toTeacherLibraryView),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async getPublishedLibraryItem(
      itemId: string
    ): Promise<SafeTeacherLibraryContentView> {
      const record = await repo.findPublishedLibraryContentByItemId(itemId);
      if (!record) {
        throw ApiErrors.notFound(
          'Không tìm thấy nội dung đã xuất bản trong thư viện.'
        );
      }
      return toTeacherLibraryView(record);
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;
