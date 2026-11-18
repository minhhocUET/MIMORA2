import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTiDbEnv } from '../db/tidb.ts';
import { runP207LiveTiDbSuite } from './p2-07-live-tidb.integration.ts';

const hasTiDbEnv = validateTiDbEnv().ok;

test(
  'P2-07 Live TiDB Integration (Observations, Profiles/Goals, Insights k=5, 22-Table Parity, Cleanup)',
  { skip: !hasTiDbEnv },
  async () => {
    const report = await runP207LiveTiDbSuite();
    assert.equal(report.ok, true);
    assert.equal(report.countsMatchedPreFlight, true);
    assert.equal(report.schemaParitySummary.all22TablesVerified, true);
    assert.equal(report.schemaParitySummary.allColumnsMatched, true);
    assert.equal(report.schemaParitySummary.allConstraintsMatched, true);
    assert.equal(
      Object.values(report.residualSyntheticRows).every((v) => v === 0),
      true
    );
  }
);
