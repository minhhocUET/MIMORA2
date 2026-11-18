import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  CANONICAL_CONTENT_TYPES,
  INSIGHT_PERIOD_TYPES,
} from '../db/schema/_shared.ts';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import {
  createInsightService,
  type InsightContentScope,
  type InsightService,
} from '../services/insight.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORBIDDEN_ANTI_DIFFERENCING_PARAM_KEYS = new Set([
  'studentid',
  'studentmembershipid',
  'teacherid',
  'teachermembershipid',
  'classid',
  'assignmentid',
  'goalid',
  'startdate',
  'enddate',
  'from',
  'fromdate',
  'to',
  'todate',
  'windowdays',
  'range',
  'userid',
]);

const INSIGHT_CONTENT_TYPE_VALUES: [InsightContentScope, ...InsightContentScope[]] =
  ['all', ...CANONICAL_CONTENT_TYPES];

const getAdminInsightsQuerySchema = z
  .object({
    organizationId: z.string().trim().regex(UUID_REGEX).optional(),
    periodType: z.enum(INSIGHT_PERIOD_TYPES).default('daily'),
    snapshotDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    contentType: z.enum(INSIGHT_CONTENT_TYPE_VALUES).default('all'),
  })
  .strict();

function assertNoForbiddenInsightFilters(rawQuery: Request['query']): void {
  const details = [];
  for (const key of Object.keys(rawQuery ?? {})) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_ANTI_DIFFERENCING_PARAM_KEYS.has(normalized)) {
      details.push({
        field: `query.${key}`,
        code: 'INSIGHT_FILTER_FORBIDDEN',
        messageKey: 'error.insights.forbidden_filter',
        message:
          'Bộ lọc tùy ý theo học sinh, lớp, giáo viên hoặc khoảng ngày trượt không được phép để bảo vệ quyền riêng tư.',
      });
    }
  }
  if (details.length > 0) {
    throw ApiErrors.validation(details);
  }
}

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

export interface AdminInsightsRouterDeps {
  insightService?: InsightService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
}

export function createAdminInsightsRouter(deps?: AdminInsightsRouterDeps) {
  const insightService = deps?.insightService ?? createInsightService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();

  const router = Router();

  router
    .route('/')
    .get(
      authMiddlewares.requireAuth,
      authMiddlewares.requireRole('platform_admin'),
      asyncHandler(async (req: Request, res: Response) => {
        assertNoForbiddenInsightFilters(req.query);
        const query = validateWithSchema(
          getAdminInsightsQuerySchema,
          req.query,
          'query'
        );
        const insights = await insightService.getAdminInsights({
          organizationId: query.organizationId,
          periodType: query.periodType,
          snapshotDate: query.snapshotDate,
          contentType: query.contentType,
        });
        res.status(200).json({
          status: 'ok',
          insights,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return router;
}
