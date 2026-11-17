import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { ATTEMPT_STATUSES } from '../repositories/attempt.repository.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  type AttemptService,
  createAttemptService,
} from '../services/attempt.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;

const targetItemParamsSchema = z.object({
  targetId: z.string().trim().regex(UUID_REGEX),
  itemId: z.string().trim().regex(UUID_REGEX),
});

const attemptIdParamsSchema = z.object({
  attemptId: z.string().trim().regex(UUID_REGEX),
});

const teacherAssignmentIdParamsSchema = z.object({
  assignmentId: z.string().trim().regex(UUID_REGEX),
});

const teacherAttemptDetailParamsSchema = z.object({
  assignmentId: z.string().trim().regex(UUID_REGEX),
  attemptId: z.string().trim().regex(UUID_REGEX),
});

const startOrResumeBodySchema = z
  .object({
    intent: z.enum(['start_or_resume', 'retry']).optional(),
    expectedContentVersionId: z.string().trim().regex(UUID_REGEX).optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(IDEMPOTENCY_KEY_REGEX)
      .optional(),
    usedAacSupport: z.boolean().optional(),
    usedReadAloud: z.boolean().optional(),
  })
  .strict();

const saveTurnBodySchema = z
  .object({
    turnIndex: z.number().int().min(0).max(10_000),
    stepKey: z.string().trim().min(1).max(64),
    selectedChoiceKey: z.string().trim().max(128).nullable().optional(),
    selectedEmotionKey: z.string().trim().max(64).nullable().optional(),
    usedAac: z.boolean().optional(),
    usedReadAloud: z.boolean().optional(),
    aacTapDelta: z.number().int().min(0).max(100).optional(),
    readAloudDelta: z.number().int().min(0).max(100).optional(),
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
    responsePayloadJson: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  })
  .strict();

const completeAttemptBodySchema = z
  .object({
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
    usedAacSupport: z.boolean().optional(),
    usedReadAloud: z.boolean().optional(),
    aacTapDelta: z.number().int().min(0).max(100).optional(),
    readAloudDelta: z.number().int().min(0).max(100).optional(),
    responseSummaryJson: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  })
  .strict();

const abandonAttemptBodySchema = z
  .object({
    confirmed: z.boolean().optional(),
    reason: z
      .enum(['paused_for_later', 'switch_activity', 'student_requested'])
      .optional(),
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .strict();

const listTeacherAttemptsQuerySchema = z.object({
  studentMembershipId: z.string().trim().regex(UUID_REGEX).optional(),
  assignmentItemId: z.string().trim().regex(UUID_REGEX).optional(),
  status: z.enum(ATTEMPT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function extractValidatedIdempotencyKeyHeader(req: Request): string | undefined {
  const raw = req.get('idempotency-key');
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 64 ||
    !IDEMPOTENCY_KEY_REGEX.test(trimmed)
  ) {
    throw ApiErrors.validation([
      {
        field: 'headers.idempotency-key',
        code: 'INVALID_IDEMPOTENCY_KEY',
        messageKey: 'error.http.invalid_idempotency_key',
        message:
          'Header Idempotency-Key phải gồm 1–64 ký tự ASCII an toàn (chữ, số, ., _, :, -).',
      },
    ]);
  }
  return trimmed;
}

function resolveStartIdempotencyKey(
  headerKey: string | undefined,
  bodyKey: string | undefined
): string | undefined {
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw ApiErrors.validation([
      {
        field: 'body.idempotencyKey',
        code: 'IDEMPOTENCY_KEY_MISMATCH',
        messageKey: 'error.http.idempotency_key_mismatch',
        message: 'Header Idempotency-Key không khớp với body.idempotencyKey.',
      },
    ]);
  }
  return headerKey ?? bodyKey;
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

export interface AttemptsRoutersDeps {
  attemptService?: AttemptService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createAttemptsRouters(deps?: AttemptsRoutersDeps) {
  const attemptService = deps?.attemptService ?? createAttemptService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireStudentInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('student'),
  ] as const;

  const requireTeacherInOrg = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireOrgContext,
    authMiddlewares.requireRole('teacher'),
  ] as const;

  const studentAttemptsRouter = Router();

  studentAttemptsRouter
    .route('/assignments/:targetId/items/:itemId/start-or-resume')
    .post(
      ...requireStudentInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          targetItemParamsSchema,
          req.params,
          'params'
        );
        const headerIdempotencyKey = extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          startOrResumeBodySchema,
          req.body ?? {},
          'body'
        );
        const idempotencyKey = resolveStartIdempotencyKey(
          headerIdempotencyKey,
          body.idempotencyKey
        );

        const result = await attemptService.startOrResumeAttempt(
          {
            targetId: params.targetId,
            itemId: params.itemId,
            intent: body.intent,
            expectedContentVersionId: body.expectedContentVersionId,
            idempotencyKey,
            usedAacSupport: body.usedAacSupport,
            usedReadAloud: body.usedReadAloud,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );

        res.status(result.httpStatus).json({
          status: 'ok',
          action: result.action,
          attempt: result.attempt,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  studentAttemptsRouter
    .route('/attempts/:attemptId')
    .get(
      ...requireStudentInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          attemptIdParamsSchema,
          req.params,
          'params'
        );
        const attempt = await attemptService.getStudentAttempt(
          params.attemptId,
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          attempt,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  studentAttemptsRouter
    .route('/attempts/:attemptId/turns')
    .post(
      ...requireStudentInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          attemptIdParamsSchema,
          req.params,
          'params'
        );
        extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          saveTurnBodySchema,
          req.body ?? {},
          'body'
        );
        const result = await attemptService.saveTurn(
          {
            attemptId: params.attemptId,
            ...body,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(result.httpStatus).json({
          status: 'ok',
          idempotentReplay: result.idempotentReplay,
          savedTurn: result.savedTurn,
          attempt: result.attempt,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  studentAttemptsRouter
    .route('/attempts/:attemptId/complete')
    .post(
      ...requireStudentInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          attemptIdParamsSchema,
          req.params,
          'params'
        );
        extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          completeAttemptBodySchema,
          req.body ?? {},
          'body'
        );
        const result = await attemptService.completeAttempt(
          {
            attemptId: params.attemptId,
            ...body,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          idempotentReplay: result.idempotentReplay,
          attempt: result.attempt,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  studentAttemptsRouter
    .route('/attempts/:attemptId/abandon')
    .post(
      ...requireStudentInOrg,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          attemptIdParamsSchema,
          req.params,
          'params'
        );
        extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          abandonAttemptBodySchema,
          req.body ?? {},
          'body'
        );
        const result = await attemptService.abandonAttempt(
          {
            attemptId: params.attemptId,
            confirmed: body.confirmed,
            durationSeconds: body.durationSeconds,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            studentMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          idempotentReplay: result.idempotentReplay,
          attempt: result.attempt,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  const teacherAssignmentAttemptsRouter = Router();

  teacherAssignmentAttemptsRouter
    .route('/:assignmentId/attempts')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          teacherAssignmentIdParamsSchema,
          req.params,
          'params'
        );
        const query = validateWithSchema(
          listTeacherAttemptsQuerySchema,
          req.query,
          'query'
        );
        const result = await attemptService.listTeacherAssignmentAttempts(
          {
            assignmentId: params.assignmentId,
            studentMembershipId: query.studentMembershipId,
            assignmentItemId: query.assignmentItemId,
            status: query.status,
            page: query.page,
            limit: query.limit,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  teacherAssignmentAttemptsRouter
    .route('/:assignmentId/attempts/:attemptId')
    .get(
      ...requireTeacherInOrg,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          teacherAttemptDetailParamsSchema,
          req.params,
          'params'
        );
        const result = await attemptService.getTeacherAttemptDetail(
          {
            assignmentId: params.assignmentId,
            attemptId: params.attemptId,
          },
          {
            actorUserId: req.auth!.userId,
            organizationId: req.auth!.activeOrganizationId!,
            teacherMembershipId: req.auth!.organizationMembershipId!,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({
          status: 'ok',
          ...result,
        });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  return {
    studentAttemptsRouter,
    teacherAssignmentAttemptsRouter,
  };
}
