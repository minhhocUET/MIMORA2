import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTiDbEnv } from '../db/tidb.ts';
import { runP206LiveTiDbSuite } from './p2-06-live-tidb.integration.ts';

const hasTiDbEnv = validateTiDbEnv().ok;

test(
  'P2-06 Live TiDB Integration (T-CONC-01..03, attempts, turns, progress, cleanup)',
  { skip: !hasTiDbEnv },
  async () => {
    const report = await runP206LiveTiDbSuite();
    assert.equal(report.ok, true);
    assert.equal(report.countsMatchedPreFlight, true);
    assert.equal(
      Object.values(report.residualSyntheticRows).every((v) => v === 0),
      true
    );
  }
);
