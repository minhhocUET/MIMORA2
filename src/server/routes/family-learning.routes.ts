import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiErrors } from '../http/errors.ts';
import { asyncHandler } from '../http/middleware.ts';
import { validateWithSchema } from '../http/validation.ts';
import { createAuthMiddlewareSuite } from '../middleware/auth.ts';
import { createAuthenticatedCsrfMiddleware } from '../security/csrf.ts';
import { extractSafeIpPrefix } from '../security/session.ts';
import {
  adminEnrollStudentSchema,
  createFamilyLearningService,
  createFamilyProgramSchema,
  createProgramVersionSchema,
  type FamilyLearningService,
  guardianActivateFreeProgramSchema,
  updateDraftProgramVersionSchema,
} from '../services/family-learning.service.ts';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{1,64}$/;

const programIdParamsSchema = z.object({
  programId: z.string().trim().regex(UUID_REGEX),
});

const programVersionParamsSchema = z.object({
  programId: z.string().trim().regex(UUID_REGEX),
  versionId: z.string().trim().regex(UUID_REGEX),
});

const enrollmentIdParamsSchema = z.object({
  enrollmentId: z.string().trim().regex(UUID_REGEX),
});

const studentUserIdParamsSchema = z.object({
  studentUserId: z.string().trim().regex(UUID_REGEX),
});

const familyAttemptStartParamsSchema = z.object({
  enrollmentId: z.string().trim().regex(UUID_REGEX),
  itemId: z.string().trim().regex(UUID_REGEX),
});

const familyAttemptIdParamsSchema = z.object({
  attemptId: z.string().trim().regex(UUID_REGEX),
});

const workspaceLookupQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
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

const updatePreferencesBodySchema = z
  .object({
    preferredName: z.string().trim().max(120).nullable().optional(),
    supportPreferencesJson: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.preferredName !== undefined ||
      val.supportPreferencesJson !== undefined,
    {
      message: 'Cần cung cấp ít nhất một tùy chọn hỗ trợ để cập nhật.',
    }
  );

function extractValidatedIdempotencyKeyHeader(req: Request): string | undefined {
  const raw = req.get('idempotency-key');
  if (raw === undefined) return undefined;
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
          'Header Idempotency-Key phải gồm 1–64 ký tự ASCII an toàn.',
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

export interface FamilyLearningRoutersDeps {
  familyLearningService?: FamilyLearningService;
  authMiddlewares?: ReturnType<typeof createAuthMiddlewareSuite>;
  authenticatedCsrf?: ReturnType<typeof createAuthenticatedCsrfMiddleware>;
}

export function createFamilyLearningRouters(deps?: FamilyLearningRoutersDeps) {
  const service =
    deps?.familyLearningService ?? createFamilyLearningService();
  const authMiddlewares = deps?.authMiddlewares ?? createAuthMiddlewareSuite();
  const authenticatedCsrf =
    deps?.authenticatedCsrf ?? createAuthenticatedCsrfMiddleware();

  const requireAdmin = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('platform_admin'),
  ] as const;

  const requireVerifiedGuardian = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('guardian'),
    authMiddlewares.requireVerifiedGuardian,
  ] as const;

  // Deliberately NO requireOrgContext so Family-only and Dual-context Students both work!
  const requireStudent = [
    authMiddlewares.requireAuth,
    authMiddlewares.requireRole('student'),
  ] as const;

  // 1. Admin Family Programs Router -> mounted at /api/v1/admin
  const adminFamilyProgramsRouter = Router();

  adminFamilyProgramsRouter
    .route('/family-programs')
    .get(
      ...requireAdmin,
      asyncHandler(async (_req: Request, res: Response) => {
        const programs = await service.listFamilyProgramsForAdmin();
        res.status(200).json({ status: 'ok', programs });
      })
    )
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const body = validateWithSchema(
          createFamilyProgramSchema,
          req.body ?? {},
          'body'
        );
        const detail = await service.createFamilyProgramForAdmin(body, {
          actorUserId: req.auth!.userId,
          ipPrefix: extractSafeIpPrefix(req.ip),
        });
        res.status(201).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, POST'));

  adminFamilyProgramsRouter
    .route('/family-workspaces')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const query = validateWithSchema(
          workspaceLookupQuerySchema,
          req.query ?? {},
          'query'
        );
        const workspaces = await service.listEligibleFamilyWorkspacesForAdmin(
          query.search
        );
        res.status(200).json({ status: 'ok', workspaces });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  adminFamilyProgramsRouter
    .route('/family-programs/:programId')
    .get(
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          programIdParamsSchema,
          req.params,
          'params'
        );
        const detail = await service.getFamilyProgramDetailForAdmin(
          params.programId
        );
        res.status(200).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  adminFamilyProgramsRouter
    .route('/family-programs/:programId/versions')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          programIdParamsSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          createProgramVersionSchema,
          req.body ?? {},
          'body'
        );
        const detail = await service.createDraftProgramVersionForAdmin(
          params.programId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  adminFamilyProgramsRouter
    .route('/family-programs/:programId/versions/:versionId')
    .patch(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          programVersionParamsSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          updateDraftProgramVersionSchema,
          req.body ?? {},
          'body'
        );
        const detail = await service.updateDraftProgramVersionForAdmin(
          params.programId,
          params.versionId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'PATCH'));

  adminFamilyProgramsRouter
    .route('/family-programs/:programId/versions/:versionId/publish')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          programVersionParamsSchema,
          req.params,
          'params'
        );
        const detail = await service.publishProgramVersionForAdmin(
          params.programId,
          params.versionId,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  adminFamilyProgramsRouter
    .route('/family-programs/:programId/retire')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          programIdParamsSchema,
          req.params,
          'params'
        );
        const detail = await service.retireFamilyProgramForAdmin(
          params.programId,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  adminFamilyProgramsRouter
    .route('/family-programs/:programId/enrollments')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          programIdParamsSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          adminEnrollStudentSchema,
          req.body ?? {},
          'body'
        );
        const enrollment = await service.enrollStudentInFamilyProgramForAdmin(
          params.programId,
          body,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({ status: 'ok', enrollment });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  adminFamilyProgramsRouter
    .route('/family-enrollments/:enrollmentId/revoke')
    .post(
      ...requireAdmin,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          enrollmentIdParamsSchema,
          req.params,
          'params'
        );
        const enrollment = await service.revokeEnrollmentForAdmin(
          params.enrollmentId,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({ status: 'ok', enrollment });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  // 2. Guardian Learning & Progress Overview Router -> mounted at /api/v1/guardian
  const guardianLearningRouter = Router();

  guardianLearningRouter
    .route('/free-programs')
    .get(
      ...requireVerifiedGuardian,
      asyncHandler(async (_req: Request, res: Response) => {
        const programs = await service.listFreeFamilyProgramsForGuardian();
        res.status(200).json({ status: 'ok', programs });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  guardianLearningRouter
    .route('/students/:studentUserId/progress')
    .get(
      ...requireVerifiedGuardian,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          studentUserIdParamsSchema,
          req.params,
          'params'
        );
        const overview =
          await service.getLinkedStudentProgressOverviewForGuardian(
            params.studentUserId,
            {
              userId: req.auth!.userId,
              ipPrefix: extractSafeIpPrefix(req.ip),
            }
          );
        res.status(200).json({ status: 'ok', ...overview });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  guardianLearningRouter
    .route('/students/:studentUserId/programs/enroll')
    .post(
      ...requireVerifiedGuardian,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          studentUserIdParamsSchema,
          req.params,
          'params'
        );
        const body = validateWithSchema(
          guardianActivateFreeProgramSchema,
          req.body ?? {},
          'body'
        );
        const enrollment = await service.activateFreeProgramForGuardian(
          params.studentUserId,
          body,
          {
            userId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(201).json({ status: 'ok', enrollment });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'POST'));

  // 3. Student Teacher-Free Family Learning Router -> mounted at /api/v1/student
  const studentFamilyLearningRouter = Router();

  studentFamilyLearningRouter
    .route('/family-preferences')
    .get(
      ...requireStudent,
      asyncHandler(async (req: Request, res: Response) => {
        const preferences = await service.getStudentFamilyPreferences(
          req.auth!.userId
        );
        res.status(200).json({ status: 'ok', preferences });
      })
    )
    .patch(
      ...requireStudent,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const rawBody =
          req.body && typeof req.body === 'object'
            ? (req.body as Record<string, unknown>)
            : {};
        const body = validateWithSchema(
          updatePreferencesBodySchema,
          rawBody,
          'body'
        );
        const preferences = await service.updateStudentFamilyPreferences(
          {
            preferredName: body.preferredName,
            supportPreferencesJson: body.supportPreferencesJson,
            hasPreferredName: Object.prototype.hasOwnProperty.call(
              rawBody,
              'preferredName'
            ),
            hasSupportPreferencesJson: Object.prototype.hasOwnProperty.call(
              rawBody,
              'supportPreferencesJson'
            ),
          },
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({ status: 'ok', preferences });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET, PATCH'));

  studentFamilyLearningRouter
    .route('/family-programs')
    .get(
      ...requireStudent,
      asyncHandler(async (req: Request, res: Response) => {
        const programs = await service.listMyFamilyProgramsForStudent(
          req.auth!.userId
        );
        res.status(200).json({ status: 'ok', programs });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  studentFamilyLearningRouter
    .route('/family-programs/:enrollmentId')
    .get(
      ...requireStudent,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          enrollmentIdParamsSchema,
          req.params,
          'params'
        );
        const detail = await service.getMyFamilyProgramDetailForStudent(
          req.auth!.userId,
          params.enrollmentId
        );
        res.status(200).json({ status: 'ok', ...detail });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  studentFamilyLearningRouter
    .route('/family-programs/:enrollmentId/items/:itemId/start-or-resume')
    .post(
      ...requireStudent,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          familyAttemptStartParamsSchema,
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

        const result = await service.startOrResumeFamilyAttempt(
          {
            enrollmentId: params.enrollmentId,
            itemId: params.itemId,
            intent: body.intent,
            expectedContentVersionId: body.expectedContentVersionId,
            idempotencyKey,
            usedAacSupport: body.usedAacSupport,
            usedReadAloud: body.usedReadAloud,
          },
          {
            actorUserId: req.auth!.userId,
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

  studentFamilyLearningRouter
    .route('/family-attempts/:attemptId')
    .get(
      ...requireStudent,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          familyAttemptIdParamsSchema,
          req.params,
          'params'
        );
        const attempt = await service.getFamilyAttemptForStudent(
          params.attemptId,
          {
            actorUserId: req.auth!.userId,
            ipPrefix: extractSafeIpPrefix(req.ip),
          }
        );
        res.status(200).json({ status: 'ok', attempt });
      })
    )
    .all((_req, res) => respondMethodNotAllowed(res, 'GET'));

  studentFamilyLearningRouter
    .route('/family-attempts/:attemptId/turns')
    .post(
      ...requireStudent,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          familyAttemptIdParamsSchema,
          req.params,
          'params'
        );
        extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          saveTurnBodySchema,
          req.body ?? {},
          'body'
        );
        const result = await service.saveFamilyTurn(
          {
            attemptId: params.attemptId,
            turnIndex: body.turnIndex,
            stepKey: body.stepKey,
            selectedChoiceKey: body.selectedChoiceKey,
            selectedEmotionKey: body.selectedEmotionKey,
            usedAac: body.usedAac,
            usedReadAloud: body.usedReadAloud,
            aacTapDelta: body.aacTapDelta,
            readAloudDelta: body.readAloudDelta,
            durationSeconds: body.durationSeconds,
            responsePayloadJson: body.responsePayloadJson,
          },
          {
            actorUserId: req.auth!.userId,
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

  studentFamilyLearningRouter
    .route('/family-attempts/:attemptId/complete')
    .post(
      ...requireStudent,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          familyAttemptIdParamsSchema,
          req.params,
          'params'
        );
        extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          completeAttemptBodySchema,
          req.body ?? {},
          'body'
        );
        const result = await service.completeFamilyAttempt(
          {
            attemptId: params.attemptId,
            durationSeconds: body.durationSeconds,
            usedAacSupport: body.usedAacSupport,
            usedReadAloud: body.usedReadAloud,
            aacTapDelta: body.aacTapDelta,
            readAloudDelta: body.readAloudDelta,
            responseSummaryJson: body.responseSummaryJson,
          },
          {
            actorUserId: req.auth!.userId,
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

  studentFamilyLearningRouter
    .route('/family-attempts/:attemptId/abandon')
    .post(
      ...requireStudent,
      authenticatedCsrf,
      asyncHandler(async (req: Request, res: Response) => {
        const params = validateWithSchema(
          familyAttemptIdParamsSchema,
          req.params,
          'params'
        );
        extractValidatedIdempotencyKeyHeader(req);
        const body = validateWithSchema(
          abandonAttemptBodySchema,
          req.body ?? {},
          'body'
        );
        const result = await service.abandonFamilyAttempt(
          {
            attemptId: params.attemptId,
            confirmed: body.confirmed,
            durationSeconds: body.durationSeconds,
          },
          {
            actorUserId: req.auth!.userId,
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

  return {
    adminFamilyProgramsRouter,
    guardianLearningRouter,
    studentFamilyLearningRouter,
  };
}
