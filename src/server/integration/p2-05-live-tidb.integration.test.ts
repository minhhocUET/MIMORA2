import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTiDbEnv } from '../db/tidb.ts';
import { runP205LiveTiDbSuite } from './p2-05-live-tidb.integration.ts';

test('Controlled live TiDB integration suite (P2-05 Class Assignments, Published Pinning & Home Practice)', async (t) => {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    t.skip(`Skipping live TiDB integration test: ${envCheck.error.message}`);
    return;
  }

  const report = await runP205LiveTiDbSuite();
  assert.equal(report.ok, true);
  assert.equal(report.countsMatchedPreFlight, true);
  assert.equal(report.checks.length >= 6, true);
});
