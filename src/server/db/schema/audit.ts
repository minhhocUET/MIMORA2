import {
  datetime,
  foreignKey,
  index,
  json,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { uuidChar36 } from './_shared';
import { organizations, users } from './identity';

/**
 * 3.22 audit_logs (Append-only operational & security audit trail)
 */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: uuidChar36('id').primaryKey().notNull(),
    organizationId: uuidChar36('organization_id'),
    actorUserId: uuidChar36('actor_user_id'),
    actorRole: varchar('actor_role', { length: 32 }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }),
    targetId: uuidChar36('target_id'),
    ipPrefix: varchar('ip_prefix', { length: 64 }),
    metadataJson: json('metadata_json').$type<Record<string, unknown>>(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_audit_org',
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: 'fk_audit_actor',
      columns: [t.actorUserId],
      foreignColumns: [users.id],
    }),
    index('idx_audit_org_created').on(t.organizationId, t.createdAt),
    index('idx_audit_event_created').on(t.eventType, t.createdAt),
    index('idx_audit_actor').on(t.actorUserId, t.createdAt),
  ]
);
