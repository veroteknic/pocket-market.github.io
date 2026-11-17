import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceRun,
  bossForAnte,
  createRun,
  isBossRound,
  lockRound,
  RUN_RULES,
  scoreRound,
  targetForRound,
  type Prices,
} from "../src/run.ts";

test("isBossRound returns true only for round 3", () => {
  assert.ok(isBossRound(1, 3));
  assert.ok(isBossRound(8, 3));
  assert.ok(!isBossRound(1, 1));
  assert.ok(!isBossRound(1, 2));
  // Round 3 is always a boss round regardless of ante
});

test("bossForAnte returns a boss for each ante 1-8", () => {
  for (let ante = 1; ante <= RUN_RULES.antes; ante += 1) {
    const boss = bossForAnte(ante);
    assert.ok(boss, `ante ${ante} should have a boss`);
    assert.ok(boss.name);
    assert.ok(boss.detail);
    assert.ok(typeof boss.apply === "function");
  }
});

test("diversification-demand boss halves chips when fewer than 2 distinct holdings", () => {
  const input = {
    ante: 1, round: 3, target: 300, startValue: 10000, cashEnd: 10000,
    holdingsEnd: { MTA: 10 }, pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, startedTick: 10, endedTick: 12,
    tradeCount: 0, roundIndex: 2, roundHistory: [], jokers: [],
    boss: bossForAnte(1),
  };
  const result = scoreRound(input);
  assert.ok(result.effects.some(e => e.label === "Diversification Penalty"), "should have penalty effect");
  assert.ok(result.chips < 100, `chips should be halved, got ${result.chips}`);
});

test("diversification-demand boss does not penalize with 2+ distinct holdings", () => {
  const input = {
    ante: 1, round: 3, target: 300, startValue: 10000, cashEnd: 10000,
    holdingsEnd: { MTA: 5, PXP: 5 }, pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, startedTick: 10, endedTick: 12,
    tradeCount: 0, roundIndex: 2, roundHistory: [], jokers: [],
    boss: bossForAnte(1),
  };
  const result = scoreRound(input);
  assert.ok(!result.effects.some(e => e.label === "Diversification Penalty"), "should not have penalty");
});

test("multiplier-ceiling boss caps mult at 1.4", () => {
  const input = {
    ante: 3, round: 3, target: 300, startValue: 10000, cashEnd: 10000,
    holdingsEnd: { MTA: 10, PXP: 10, RMP: 10, CLD: 10 },
    pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, startedTick: 10, endedTick: 12,
    tradeCount: 0, roundIndex: 8, roundHistory: [], jokers: ["market-corner"],
    boss: bossForAnte(3),
  };
  const result = scoreRound(input);
  assert.ok(result.mult <= 1.4, `mult should be capped at 1.4, got ${result.mult}`);
});

test("iron-cap boss caps score at 10% above target", () => {
  const input = {
    ante: 8, round: 3, target: 780, startValue: 10000, cashEnd: 50000,
    holdingsEnd: {}, pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, startedTick: 10, endedTick: 12,
    tradeCount: 0, roundIndex: 23, roundHistory: [], jokers: ["black-swan"],
    boss: bossForAnte(8),
  };
  const result = scoreRound(input);
  const cap = Math.round(780 * 1.1);
  assert.ok(result.score <= cap, `score should be capped at ${cap}, got ${result.score}`);
});

test("bull market event adds 0.3 mult", () => {
  const input = {
    ante: 1, round: 1, target: 120, startValue: 10000, cashEnd: 10000,
    holdingsEnd: {}, pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, startedTick: 10, endedTick: 12,
    tradeCount: 0, roundIndex: 0, roundHistory: [], jokers: [],
    marketEvent: "bull",
  };
  const result = scoreRound(input);
  assert.ok(result.effects.some(e => e.label === "Bull Market"), "should have bull market effect");
  assert.ok(result.mult >= 1.3, `mult should include bull bonus, got ${result.mult}`);
});

test("flatline market event halves rising bonus", () => {
  const input = {
    ante: 1, round: 1, target: 120, startValue: 10000, cashEnd: 10000,
    holdingsEnd: { MTA: 10 }, pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 50, PXP: 18, RMP: 67, CLD: 10 }, startedTick: 10, endedTick: 12,
    tradeCount: 0, roundIndex: 0, roundHistory: [], jokers: [],
    marketEvent: "flatline",
  };
  const result = scoreRound(input);
  const rising = result.effects.find(e => e.label === "Rising");
  assert.ok(rising, "should have rising effect");
  assert.ok(rising.value <= 10, `rising should be halved, got ${rising.value}`);
});

test("volatility-wall boss raises the target by 40% on advance", () => {
  const run = createRun("player-x", "Tester", { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, 5, 1000);
  // Set up ante 5 round 2 as a completed scoring round
  const round2Run = { ...run, ante: 5, round: 2, phase: "trading", target: 0 };
  const { run: locked } = lockRound(round2Run, { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, 6, 1500);
  const finished = advanceRun(locked, { MTA: 42, PXP: 18, RMP: 67, CLD: 10 }, 7, 1600);
  const bossTarget = targetForRound(5, 3);
  const expected = Math.round(bossTarget * 1.4);
  assert.equal(finished.round, 3, "should advance to round 3");
  assert.equal(finished.ante, 5, "should stay on ante 5");
  assert.equal(finished.target, expected, `volatility wall target should be ${expected}, got ${finished.target}`);
});
