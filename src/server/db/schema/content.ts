import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  type MySqlTableExtraConfigValue,
  boolean,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { uuidChar36 } from './_shared.ts';
import { users } from './identity.ts';

/**
 * 3.11 content_items (Platform-wide library; circular FK to content_versions via fk_content_items_pub_version)
 */
export const contentItems = mysqlTable(
  'content_items',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    contentType: varchar('content_type', { length: 32 }).notNull(),
    currentPublishedVersionId: uuidChar36('current_published_version_id'),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    foreignKey({
      name: 'fk_content_items_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_content_items_pub_version',
      columns: [t.id, t.currentPublishedVersionId],
      foreignColumns: [
        contentVersions.contentItemId as AnyMySqlColumn,
        contentVersions.id as AnyMySqlColumn,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    unique('uq_content_items_slug').on(t.slug),
    index('idx_content_items_type_archived').on(t.contentType, t.isArchived),
  ]
);

/**
 * 3.12 content_versions (Published versions are immutable)
 */
export const contentVersions = mysqlTable(
  'content_versions',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    contentItemId: uuidChar36('content_item_id').notNull(),
    versionNumber: int('version_number').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    title: varchar('title', { length: 255 }).notNull(),
    summary: text('summary'),
    locale: varchar('locale', { length: 16 }).notNull().default('vi'),
    payloadJson: json('payload_json').$type<Record<string, unknown>>().notNull(),
    metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
    createdByUserId: uuidChar36('created_by_user_id').notNull(),
    publishedByUserId: uuidChar36('published_by_user_id'),
    publishedAt: datetime('published_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_content_versions_item',
      columns: [t.contentItemId],
      foreignColumns: [contentItems.id],
    }),
    foreignKey({
      name: 'fk_content_versions_creator',
      columns: [t.createdByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_content_versions_publisher',
      columns: [t.publishedByUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_content_versions_item_num').on(t.contentItemId, t.versionNumber),
    unique('uq_content_versions_item_id').on(t.contentItemId, t.id),
    index('idx_content_versions_status').on(t.status, t.contentItemId),
  ]
);

/**
 * 3.13 content_approvals (1 row = 1 submission_round; immutable once decided)
 */
export const contentApprovals = mysqlTable(
  'content_approvals',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    contentVersionId: uuidChar36('content_version_id').notNull(),
    submissionRound: int('submission_round').notNull().default(1),
    submittedByUserId: uuidChar36('submitted_by_user_id').notNull(),
    submittedAt: datetime('submitted_at', { fsp: 3 }).notNull(),
    reviewerUserId: uuidChar36('reviewer_user_id'),
    decision: varchar('decision', { length: 32 }).notNull().default('pending'),
    decisionNote: text('decision_note'),
    isSelfApproval: boolean('is_self_approval').notNull().default(false),
    activeAdminCountAtDecision: int('active_admin_count_at_decision'),
    decidedAt: datetime('decided_at', { fsp: 3 }),
    pendingVersionGuard: uuidChar36('pending_version_guard').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`CASE WHEN decision = 'pending' THEN content_version_id ELSE NULL END`,
      { mode: 'virtual' }
    ),
  },
  (t) => [
    foreignKey({
      name: 'fk_approvals_version',
      columns: [t.contentVersionId],
      foreignColumns: [contentVersions.id],
    }),
    foreignKey({
      name: 'fk_approvals_submitter',
      columns: [t.submittedByUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'fk_approvals_reviewer',
      columns: [t.reviewerUserId],
      foreignColumns: [users.id],
    }),
    unique('uq_approvals_version_round').on(t.contentVersionId, t.submissionRound),
    unique('uq_approvals_single_pending').on(t.pendingVersionGuard),
    index('idx_approvals_version_decision').on(t.contentVersionId, t.decision),
  ]
);
