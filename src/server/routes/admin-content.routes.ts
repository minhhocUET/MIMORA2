import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CANONICAL_CONTENT_TYPES } from '../db/schema/_shared.ts';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  createContentService,
  type ContentService,
} from '../services/content.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const itemIdParamSchema = z.object({
  itemId: z.string().trim().regex(UUID_REGEX),
});

const versionIdParamSchema = z.object({
  versionId: z.string().trim().regex(UUID_REGEX),
});

const listContentItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  contentType: z.enum(CANONICAL_CONTENT_TYPES).optional(),
  isArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).max(128).optional(),
});

const createContentItemBodySchema = z.object({
  slug: z.string().trim().min(2).max(128),
  contentType: z.enum(CANONICAL_CONTENT_TYPES),
  title: z.string().trim().min(1).max(255),
  summary: z.string().trim().max(2000).nullable().optional(),
  locale: z.string().trim().min(2).max(16).default('vi'),
  payloadJson: z.record(z.string(), z.unknown()),
  metadataJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateContentItemBodySchema = z.object({
  slug: z.string().trim().min(2).max(128).optional(),
  isArchived: z.boolean().optional(),
});

const createDraftVersionBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  summary: z.string().trim().max(2000).nullable().optional(),
  locale: z.string().trim().min(2).max(16).default('vi'),
  payloadJson: z.record(z.string(), z.unknown()),
  metadataJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateDraftVersionBodySchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  payloadJson: z.record(z.string(), z.unknown()).optional(),
  metadataJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

const approvalDecisionBodySchema = z
  .object({
    decisionNote: z.string().trim().max(2000).nullable().optional(),
  })
  .optional()
  .default({});

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

export interface AdminContentRouterDeps {
  contentService?: ContentService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createAdminContentRouter(
  deps?: AdminContentRouterDeps
): Router {
  const router = Router();
  const contentService = deps?.contentService ?? createContentService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireAdmin = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
  ] as const;

  router
    .route('/content-items')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          listContentItemsQuerySchema,
          req.query,
          'query'
        );
        const result = await contentService.listContentItems(query);
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
        const body = validateWithSchema(
          createContentItemBodySchema,
          req.body,
          'body'
        );
        const created = await contentService.createContentItem(body, {
          actorUserId: req.auth!.userId,
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
    .route('/content-items/:itemId')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(itemIdParamSchema, req.params, 'params');
        const detail = await contentService.getContentItemDetail(params.itemId);
        res.status(200).json({
          status: 'ok',
          ...detail,
        });
      })
    )
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(itemIdParamSchema, req.params, 'params');
        const body = validateWithSchema(
          updateContentItemBodySchema,
          req.body,
          'body'
        );
        const item = await contentService.updateContentItemMetadata(
          params.itemId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          item,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  router
    .route('/content-items/:itemId/archive')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(itemIdParamSchema, req.params, 'params');
        const item = await contentService.archiveContentItem(params.itemId, {
          actorUserId: req.auth!.userId,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          item,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  router
    .route('/content-items/:itemId/versions')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(itemIdParamSchema, req.params, 'params');
        const result = await contentService.listItemVersions(params.itemId);
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
        const params = validateWithSchema(itemIdParamSchema, req.params, 'params');
        const body = validateWithSchema(
          createDraftVersionBodySchema,
          req.body,
          'body'
        );
        const version = await contentService.createDraftVersion(
          params.itemId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({
          status: 'ok',
          version,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  router
    .route('/content-versions/:versionId')
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          versionIdParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          updateDraftVersionBodySchema,
          req.body,
          'body'
        );
        const version = await contentService.updateDraftVersion(
          params.versionId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          version,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'PATCH'));

  router
    .route('/content-versions/:versionId/submit')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          versionIdParamSchema,
          req.params,
          'params'
        );
        const result = await contentService.submitVersionForReview(
          params.versionId,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  router
    .route('/content-versions/:versionId/approve')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          versionIdParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          approvalDecisionBodySchema,
          req.body,
          'body'
        );
        const result = await contentService.approveVersion(
          params.versionId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  router
    .route('/content-versions/:versionId/reject')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          versionIdParamSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          approvalDecisionBodySchema,
          req.body,
          'body'
        );
        const result = await contentService.rejectVersion(
          params.versionId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  router
    .route('/content-versions/:versionId/publish')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          versionIdParamSchema,
          req.params,
          'params'
        );
        const result = await contentService.publishVersion(params.versionId, {
          actorUserId: req.auth!.userId,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  return router;
}
