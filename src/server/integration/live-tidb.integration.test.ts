import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTiDbEnv } from '../db/tidb.ts';
import { runLiveTiDbIntegrationSuite } from './live-tidb.integration.ts';

test('Controlled live TiDB integration suite (P2-02 Auth Repo + P2-03 Orgs/Users/Classes/CSV Repos)', async (t) => {
  const envCheck = validateTiDbEnv();
  if (!envCheck.ok) {
    t.skip(`Skipping live TiDB integration test: ${envCheck.error.message}`);
    return;
  }

  const report = await runLiveTiDbIntegrationSuite();
  assert.equal(report.ok, true);
  assert.equal(report.countsMatchedPreFlight, true);
  assert.equal(report.checks.length >= 6, true);
});
