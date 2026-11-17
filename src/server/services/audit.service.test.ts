import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../http/errors.ts';
import * as auditService from './audit.service.ts';
import type { AuditInsertExecutor, AuditLogInsertRow } from './audit.service.ts';

function createMockAuditExecutor() {
  const insertedRows: AuditLogInsertRow[] = [];
  const executor = {
    insert() {
      return {
        values(row: AuditLogInsertRow) {
          insertedRows.push(row);
          return Promise.resolve();
        },
      };
    },
  } as unknown as AuditInsertExecutor;
  return { insertedRows, executor };
}

test('audit service exports append-only API without update or delete operations', () => {
  const exportedNames = Object.keys(auditService).map((k) => k.toLowerCase());
  for (const name of exportedNames) {
    assert.equal(name.includes('update'), false);
    assert.equal(name.includes('delete'), false);
    assert.equal(name.includes('remove'), false);
  }
});

test('recordAuditEvent accepts allowlisted org-scoped and platform-scoped events via mock executor', async () => {
  const { insertedRows, executor } = createMockAuditExecutor();
  const orgId = '01950000-0000-7000-8000-000000000010';
  const userId = '01950000-0000-7000-8000-000000000020';
  const targetId = '01950000-0000-7000-8000-000000000030';

  const row1 = await auditService.recordAuditEvent(
    {
      organizationId: null,
      actorUserId: userId,
      actorRole: 'platform_admin',
      eventType: 'content.self_approved',
      targetType: 'content_version',
      targetId,
      ipPrefix: '203.0.113.0/24',
      metadata: {
        submissionRound: 1,
        activeAdminCountAtDecision: 1,
      },
    },
    executor
  );

  const row2 = await auditService.recordAuditEvent(
    {
      organizationId: orgId,
      actorUserId: userId,
      actorRole: 'teacher',
      eventType: 'assignment.created',
      targetType: 'assignment',
      targetId,
      metadata: {
        itemCount: 3,
      },
    },
    executor
  );

  assert.equal(insertedRows.length, 2);
  assert.equal(row1.organizationId, null);
  assert.equal(row1.eventType, 'content.self_approved');
  assert.equal(row2.organizationId, orgId);
  assert.match(row1.id, /^[0-9a-f-]{36}$/);
});

test('recordAuditEvent rejects non-allowlisted event types', async () => {
  const { insertedRows, executor } = createMockAuditExecutor();

  await assert.rejects(
    () =>
      auditService.recordAuditEvent(
        {
          eventType: 'auth.invented_event' as never,
          metadata: { safe: true },
        },
        executor
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, 'AUDIT_DISALLOWED_EVENT_TYPE');
      return true;
    }
  );
  assert.equal(insertedRows.length, 0);
});

test('recordAuditEvent recursively rejects sensitive metadata keys in nested objects and arrays', async () => {
  const { insertedRows, executor } = createMockAuditExecutor();

  const unsafeMetadataCases: Array<{
    targetType?: string;
    metadata: Record<string, unknown>;
  }> = [
    { metadata: { password: 'secret' } },
    { metadata: { nested: { password_hash: 'scrypt$v1$...' } } },
    { metadata: { session: { info: { tokenHash: 'abc' } } } },
    { metadata: { headers: [{ cookie: 'sid=123' }] } },
    { metadata: { turns: [{ selected_choice_key: 'calm_breath' }] } },
    { metadata: { detail: { selectedEmotionKey: 'happy' } } },
    { metadata: { payload: { response_payload_json: { step: 1 } } } },
    { metadata: { payload: { responseSummaryJson: { count: 2 } } } },
    { metadata: { observation: { note_body: 'Private teacher note' } } },
    { metadata: { studentGoal: { goalTitle: 'Identify feelings' } } },
    { targetType: 'student_goal', metadata: { title: 'Goal text', description: 'More text' } },
    { metadata: { profile: { support_preferences_json: { aac: true } } } },
  ];

  for (const testCase of unsafeMetadataCases) {
    await assert.rejects(
      () =>
        auditService.recordAuditEvent(
          {
            eventType: 'security.unauthorized_access_denied',
            targetType: testCase.targetType ?? 'security',
            metadata: testCase.metadata,
          },
          executor
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'AUDIT_UNSAFE_METADATA');
        return true;
      }
    );
  }

  assert.equal(insertedRows.length, 0);
});
