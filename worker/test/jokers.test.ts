import test from "node:test";
import assert from "node:assert/strict";
import {
  applyJokerEffects,
  JOKER_CATALOG,
  findJoker,
  RARITY_ORDER,
  RARITY_STYLE,
  consecutiveHoldRounds,
} from "../src/jokers.ts";

const base = {
  chips: 200,
  mult: 1.25,
  score: 250,
  effects: [{ kind: "chips", label: "Portfolio", value: 200 }],
};

const context = {
  startValue: 10000,
  cashEnd: 10500,
  holdingsEnd: { MTA: 10, PXP: 5, RMP: 0, CLD: 0 },
  pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
  pricesEnd: { MTA: 45, PXP: 16, RMP: 70, CLD: 11 },
  tradeCount: 4,
  roundIndex: 2,
  roundHistory: [
    { score: 120, pass: true, ante: 1, round: 1 },
    { score: 180, pass: true, ante: 1, round: 2 },
  ],
};

function result(chips: number, mult: number) {
  return { chips, mult, score: Math.round(chips * mult), effects: [] };
}

test("catalog has 20 unique jokers, four per rarity", () => {
  const ids = JOKER_CATALOG.map(j => j.id);
  assert.strictEqual(new Set(ids).size, ids.length, "duplicate joker ids");
  assert.strictEqual(JOKER_CATALOG.length, 20, `expected 20 jokers, got ${JOKER_CATALOG.length}`);
  for (const rarity of RARITY_ORDER) {
    const count = JOKER_CATALOG.filter(j => j.rarity === rarity).length;
    assert.strictEqual(count, 4, `expected 4 ${rarity} jokers, got ${count}`);
  }
});

test("every joker has a valid rarity, effect kind, and glyph", () => {
  const validKind = new Set(["chips-add", "mult-add", "mult"]);
  for (const joker of JOKER_CATALOG) {
    assert.ok(joker.rarity in RARITY_STYLE, `missing style ${joker.rarity}`);
    assert.ok(validKind.has(joker.effectKind), `bad kind ${joker.effectKind}`);
    assert.ok(typeof joker.value === "number" && Number.isFinite(joker.value), `bad value ${joker.id}`);
    assert.ok(joker.glyph && joker.glyph.length === 1, `bad glyph ${joker.id}`);
  }
});

test("findJoker returns the right joker and undefined for unknown ids", () => {
  const j = findJoker("black-swan");
  assert.ok(j);
  assert.strictEqual(j!.rarity, "legendary");
  assert.strictEqual(j!.name, "Black Swan");
  assert.strictEqual(findJoker("does-not-exist"), undefined);
});

test("no jokers leaves the base result unchanged", () => {
  const out = applyJokerEffects([], context, base);
  assert.strictEqual(out.chips, base.chips);
  assert.strictEqual(out.mult, base.mult);
  assert.strictEqual(out.score, base.score);
  assert.strictEqual(out.effects.length, base.effects.length);
});

test("bull investor only applies in a rising market", () => {
  const up = applyJokerEffects(["bull-investor"], context, result(200, 1));
  assert.strictEqual(up.mult, 1.5, `bull investor should add 0.5 mult, got ${up.mult}`);
  const down = {
    ...context,
    pricesEnd: { MTA: 40, PXP: 17, RMP: 60, CLD: 9 },
  };
  const flat = applyJokerEffects(["bull-investor"], down, result(200, 1));
  assert.strictEqual(flat.mult, 1, `bull investor should not apply in a falling market, got ${flat.mult}`);
});

test("bear market only applies in a falling market", () => {
  const down = {
    ...context,
    pricesEnd: { MTA: 40, PXP: 17, RMP: 60, CLD: 9 },
  };
  const out = applyJokerEffects(["bear-market"], down, result(200, 1));
  assert.strictEqual(out.chips, 240, `bear market should add 40 chips, got ${out.chips}`);
  const up = applyJokerEffects(["bear-market"], context, result(200, 1));
  assert.strictEqual(up.chips, 200, `bear market should not apply in a rising market, got ${up.chips}`);
});

test("diversification scales with distinct holdings", () => {
  const two = { ...context, holdingsEnd: { MTA: 10, PXP: 5 } };
  const four = { ...context, holdingsEnd: { MTA: 10, PXP: 5, RMP: 3, CLD: 2 } };
  const out2 = applyJokerEffects(["diversification"], two, result(200, 1));
  const out4 = applyJokerEffects(["diversification"], four, result(200, 1));
  assert.strictEqual(out2.chips, 250, `diversification 2 held should be 250, got ${out2.chips}`);
  assert.strictEqual(out4.chips, 300, `diversification 4 held should be 300, got ${out4.chips}`);
});

test("day trader is capped at max trades", () => {
  const many = { ...context, tradeCount: 50 };
  const out = applyJokerEffects(["day-trader"], many, result(200, 1));
  assert.strictEqual(out.chips, 280, `day trader capped at 8 should add 80, got ${out.chips}`);
  const none = { ...context, tradeCount: 0 };
  const out0 = applyJokerEffects(["day-trader"], none, result(200, 1));
  assert.strictEqual(out0.chips, 200, "day trader with zero trades should add nothing");
});

test("compound interest scales with completed rounds", () => {
  const r0 = { ...context, roundIndex: 0 };
  const out0 = applyJokerEffects(["compound-interest"], r0, result(200, 1));
  assert.strictEqual(out0.mult, 1, `compound interest round 0 should add nothing, got ${out0.mult}`);
  const r3 = { ...context, roundIndex: 3 };
  const out3 = applyJokerEffects(["compound-interest"], r3, result(200, 1));
  assert.strictEqual(out3.mult, 1.45, `compound interest round 3 should add 0.45, got ${out3.mult}`);
});

test("short squeeze only applies when market falls and a holding rises", () => {
  const downRiser = {
    ...context,
    pricesStart: { MTA: 42, PXP: 18, RMP: 67, CLD: 10 },
    pricesEnd: { MTA: 40, PXP: 20, RMP: 60, CLD: 9 },
  };
  const out = applyJokerEffects(["short-squeeze"], downRiser, result(200, 1));
  assert.strictEqual(out.mult, 1.6, `short squeeze should be x1.6, got ${out.mult}`);
  const noRiser = {
    ...downRiser,
    pricesEnd: { MTA: 40, PXP: 17, RMP: 60, CLD: 9 },
  };
  const outNone = applyJokerEffects(["short-squeeze"], noRiser, result(200, 1));
  assert.strictEqual(outNone.mult, 1, `short squeeze should not apply without a riser, got ${outNone.mult}`);
});

test("black swan always applies its multiplier", () => {
  const out = applyJokerEffects(["black-swan"], context, result(200, 1));
  assert.strictEqual(out.mult, 1.5, `black swan should be x1.5, got ${out.mult}`);
});

test("market corner adds mult per distinct holding", () => {
  const two = { ...context, holdingsEnd: { MTA: 10, PXP: 5 } };
  const four = { ...context, holdingsEnd: { MTA: 10, PXP: 5, RMP: 3, CLD: 2 } };
  const out2 = applyJokerEffects(["market-corner"], two, result(200, 1));
  const out4 = applyJokerEffects(["market-corner"], four, result(200, 1));
  assert.strictEqual(out2.mult, 2.4, `market corner 2 held should be 2.4, got ${out2.mult}`);
  assert.strictEqual(out4.mult, 3.8, `market corner 4 held should be 3.8, got ${out4.mult}`);
});

test("joker effects are deterministic across repeated calls", () => {
  const a = applyJokerEffects(["insider", "tape-reader"], context, result(200, 1));
  const b = applyJokerEffects(["insider", "tape-reader"], context, result(200, 1));
  assert.strictEqual(a.score, b.score);
  assert.strictEqual(a.chips, b.chips);
  assert.strictEqual(a.mult, b.mult);
});

test("unknown joker ids are ignored", () => {
  const out = applyJokerEffects(["does-not-exist", "black-swan"], context, result(200, 1));
  assert.strictEqual(out.mult, 1.5, `unknown ids ignored but black swan should apply, got ${out.mult}`);
  assert.ok(!out.effects.some(e => e.jokerId === "does-not-exist"), "unknown id leaked into effects");
});

test("consecutive hold rounds counts completed rounds", () => {
  assert.strictEqual(consecutiveHoldRounds([], 0), 0, "round 0 streak should be 0");
  assert.strictEqual(consecutiveHoldRounds([{}, {}, {}], 3), 3, "three-round streak should be 3");
  assert.strictEqual(consecutiveHoldRounds([{}, {}], 5), 2, "streak capped by history length");
});
