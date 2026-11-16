import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceRun,
  createRun,
  lockRound,
  migrateRun,
  openRound,
  portfolioValue,
  RUN_RULES,
  scoreRound,
  targetForRound,
  type Prices,
} from "../src/run.ts";

const prices = (mta: number, pxp = 18, rmp = 67, cld = 10): Prices => ({ MTA: mta, PXP: pxp, RMP: rmp, CLD: cld });

test("targets rise across the eight antes", () => {
  const opening = targetForRound(1, 1);
  const closing = targetForRound(RUN_RULES.antes, RUN_RULES.roundsPerAnte);
  assert.equal(opening, 120);
  assert.ok(closing > opening);
  for (let ante = 1; ante <= RUN_RULES.antes; ante += 1) {
    for (let round = 2; round <= RUN_RULES.roundsPerAnte; round += 1) {
      assert.ok(targetForRound(ante, round) > targetForRound(ante, round - 1));
    }
  }
});

test("portfolio value includes cash and marked holdings", () => {
  assert.equal(portfolioValue(9000, { MTA: 25 }, prices(40)), 10000);
});

test("an idle round scores base chips only", () => {
  const result = scoreRound({
    ante: 1, round: 1, target: 120,
    startValue: 10000, cashEnd: 10000, holdingsEnd: {},
    pricesStart: prices(42), pricesEnd: prices(42),
    startedTick: 10, endedTick: 12, tradeCount: 0,
  });
  assert.equal(result.chips, 100);
  assert.equal(result.mult, 1);
  assert.equal(result.score, 100);
  assert.equal(result.pass, false);
});

test("holding several companies adds chips and a multiplier", () => {
  const result = scoreRound({
    ante: 1, round: 1, target: 120,
    startValue: 10000, cashEnd: 7020,
    holdingsEnd: { MTA: 25, PXP: 110 },
    pricesStart: prices(40), pricesEnd: prices(40),
    startedTick: 10, endedTick: 12, tradeCount: 2,
  });
  assert.equal(result.chips, 100 + 50);
  assert.equal(result.mult, 1.5);
  assert.equal(result.score, 225);
  assert.deepEqual(result.effects.map(effect => effect.kind), ["chips", "chips-add", "mult"]);
});

test("a rising holding adds the momentum bonus", () => {
  const result = scoreRound({
    ante: 1, round: 1, target: 120,
    startValue: 10000, cashEnd: 5000,
    holdingsEnd: { MTA: 100 },
    pricesStart: prices(50), pricesEnd: prices(60),
    startedTick: 10, endedTick: 12, tradeCount: 1,
  });
  assert.equal(result.chips, 140 + 25 + 20);
  assert.equal(result.mult, 1.25);
  assert.equal(result.score, 231);
});

test("a loss can score zero without producing negative chips", () => {
  const result = scoreRound({
    ante: 1, round: 1, target: 120,
    startValue: 10000, cashEnd: 0,
    holdingsEnd: { MTA: 1 },
    pricesStart: prices(50), pricesEnd: prices(1),
    startedTick: 10, endedTick: 12, tradeCount: 1,
  });
  assert.equal(result.chips, 0 + 25);
  assert.equal(result.score, 31);
  assert.ok(result.chips >= 0);
});

test("a round locks with the start snapshot and keeps the run cash", () => {
  const run = createRun("player-1", "Tester", prices(42), 5, 1000);
  const open = openRound({ ...run, holdings: { MTA: 10 }, cash: 9580 }, prices(42), 5, 1000);
  const { run: locked, result } = lockRound({ ...open, holdings: { MTA: 10 }, cash: 9580 }, prices(50), 9, 2000);
  assert.equal(locked.phase, "scoring");
  assert.equal(locked.cash, 9580);
  assert.equal(result.pass, true);
  assert.equal(locked.roundHistory.length, 1);
  assert.equal(locked.scoreTotal, result.score);
});

test("failing a round ends the run at the results screen", () => {
  const run = createRun("player-2", "Tester", prices(42), 5, 1000);
  const { run: locked } = lockRound({ ...run, target: 5000 }, prices(42), 6, 1500);
  const finished = advanceRun(locked, prices(42), 7, 1600);
  assert.equal(finished.phase, "results");
  assert.equal(finished.endedReason, "failed");
});

test("passing advances the round and resets the trade count", () => {
  const run = createRun("player-3", "Tester", prices(42), 5, 1000);
  const { run: locked } = lockRound({ ...run, target: 0, tradeCount: 4 }, prices(43), 6, 1500);
  const next = advanceRun(locked, prices(43), 7, 1600);
  assert.equal(next.phase, "trading");
  assert.equal(next.round, 2);
  assert.equal(next.ante, 1);
  assert.equal(next.tradeCount, 0);
  assert.equal(next.target, targetForRound(1, 2));
  assert.equal(next.roundStartValue, portfolioValue(next.cash, next.holdings, prices(43)));
});

test("the final round of the final ante completes the run", () => {
  const run = createRun("player-4", "Tester", prices(42), 5, 1000);
  const finalRound = { ...run, ante: RUN_RULES.antes, round: RUN_RULES.roundsPerAnte, target: 0 };
  const { run: locked } = lockRound(finalRound, prices(42), 6, 1500);
  const finished = advanceRun(locked, prices(42), 7, 1600);
  assert.equal(finished.phase, "results");
  assert.equal(finished.endedReason, "completed");
  assert.equal(finished.completedAntes, RUN_RULES.antes);
});

test("run saves round-trip and reject unknown versions", () => {
  const run = createRun("player-5", "Tester", prices(42), 5, 1000);
  const restored = migrateRun(JSON.parse(JSON.stringify(run)));
  assert.deepEqual(restored, run);
  assert.equal(migrateRun({ ...run, version: 2 }), null);
  assert.equal(migrateRun(null), null);
  assert.equal(migrateRun({ version: 1 }), null);
});

test("older saves receive safe defaults", () => {
  const restored = migrateRun({
    version: 1,
    runId: "run-1",
    playerId: "player-6",
    ante: 2,
    round: 1,
    phase: "trading",
    cash: 7500,
  });
  assert.ok(restored);
  assert.equal(restored.playerName, "Anonymous");
  assert.deepEqual(restored.roundHistory, []);
  assert.equal(restored.target, targetForRound(2, 1));
  assert.equal(restored.roundStartPrices.MTA, 42);
});
