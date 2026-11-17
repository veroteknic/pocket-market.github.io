// Run rules and scoring for Pocket Market's roguelike layer.
// This module is intentionally free of Cloudflare imports so the rules can be
// tested with `node --test` and reused by any client.

import { type ShopOffer, SHOP_STARTING_CURRENCY, SHOP_ROUND_REWARD, applyJokerEffects } from "./jokers.ts";

export const TICKERS = ["MTA", "PXP", "RMP", "CLD"] as const;
export type Ticker = (typeof TICKERS)[number];
export type Prices = Record<Ticker, number>;
export type Holdings = Partial<Record<Ticker, number>>;

export const RUN_RULES = {
  antes: 8,
  roundsPerAnte: 3,
  startingCash: 10000,
  maxCountedTrades: 8,
  roundHistoryLimit: 40,
  archiveLimit: 20,
} as const;

export type ScoreEffect = {
  kind: "chips" | "chips-add" | "mult" | "mult-add";
  label: string;
  value: number;
};

export type RoundResultV1 = {
  roundId: string;
  ante: number;
  round: number;
  target: number;
  chips: number;
  mult: number;
  score: number;
  pass: boolean;
  startedTick: number;
  endedTick: number;
  tradeCount: number;
  effects: ScoreEffect[];
};

export type RunSaveV1 = {
  version: 1;
  runId: string;
  playerId: string;
  playerName: string;
  createdAt: number;
  updatedAt: number;

  ante: number;
  round: number;
  phase: "trading" | "scoring" | "results";
  endedReason?: "failed" | "retired" | "completed";

  roundStartedTick: number;
  roundStartValue: number;
  roundStartPrices: Prices;
  roundStartHoldings: Holdings;

  cash: number;
  holdings: Holdings;
  costBasis: Partial<Record<Ticker, number>>;
  realizedProfit: number;
  tradeCount: number;

  scoreTotal: number;
  lastRoundScore: number;
  bestRoundScore: number;
  target: number;
  completedAntes: number;

  seed: number;
  roundHistory: RoundResultV1[];

  // Roguelike shop economy. Currency is separate from real cash and cannot be
  // cashed out; it is spent on Jokers and shop rerolls.
  shopCurrency: number;
  jokers: string[];
  shopSeed: number;
  shopOffers: ShopOffer[];
  shopRerolls: number;
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function portfolioValue(cash: number, holdings: Holdings, prices: Prices): number {
  return round2(cash + TICKERS.reduce((sum, ticker) => sum + (holdings[ticker] || 0) * prices[ticker], 0));
}

// A gentle curve: ante 1 opens at 120 points and ante 8 closes near 780.
export function targetForRound(ante: number, round: number): number {
  const index = (ante - 1) * RUN_RULES.roundsPerAnte + (round - 1);
  return Math.round((120 + 15 * index + 0.6 * index * index) / 5) * 5;
}

export type ScoreInput = {
  ante: number;
  round: number;
  target: number;
  startValue: number;
  cashEnd: number;
  holdingsEnd: Holdings;
  pricesStart: Prices;
  pricesEnd: Prices;
  startedTick: number;
  endedTick: number;
  tradeCount: number;
  roundIndex: number;
  roundHistory: Array<{ score: number; pass: boolean; ante: number; round: number }>;
  jokers: string[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Score is chips x mult. It never touches cash: the return is measured against
// the portfolio snapshot taken when the round opened.
export function scoreRound(input: ScoreInput): RoundResultV1 {
  const startValue = Math.max(1, input.startValue);
  const endValue = portfolioValue(input.cashEnd, input.holdingsEnd, input.pricesEnd);
  const roundReturn = (endValue - startValue) / startValue;

  const baseChips = Math.round(clamp(100 + 400 * roundReturn, 0, 900));
  const distinct = TICKERS.filter(ticker => (input.holdingsEnd[ticker] || 0) > 0).length;
  const rising = TICKERS.filter(ticker =>
    (input.holdingsEnd[ticker] || 0) > 0 && input.pricesEnd[ticker] > input.pricesStart[ticker]
  ).length;

  const holdingsBonus = 25 * distinct;
  const risingBonus = 20 * rising;
  const chips = baseChips + holdingsBonus + risingBonus;
  const mult = round2(1 + 0.25 * Math.min(4, distinct));

  const effects: ScoreEffect[] = [{ kind: "chips", label: "Portfolio", value: baseChips }];
  if (holdingsBonus) effects.push({ kind: "chips-add", label: "Holdings", value: holdingsBonus });
  if (risingBonus) effects.push({ kind: "chips-add", label: "Rising", value: risingBonus });
  effects.push({ kind: "mult", label: "Multiplier", value: mult });

  const context = {
    startValue: input.startValue,
    cashEnd: input.cashEnd,
    holdingsEnd: input.holdingsEnd,
    pricesStart: input.pricesStart,
    pricesEnd: input.pricesEnd,
    tradeCount: input.tradeCount,
    roundIndex: input.roundIndex ?? 0,
    roundHistory: input.roundHistory ?? [],
  };
  const scored = applyJokerEffects(input.jokers ?? [], context, {
    chips,
    mult,
    score: Math.round(chips * mult),
    effects: effects.map(e => ({ kind: e.kind, label: e.label, value: e.value })),
  });

  return {
    roundId: `${input.ante}:${input.round}`,
    ante: input.ante,
    round: input.round,
    target: input.target,
    chips: scored.chips,
    mult: scored.mult,
    score: scored.score,
    pass: scored.score >= input.target,
    startedTick: input.startedTick,
    endedTick: input.endedTick,
    tradeCount: input.tradeCount,
    effects: scored.effects.map(e => ({ kind: e.kind, label: e.label, value: e.value })),
  };
}

export function createRun(playerId: string, playerName: string, prices: Prices, tick: number, now = Date.now()): RunSaveV1 {
  const target = targetForRound(1, 1);
  return {
    version: 1,
    runId: crypto.randomUUID(),
    playerId,
    playerName,
    createdAt: now,
    updatedAt: now,
    ante: 1,
    round: 1,
    phase: "trading",
    roundStartedTick: tick,
    roundStartValue: RUN_RULES.startingCash,
    roundStartPrices: { ...prices },
    roundStartHoldings: {},
    cash: RUN_RULES.startingCash,
    holdings: {},
    costBasis: {},
    realizedProfit: 0,
    tradeCount: 0,
    scoreTotal: 0,
    lastRoundScore: 0,
    bestRoundScore: 0,
    target,
    completedAntes: 0,
    seed: Math.floor(Math.random() * 2 ** 31),
    roundHistory: [],
    shopCurrency: SHOP_STARTING_CURRENCY,
    jokers: [],
    shopSeed: Math.floor(Math.random() * 2 ** 31),
    shopOffers: [],
    shopRerolls: 0,
  };
}

// Opening a round snapshots prices and portfolio so scoring can only use data
// the player actually experienced.
export function openRound(run: RunSaveV1, prices: Prices, tick: number, now = Date.now()): RunSaveV1 {
  return {
    ...run,
    phase: "trading",
    updatedAt: now,
    roundStartedTick: tick,
    roundStartValue: portfolioValue(run.cash, run.holdings, prices),
    roundStartPrices: { ...prices },
    roundStartHoldings: { ...run.holdings },
    tradeCount: 0,
  };
}

export function lockRound(run: RunSaveV1, prices: Prices, tick: number, now = Date.now()): { run: RunSaveV1; result: RoundResultV1 } {
  if (run.phase !== "trading") throw new Error("This round is not open");
  const result = scoreRound({
    ante: run.ante,
    round: run.round,
    target: run.target,
    startValue: run.roundStartValue,
    cashEnd: run.cash,
    holdingsEnd: run.holdings,
    pricesStart: run.roundStartPrices,
    pricesEnd: prices,
    startedTick: run.roundStartedTick,
    endedTick: tick,
    tradeCount: run.tradeCount,
    roundIndex: (run.ante - 1) * RUN_RULES.roundsPerAnte + (run.round - 1),
    roundHistory: run.roundHistory,
    jokers: run.jokers,
  });
  const history = [...run.roundHistory, result].slice(-RUN_RULES.roundHistoryLimit);
  const next: RunSaveV1 = {
    ...run,
    phase: "scoring",
    updatedAt: now,
    lastRoundScore: result.score,
    bestRoundScore: Math.max(run.bestRoundScore, result.score),
    ...(result.pass ? { scoreTotal: run.scoreTotal + result.score } : {}),
    roundHistory: history,
  };
  return { run: next, result };
}

// Called after the scoring screen. Passing advances the ante/round and opens the
// next market; failing ends the run and keeps the final board for the results.
export function advanceRun(run: RunSaveV1, prices: Prices, tick: number, now = Date.now()): RunSaveV1 {
  if (run.phase !== "scoring") throw new Error("No round is awaiting advance");
  const result = run.roundHistory[run.roundHistory.length - 1];
  if (!result) throw new Error("Round result missing");
  if (!result.pass) {
    return { ...run, phase: "results", endedReason: "failed", updatedAt: now };
  }

  const isLastRound = run.round === RUN_RULES.roundsPerAnte;
  const isLastAnte = run.ante >= RUN_RULES.antes;
  if (isLastRound && isLastAnte) {
    return {
      ...run,
      phase: "results",
      endedReason: "completed",
      completedAntes: RUN_RULES.antes,
      updatedAt: now,
    };
  }

  const ante = isLastRound ? run.ante + 1 : run.ante;
  const round = isLastRound ? 1 : run.round + 1;
  const next: RunSaveV1 = {
    ...run,
    ante,
    round,
    target: targetForRound(ante, round),
    completedAntes: isLastRound ? run.ante : run.completedAntes,
    shopCurrency: run.shopCurrency + SHOP_ROUND_REWARD,
    updatedAt: now,
  };
  return openRound(next, prices, tick, now);
}

export function retireRun(run: RunSaveV1, now = Date.now()): RunSaveV1 {
  return { ...run, phase: "results", endedReason: "retired", updatedAt: now };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Unknown versions are rejected rather than coerced. Missing optional blocks get
// safe defaults so a save written by an earlier build still loads.
export function migrateRun(raw: unknown): RunSaveV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<RunSaveV1>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.runId !== "string" || typeof candidate.playerId !== "string") return null;
  if (!isFiniteNumber(candidate.ante) || !isFiniteNumber(candidate.round)) return null;
  if (!candidate.phase || !["trading", "scoring", "results"].includes(candidate.phase)) return null;
  if (!isFiniteNumber(candidate.cash)) return null;

  const prices = candidate.roundStartPrices as Prices | undefined;
  const safePrices: Prices = prices && TICKERS.every(ticker => isFiniteNumber(prices[ticker]))
    ? { MTA: prices.MTA, PXP: prices.PXP, RMP: prices.RMP, CLD: prices.CLD }
    : { MTA: 42, PXP: 18, RMP: 67, CLD: 10 };

  return {
    version: 1,
    runId: candidate.runId,
    playerId: candidate.playerId,
    playerName: candidate.playerName || "Anonymous",
    createdAt: isFiniteNumber(candidate.createdAt) ? candidate.createdAt : Date.now(),
    updatedAt: isFiniteNumber(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    ante: candidate.ante,
    round: candidate.round,
    phase: candidate.phase as RunSaveV1["phase"],
    ...(candidate.endedReason ? { endedReason: candidate.endedReason } : {}),
    roundStartedTick: isFiniteNumber(candidate.roundStartedTick) ? candidate.roundStartedTick : 0,
    roundStartValue: isFiniteNumber(candidate.roundStartValue) ? candidate.roundStartValue : RUN_RULES.startingCash,
    roundStartPrices: safePrices,
    roundStartHoldings: candidate.roundStartHoldings || {},
    cash: candidate.cash,
    holdings: candidate.holdings || {},
    costBasis: candidate.costBasis || {},
    realizedProfit: isFiniteNumber(candidate.realizedProfit) ? candidate.realizedProfit : 0,
    tradeCount: isFiniteNumber(candidate.tradeCount) ? candidate.tradeCount : 0,
    scoreTotal: isFiniteNumber(candidate.scoreTotal) ? candidate.scoreTotal : 0,
    lastRoundScore: isFiniteNumber(candidate.lastRoundScore) ? candidate.lastRoundScore : 0,
    bestRoundScore: isFiniteNumber(candidate.bestRoundScore) ? candidate.bestRoundScore : 0,
    target: isFiniteNumber(candidate.target) ? candidate.target : targetForRound(candidate.ante, candidate.round),
    completedAntes: isFiniteNumber(candidate.completedAntes) ? candidate.completedAntes : 0,
    seed: isFiniteNumber(candidate.seed) ? candidate.seed : 1,
    roundHistory: Array.isArray(candidate.roundHistory) ? candidate.roundHistory.slice(-RUN_RULES.roundHistoryLimit) : [],
    shopCurrency: isFiniteNumber(candidate.shopCurrency) ? candidate.shopCurrency : SHOP_STARTING_CURRENCY,
    jokers: Array.isArray(candidate.jokers) ? candidate.jokers : [],
    shopSeed: isFiniteNumber(candidate.shopSeed) ? candidate.shopSeed : Math.floor(Math.random() * 2 ** 31),
    shopOffers: Array.isArray(candidate.shopOffers) ? candidate.shopOffers : [],
    shopRerolls: isFiniteNumber(candidate.shopRerolls) ? candidate.shopRerolls : 0,
  };
}
