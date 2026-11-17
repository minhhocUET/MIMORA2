import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTiDbEnv } from '../db/tidb.ts';
import { runP204LiveTiDbSuite } from './p2-04-live-tidb.integration.ts';

test('Controlled live TiDB integration suite (P2-04 Shared SEL Content Library, Versioning & Multi-Round Approval)', async (t) => {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    t.skip(`Skipping live TiDB integration test: ${envCheck.error.message}`);
    return;
  }

  const report = await runP204LiveTiDbSuite();
  assert.equal(report.ok, true);
  assert.equal(report.countsMatchedPreFlight, true);
  assert.equal(report.checks.length >= 6, true);
});
