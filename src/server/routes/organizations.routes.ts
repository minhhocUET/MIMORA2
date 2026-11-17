import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { ORGANIZATION_STATUSES } from '../repositories/org.repository.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import { createOrgService, type OrgService } from '../services/org.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const orgIdParamSchema = z.object({
  orgId: z.string().trim().regex(UUID_REGEX),
});

const listOrgsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  search: z.string().trim().min(1).max(128).optional(),
});

const createOrgBodySchema = z.object({
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(1).max(255),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
});

const updateOrgBodySchema = z.object({
  code: z.string().trim().min(2).max(64).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
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

export interface OrganizationsRouterDeps {
  orgService?: OrgService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createAdminOrganizationsRouter(
  deps?: OrganizationsRouterDeps
): Router {
  const router = Router();
  const orgService = deps?.orgService ?? createOrgService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireAdmin = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
  ] as const;

  router
    .route('/')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(listOrgsQuerySchema, req.query, 'query');
        const result = await orgService.listOrganizations(query);
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
        const body = validateWithSchema(createOrgBodySchema, req.body, 'body');
        const organization = await orgService.createOrganization(body, {
          actorUserId: req.auth!.userId,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({
          status: 'ok',
          organization,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  router
    .route('/:orgId')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgIdParamSchema, req.params, 'params');
        const organization = await orgService.getOrganizationById(params.orgId);
        res.status(200).json({
          status: 'ok',
          organization,
        });
      })
    )
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(orgIdParamSchema, req.params, 'params');
        const body = validateWithSchema(updateOrgBodySchema, req.body, 'body');
        const organization = await orgService.updateOrganization(
          params.orgId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          organization,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  return router;
}
