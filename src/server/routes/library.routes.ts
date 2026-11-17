import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CANONICAL_CONTENT_TYPES } from '../db/schema/_shared.ts';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import {
  createContentService,
  type ContentService,
} from '../services/content.service.ts';
import { SUPPORTED_CONTENT_LOCALES } from '../validators/content-payload.schema.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const itemIdParamSchema = z.object({
  itemId: z.string().trim().regex(UUID_REGEX),
});

const listLibraryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  contentType: z.enum(CANONICAL_CONTENT_TYPES).optional(),
  locale: z.enum(SUPPORTED_CONTENT_LOCALES).optional(),
  search: z.string().trim().min(1).max(128).optional(),
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

export interface LibraryRouterDeps {
  contentService?: ContentService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
}

export function createLibraryRouter(deps?: LibraryRouterDeps): Router {
  const router = Router();
  const contentService = deps?.contentService ?? createContentService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();

  const requireTeacher = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('teacher'),
  ] as const;

  router
    .route('/content')
    .get(
      ...requireTeacher,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(listLibraryQuerySchema, req.query, 'query');
        const result = await contentService.listPublishedLibrary(query);
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  router
    .route('/content/:itemId')
    .get(
      ...requireTeacher,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(itemIdParamSchema, req.params, 'params');
        const item = await contentService.getPublishedLibraryItem(params.itemId);
        res.status(200).json({
          status: 'ok',
          item,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return router;
}
