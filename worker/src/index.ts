import { DurableObject } from "cloudflare:workers";

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
type LeaderEntry = { name: string; score: number; rank: number; rankChange: number };
type MarketEvent = { headline: string; kind: "boom" | "crash"; effect: number; expiresAt: number };
type MarketState = { day: number; tick: number; updatedAt: number; prices: Prices; history: History; orderFlow: Partial<Record<keyof Prices, number>>; sentiment: number; event: MarketEvent | null };

function makeHistory(prices: Prices, days: number): History {
  return {
    MTA: [{ time: days, price: prices.MTA }],
    PXP: [{ time: days, price: prices.PXP }],
    RMP: [{ time: days, price: prices.RMP }],
    CLD: [{ time: days, price: prices.CLD }],
  };
}

function currentDayOfYear() {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const elapsedDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.min(MAX_DAYS, elapsedDays + 1));
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
      market = { day, tick: 0, updatedAt: Date.now(), prices: startingPrices, history: makeHistory(startingPrices, day), orderFlow: {}, sentiment: 0, event: null };
      await this.ctx.storage.put("market", market);
    } else if (!Number.isFinite(market.tick) || !Number.isFinite(market.updatedAt) || !market.history || !market.orderFlow || !Number.isFinite(market.sentiment)) {
      // Upgrade state created by the first version of the prototype.
      market = {
        ...market,
        tick: Number.isFinite(market.tick) ? market.tick : 0,
        updatedAt: Number.isFinite(market.updatedAt) ? market.updatedAt : Date.now(),
        history: market.history || makeHistory(market.prices, currentDayOfYear()),
        orderFlow: market.orderFlow || {},
        sentiment: Number.isFinite(market.sentiment) ? market.sentiment : 0,
        event: market.event || null,
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
    if (!event && Math.random() < 0.04) event = randomMarketEvent(updatedAt);
    const flow = Object.values(market.orderFlow || {}).reduce((sum, value) => sum + (value || 0), 0);
    const sentiment = Math.max(-100, Math.min(100, (market.sentiment || 0) * 0.96 + flow * 0.12 + (Math.random() * 6 - 3)));
    const eventEffect = event?.effect || 0;
    const prices = {
      MTA: movePriceWithPressure(market.prices.MTA, "MTA", market.orderFlow?.MTA || 0, sentiment, eventEffect),
      PXP: movePriceWithPressure(market.prices.PXP, "PXP", market.orderFlow?.PXP || 0, sentiment, eventEffect),
      RMP: movePriceWithPressure(market.prices.RMP, "RMP", market.orderFlow?.RMP || 0, sentiment, eventEffect),
      CLD: movePriceWithPressure(market.prices.CLD, "CLD", market.orderFlow?.CLD || 0, sentiment, eventEffect),
    };
    const history = { ...market.history };
    (Object.keys(prices) as Array<keyof Prices>).forEach(ticker => {
      const points = [...history[ticker]];
      // Keep genuine live ticks only; no synthetic backfill.
      points.push({ time: updatedAt, price: prices[ticker] });
      history[ticker] = points.slice(-365);
    });
    const nextMarket = {
      ...market,
      tick: nextTick,
      updatedAt,
      prices,
      orderFlow: {},
      history,
      sentiment,
      event,
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

  async getLeaderboard(market: MarketState): Promise<LeaderEntry[]> {
    const players = await this.ctx.storage.list<PlayerState>({ prefix: "player:" });
    const entries: Array<{ name: string; score: number }> = [];
    for (const [key, player] of players) {
      const score = Math.round(player.cash + Object.entries(player.holdings).reduce((total, [ticker, shares]) => total + (market.prices[ticker as keyof Prices] * (shares || 0)), 0));
      entries.push({ name: player.name || "Anonymous", score });
    }
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, 10).map((entry, index) => ({
      name: entry.name,
      score: entry.score,
      rank: index + 1,
      // Rank movement is intentionally omitted from storage-heavy updates.
      rankChange: 0,
    }));
  }

  async trade(playerId: string, playerName: string, ticker: string, action: string, quantity: number) {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(playerId)) throw new Error("Invalid player ID");
    if (!(ticker in startingPrices) || !["buy", "sell"].includes(action)) throw new Error("Invalid trade");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("Invalid quantity");

    const symbol = ticker as keyof Prices;
    const market = await this.getMarket();
    const player = await this.getPlayer(playerId);
    if (typeof playerName === "string" && playerName.trim()) player.name = playerName.trim().slice(0, 16);
    const owned = player.holdings[symbol] || 0;
    const costBasis = player.costBasis[symbol] || 0;
    const total = market.prices[symbol] * quantity;

    if (action === "buy") {
      if (player.cash < total) throw new Error("Not enough cash");
      player.cash -= total;
      player.holdings[symbol] = owned + quantity;
      player.costBasis[symbol] = roundMoney(costBasis + total);
    } else {
      if (owned < quantity) throw new Error("Not enough shares");
      player.cash += total;
      player.holdings[symbol] = owned - quantity;
      const averageCost = owned > 0 ? costBasis / owned : 0;
      player.costBasis[symbol] = roundMoney(Math.max(0, costBasis - averageCost * quantity));
      player.realizedProfit = roundMoney(player.realizedProfit + total - averageCost * quantity);
    }

    const flow = (market.orderFlow?.[symbol] || 0) + (action === "buy" ? quantity : -quantity);
    const nextMarket = { ...market, orderFlow: { ...market.orderFlow, [symbol]: Math.max(-100, Math.min(100, flow)) } };
    await this.ctx.storage.put(`player:${playerId}`, player);
    await this.ctx.storage.put("market", nextMarket);
    return { player, price: market.prices[symbol], ticker: symbol, action, quantity };
  }

  private broadcast(market: MarketState) {
    const message = JSON.stringify({ type: "market_update", ...market });
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
  const boom = Math.random() > 0.5;
  return boom
    ? { headline: "MARKET BOOM — traders are piling in!", kind: "boom", effect: 0.08, expiresAt: now + 15000 }
    : { headline: "FLASH CRASH — panic selling detected!", kind: "crash", effect: -0.08, expiresAt: now + 15000 };
}

function movePriceWithPressure(price: number, ticker: keyof Prices, flow: number, sentiment = 0, eventEffect = 0) {
  const randomMovement = (Math.random() * 2 - 1) * volatility[ticker];
  const cappedPressure = Math.max(-100, Math.min(100, flow));
  const playerInfluence = (cappedPressure / 100) * volatility[ticker] * 0.5;
  const moodInfluence = (sentiment / 100) * 0.02;
  return Math.max(1, Math.round(price * (1 + randomMovement + playerInfluence + moodInfluence + eventEffect) * 100) / 100);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/api/market") {
      const market = env.MARKET.getByName("global-school-year-market-v11");
      const state = await market.getMarket();
      return Response.json({ ...state, day: currentDayOfYear() }, { headers: cors });
    }

    if (url.pathname === "/api/player" && request.method === "GET") {
      const playerId = url.searchParams.get("playerId") || "";
      const market = env.MARKET.getByName("global-school-year-market-v11");
      return Response.json(await market.getPlayer(playerId), { headers: cors });
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      try {
        const body = await request.json() as { playerId?: string; name?: string };
        const market = env.MARKET.getByName("global-school-year-market-v11");
        const player = await market.registerPlayer(body.playerId || "", body.name || "");
        return Response.json(player, { headers: cors });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not register name" }, { status: 400, headers: cors });
      }
    }

    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      const market = env.MARKET.getByName("global-school-year-market-v11");
      const state = await market.getMarket();
      return Response.json(await market.getLeaderboard(state), { headers: cors });
    }

    if (url.pathname === "/api/trade" && request.method === "POST") {
      try {
        const body = await request.json() as { playerId?: string; playerName?: string; ticker?: string; action?: string; quantity?: number };
        const market = env.MARKET.getByName("global-school-year-market-v11");
        const result = await market.trade(body.playerId || "", body.playerName || "Anonymous", body.ticker || "", body.action || "", body.quantity || 0);
        return Response.json(result, { headers: cors });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Trade rejected" }, { status: 400, headers: cors });
      }
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket connection.", { status: 426 });
      }
      const market = env.MARKET.getByName("global-school-year-market-v11");
      return market.fetch(request);
    }

    return new Response("Pocket Market backend is online!");
  },
} satisfies ExportedHandler<{ MARKET: DurableObjectNamespace<Market> }>;
