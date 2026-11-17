// Joker catalog and scoring effects for Pocket Market's roguelike layer.
// Pure, dependency-free: testable with `node --test`, ready for the shop layer.
// Visual identity is graphic and minimalist: geometric and financial symbols,
// never cartoon characters or mascots.

export type JokerRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_ORDER: JokerRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

export const RARITY_STYLE: Record<
  JokerRarity,
  { label: string; color: string; border: string }
> = {
  common: { label: "Common", color: "#8a7c6a", border: "#5c5244" },
  uncommon: { label: "Uncommon", color: "#3d7d5a", border: "#2a523c" },
  rare: { label: "Rare", color: "#7d5a3d", border: "#523c2a" },
  epic: { label: "Epic", color: "#7d3d7d", border: "#522a52" },
  legendary: { label: "Legendary", color: "#a87414", border: "#7a5210" },
};

export type JokerTrigger =
  | "always"
  | "bull-market"
  | "bear-market"
  | "diversification"
  | "full-spectrum"
  | "portfolio-width"
  | "rising-holding"
  | "falling-holding"
  | "day-trade"
  | "diamond-hands"
  | "insider"
  | "blue-chip"
  | "penny-stock"
  | "short-squeeze"
  | "compound-interest"
  | "market-analyst"
  | "contrarian";

export type JokerEffectKind = "chips-add" | "mult-add" | "mult";

export interface Joker {
  id: string;
  name: string;
  description: string;
  rarity: JokerRarity;
  trigger: JokerTrigger;
  effectKind: JokerEffectKind;
  value: number;
  max?: number;
  threshold?: number;
  glyph: string;
}

export interface JokerContext {
  startValue: number;
  cashEnd: number;
  holdingsEnd: Record<string, number>;
  pricesStart: Record<string, number>;
  pricesEnd: Record<string, number>;
  tradeCount: number;
  roundIndex: number;
  roundHistory: Array<{
    score: number;
    pass: boolean;
    ante: number;
    round: number;
  }>;
}

export type JokerEffect = {
  kind: JokerEffectKind;
  label: string;
  value: number;
  jokerId: string;
};

const clamp = (v: number, mn: number, mx: number) => Math.min(mx, Math.max(mn, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

// Overall direction of the shared market this round, computed from every ticker.
export function marketDirection(context: JokerContext): "up" | "down" | "flat" {
  const tickers = Object.keys(context.pricesEnd);
  let move = 0;
  for (const t of tickers) {
    const start = context.pricesStart[t] || 0;
    const end = context.pricesEnd[t] || 0;
    if (start > 0) move += (end - start) / start;
  }
  const avg = move / Math.max(1, tickers.length);
  if (avg > 0.005) return "up";
  if (avg < -0.005) return "down";
  return "flat";
}

export function heldTickers(context: JokerContext): string[] {
  return Object.keys(context.holdingsEnd).filter(t => (context.holdingsEnd[t] || 0) > 0);
}

export function risingTickers(context: JokerContext): string[] {
  return heldTickers(context).filter(
    t => (context.pricesEnd[t] || 0) > (context.pricesStart[t] || 0)
  );
}

export function fallingTickers(context: JokerContext): string[] {
  return heldTickers(context).filter(
    t => (context.pricesEnd[t] || 0) < (context.pricesStart[t] || 0)
  );
}

// Approximation of consecutive rounds holding a position. Round history stores
// scored results rather than per-round snapshots, so each completed round counts
// toward the streak. Safe default for read-only preview and Phase 6 acquisition.
export function consecutiveHoldRounds(
  history: JokerContext["roundHistory"],
  roundIndex: number
): number {
  let streak = 0;
  const limit = Math.min(roundIndex, history.length);
  for (let i = limit - 1; i >= 0; i--) {
    if (history[i]) streak += 1;
    else break;
  }
  return streak;
}

export const JOKER_CATALOG: Joker[] = [
  // ---------- Common ----------
  {
    id: "diversification",
    name: "Diversification",
    description: "+25 chips per distinct holding.",
    rarity: "common",
    trigger: "diversification",
    effectKind: "chips-add",
    value: 25,
    glyph: "◇",
  },
  {
    id: "blue-chip",
    name: "Blue Chip",
    description: "+15 chips per established holding ($40+).",
    rarity: "common",
    trigger: "blue-chip",
    effectKind: "chips-add",
    value: 15,
    threshold: 40,
    glyph: "□",
  },
  {
    id: "market-analyst",
    name: "Market Analyst",
    description: "+0.25 mult when holding risers.",
    rarity: "common",
    trigger: "market-analyst",
    effectKind: "mult-add",
    value: 0.25,
    glyph: "⌘",
  },
  {
    id: "day-trader",
    name: "Day Trader",
    description: "+10 chips per trade (max 8).",
    rarity: "common",
    trigger: "day-trade",
    effectKind: "chips-add",
    value: 10,
    max: 8,
    glyph: "↻",
  },
  // ---------- Uncommon ----------
  {
    id: "bull-investor",
    name: "Bull Investor",
    description: "+0.5 mult in a rising market.",
    rarity: "uncommon",
    trigger: "bull-market",
    effectKind: "mult-add",
    value: 0.5,
    glyph: "▲",
  },
  {
    id: "bear-market",
    name: "Bear Market",
    description: "+40 chips in a falling market.",
    rarity: "uncommon",
    trigger: "bear-market",
    effectKind: "chips-add",
    value: 40,
    glyph: "▼",
  },
  {
    id: "contrarian",
    name: "Contrarian",
    description: "+20 chips per holding moving against the market.",
    rarity: "uncommon",
    trigger: "contrarian",
    effectKind: "chips-add",
    value: 20,
    glyph: "↕",
  },
  {
    id: "diamond-hands",
    name: "Diamond Hands",
    description: "+0.3 mult per consecutive round holding.",
    rarity: "uncommon",
    trigger: "diamond-hands",
    effectKind: "mult-add",
    value: 0.3,
    glyph: "◆",
  },
  // ---------- Rare ----------
  {
    id: "penny-stock",
    name: "Penny Stock",
    description: "+0.4 mult per low-priced holding (<$25).",
    rarity: "rare",
    trigger: "penny-stock",
    effectKind: "mult-add",
    value: 0.4,
    threshold: 25,
    glyph: "○",
  },
  {
    id: "insider",
    name: "Insider Knowledge",
    description: "+30 chips per rising holding.",
    rarity: "rare",
    trigger: "insider",
    effectKind: "chips-add",
    value: 30,
    glyph: "◐",
  },
  {
    id: "short-squeeze",
    name: "Short Squeeze",
    description: "×1.6 mult when the market falls but a holding rises.",
    rarity: "rare",
    trigger: "short-squeeze",
    effectKind: "mult",
    value: 1.6,
    glyph: "⚡",
  },
  {
    id: "compound-interest",
    name: "Compound Interest",
    description: "+0.15 mult per completed round.",
    rarity: "rare",
    trigger: "compound-interest",
    effectKind: "mult-add",
    value: 0.15,
    glyph: "↬",
  },
  // ---------- Epic ----------
  {
    id: "bull-market",
    name: "Bull Market",
    description: "×1.4 mult in a rising market.",
    rarity: "epic",
    trigger: "bull-market",
    effectKind: "mult",
    value: 1.4,
    glyph: "⇧",
  },
  {
    id: "bear-market-deep",
    name: "Bear Market Deep",
    description: "+80 chips in a falling market.",
    rarity: "epic",
    trigger: "bear-market",
    effectKind: "chips-add",
    value: 80,
    glyph: "⇩",
  },
  {
    id: "sector-rotation",
    name: "Sector Rotation",
    description: "+0.7 mult when holding all four tickers.",
    rarity: "epic",
    trigger: "full-spectrum",
    effectKind: "mult-add",
    value: 0.7,
    glyph: "⟳",
  },
  {
    id: "earnings-surprise",
    name: "Earnings Surprise",
    description: "+50 chips per rising holding.",
    rarity: "epic",
    trigger: "rising-holding",
    effectKind: "chips-add",
    value: 50,
    glyph: "❖",
  },
  // ---------- Legendary ----------
  {
    id: "market-corner",
    name: "Market Corner",
    description: "+0.7 mult per distinct holding.",
    rarity: "legendary",
    trigger: "portfolio-width",
    effectKind: "mult-add",
    value: 0.7,
    glyph: "▩",
  },
  {
    id: "flash-crash",
    name: "Flash Crash",
    description: "+0.6 mult per falling holding.",
    rarity: "legendary",
    trigger: "falling-holding",
    effectKind: "mult-add",
    value: 0.6,
    glyph: "⇄",
  },
  {
    id: "black-swan",
    name: "Black Swan",
    description: "×1.5 mult.",
    rarity: "legendary",
    trigger: "always",
    effectKind: "mult",
    value: 1.5,
    glyph: "☼",
  },
  {
    id: "tape-reader",
    name: "Tape Reader",
    description: "+0.8 mult per trade (max 8).",
    rarity: "legendary",
    trigger: "day-trade",
    effectKind: "mult-add",
    value: 0.8,
    max: 8,
    glyph: "↷",
  },
] as const;

export function catalogByRarity(): Record<JokerRarity, Joker[]> {
  const out: Record<JokerRarity, Joker[]> = {
    common: [],
    uncommon: [],
    rare: [],
    epic: [],
    legendary: [],
  };
  for (const joker of JOKER_CATALOG) out[joker.rarity].push(joker);
  return out;
}

export function findJoker(id: string): Joker | undefined {
  return JOKER_CATALOG.find(joker => joker.id === id);
}

function chips(label: string, amount: number): JokerEffect {
  return { kind: "chips-add", label, value: round2(amount), jokerId: "" };
}

function multAdd(label: string, amount: number): JokerEffect {
  return { kind: "mult-add", label, value: round2(amount), jokerId: "" };
}

function mult(label: string, factor: number): JokerEffect {
  return { kind: "mult", label, value: round2(factor), jokerId: "" };
}

function computeJokerEffect(joker: Joker, context: JokerContext): JokerEffect | null {
  const { trigger, value, max, threshold } = joker;
  const held = heldTickers(context);
  const rising = risingTickers(context);
  const falling = fallingTickers(context);
  const distinct = held.length;
  const md = marketDirection(context);

  switch (trigger) {
    case "always":
      return joker.effectKind === "mult" ? mult(joker.name, value) : chips(joker.name, value);
    case "bull-market":
      if (md !== "up") return null;
      return joker.effectKind === "mult" ? mult(joker.name, value) : multAdd(joker.name, value);
    case "bear-market":
      if (md !== "down") return null;
      return chips(joker.name, value);
    case "diversification": {
      let amount = value * distinct;
      if (max !== undefined) amount = Math.min(amount, max);
      return chips(`${joker.name} (${distinct} held)`, amount);
    }
    case "full-spectrum":
      if (distinct < 4) return null;
      return multAdd(joker.name, value);
    case "portfolio-width": {
      let amount = value * distinct;
      if (max !== undefined) amount = Math.min(amount, max);
      return multAdd(`${joker.name} (${distinct} held)`, amount);
    }
    case "rising-holding": {
      const amount = value * rising.length;
      return chips(`${joker.name} (${rising.length} rising)`, amount);
    }
    case "falling-holding": {
      const amount = value * falling.length;
      return multAdd(`${joker.name} (${falling.length} falling)`, amount);
    }
    case "day-trade": {
      const count = Math.min(context.tradeCount, max ?? context.tradeCount);
      if (count <= 0) return null;
      return chips(`${joker.name} (${count} trades)`, value * count);
    }
    case "diamond-hands": {
      const streak = consecutiveHoldRounds(context.roundHistory, context.roundIndex);
      if (streak <= 0) return null;
      return multAdd(`${joker.name} (${streak} rounds)`, value * streak);
    }
    case "insider": {
      const amount = value * rising.length;
      return chips(`${joker.name} (${rising.length} rising)`, amount);
    }
    case "blue-chip": {
      const thr = threshold ?? 40;
      const established = held.filter(t => (context.pricesEnd[t] || 0) >= thr).length;
      if (established <= 0) return null;
      return chips(`${joker.name} (${established} established)`, value * established);
    }
    case "penny-stock": {
      const thr = threshold ?? 25;
      const cheap = held.filter(t => (context.pricesEnd[t] || 0) < thr).length;
      if (cheap <= 0) return null;
      return multAdd(`${joker.name} (${cheap} low-priced)`, value * cheap);
    }
    case "short-squeeze":
      if (md !== "down" || rising.length <= 0) return null;
      return mult(joker.name, value);
    case "compound-interest": {
      const rounds = context.roundIndex;
      if (rounds <= 0) return null;
      return multAdd(`${joker.name} (${rounds} rounds)`, value * rounds);
    }
    case "market-analyst":
      if (rising.length <= 0) return null;
      return multAdd(joker.name, value);
    case "contrarian": {
      let opposed = 0;
      for (const t of held) {
        const move = (context.pricesEnd[t] || 0) - (context.pricesStart[t] || 0);
        if (md === "up" && move < 0) opposed += 1;
        else if (md === "down" && move > 0) opposed += 1;
      }
      if (opposed <= 0) return null;
      return chips(`${joker.name} (${opposed} contrarian)`, value * opposed);
    }
  }
  return null;
}

export function applyJokerEffects(
  jokerIds: string[],
  context: JokerContext,
  base: { chips: number; mult: number; score: number; effects: Array<{ kind: string; label: string; value: number }> }
): { chips: number; mult: number; score: number; effects: JokerEffect[] } {
  const effects: JokerEffect[] = base.effects.map((e, index) => ({
    kind: e.kind as JokerEffectKind,
    label: e.label,
    value: e.value,
    jokerId: undefined as unknown as string,
  }));
  let chips = base.chips;
  let mult = base.mult;

  for (const id of jokerIds) {
    const joker = findJoker(id);
    if (!joker) continue;
    const effect = computeJokerEffect(joker, context);
    if (!effect) continue;
    effect.jokerId = joker.id;
    effects.push(effect);
    if (effect.kind === "chips-add") chips += effect.value;
    else if (effect.kind === "mult-add") mult += effect.value;
    else if (effect.kind === "mult") mult *= effect.value;
  }

  mult = round2(Math.max(0.01, mult));
  const score = Math.round(chips * mult);
  return { chips, mult, score, effects };
}

// ---------- Shop ----------

export interface ShopOffer {
  jokerId: string;
  price: number;
}

export interface ShopState {
  currency: number;
  owned: string[];
  offers: ShopOffer[];
  rerolls: number;
}

// Simple 32-bit LCG for deterministic, reproducible shop generation.
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const RARITY_PRICE: Record<JokerRarity, { min: number; max: number }> = {
  common: { min: 20, max: 40 },
  uncommon: { min: 50, max: 80 },
  rare: { min: 100, max: 150 },
  epic: { min: 200, max: 300 },
  legendary: { min: 500, max: 700 },
};

// Starting shop currency is separate from real cash and cannot be cashed out.
export const SHOP_STARTING_CURRENCY = 100;
export const SHOP_OFFER_COUNT = 4;
export const SHOP_REROLL_COST = 15;
export const SHOP_ROUND_REWARD = 30;

function priceFor(joker: Joker, rng: () => number): number {
  const band = RARITY_PRICE[joker.rarity];
  return band.min + Math.floor(rng() * (band.max - band.min + 1));
}

// Generates a deterministic shop offer list from the run seed, ante and round.
// Jokers the player already owns are never re-offered.
export function generateShopOffers(
  seed: number,
  ante: number,
  round: number,
  owned: string[],
  existingOffers: ShopOffer[] | null,
): ShopOffer[] {
  const mix = seed ^ (ante * 7919 + round * 101);
  const rng = lcg(mix);
  const available = JOKER_CATALOG.filter(joker => !owned.includes(joker.id));
  // Shuffle a copy using Fisher-Yates with the deterministic RNG.
  const pool = [...available];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const count = Math.min(SHOP_OFFER_COUNT, pool.length);
  return pool.slice(0, count).map(joker => ({
    jokerId: joker.id,
    price: priceFor(joker, rng),
  }));
}

// Applies a purchase to a shop state. Returns the new state or null if invalid.
export function applyPurchase(
  state: ShopState,
  jokerId: string,
): ShopState | null {
  const offer = state.offers.find(o => o.jokerId === jokerId);
  if (!offer) return null;
  if (state.owned.includes(jokerId)) return null;
  if (state.currency < offer.price) return null;
  const joker = findJoker(jokerId);
  if (!joker) return null;
  return {
    currency: state.currency - offer.price,
    owned: [...state.owned, jokerId],
    offers: state.offers.filter(o => o.jokerId !== jokerId),
    rerolls: state.rerolls,
  };
}

// Applies a reroll to a shop state. Returns the new state or null if invalid.
export function applyReroll(
  state: ShopState,
  seed: number,
  ante: number,
  round: number,
): ShopState | null {
  if (state.currency < SHOP_REROLL_COST) return null;
  const offers = generateShopOffers(seed, ante, round, state.owned, state.offers);
  return {
    currency: state.currency - SHOP_REROLL_COST,
    owned: state.owned,
    offers,
    rerolls: state.rerolls + 1,
  };
}

