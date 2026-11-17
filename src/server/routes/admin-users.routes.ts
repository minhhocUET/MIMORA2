import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ORG_ROLES } from '../db/schema/_shared.ts';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import {
  MEMBERSHIP_STATUSES,
  USER_STATUSES,
} from '../repositories/membership.repository.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  createCsvImportService,
  type CsvImportService,
} from '../services/csv-import.service.ts';
import {
  createMembershipService,
  type MembershipService,
} from '../services/membership.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const userIdParamSchema = z.object({
  userId: z.string().trim().regex(UUID_REGEX),
});

const orgIdParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
});

const membershipParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
  membershipId: z.string().trim().regex(UUID_REGEX),
});

const csvJobParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
  jobId: z.string().trim().regex(UUID_REGEX),
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(USER_STATUSES).optional(),
  platformRole: z.literal('platform_admin').optional(),
  search: z.string().trim().min(1).max(128).optional(),
});

const provisionUserBodySchema = z.object({
  role: z.enum(ORG_ROLES),
  organizationId: z.string().trim().regex(UUID_REGEX),
  displayName: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
  email: z.string().trim().email().max(255).nullable().optional(),
  platformUsername: z.string().trim().min(2).max(64).nullable().optional(),
  orgUsername: z.string().trim().min(2).max(64).nullable().optional(),
  classId: z.string().trim().regex(UUID_REGEX).optional(),
});

const updateUserBodySchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
});

const listMembershipsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  search: z.string().trim().min(1).max(128).optional(),
});

const createMembershipBodySchema = z.object({
  userId: z.string().trim().regex(UUID_REGEX),
  role: z.enum(ORG_ROLES),
  orgUsername: z.string().trim().min(2).max(64).nullable().optional(),
});

const updateMembershipBodySchema = z.object({
  orgUsername: z.string().trim().min(2).max(64).nullable().optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
});

const listCsvJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const csvImportBodySchema = z.object({
  sourceFilename: z.string().trim().min(1).max(255),
  csvContent: z.string().min(1),
  targetClassId: z.string().trim().regex(UUID_REGEX).nullable().optional(),
  mode: z.enum(['preview', 'commit']).default('preview'),
});

function respondMethodNotAllowed(res: Response, allowed: string): void {
  const err = ApiErrors.methodNotAllowed();
  res.set('Allow', allowed).status(405).json({
    status: 'error',
    code: err.code,
    messageKey: err.messageKey,
    message: err.message,
    locale: 'vi-VN',
  });
}

export interface AdminUsersRouterDeps {
  membershipService?: MembershipService;
  csvImportService?: CsvImportService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createAdminUsersRouter(deps?: AdminUsersRouterDeps): Router {
  const router = Router();
  const membershipService = deps?.membershipService ?? createMembershipService();
  const csvImportService = deps?.csvImportService ?? createCsvImportService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireAdmin = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
  ] as const;

  router
    .route('/users')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(listUsersQuerySchema, req.query, 'query');
        const result = await membershipService.listUsers(query);
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(provisionUserBodySchema, req.body, 'body');
        const created = await membershipService.provisionAccount(body, {
          actorUserId: req.auth!.userId,
          actorRole: 'platform_admin',
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({
          status: 'ok',
          ...created,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  router
    .route('/users/:userId')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(userIdParamSchema, req.params, 'params');
        const result = await membershipService.getUserById(params.userId);
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(userIdParamSchema, req.params, 'params');
        const body = validateWithSchema(updateUserBodySchema, req.body, 'body');
        const user = await membershipService.updateUser(params.userId, body, {
          actorUserId: req.auth!.userId,
          actorRole: 'platform_admin',
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          user,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  router
    .route('/organizations/:orgId/memberships')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgIdParamSchema, req.params, 'params');
        const query = validateWithSchema(listMembershipsQuerySchema, req.query, 'query');
        const result = await membershipService.listOrganizationMemberships({
          organizationId: params.orgId,
          ...query,
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgIdParamSchema, req.params, 'params');
        const body = validateWithSchema(createMembershipBodySchema, req.body, 'body');
        const membership = await membershipService.createOrganizationMembership(
          {
            organizationId: params.orgId,
            ...body,
          },
          {
            actorUserId: req.auth!.userId,
            actorRole: 'platform_admin',
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({
          status: 'ok',
          membership,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  router
    .route('/organizations/:orgId/memberships/:membershipId')
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(membershipParamSchema, req.params, 'params');
        const body = validateWithSchema(updateMembershipBodySchema, req.body, 'body');
        const membership = await membershipService.updateOrganizationMembership(
          params.orgId,
          params.membershipId,
          body,
          {
            actorUserId: req.auth!.userId,
            actorRole: 'platform_admin',
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          membership,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'PATCH'));

  router
    .route('/organizations/:orgId/csv-imports')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgIdParamSchema, req.params, 'params');
        const query = validateWithSchema(listCsvJobsQuerySchema, req.query, 'query');
        const result = await csvImportService.listImportJobs({
          organizationId: params.orgId,
          ...query,
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgIdParamSchema, req.params, 'params');
        const body = validateWithSchema(csvImportBodySchema, req.body, 'body');
        const result = await csvImportService.processStudentCsvImport(
          {
            organizationId: params.orgId,
            ...body,
          },
          {
            actorUserId: req.auth!.userId,
            actorRole: 'platform_admin',
            teacherMembershipId: null,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  router
    .route('/organizations/:orgId/csv-imports/:jobId')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(csvJobParamSchema, req.params, 'params');
        const job = await csvImportService.getImportJob(params.orgId, params.jobId, {
          actorUserId: req.auth!.userId,
          actorRole: 'platform_admin',
          teacherMembershipId: null,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          job,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return router;
}
