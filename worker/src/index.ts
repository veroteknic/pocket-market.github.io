import { DurableObject } from "cloudflare:workers";
import {
  advanceRun,
  createRun,
  lockRound,
  migrateRun,
  portfolioValue,
  retireRun,
  RUN_RULES,
  type RunSaveV1,
} from "./run.ts";

const startingPrices = {
  MTA: 42.00,
  PXP: 18.00,
  RMP: 67.00,
  CLD: 10.00,
};

const volatility = {
  MTA: 0.06,
  PXP: 0.14,
  RMP: 0.09,
  CLD: 0.18,
};

// Keep the shared market lively without exhausting Durable Object free-tier writes.
const TICK_MS = 15000;
const MAX_DAYS = 365;
type Prices = typeof startingPrices;
type HistoryPoint = { time: number; price: number };
type History = { [K in keyof Prices]: HistoryPoint[] };
type PlayerState = {
  name: string;
  cash: number;
  holdings: Partial<Record<keyof Prices, number>>;
  costBasis: Partial<Record<keyof Prices, number>>;
  realizedProfit: number;
};
type UserRecord = { playerId: string; passwordHash: string };
type SessionRecord = { playerId: string; developer?: boolean };
type LeaderEntry = { name: string; score: number; rank: number; rankChange: number };
type DailyRanks = Record<string, { rank: number; rankChange: number }>;
type StoredDailyRanks = DailyRanks | Record<string, number>;
type MarketEvent = {
  headline: string;
  detail: string;
  kind: "boom" | "crash";
  effect: number;
  expiresAt: number;
  scope: "market" | "company";
  ticker?: keyof Prices;
};
type DailyTracking = {
  dateKey: string;
  day: number;
  openedAt: number;
  opening: Prices;
  high: Prices;
  low: Prices;
  sentimentHigh: number;
  sentimentLow: number;
  events: Array<Pick<MarketEvent, "headline" | "detail" | "kind" | "scope" | "ticker">>;
};
type DailySummary = DailyTracking & {
  closedAt?: number;
  closing: Prices;
  biggestMover: keyof Prices;
  inProgress: boolean;
};
type MarketState = {
  day: number;
  tick: number;
  updatedAt: number;
  prices: Prices;
  history: History;
  orderFlow: Partial<Record<keyof Prices, number>>;
  sentiment: number;
  event: MarketEvent | null;
  daily: DailyTracking;
};

function makeHistory(prices: Prices, time = Date.now()): History {
  return {
    MTA: [{ time, price: prices.MTA }],
    PXP: [{ time, price: prices.PXP }],
    RMP: [{ time, price: prices.RMP }],
    CLD: [{ time, price: prices.CLD }],
  };
}

// History is thinned by halving the older part of the record, never by dropping
// the far end. The newest 720 points keep full resolution, so the Day chart only
// coarsens after several hours while Week and All still reach back across the
// whole run at a steadily wider grain.
const HISTORY_RECENT = 720;

function appendHistory(points: HistoryPoint[], time: number, price: number): HistoryPoint[] {
  const next = [...points, { time, price }];
  if (next.length <= HISTORY_RECENT * 2) return next;
  const recent = next.slice(-HISTORY_RECENT);
  const older = next.slice(0, next.length - HISTORY_RECENT);
  const thinned = older.filter((_, index) => index % 2 === 0);
  return [...thinned, ...recent];
}

function currentDayOfYear() {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const elapsedDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.min(MAX_DAYS, elapsedDays + 1));
}

function currentDateKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(currentDayOfYear()).padStart(3, "0")}`;
}

function pricesCopy(prices: Prices): Prices {
  return { MTA: prices.MTA, PXP: prices.PXP, RMP: prices.RMP, CLD: prices.CLD };
}

function startDailyTracking(prices: Prices, sentiment: number, now = Date.now()): DailyTracking {
  return {
    dateKey: currentDateKey(new Date(now)),
    day: currentDayOfYear(),
    openedAt: now,
    opening: pricesCopy(prices),
    high: pricesCopy(prices),
    low: pricesCopy(prices),
    sentimentHigh: sentiment,
    sentimentLow: sentiment,
    events: [],
  };
}

function dailySummary(daily: DailyTracking, closing: Prices, inProgress: boolean, closedAt?: number): DailySummary {
  const biggestMover = (Object.keys(closing) as Array<keyof Prices>).reduce((winner, ticker) => {
    const winnerChange = Math.abs((closing[winner] - daily.opening[winner]) / daily.opening[winner]);
    const change = Math.abs((closing[ticker] - daily.opening[ticker]) / daily.opening[ticker]);
    return change > winnerChange ? ticker : winner;
  }, "MTA" as keyof Prices);
  return { ...daily, closing: pricesCopy(closing), biggestMover, inProgress, ...(closedAt ? { closedAt } : {}) };
}

const textEncoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: textEncoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return `${salt}.${bytesToHex(bits)}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [salt, expected] = storedHash.split(".");
  if (!salt || !expected) return false;
  const actual = await hashPassword(password, salt);
  return actual === `${salt}.${expected}`;
}

function movePrice(price: number, ticker: keyof Prices) {
  const movement = (Math.random() * 2 - 1) * volatility[ticker];
  return Math.max(1, Math.round(price * (1 + movement) * 100) / 100);
}

export class Market extends DurableObject {
  async fetch(request: Request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket connection.", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const market = await this.getMarket();
    server.send(JSON.stringify({ type: "market_update", ...market }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Clients do not need to send anything yet. Replying makes testing easier.
    ws.send(JSON.stringify({ type: "connected", message: "Live market connected." }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }

  async getMarket() {
    let market = await this.ctx.storage.get<MarketState>("market");

    if (!market) {
      const day = currentDayOfYear();
      const updatedAt = Date.now();
      market = {
        day,
        tick: 0,
        updatedAt,
        prices: pricesCopy(startingPrices),
        history: makeHistory(startingPrices, updatedAt),
        orderFlow: {},
        sentiment: 0,
        event: null,
        daily: startDailyTracking(startingPrices, 0, updatedAt),
      };
      await this.ctx.storage.put("market", market);
    } else if (!Number.isFinite(market.tick) || !Number.isFinite(market.updatedAt) || !market.history || !market.orderFlow || !Number.isFinite(market.sentiment) || !market.daily) {
      // Upgrade state created by the first version of the prototype.
      market = {
        ...market,
        tick: Number.isFinite(market.tick) ? market.tick : 0,
        updatedAt: Number.isFinite(market.updatedAt) ? market.updatedAt : Date.now(),
        history: market.history || makeHistory(market.prices),
        orderFlow: market.orderFlow || {},
        sentiment: Number.isFinite(market.sentiment) ? market.sentiment : 0,
        event: market.event || null,
        daily: market.daily || startDailyTracking(market.prices, Number.isFinite(market.sentiment) ? market.sentiment : 0),
      };
      await this.ctx.storage.put("market", market);
    }

    // Keep the calendar anchored to server time, while preserving any simulated
    // days the game has already advanced beyond the real calendar.
    const serverDay = currentDayOfYear();
    if (market.day < serverDay) {
      market = {
        ...market,
        day: Math.max(market.day, serverDay),
      };
      await this.ctx.storage.put("market", market);
    }

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }

    return market;
  }

  async alarm() {
    const market = await this.ctx.storage.get<MarketState>("market");
    if (!market) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
      return;
    }

    const nextTick = (Number.isFinite(market.tick) ? market.tick : 0) + 1;
    const updatedAt = Date.now();
    let event = market.event;
    if (event && event.expiresAt <= updatedAt) event = null;
    if (!event && Math.random() < 0.1) event = randomMarketEvent(updatedAt);
    const flow = Object.values(market.orderFlow || {}).reduce((sum, value) => sum + (value || 0), 0);
    const sentiment = Math.max(-100, Math.min(100, (market.sentiment || 0) * 0.96 + flow * 0.12 + (Math.random() * 6 - 3)));
    const prices = {
      MTA: movePriceWithPressure(market.prices.MTA, "MTA", market.orderFlow?.MTA || 0, sentiment, eventEffectFor(event, "MTA")),
      PXP: movePriceWithPressure(market.prices.PXP, "PXP", market.orderFlow?.PXP || 0, sentiment, eventEffectFor(event, "PXP")),
      RMP: movePriceWithPressure(market.prices.RMP, "RMP", market.orderFlow?.RMP || 0, sentiment, eventEffectFor(event, "RMP")),
      CLD: movePriceWithPressure(market.prices.CLD, "CLD", market.orderFlow?.CLD || 0, sentiment, eventEffectFor(event, "CLD")),
    };
    const history = { ...market.history };
    (Object.keys(prices) as Array<keyof Prices>).forEach(ticker => {
      // Keep genuine live ticks only; no synthetic backfill.
      history[ticker] = appendHistory(market.history[ticker], updatedAt, prices[ticker]);
    });
    let daily = market.daily;
    const todayKey = currentDateKey(new Date(updatedAt));
    if (daily.dateKey !== todayKey) {
      // Only completed, real live-market days are persisted. No backfill.
      await this.ctx.storage.put(`summary:${daily.dateKey}`, dailySummary(daily, market.prices, false, updatedAt));
      daily = startDailyTracking(market.prices, sentiment, updatedAt);
    }
    (Object.keys(prices) as Array<keyof Prices>).forEach(ticker => {
      daily.high[ticker] = Math.max(daily.high[ticker], prices[ticker]);
      daily.low[ticker] = Math.min(daily.low[ticker], prices[ticker]);
    });
    daily.sentimentHigh = Math.max(daily.sentimentHigh, sentiment);
    daily.sentimentLow = Math.min(daily.sentimentLow, sentiment);
    if (event && (!market.event || market.event.expiresAt !== event.expiresAt)) {
      daily.events = [...daily.events, {
        headline: event.headline,
        detail: event.detail,
        kind: event.kind,
        scope: event.scope,
        ...(event.ticker ? { ticker: event.ticker } : {}),
      }].slice(-8);
    }
    const nextMarket = {
      ...market,
      day: currentDayOfYear(),
      tick: nextTick,
      updatedAt,
      prices,
      orderFlow: {},
      history,
      sentiment,
      event,
      daily,
    };
    await this.ctx.storage.put("market", nextMarket);
    this.broadcast(nextMarket);
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  async getPlayer(playerId: string): Promise<PlayerState> {
    const player = await this.ctx.storage.get<PlayerState>(`player:${playerId}`);
    if (!player) return { name: "Anonymous", cash: 10000, holdings: {}, costBasis: {}, realizedProfit: 0 };

    // Migrate players created before cost basis tracking was introduced.
    const migrated = {
      ...player,
      costBasis: player.costBasis || {},
      realizedProfit: Number.isFinite(player.realizedProfit) ? player.realizedProfit : 0,
    };
    if (!player.costBasis || !Number.isFinite(player.realizedProfit)) {
      await this.ctx.storage.put(`player:${playerId}`, migrated);
    }
    return migrated;
  }

  private validateCredentials(name: string, password: string) {
    const cleanName = name.trim();
    if (!/^[a-zA-Z0-9 _-]{3,16}$/.test(cleanName)) throw new Error("Name must be 3–16 letters, numbers, spaces, _ or -");
    if (password.length < 8 || password.length > 128) throw new Error("Password must be 8–128 characters");
    return cleanName;
  }

  async registerAccount(name: string, password: string) {
    const cleanName = this.validateCredentials(name, password);
    const normalized = cleanName.toLowerCase();
    if (await this.ctx.storage.get<UserRecord>(`user:${normalized}`)) throw new Error("That name is already taken");
    const playerId = crypto.randomUUID();
    const player = { name: cleanName, cash: 10000, holdings: {}, costBasis: {}, realizedProfit: 0 } satisfies PlayerState;
    const passwordHash = await hashPassword(password, crypto.randomUUID());
    const token = crypto.randomUUID();
    await this.ctx.storage.put(`user:${normalized}`, { playerId, passwordHash });
    await this.ctx.storage.put(`player:${playerId}`, player);
    await this.ctx.storage.put(`session:${token}`, { playerId } satisfies SessionRecord);
    return { token, player };
  }

  async loginAccount(name: string, password: string) {
    const cleanName = name.trim();
    const record = await this.ctx.storage.get<UserRecord>(`user:${cleanName.toLowerCase()}`);
    if (!record || !(await verifyPassword(password, record.passwordHash))) throw new Error("Invalid name or password");
    const token = crypto.randomUUID();
    await this.ctx.storage.put(`session:${token}`, { playerId: record.playerId } satisfies SessionRecord);
    return { token, player: await this.getPlayer(record.playerId) };
  }

  async playerIdForSession(token: string) {
    const session = await this.sessionForToken(token);
    return session?.playerId;
  }

  async isDeveloperSession(token: string) {
    return Boolean((await this.sessionForToken(token))?.developer);
  }

  async authorizeDeveloperSession(token: string) {
    const session = await this.sessionForToken(token);
    if (!session) throw new Error("Not authenticated");
    await this.ctx.storage.put(`session:${token}`, { ...session, developer: true });
  }

  private async sessionForToken(token: string): Promise<SessionRecord | undefined> {
    if (!token) return undefined;
    const stored = await this.ctx.storage.get<SessionRecord | string>(`session:${token}`);
    // Seamlessly migrate cookies created before developer roles existed.
    return typeof stored === "string" ? { playerId: stored } : stored;
  }

  async registerPlayer(playerId: string, name: string): Promise<PlayerState> {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(playerId)) throw new Error("Invalid player ID");
    const cleanName = name.trim();
    if (!/^[a-zA-Z0-9 _-]{3,16}$/.test(cleanName)) throw new Error("Name must be 3–16 letters, numbers, spaces, _ or -");
    const normalized = cleanName.toLowerCase();
    const players = await this.ctx.storage.list<PlayerState>({ prefix: "player:" });

    for (const [key, player] of players) {
      if (key !== `player:${playerId}` && player.name?.toLowerCase() === normalized) {
        throw new Error("That name is already taken");
      }
    }

    const player = await this.getPlayer(playerId);
    player.name = cleanName;
    await this.ctx.storage.put(`player:${playerId}`, player);
    return player;
  }

  async getRun(playerId: string): Promise<RunSaveV1 | null> {
    const stored = await this.ctx.storage.get<unknown>(`run:${playerId}`);
    if (!stored) return null;
    return migrateRun(stored);
  }

  // A run is created only when the player asks for one. The town portfolio is
  // archived first so the classic board and every past trade stay inspectable.
  async startRun(playerId: string, playerName: string): Promise<RunSaveV1> {
    const existing = await this.getRun(playerId);
    if (existing && existing.phase !== "results") throw new Error("A run is already in progress");
    if (existing) await this.archiveRun(existing);

    if (!(await this.ctx.storage.get(`legacy:${playerId}`))) {
      const player = await this.getPlayer(playerId);
      await this.ctx.storage.put(`legacy:${playerId}`, { archivedAt: Date.now(), player });
    }

    const market = await this.getMarket();
    const run = createRun(playerId, playerName, market.prices, market.tick);
    await this.ctx.storage.put(`run:${playerId}`, run);
    return run;
  }

  async lockPlayerRun(playerId: string) {
    const run = await this.getRun(playerId);
    if (!run) throw new Error("No active run");
    const market = await this.getMarket();
    const locked = lockRound(run, market.prices, market.tick);
    await this.ctx.storage.put(`run:${playerId}`, locked.run);
    return locked;
  }

  async advancePlayerRun(playerId: string): Promise<RunSaveV1> {
    const run = await this.getRun(playerId);
    if (!run) throw new Error("No active run");
    const market = await this.getMarket();
    const next = advanceRun(run, market.prices, market.tick);
    await this.ctx.storage.put(`run:${playerId}`, next);
    return next;
  }

  async retirePlayerRun(playerId: string): Promise<RunSaveV1> {
    const run = await this.getRun(playerId);
    if (!run) throw new Error("No active run");
    const next = retireRun(run);
    await this.ctx.storage.put(`run:${playerId}`, next);
    return next;
  }

  // Completed runs are bounded per player so the run key stays small.
  private async archiveRun(run: RunSaveV1) {
    await this.ctx.storage.put(`runArchive:${run.playerId}:${run.runId}`, {
      runId: run.runId,
      ante: run.ante,
      round: run.round,
      scoreTotal: run.scoreTotal,
      bestRoundScore: run.bestRoundScore,
      completedAntes: run.completedAntes,
      endedReason: run.endedReason || "retired",
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
    const archived = await this.ctx.storage.list<{ updatedAt: number }>({ prefix: `runArchive:${run.playerId}:` });
    if (archived.size > RUN_RULES.archiveLimit) {
      const stale = [...archived.entries()]
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
        .slice(0, archived.size - RUN_RULES.archiveLimit)
        .map(([key]) => key);
      await this.ctx.storage.delete(stale);
    }
  }

  async getLeaderboard(market: MarketState): Promise<LeaderEntry[]> {
    const players = await this.ctx.storage.list<PlayerState>({ prefix: "player:" });
    const runs = await this.ctx.storage.list<RunSaveV1>({ prefix: "run:" });
    const activeRuns = new Map<string, RunSaveV1>();
    for (const [, run] of runs) {
      if (run.phase !== "results") activeRuns.set(run.playerId, run);
    }
    const entries: Array<{ playerId: string; name: string; score: number }> = [];
    for (const [key, player] of players) {
      const playerId = key.slice("player:".length);
      const run = activeRuns.get(playerId);
      const score = run
        ? Math.round(portfolioValue(run.cash, run.holdings, market.prices))
        : Math.round(player.cash + Object.entries(player.holdings).reduce((total, [ticker, shares]) => total + (market.prices[ticker as keyof Prices] * (shares || 0)), 0));
      entries.push({ playerId, name: player.name || "Anonymous", score });
    }
    entries.sort((a, b) => b.score - a.score);
    const rankKey = `ranks:${market.daily.dateKey}`;
    const previousRanks = (await this.ctx.storage.get<StoredDailyRanks>(rankKey)) || {};
    const currentRanks: DailyRanks = {};
    entries.forEach((entry, index) => {
      const rank = index + 1;
      const previous = previousRanks[entry.playerId];
      const previousRank = typeof previous === "number" ? previous : previous?.rank;
      currentRanks[entry.playerId] = {
        rank,
        // Keep the last movement visible until this player moves again.
        rankChange: previousRank && previousRank !== rank
          ? previousRank - rank
          : (typeof previous === "object" ? previous.rankChange : 0),
      };
    });
    if (JSON.stringify(previousRanks) !== JSON.stringify(currentRanks)) {
      await this.ctx.storage.put(rankKey, currentRanks);
    }
    return entries.slice(0, 10).map((entry, index) => ({
      name: entry.name,
      score: entry.score,
      rank: index + 1,
      // A lower rank number is better, so a positive change means climbing.
      rankChange: currentRanks[entry.playerId].rankChange,
    }));
  }

  async getDailySummaries() {
    const market = await this.getMarket();
    const stored = await this.ctx.storage.list<DailySummary>({ prefix: "summary:", reverse: true, limit: 6 });
    const summaries = [...stored.values()];
    // The current day is a live partial recap, explicitly marked as such.
    summaries.unshift(dailySummary(market.daily, market.prices, true));
    return summaries.slice(0, 7);
  }

  async developerMarketControl(token: string, action: string, payload: { kind?: string; ticker?: string; sentiment?: number }) {
    if (!(await this.isDeveloperSession(token))) throw new Error("Developer access required");
    const market = await this.getMarket();

    if (action === "event") {
      if (!["boom", "crash"].includes(payload.kind || "")) throw new Error("Invalid event kind");
      const ticker = payload.ticker && payload.ticker in startingPrices ? payload.ticker as keyof Prices : undefined;
      const kind = payload.kind as "boom" | "crash";
      const effect = (kind === "boom" ? 1 : -1) * (ticker ? 0.14 : 0.08);
      const event: MarketEvent = {
        headline: ticker ? `DEV ${kind === "boom" ? "BOOM" : "CRASH"} — ${ticker}` : `DEV MARKET ${kind === "boom" ? "BOOM" : "CRASH"}`,
        detail: ticker ? `Developer override affecting ${ticker} only.` : "Developer override affecting the entire market.",
        kind,
        effect,
        expiresAt: Date.now() + TICK_MS,
        scope: ticker ? "company" : "market",
        ...(ticker ? { ticker } : {}),
      };
      const nextMarket = { ...market, event };
      await this.ctx.storage.put("market", nextMarket);
      this.broadcast(nextMarket);
      return nextMarket;
    }

    if (action === "sentiment") {
      if (!Number.isFinite(payload.sentiment) || Math.abs(payload.sentiment!) > 100) throw new Error("Sentiment must be between -100 and 100");
      const nextMarket = { ...market, sentiment: Math.round(payload.sentiment!) };
      await this.ctx.storage.put("market", nextMarket);
      this.broadcast(nextMarket);
      return nextMarket;
    }

    throw new Error("Unknown developer market control");
  }

  async developerPlayerControl(token: string, action: string, payload: { cash?: number; ticker?: string; quantity?: number; name?: string }) {
    const session = await this.sessionForToken(token);
    if (!session?.developer) throw new Error("Developer access required");
    const player = await this.getPlayer(session.playerId);
    const market = await this.getMarket();

    if (action === "cash") {
      if (!Number.isFinite(payload.cash) || payload.cash! < 0 || payload.cash! > 1_000_000) throw new Error("Cash must be between 0 and 1,000,000");
      player.cash = roundMoney(payload.cash!);
    } else if (action === "holding") {
      if (!payload.ticker || !(payload.ticker in startingPrices) || !Number.isInteger(payload.quantity) || payload.quantity! < 0 || payload.quantity! > 10_000) {
        throw new Error("Invalid holding");
      }
      const ticker = payload.ticker as keyof Prices;
      player.holdings[ticker] = payload.quantity!;
      // A test holding starts at current price, so developer setup does not fake P/L.
      player.costBasis[ticker] = roundMoney(market.prices[ticker] * payload.quantity!);
    } else if (action === "reset") {
      player.cash = 10000;
      player.holdings = {};
      player.costBasis = {};
      player.realizedProfit = 0;
    } else if (action === "delete") {
      const targetName = (payload.name || "").trim().toLowerCase();
      if (!targetName) throw new Error("Enter the account name to delete");
      const record = await this.ctx.storage.get<UserRecord>(`user:${targetName}`);
      if (!record) throw new Error("No account with that name");
      // Deleting the signed-in account is allowed; it simply ends this session.
      await this.ctx.storage.delete(`user:${targetName}`);
      await this.ctx.storage.delete(`player:${record.playerId}`);
      const sessions = await this.ctx.storage.list<SessionRecord | string>({ prefix: "session:" });
      const staleSessions = [...sessions]
        .filter(([, stored]) => (typeof stored === "string" ? stored : stored.playerId) === record.playerId)
        .map(([key]) => key);
      if (staleSessions.length) await this.ctx.storage.delete(staleSessions);
      return { deleted: targetName, playerId: record.playerId };
    } else {
      throw new Error("Unknown developer player control");
    }

    await this.ctx.storage.put(`player:${session.playerId}`, player);
    return player;
  }

  async developerRunControl(token: string, action: string) {
    const session = await this.sessionForToken(token);
    if (!session?.developer) throw new Error("Developer access required");
    if (action === "reset") {
      const run = await this.getRun(session.playerId);
      if (run) await this.archiveRun(run);
      await this.ctx.storage.delete(`run:${session.playerId}`);
      return { reset: true };
    }
    throw new Error("Unknown developer run control");
  }

  async trade(playerId: string, ticker: string, action: string, quantity: number) {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(playerId)) throw new Error("Invalid player ID");
    if (!(ticker in startingPrices) || !["buy", "sell"].includes(action)) throw new Error("Invalid trade");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("Invalid quantity");

    const symbol = ticker as keyof Prices;
    const market = await this.getMarket();
    const player = await this.getPlayer(playerId);
    const run = await this.getRun(playerId);
    if (run && run.phase === "scoring") throw new Error("Trading is locked");
    // A finished run leaves its save in place for the results screen. Once the
    // run is over, the archived classic portfolio becomes the live account again.
    const activeRun = run && run.phase === "trading" ? run : null;
    const account = activeRun || player;
    const owned = account.holdings[symbol] || 0;
    const costBasis = account.costBasis[symbol] || 0;
    const quote = market.prices[symbol];
    // Size has a price. The fill slips against you and the tape moves for
    // everyone, so a big order costs real ground and smaller players can react
    // to the wave it leaves behind.
    const impact = Math.min(0.08, 0.0006 + quantity * 0.0007);
    const direction = action === "buy" ? 1 : -1;
    const execution = Math.max(0.01, roundMoney(quote * (1 + (direction * impact) / 2)));
    const tapePrice = Math.max(1, roundMoney(quote * (1 + direction * impact)));
    const total = execution * quantity;

    if (action === "buy") {
      if (account.cash < total) throw new Error("Not enough cash");
      account.cash = roundMoney(account.cash - total);
      account.holdings[symbol] = owned + quantity;
      account.costBasis[symbol] = roundMoney(costBasis + total);
    } else {
      if (owned < quantity) throw new Error("Not enough shares");
      account.cash = roundMoney(account.cash + total);
      account.holdings[symbol] = owned - quantity;
      const averageCost = owned > 0 ? costBasis / owned : 0;
      account.costBasis[symbol] = roundMoney(Math.max(0, costBasis - averageCost * quantity));
      account.realizedProfit = roundMoney(account.realizedProfit + total - averageCost * quantity);
    }

    const flow = (market.orderFlow?.[symbol] || 0) + (action === "buy" ? quantity : -quantity);
    const tradedAt = Date.now();
    const nextMarket: MarketState = {
      ...market,
      // A fill is a market event too: it moves updatedAt so every client can
      // place the trade on the tape without waiting for the next alarm.
      updatedAt: tradedAt,
      prices: { ...market.prices, [symbol]: tapePrice },
      // The chart gets the trade as a real live point instead of waiting for
      // the next alarm, which is what makes a fill feel like it hit the tape.
      history: {
        ...market.history,
        [symbol]: appendHistory(market.history[symbol], tradedAt, tapePrice),
      },
      daily: {
        ...market.daily,
        high: { ...market.daily.high, [symbol]: Math.max(market.daily.high[symbol], tapePrice) },
        low: { ...market.daily.low, [symbol]: Math.min(market.daily.low[symbol], tapePrice) },
      },
      orderFlow: { ...market.orderFlow, [symbol]: Math.max(-100, Math.min(100, flow)) },
    };
    if (activeRun) {
      activeRun.tradeCount += 1;
      activeRun.updatedAt = tradedAt;
      await this.ctx.storage.put(`run:${playerId}`, activeRun);
    } else {
      await this.ctx.storage.put(`player:${playerId}`, player);
    }
    await this.ctx.storage.put("market", nextMarket);
    this.broadcast(nextMarket);
    return {
      player: {
        name: player.name,
        cash: account.cash,
        holdings: account.holdings,
        costBasis: account.costBasis,
        realizedProfit: account.realizedProfit,
      },
      price: execution,
      marketPrice: tapePrice,
      impact,
      ticker: symbol,
      action,
      quantity,
    };
  }

  // Live updates carry prices, not the whole record. History only rides along on
  // the opening snapshot, which keeps every tick message small no matter how
  // much history the chart is holding.
  private broadcast(market: MarketState) {
    const { history, ...live } = market;
    const message = JSON.stringify({ type: "market_update", ...live });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Market connection failed");
      }
    }
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function randomMarketEvent(now: number): MarketEvent {
  if (Math.random() < 0.3) {
    const boom = Math.random() > 0.5;
    return boom
      ? {
          headline: "MARKET BOOM — traders are piling in!",
          detail: "Broad buying pressure is lifting every ticker.",
          kind: "boom",
          effect: 0.08,
          expiresAt: now + TICK_MS,
          scope: "market",
        }
      : {
          headline: "FLASH CRASH — panic selling detected!",
          detail: "A broad sell-off is hitting the entire board.",
          kind: "crash",
          effect: -0.08,
          expiresAt: now + TICK_MS,
          scope: "market",
        };
  }

  const personalityEvent = companyEvents[Math.floor(Math.random() * companyEvents.length)];
  return { ...personalityEvent, expiresAt: now + TICK_MS };
}

const companyEvents: Array<Omit<MarketEvent, "expiresAt">> = [
  { ticker: "MTA", scope: "company", kind: "boom", effect: 0.11, headline: "MOON TACO GOES INTERSTELLAR", detail: "Its limited Meteor Melt taco sold out before lunch." },
  { ticker: "MTA", scope: "company", kind: "crash", effect: -0.1, headline: "MOON TACO SAUCE SPILL", detail: "A neon queso leak closed three locations for cleanup." },
  { ticker: "PXP", scope: "company", kind: "boom", effect: 0.14, headline: "PIXELPETS GOES VIRAL", detail: "A rare virtual pet is all over the school feed." },
  { ticker: "PXP", scope: "company", kind: "crash", effect: -0.13, headline: "PIXELPETS SERVER NAP", detail: "Players cannot feed their pets after an update outage." },
  { ticker: "RMP", scope: "company", kind: "boom", effect: 0.09, headline: "ROBOMOP NAILS THE DEMO", detail: "Its new mop cleaned the gym floor during halftime." },
  { ticker: "RMP", scope: "company", kind: "crash", effect: -0.08, headline: "ROBOMOP ESCAPES STUDY HALL", detail: "A demo unit rolled away and soaked the library carpet." },
  { ticker: "CLD", scope: "company", kind: "boom", effect: 0.16, headline: "CLOUDY SODA GETS THE COOL KID", detail: "A viral cafeteria review calls the new flavor legendary." },
  { ticker: "CLD", scope: "company", kind: "crash", effect: -0.15, headline: "CLOUDY SODA MYSTERY FLAVOR", detail: "Nobody can identify the new purple-ish fizz. Sales wobble." },
];

function eventEffectFor(event: MarketEvent | null, ticker: keyof Prices) {
  if (!event) return 0;
  return event.scope === "market" || event.ticker === ticker ? event.effect : 0;
}

function movePriceWithPressure(price: number, ticker: keyof Prices, flow: number, sentiment = 0, eventEffect = 0) {
  const randomMovement = (Math.random() * 2 - 1) * volatility[ticker];
  const cappedPressure = Math.max(-100, Math.min(100, flow));
  const playerInfluence = (cappedPressure / 100) * volatility[ticker] * 0.5;
  const moodInfluence = (sentiment / 100) * 0.02;
  return Math.max(1, Math.round(price * (1 + randomMovement + playerInfluence + moodInfluence + eventEffect) * 100) / 100);
}

const FRONTEND_ORIGIN = "https://veroteknic.github.io";

function sessionToken(request: Request) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map(part => part.trim()).find(part => part.startsWith("pm_session="))?.slice("pm_session=".length) || "";
}

function sessionCookie(token: string) {
  return `pm_session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=2592000`;
}

async function secretsMatch(candidate: string, expected: string) {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected)),
  ]);
  const candidateBytes = new Uint8Array(candidateHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = candidateBytes.length ^ expectedBytes.length;
  for (let index = 0; index < Math.max(candidateBytes.length, expectedBytes.length); index += 1) {
    difference |= (candidateBytes[index] || 0) ^ (expectedBytes[index] || 0);
  }
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/api/market") {
      const market = env.MARKET.getByName("global-school-year-market-v12");
      const state = await market.getMarket();
      return Response.json({ ...state, day: currentDayOfYear() }, { headers: cors });
    }

    if (url.pathname === "/api/market/summary" && request.method === "GET") {
      const market = env.MARKET.getByName("global-school-year-market-v12");
      return Response.json(await market.getDailySummaries(), { headers: cors });
    }

    if (url.pathname === "/api/player" && request.method === "GET") {
      const market = env.MARKET.getByName("global-school-year-market-v12");
      const playerId = await market.playerIdForSession(sessionToken(request));
      if (!playerId) return Response.json({ error: "Not authenticated" }, { status: 401, headers: cors });
      return Response.json(await market.getPlayer(playerId), { headers: cors });
    }

    if (["/api/auth/register", "/api/auth/login"].includes(url.pathname) && request.method === "POST") {
      try {
        const body = await request.json() as { name?: string; password?: string };
        const market = env.MARKET.getByName("global-school-year-market-v12");
        const result = url.pathname.endsWith("/register")
          ? await market.registerAccount(body.name || "", body.password || "")
          : await market.loginAccount(body.name || "", body.password || "");
        return Response.json(result.player, { headers: { ...cors, "Set-Cookie": sessionCookie(result.token) } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not register name" }, { status: 400, headers: cors });
      }
    }

    if (url.pathname.startsWith("/api/run") && ["GET", "POST"].includes(request.method)) {
      const market = env.MARKET.getByName("global-school-year-market-v12");
      const playerId = await market.playerIdForSession(sessionToken(request));
      if (!playerId) return Response.json({ error: "Not authenticated" }, { status: 401, headers: cors });

      if (url.pathname === "/api/run" && request.method === "GET") {
        return Response.json({ run: await market.getRun(playerId), rules: RUN_RULES }, { headers: cors });
      }

      try {
        if (url.pathname === "/api/run/start" && request.method === "POST") {
          const player = await market.getPlayer(playerId);
          return Response.json({ run: await market.startRun(playerId, player.name), rules: RUN_RULES }, { headers: cors });
        }
        if (url.pathname === "/api/run/round/lock" && request.method === "POST") {
          return Response.json({ ...(await market.lockPlayerRun(playerId)), rules: RUN_RULES }, { headers: cors });
        }
        if (url.pathname === "/api/run/round/advance" && request.method === "POST") {
          return Response.json({ run: await market.advancePlayerRun(playerId), rules: RUN_RULES }, { headers: cors });
        }
        if (url.pathname === "/api/run/retire" && request.method === "POST") {
          return Response.json({ run: await market.retirePlayerRun(playerId), rules: RUN_RULES }, { headers: cors });
        }
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Run action rejected" }, { status: 400, headers: cors });
      }
    }

    if (url.pathname === "/api/dev/status" && request.method === "GET") {
      const market = env.MARKET.getByName("global-school-year-market-v12");
      return Response.json({ authorized: await market.isDeveloperSession(sessionToken(request)) }, { headers: cors });
    }

    if (url.pathname === "/api/dev/login" && request.method === "POST") {
      try {
        const token = sessionToken(request);
        const market = env.MARKET.getByName("global-school-year-market-v12");
        if (!(await market.playerIdForSession(token))) return Response.json({ error: "Not authenticated" }, { status: 401, headers: cors });
        const body = await request.json() as { password?: string };
        if (!env.DEV_PASSWORD) return Response.json({ error: "Developer sign-in is not configured on this server" }, { status: 503, headers: cors });
        if (!await secretsMatch(body.password || "", env.DEV_PASSWORD)) return Response.json({ error: "Invalid developer password" }, { status: 403, headers: cors });
        await market.authorizeDeveloperSession(token);
        return Response.json({ authorized: true }, { headers: cors });
      } catch {
        return Response.json({ error: "Developer sign-in failed" }, { status: 400, headers: cors });
      }
    }

    if (url.pathname === "/api/dev/market" && request.method === "POST") {
      try {
        const token = sessionToken(request);
        const body = await request.json() as { action?: string; kind?: string; ticker?: string; sentiment?: number };
        const market = env.MARKET.getByName("global-school-year-market-v12");
        const result = await market.developerMarketControl(token, body.action || "", body);
        return Response.json(result, { headers: cors });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Developer control rejected" }, { status: 403, headers: cors });
      }
    }

    if (url.pathname === "/api/dev/player" && request.method === "POST") {
      try {
        const token = sessionToken(request);
        const body = await request.json() as { action?: string; cash?: number; ticker?: string; quantity?: number; name?: string };
        const market = env.MARKET.getByName("global-school-year-market-v12");
        const player = await market.developerPlayerControl(token, body.action || "", body);
        return Response.json(player, { headers: cors });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Developer control rejected" }, { status: 403, headers: cors });
      }
    }

    if (url.pathname === "/api/dev/run" && request.method === "POST") {
      try {
        const token = sessionToken(request);
        const body = await request.json() as { action?: string };
        const market = env.MARKET.getByName("global-school-year-market-v12");
        return Response.json(await market.developerRunControl(token, body.action || ""), { headers: cors });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Developer control rejected" }, { status: 403, headers: cors });
      }
    }

    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      const market = env.MARKET.getByName("global-school-year-market-v12");
      const state = await market.getMarket();
      return Response.json(await market.getLeaderboard(state), { headers: cors });
    }

    if (url.pathname === "/api/trade" && request.method === "POST") {
      try {
        const body = await request.json() as { ticker?: string; action?: string; quantity?: number };
        const market = env.MARKET.getByName("global-school-year-market-v12");
        const playerId = await market.playerIdForSession(sessionToken(request));
        if (!playerId) return Response.json({ error: "Not authenticated" }, { status: 401, headers: cors });
        const result = await market.trade(playerId, body.ticker || "", body.action || "", body.quantity || 0);
        return Response.json(result, { headers: cors });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Trade rejected" }, { status: 400, headers: cors });
      }
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket connection.", { status: 426 });
      }
      const market = env.MARKET.getByName("global-school-year-market-v12");
      return market.fetch(request);
    }

    return new Response("Pocket Market backend is online!");
  },
} satisfies ExportedHandler<{ MARKET: DurableObjectNamespace<Market>; DEV_PASSWORD: string }>;
