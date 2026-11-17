import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { z } from 'zod';
import {
  AppError,
  normalizeToAppError,
  toApiErrorEnvelope,
  translateDatabaseError,
} from './errors.ts';
import {
  apiErrorHandler,
  apiNotFoundHandler,
  attachRequestId,
  baselineSecurityHeaders,
} from './middleware.ts';
import { validateRequest, validateWithSchema } from './validation.ts';

test('validateWithSchema returns parsed data and throws structured 422 Vietnamese error on failure', () => {
  const schema = z.object({
    orgCode: z.string().trim().min(2),
    count: z.number().int().positive(),
  });

  const ok = validateWithSchema(schema, { orgCode: ' THCS01 ', count: 3 }, 'body');
  assert.deepEqual(ok, { orgCode: 'THCS01', count: 3 });

  assert.throws(
    () => validateWithSchema(schema, { orgCode: 'A', count: 'bad-secret-value' }, 'body'),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.httpStatus, 422);
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.messageKey, 'error.validation.failed');
      assert.equal(err.locale, 'vi-VN');
      assert.ok(Array.isArray(err.details) && err.details.length === 2);
      const serialized = JSON.stringify(toApiErrorEnvelope(err, 'req-1'));
      assert.equal(serialized.includes('bad-secret-value'), false);
      return true;
    }
  );
});

test('validateRequest validates params, query, and body together', () => {
  const parsed = validateRequest(
    {
      params: { id: '01950000-0000-7000-8000-000000000001' },
      query: { page: '2' },
      body: { title: 'Chào buổi sáng' },
    },
    {
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ page: z.coerce.number().int().min(1) }),
      body: z.object({ title: z.string().min(1) }),
    }
  );

  assert.equal(parsed.query.page, 2);
  assert.equal(parsed.body.title, 'Chào buổi sáng');
});

test('translateDatabaseError maps duplicate and FK errors to 409 without leaking SQL or credentials', () => {
  const duplicateErr = {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlState: '23000',
    sql: "INSERT INTO users (password_hash) VALUES ('secret-bind')",
    sqlMessage: "Duplicate entry 'sensitive@example.com' for key 'uq_users_email'",
  };
  const dupAppErr = translateDatabaseError(duplicateErr);
  assert.equal(dupAppErr.httpStatus, 409);
  assert.equal(dupAppErr.code, 'CONFLICT_DUPLICATE');
  assert.equal(dupAppErr.messageKey, 'error.db.duplicate_entry');
  assert.equal(dupAppErr.locale, 'vi-VN');
  const dupJson = JSON.stringify(toApiErrorEnvelope(dupAppErr));
  assert.equal(dupJson.includes('secret-bind'), false);
  assert.equal(dupJson.includes('sensitive@example.com'), false);

  const fkWrappedErr = new Error('DrizzleQueryError wrapper', {
    cause: {
      code: 'ER_NO_REFERENCED_ROW_2',
      errno: 1452,
      sqlState: '23000',
      sql: 'INSERT INTO class_enrollments ...',
    },
  });
  const fkAppErr = translateDatabaseError(fkWrappedErr);
  assert.equal(fkAppErr.httpStatus, 409);
  assert.equal(fkAppErr.code, 'CONFLICT_FOREIGN_KEY');

  const refInUseErr = { code: 'ER_ROW_IS_REFERENCED_2', errno: 1451, sqlState: '23000' };
  assert.equal(translateDatabaseError(refInUseErr).code, 'CONFLICT_FOREIGN_KEY_IN_USE');

  const unknownDbErr = {
    code: 'ER_UNKNOWN_ERROR',
    errno: 1105,
    sqlState: 'HY000',
    sql: 'SELECT * FROM users WHERE password_hash = "leak"',
  };
  const unknownAppErr = translateDatabaseError(unknownDbErr);
  assert.equal(unknownAppErr.httpStatus, 500);
  assert.equal(unknownAppErr.code, 'INTERNAL_DATABASE_ERROR');
  assert.equal(JSON.stringify(toApiErrorEnvelope(unknownAppErr)).includes('leak'), false);
});

test('normalizeToAppError hides raw unexpected errors and stack traces', () => {
  const raw = new Error('Secret connection string mysql://user:pass@host/db');
  const normalized = normalizeToAppError(raw);
  assert.equal(normalized.httpStatus, 500);
  assert.equal(normalized.code, 'INTERNAL_ERROR');
  const envelope = toApiErrorEnvelope(normalized, 'req-500');
  assert.equal(JSON.stringify(envelope).includes('mysql://'), false);
  assert.equal(envelope.requestId, 'req-500');
});

test('Express middleware enforces 1mb JSON limit, 400 malformed JSON, 404 API envelope, and safe headers', async () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(attachRequestId);
  app.use(baselineSecurityHeaders);
  app.use('/api', express.json({ limit: '1mb' }));

  app.post('/api/v1/echo-validate', (req, res) => {
    const body = validateWithSchema(z.object({ name: z.string().min(2) }), req.body, 'body');
    res.status(200).json({ status: 'ok', body });
  });
  app.use('/api', apiNotFoundHandler);
  app.use('/api', apiErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // 1. Malformed JSON -> 400 JSON + baseline security headers
    const badJsonRes = await fetch(`${baseUrl}/api/v1/echo-validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": ',
    });
    assert.equal(badJsonRes.status, 400);
    assert.equal(badJsonRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(badJsonRes.headers.get('cache-control'), 'no-store');
    assert.equal(badJsonRes.headers.get('x-frame-options'), null);
    assert.ok(badJsonRes.headers.get('x-request-id'));
    const badJsonBody = (await badJsonRes.json()) as { code: string; locale: string };
    assert.equal(badJsonBody.code, 'MALFORMED_JSON');
    assert.equal(badJsonBody.locale, 'vi-VN');

    // 2. Oversized JSON (> 1 MB) -> 413 JSON
    const largePayload = JSON.stringify({ name: 'a'.repeat(1024 * 1024 + 512) });
    const tooLargeRes = await fetch(`${baseUrl}/api/v1/echo-validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largePayload,
    });
    assert.equal(tooLargeRes.status, 413);
    const tooLargeBody = (await tooLargeRes.json()) as { code: string };
    assert.equal(tooLargeBody.code, 'PAYLOAD_TOO_LARGE');

    // 3. Validation error -> 422 JSON
    const invalidRes = await fetch(`${baseUrl}/api/v1/echo-validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    assert.equal(invalidRes.status, 422);
    const invalidBody = (await invalidRes.json()) as { code: string; details?: unknown[] };
    assert.equal(invalidBody.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(invalidBody.details) && invalidBody.details.length === 1);

    // 4. API 404 -> JSON envelope
    const notFoundRes = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    assert.equal(notFoundRes.status, 404);
    const notFoundBody = (await notFoundRes.json()) as { code: string; messageKey: string };
    assert.equal(notFoundBody.code, 'NOT_FOUND');
    assert.equal(notFoundBody.messageKey, 'error.http.not_found');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
