import { generateUuidV7 } from '../db/uuid.ts';
import { ApiErrors, AppError, isDatabaseError, translateDatabaseError } from '../http/errors.ts';
import {
  ORGANIZATION_STATUSES,
  createOrgRepository,
  type OrganizationRecord,
  type OrganizationStatus,
  type OrgDbOrTx,
  type OrgRepository,
} from '../repositories/org.repository.ts';
import { recordAuditEvent, type AuditInsertExecutor } from './audit.service.ts';

export const ORG_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

export function normalizeOrganizationCode(rawCode: string): string {
  return rawCode.trim().toUpperCase();
}

export function isValidOrganizationStatus(value: string): value is OrganizationStatus {
  return (ORGANIZATION_STATUSES as readonly string[]).includes(value);
}

export interface SafeOrganizationView {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
}

function toSafeOrganizationView(row: OrganizationRecord): SafeOrganizationView {
  const status: OrganizationStatus =
    row.status === 'suspended' ? 'suspended' : 'active';
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface OrgActorContext {
  actorUserId: string;
  ipPrefix: string | null;
}

export interface OrgServiceDeps {
  repo?: OrgRepository;
  now?: () => Date;
  auditFn?: (
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: AuditInsertExecutor
  ) => Promise<unknown>;
}

export function createOrgService(deps?: OrgServiceDeps) {
  const repo = deps?.repo ?? createOrgRepository();
  const nowFn = deps?.now ?? (() => new Date());
  const emitAudit = deps?.auditFn ?? recordAuditEvent;

  async function safeAudit(
    input: Parameters<typeof recordAuditEvent>[0],
    executor?: OrgDbOrTx
  ): Promise<void> {
    await emitAudit(input, executor as AuditInsertExecutor | undefined);
  }

  return {
    async listOrganizations(params: {
      page: number;
      limit: number;
      status?: OrganizationStatus;
      search?: string;
    }): Promise<{
      items: SafeOrganizationView[];
      page: number;
      limit: number;
      total: number;
    }> {
      const result = await repo.listOrganizations(params);
      return {
        items: result.items.map(toSafeOrganizationView),
        page: params.page,
        limit: params.limit,
        total: result.total,
      };
    },

    async getOrganizationById(orgId: string): Promise<SafeOrganizationView> {
      const org = await repo.findOrganizationById(orgId);
      if (!org) {
        throw ApiErrors.notFound('Không tìm thấy tổ chức.');
      }
      return toSafeOrganizationView(org);
    },

    async createOrganization(
      input: { code: string; name: string; status?: OrganizationStatus },
      actor: OrgActorContext
    ): Promise<SafeOrganizationView> {
      const normalizedCode = normalizeOrganizationCode(input.code);
      if (!ORG_CODE_REGEX.test(normalizedCode)) {
        throw ApiErrors.validation([
          {
            field: 'body.code',
            code: 'INVALID_FORMAT',
            messageKey: 'error.org.invalid_code',
            message: 'Mã trường chỉ được gồm chữ cái, số, dấu gạch ngang hoặc gạch dưới (2-64 ký tự).',
          },
        ]);
      }

      const trimmedName = input.name.trim();
      const status: OrganizationStatus = input.status ?? 'active';
      const now = nowFn();
      const id = generateUuidV7();

      try {
        const created = await repo.withTransaction(async (tx) => {
          const existing = await repo.findOrganizationByCode(normalizedCode, tx);
          if (existing) {
            throw ApiErrors.conflict(
              'ORGANIZATION_CODE_EXISTS',
              'error.org.code_exists',
              'Mã trường học đã tồn tại trong hệ thống.'
            );
          }

          const record = await repo.createOrganization(
            {
              id,
              code: normalizedCode,
              name: trimmedName,
              status,
              now,
            },
            tx
          );

          await safeAudit(
            {
              organizationId: record.id,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType: 'account.created',
              targetType: 'organization',
              targetId: record.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                entity: 'organization',
                action: 'created',
                code: record.code,
                status: record.status,
              },
            },
            tx
          );

          return record;
        });

        return toSafeOrganizationView(created);
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

    async updateOrganization(
      orgId: string,
      input: { code?: string; name?: string; status?: OrganizationStatus },
      actor: OrgActorContext
    ): Promise<SafeOrganizationView> {
      if (
        input.code === undefined &&
        input.name === undefined &&
        input.status === undefined
      ) {
        throw ApiErrors.validation([
          {
            field: 'body',
            code: 'EMPTY_UPDATE',
            messageKey: 'error.validation.empty_update',
            message: 'Cần cung cấp ít nhất một trường để cập nhật.',
          },
        ]);
      }

      const normalizedCode =
        input.code !== undefined ? normalizeOrganizationCode(input.code) : undefined;
      if (normalizedCode !== undefined && !ORG_CODE_REGEX.test(normalizedCode)) {
        throw ApiErrors.validation([
          {
            field: 'body.code',
            code: 'INVALID_FORMAT',
            messageKey: 'error.org.invalid_code',
            message: 'Mã trường chỉ được gồm chữ cái, số, dấu gạch ngang hoặc gạch dưới (2-64 ký tự).',
          },
        ]);
      }

      const now = nowFn();

      try {
        const updated = await repo.withTransaction(async (tx) => {
          const existing = await repo.findOrganizationById(orgId, tx);
          if (!existing) {
            throw ApiErrors.notFound('Không tìm thấy tổ chức.');
          }

          if (input.status !== undefined && !isValidOrganizationStatus(input.status)) {
            throw ApiErrors.validation([
              {
                field: 'body.status',
                code: 'INVALID_ENUM',
                messageKey: 'error.org.invalid_status',
                message: 'Trạng thái tổ chức không hợp lệ.',
              },
            ]);
          }

          if (normalizedCode !== undefined && normalizedCode !== existing.code) {
            const conflict = await repo.findOrganizationByCode(normalizedCode, tx);
            if (conflict && conflict.id !== existing.id) {
              throw ApiErrors.conflict(
                'ORGANIZATION_CODE_EXISTS',
                'error.org.code_exists',
                'Mã trường học đã tồn tại trong hệ thống.'
              );
            }
          }

          const next = await repo.updateOrganization(
            {
              id: orgId,
              code: normalizedCode,
              name: input.name !== undefined ? input.name.trim() : undefined,
              status: input.status,
              now,
            },
            tx
          );

          if (!next) {
            throw ApiErrors.notFound('Không tìm thấy tổ chức.');
          }

          const statusChanged =
            input.status !== undefined && input.status !== existing.status;

          await safeAudit(
            {
              organizationId: next.id,
              actorUserId: actor.actorUserId,
              actorRole: 'platform_admin',
              eventType:
                statusChanged && next.status === 'suspended'
                  ? 'account.disabled'
                  : 'account.updated',
              targetType: 'organization',
              targetId: next.id,
              ipPrefix: actor.ipPrefix,
              metadata: {
                entity: 'organization',
                action: statusChanged ? `status_${next.status}` : 'updated',
                previousStatus: existing.status,
                status: next.status,
              },
            },
            tx
          );

          return next;
        });

        return toSafeOrganizationView(updated);
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
  };
}

export type OrgService = ReturnType<typeof createOrgService>;
