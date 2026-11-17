import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { organizations } from '../db/schema/identity.ts';
import {
  getDb,
  withTransaction,
  type MimoraDatabase,
  type MimoraTransaction,
} from '../db/tidb.ts';

export type OrgDbOrTx = MimoraDatabase | MimoraTransaction;

export const ORGANIZATION_STATUSES = ['active', 'suspended'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export interface OrganizationRecord {
  id: string;
  code: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListOrganizationsParams {
  page: number;
  limit: number;
  status?: OrganizationStatus;
  search?: string;
}

export interface CreateOrganizationParams {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  now: Date;
}

export interface UpdateOrganizationParams {
  id: string;
  code?: string;
  name?: string;
  status?: OrganizationStatus;
  now: Date;
}

export interface OrgRepository {
  withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T>;
  listOrganizations(
    params: ListOrganizationsParams
  ): Promise<{ items: OrganizationRecord[]; total: number }>;
  findOrganizationById(id: string, executor?: OrgDbOrTx): Promise<OrganizationRecord | null>;
  findOrganizationByCode(code: string, executor?: OrgDbOrTx): Promise<OrganizationRecord | null>;
  createOrganization(
    params: CreateOrganizationParams,
    executor?: OrgDbOrTx
  ): Promise<OrganizationRecord>;
  updateOrganization(
    params: UpdateOrganizationParams,
    executor?: OrgDbOrTx
  ): Promise<OrganizationRecord | null>;
}

function getExecutor(executor?: OrgDbOrTx): OrgDbOrTx {
  return executor ?? getDb();
}

export function escapeSqlLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function createOrgRepository(): OrgRepository {
  return {
    withTransaction<T>(fn: (tx: MimoraTransaction) => Promise<T>): Promise<T> {
      return withTransaction(fn);
    },

    async listOrganizations(
      params: ListOrganizationsParams
    ): Promise<{ items: OrganizationRecord[]; total: number }> {
      const db = getDb();
      const filters = [];
      if (params.status) {
        filters.push(eq(organizations.status, params.status));
      }
      if (params.search && params.search.trim().length > 0) {
        const pattern = `%${escapeSqlLikePattern(params.search.trim())}%`;
        filters.push(
          or(like(organizations.code, pattern), like(organizations.name, pattern))!
        );
      }

      const whereClause = filters.length > 0 ? and(...filters) : undefined;
      const offset = (params.page - 1) * params.limit;

      const [countRows, items] = await Promise.all([
        db
          .select({ total: count() })
          .from(organizations)
          .where(whereClause),
        db
          .select({
            id: organizations.id,
            code: organizations.code,
            name: organizations.name,
            status: organizations.status,
            createdAt: organizations.createdAt,
            updatedAt: organizations.updatedAt,
          })
          .from(organizations)
          .where(whereClause)
          .orderBy(desc(organizations.createdAt))
          .limit(params.limit)
          .offset(offset),
      ]);

      return {
        items,
        total: Number(countRows[0]?.total ?? 0),
      };
    },

    async findOrganizationById(
      id: string,
      executor?: OrgDbOrTx
    ): Promise<OrganizationRecord | null> {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: organizations.id,
          code: organizations.code,
          name: organizations.name,
          status: organizations.status,
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
        })
        .from(organizations)
        .where(eq(organizations.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findOrganizationByCode(
      code: string,
      executor?: OrgDbOrTx
    ): Promise<OrganizationRecord | null> {
      const db = getExecutor(executor);
      const rows = await db
        .select({
          id: organizations.id,
          code: organizations.code,
          name: organizations.name,
          status: organizations.status,
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
        })
        .from(organizations)
        .where(eq(organizations.code, code))
        .limit(1);
      return rows[0] ?? null;
    },

    async createOrganization(
      params: CreateOrganizationParams,
      executor?: OrgDbOrTx
    ): Promise<OrganizationRecord> {
      const db = getExecutor(executor);
      await db.insert(organizations).values({
        id: params.id,
        code: params.code,
        name: params.name,
        status: params.status,
        createdAt: params.now,
        updatedAt: params.now,
      });

      return {
        id: params.id,
        code: params.code,
        name: params.name,
        status: params.status,
        createdAt: params.now,
        updatedAt: params.now,
      };
    },

    async updateOrganization(
      params: UpdateOrganizationParams,
      executor?: OrgDbOrTx
    ): Promise<OrganizationRecord | null> {
      const db = getExecutor(executor);
      const existing = await this.findOrganizationById(params.id, db);
      if (!existing) {
        return null;
      }

      const nextCode = params.code ?? existing.code;
      const nextName = params.name ?? existing.name;
      const nextStatus = params.status ?? existing.status;

      await db
        .update(organizations)
        .set({
          code: nextCode,
          name: nextName,
          status: nextStatus,
          updatedAt: params.now,
        })
        .where(eq(organizations.id, params.id));

      return {
        ...existing,
        code: nextCode,
        name: nextName,
        status: nextStatus,
        updatedAt: params.now,
      };
    },
  };
}
