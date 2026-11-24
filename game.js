const STARTING_CASH = 10000;
const MAX_DAYS = 365;
const TICK_MS = 15000;
const VERSION = "2026-11-25.7";
const BACKEND_WS_URL = "wss://pocket-market-worker.unpaidandpoor.workers.dev/ws";
const BACKEND_HTTP_URL = "https://pocket-market-worker.unpaidandpoor.workers.dev";
const savedPlayerName = localStorage.getItem("pocket-market-player-name");
const getPlayerName = () => localStorage.getItem("pocket-market-player-name") || "Anonymous";
const isDeveloper = () => ["veroteknik", "veroteknic"].includes(getPlayerName().toLowerCase());
const RUN_RULES_FALLBACK = { antes: 8, roundsPerAnte: 3, startingCash: 10000 };
const SCREEN_NAMES = ["menu", "run-setup", "round-intro", "floor", "portfolio", "jokers", "score", "ante-complete", "boss", "results", "run-victory", "run-failure", "run-stats", "collection", "shop"];

// IMMEDIATELY hide the identity gate and show the menu, before any JS can fail.
// This runs as soon as the DOM is ready, ensuring the page is never stuck on a
// black gate even if something else in game.js throws.
(function() {
  const gate = document.getElementById("identity-gate");
  const menu = document.getElementById("screen-menu");
  if (gate) gate.hidden = true;
  if (menu) menu.hidden = false;
  document.querySelectorAll(".screen").forEach(s => {
    if (s.id !== "screen-menu") s.hidden = true;
  });
  document.body.dataset.screen = "menu";
})();
let runRules = { ...RUN_RULES_FALLBACK };
let runState = null;
let lastRoundResult = null;
let floorMode = "classic";
let activeScreen = "menu";
let transitioning = false;
let runBusy = false;
let scoreAnimationToken = 0;
let scoreRenderKey = "";
let numberAnimGeneration = 0;
const numberAnimTokens = new WeakMap();
let jokerCatalog = null;
let shopState = null;
let pendingMarketEvent = null;
let proceedToFloorAfterBoss = false;

// Client-side boss catalog so boss info survives reloads without depending on
// in-memory state from a previous page visit. Keys match the server-side
// BOSS_ROUNDS ante order in worker/src/run.ts.
const BOSS_INFO = {
  1: { name: "The Diversification Demand", detail: "Hold at least 2 distinct companies or chips are halved." },
  2: { name: "The Concentration Penalty", detail: "One dominant holding above 35% of portfolio chips your score." },
  3: { name: "The Multiplier Ceiling", detail: "Multiplier cannot exceed 1.4 this round." },
  4: { name: "The Sector Blind", detail: "One sector generates no chips this round." },
  5: { name: "The Volatility Wall", detail: "Round target is raised by 40%." },
  6: { name: "The Breadth Requirement", detail: "Hold all four companies or you earn no holdings/rising bonuses." },
  7: { name: "The Quiet Tape", detail: "Rising holdings earn half their usual bonus." },
  8: { name: "The Iron Cap", detail: "Final score cannot exceed 10% above the target." },
};

function bossForAnteClient(ante) {
  return BOSS_INFO[ante] || null;
}

function updateDevConsole(data) {
  if (!isDeveloper()) return;
  $("dev-console").hidden = false;
  $("dev-day").textContent = `${data.day ?? "—"} / 365`;
  $("dev-tick").textContent = data.tick ?? "—";
  $("dev-sentiment").textContent = data.sentiment == null ? "—" : Math.round(data.sentiment);
  $("dev-event").textContent = data.event?.headline || "None";
  $("dev-output").textContent = JSON.stringify({
    connected: true,
    day: data.day,
    tick: data.tick,
    sentiment: data.sentiment,
    event: data.event,
    prices: data.prices
  }, null, 2);
}

const companies = [
  { name: "Moon Taco", ticker: "MTA", price: 42, shares: 0, volatility: 0.18 },
  { name: "PixelPets", ticker: "PXP", price: 18, shares: 0, volatility: 0.25 },
  { name: "RoboMop", ticker: "RMP", price: 67, shares: 0, volatility: 0.12 },
  { name: "Cloudy Soda", ticker: "CLD", price: 10, shares: 0, volatility: 0.20 }
];

let state;
let marketHistory = {};
const savedChartRange = localStorage.getItem("pocket-market-chart-range");
let chartRange = ["day", "week", "all"].includes(savedChartRange) ? savedChartRange : "day";
let pendingTrade = null;
let filledMarker = { ticker: "", until: 0 };
let fillMarkerCleanup = 0;
let lastEventKey = "";
let playerStats = { costBasis: {}, realizedProfit: 0 };
const hudValues = new Map();
const hudFrames = new Map();
const $ = (id) => document.getElementById(id);
const money = (value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// CRT overlay switch. Stored on the body so the whole tube can be toggled
// without touching layout; the choice survives reloads.
function applyCrt(enabled, persist = true) {
  document.body.dataset.crt = enabled ? "on" : "off";
  $("dev-crt").textContent = `CRT: ${enabled ? "on" : "off"}`;
  if (persist) localStorage.setItem("pocket-market-crt", enabled ? "on" : "off");
}
applyCrt(localStorage.getItem("pocket-market-crt") !== "off", false);
$("dev-crt").addEventListener("click", () => applyCrt(document.body.dataset.crt === "off"));

// Three-tier screenshake. Magnitude scales with the impulse, and the shake
// targets the affected element only — never the whole screen. Skipped when
// the OS asks for reduced motion.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let shakeCleanup = 0;
let shakeTarget = null;
function shake(target, intensity = "sm") {
  if (reducedMotion.matches) return;
  const el = target || document.querySelector("main");
  if (shakeTarget && shakeTarget !== el) shakeTarget.classList.remove("shake-sm", "shake-md", "shake-lg");
  shakeTarget = el;
  el.classList.remove("shake-sm", "shake-md", "shake-lg");
  void el.offsetWidth;
  el.classList.add(`shake-${intensity}`);
  clearTimeout(shakeCleanup);
  shakeCleanup = setTimeout(() => {
    el.classList.remove("shake-sm", "shake-md", "shake-lg");
    if (shakeTarget === el) shakeTarget = null;
  }, 400);
}

// Global update dialog: shows the latest changelog when the shipped version
// changes. Quickly dismissable; remembers the acknowledged version in localStorage.
let seenVersion = localStorage.getItem("pocket-market-seen-version");
let updateDialogShown = false;

function showUpdateDialog() {
  if (updateDialogShown || seenVersion === VERSION) return;
  const dialog = $("update-dialog");
  if (!dialog) return;
  updateDialogShown = true;
  dialog.hidden = false;
}

function dismissUpdateDialog() {
  const dialog = $("update-dialog");
  if (dialog) dialog.hidden = true;
  localStorage.setItem("pocket-market-seen-version", VERSION);
  seenVersion = VERSION;
  updateDialogShown = false;
}

// One-shot event punctuation: a short chromatic bloom on the news panel and on
// the affected company row. The animation is cleared on a timer rather than
// animationend so background tabs still return to a clean state.
let punctuationCleanup = 0;
function punctuate(event) {
  if (reducedMotion.matches) return;
  const targets = [$("featured-news")];
  if (event.ticker) {
    const row = document.querySelector(`#market tr[data-ticker="${event.ticker}"]`);
    if (row) targets.push(row);
  }
  targets.forEach(target => {
    target.classList.remove("event-flash");
    target.dataset.flash = event.kind;
    void target.offsetWidth;
    target.classList.add("event-flash");
  });
  clearTimeout(punctuationCleanup);
  punctuationCleanup = setTimeout(() => {
    targets.forEach(target => target.classList.remove("event-flash"));
  }, 520);
}

// Every button pokes back on pointer down, plus keyboard activation (which
// arrives as a click with detail 0).
function tap(button) {
  if (reducedMotion.matches) return;
  button.classList.remove("tap");
  void button.offsetWidth;
  button.classList.add("tap");
  setTimeout(() => button.classList.remove("tap"), 260);
}
document.addEventListener("pointerdown", event => {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (button && !button.disabled) tap(button);
});
document.addEventListener("click", event => {
  if (event.detail !== 0) return;
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (button && !button.disabled) tap(button);
});

// Short synthesized cues through the Web Audio API. No audio files, and the
// context is unlocked by the first real gesture, as autoplay rules require.
const sound = {
  enabled: localStorage.getItem("pocket-market-sound") !== "off",
  context: null,
};

function audioContext() {
  if (!sound.context) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    sound.context = new AudioCtor();
  }
  if (sound.context.state === "suspended") sound.context.resume();
  return sound.context;
}

// Safari only treats audio as unlocked after a buffer has played during a
// gesture. A one-sample buffer is inaudible and satisfies that requirement.
function unlockAudio() {
  if (!sound.enabled) return;
  const context = audioContext();
  if (!context) return;
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(context.destination);
  source.start(0);
}

function tone(frequency, { end = frequency, duration = 0.12, type = "triangle", gain = 0.12, delay = 0 } = {}) {
  if (!sound.enabled) return;
  const context = audioContext();
  if (!context) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const amp = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  // Exponential ramps cannot reach zero, so both ends sit just above silence.
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(amp).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function cue(name) {
  if (!sound.enabled || document.hidden) return;
  if (name === "buy") {
    tone(440, { end: 660, duration: 0.13, gain: 0.13 });
    tone(880, { duration: 0.11, gain: 0.1, delay: 0.08 });
  } else if (name === "reroll") {
    tone(220, { end: 330, duration: 0.07, type: "square", gain: 0.06 });
    tone(330, { end: 220, duration: 0.07, type: "square", gain: 0.06, delay: 0.06 });
    tone(494, { duration: 0.12, gain: 0.09, delay: 0.12 });
  } else if (name === "epic") {
    [659, 880, 1108, 1319].forEach((frequency, index) => tone(frequency, { duration: 0.17, gain: 0.09, delay: index * 0.06 }));
  } else if (name === "sell") {
    tone(560, { end: 300, duration: 0.16, gain: 0.12 });
  } else if (name === "boom") {
    [523, 659, 784].forEach((frequency, index) => tone(frequency, { duration: 0.16, gain: 0.1, delay: index * 0.075 }));
  } else if (name === "crash") {
    [392, 311, 233].forEach((frequency, index) => tone(frequency, { duration: 0.18, type: "sawtooth", gain: 0.09, delay: index * 0.08 }));
  } else if (name === "reject") {
    tone(150, { end: 105, duration: 0.18, type: "square", gain: 0.09 });
  } else if (name === "fill") {
    // A fat order gets a low thud under the regular trade cue.
    tone(170, { end: 118, duration: 0.17, type: "square", gain: 0.08 });
    tone(520, { end: 380, duration: 0.05, gain: 0.06, delay: 0.01 });
  } else if (name === "tick") {
    tone(760, { duration: 0.05, gain: 0.05 });
  } else if (name === "score") {
    [523, 659, 784, 1046].forEach((frequency, index) => tone(frequency, { duration: 0.18, gain: 0.08, delay: index * 0.07 }));
  } else if (name === "joker") {
    [659, 988, 1319].forEach((frequency, index) => tone(frequency, { duration: 0.15, gain: 0.1, delay: index * 0.06 }));
  } else if (name === "chips") {
    tone(280, { end: 520, duration: 0.13, type: "triangle", gain: 0.09 });
  } else if (name === "mult") {
    [523, 784, 1046].forEach((frequency, index) => tone(frequency, { duration: 0.16, gain: 0.1, delay: index * 0.05 }));
  } else if (name === "fail") {
    [330, 262, 196].forEach((frequency, index) => tone(frequency, { duration: 0.2, type: "sawtooth", gain: 0.07, delay: index * 0.09 }));
  }
}

function applySound(enabled, persist = true) {
  sound.enabled = enabled;
  ["sound-toggle", "menu-sound"].forEach(id => {
    const button = $(id);
    if (!button) return;
    button.textContent = `Sound: ${enabled ? "on" : "off"}`;
    button.setAttribute("aria-pressed", String(enabled));
  });
  if (persist) localStorage.setItem("pocket-market-sound", enabled ? "on" : "off");
}
function toggleSound() {
  applySound(!sound.enabled);
  if (sound.enabled) {
    unlockAudio();
    cue("buy");
  }
}
applySound(sound.enabled, false);
["sound-toggle", "menu-sound"].forEach(id => {
  const button = $(id);
  if (button) button.addEventListener("click", toggleSound);
});
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });

function newGame() {
  state = { day: getCurrentDayOfYear(), cash: STARTING_CASH, companies: companies.map(company => ({ ...company })), tick: 0, tickDeadline: 0, finished: false };
  marketHistory = {};
  render();
  renderLeaderboard();
}

function getCurrentDayOfYear() {
  const today = new Date();
  const start = new Date(today.getFullYear(), 0, 1);
  const elapsedDays = Math.floor((today - start) / 86400000);
  return Math.max(1, Math.min(MAX_DAYS, elapsedDays + 1));
}

function portfolioValue() {
  return state.companies.reduce((sum, company) => sum + company.price * company.shares, 0);
}

const isRunTrading = () => Boolean(runState && runState.phase === "trading");

function applyAccount(account) {
  if (!account) return;
  state.cash = Number(account.cash) || 0;
  playerStats.costBasis = account.costBasis || {};
  playerStats.realizedProfit = Number(account.realizedProfit) || 0;
  state.companies.forEach(company => {
    company.shares = account.holdings?.[company.ticker] || 0;
  });
}

function applyRunAccount() {
  if (!runState) return;
  applyAccount({
    cash: runState.cash,
    holdings: runState.holdings,
    costBasis: runState.costBasis,
    realizedProfit: runState.realizedProfit,
  });
}

// A display-only preview of the same chips x mult rules the Worker uses when
// the round is locked. The server remains the only source of a final score.
function previewRoundScore() {
  if (!runState || runState.phase !== "trading") return null;
  const startValue = Math.max(1, Number(runState.roundStartValue) || 1);
  const endValue = state.cash + portfolioValue();
  const roundReturn = (endValue - startValue) / startValue;
  const baseChips = Math.round(Math.min(900, Math.max(0, 100 + 400 * roundReturn)));
  const startPrices = runState.roundStartPrices || {};
  const held = state.companies.filter(company => company.shares > 0);
  const rising = held.filter(company => company.price > (Number(startPrices[company.ticker]) || company.price)).length;
  const chips = baseChips + 25 * held.length + 20 * rising;
  const mult = Math.round((1 + 0.25 * Math.min(4, held.length)) * 100) / 100;
  return { chips, mult, score: Math.round(chips * mult) };
}

// Display-only preview of what each owned Joker would contribute to the
// current round score. Runs in the browser; the server remains authoritative
// for the final locked score. Mirrors the Worker's Joker effect engine.
function marketDirectionClient(pricesEnd, pricesStart) {
  const tickers = Object.keys(pricesEnd);
  let move = 0;
  for (const ticker of tickers) {
    const start = pricesStart[ticker] || 0;
    const end = pricesEnd[ticker] || 0;
    if (start > 0) move += (end - start) / start;
  }
  const avg = move / Math.max(1, tickers.length);
  if (avg > 0.005) return "up";
  if (avg < -0.005) return "down";
  return "flat";
}

function computeJokerPreview(joker, ctx) {
  const { distinct, rising, falling, md, tradeCount, roundIndex, pricesEnd, pricesStart, held } = ctx;
  const { id, effectKind, value, trigger, threshold, max } = joker;
  const multAdd = (label, amount) => ({ kind: "mult-add", label, value: amount });
  const chipsAdd = (label, amount) => ({ kind: "chips-add", label, value: amount });
  const mult = (label, amount) => ({ kind: "mult", label, value: amount });

  switch (trigger) {
    case "always":
      return effectKind === "mult" ? mult(joker.name, value) : chipsAdd(joker.name, value);
    case "bull-market":
      if (md !== "up") return null;
      return effectKind === "mult" ? mult(joker.name, value) : multAdd(joker.name, value);
    case "bear-market":
      if (md !== "down") return null;
      return chipsAdd(joker.name, value);
    case "diversification": {
      let amount = value * distinct;
      if (max !== undefined) amount = Math.min(amount, max);
      return chipsAdd(`${joker.name} (${distinct} held)`, amount);
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
      return chipsAdd(`${joker.name} (${rising.length} rising)`, amount);
    }
    case "falling-holding": {
      const amount = value * falling.length;
      return multAdd(`${joker.name} (${falling.length} falling)`, amount);
    }
    case "day-trade": {
      const count = Math.min(tradeCount, max ?? tradeCount);
      if (count <= 0) return null;
      return chipsAdd(`${joker.name} (${count} trades)`, value * count);
    }
    case "diamond-hands": {
      const history = ctx.roundHistory || [];
      const limit = Math.min(ctx.roundIndex, history.length);
      let streak = 0;
      for (let i = limit - 1; i >= 0; i--) {
        if (history[i]) streak += 1;
        else break;
      }
      if (streak <= 0) return null;
      return multAdd(`${joker.name} (${streak} rounds)`, value * streak);
    }
    case "insider": {
      const amount = value * rising.length;
      return chipsAdd(`${joker.name} (${rising.length} rising)`, amount);
    }
    case "blue-chip": {
      const thr = threshold ?? 40;
      const established = held.filter(t => (pricesEnd[t.ticker] || 0) >= thr).length;
      if (established <= 0) return null;
      return chipsAdd(`${joker.name} (${established} established)`, value * established);
    }
    case "penny-stock": {
      const thr = threshold ?? 25;
      const cheap = held.filter(t => (pricesEnd[t.ticker] || 0) < thr).length;
      if (cheap <= 0) return null;
      return multAdd(`${joker.name} (${cheap} low-priced)`, value * cheap);
    }
    case "short-squeeze":
      if (md !== "down" || rising.length <= 0) return null;
      return mult(joker.name, value);
    case "compound-interest": {
      if (roundIndex <= 0) return null;
      return multAdd(`${joker.name} (${roundIndex} rounds)`, value * roundIndex);
    }
    case "market-analyst":
      if (rising.length <= 0) return null;
      return multAdd(joker.name, value);
    case "contrarian": {
      let opposed = 0;
      for (const t of held) {
        const move = (pricesEnd[t.ticker] || 0) - (pricesStart[t.ticker] || 0);
        if (md === "up" && move < 0) opposed += 1;
        else if (md === "down" && move > 0) opposed += 1;
      }
      if (opposed <= 0) return null;
      return chipsAdd(`${joker.name} (${opposed} contrarian)`, value * opposed);
    }
    default:
      return null;
  }
}

function previewJokerContributions() {
  if (!runState || runState.phase !== "trading") return [];
  const jokerIds = runState.jokers || [];
  if (!jokerIds.length || !jokerCatalog) return [];

  const held = state.companies.filter(c => c.shares > 0);
  const distinct = held.length;
  const startPrices = runState.roundStartPrices || {};
  const pricesEnd = {};
  const pricesStart = {};
  for (const c of state.companies) {
    pricesEnd[c.ticker] = c.price;
    pricesStart[c.ticker] = Number(startPrices[c.ticker]) || 0;
  }
  const rising = held.filter(c => (pricesEnd[c.ticker] || 0) > (pricesStart[c.ticker] || 0));
  const falling = held.filter(c => (pricesEnd[c.ticker] || 0) < (pricesStart[c.ticker] || 0));
  const md = marketDirectionClient(pricesEnd, pricesStart);
  const tradeCount = runState.tradeCount || 0;
  const roundIndex = runState.round || 1;

  const byId = {};
  jokerCatalog.jokers.forEach(j => { byId[j.id] = j; });

  const contributions = [];
  for (const id of jokerIds) {
    const joker = byId[id];
    if (!joker) continue;
    const effect = computeJokerPreview(joker, {
      distinct, rising, falling, md, tradeCount, roundIndex,
      pricesEnd, pricesStart, held,
      roundHistory: runState.roundHistory || [],
    });
    if (effect && Number(effect.value) !== 0) contributions.push({ ...effect, jokerId: id, name: joker.name, rarity: joker.rarity });
  }
  return contributions;
}

function jokerContributionLabel(effect) {
  const value = Number(effect.value) || 0;
  if (effect.kind === "chips-add") return `+${value.toLocaleString()} chips`;
  if (effect.kind === "mult-add") return `+${value}× mult`;
  if (effect.kind === "mult") return `×${value} mult`;
  return `+${value}`;
}

// Paint which owned Jokers are contributing to the live preview. The rail card
// and the contribution chip share the same state, like Jokers lighting up in
// Balatro. Display-only: the locked score always comes from the server.
function renderJokerPreview() {
  const wrap = $("floor-joker-contrib");
  const list = $("floor-joker-list");
  const contributions = previewJokerContributions();
  const byId = new Map(contributions.map(contribution => [contribution.jokerId, contribution]));

  if (list) {
    list.replaceChildren();
    for (const contribution of contributions) {
      const chip = document.createElement("span");
      chip.className = "floor-joker-chip is-active";
      chip.dataset.jokerId = contribution.jokerId;
      chip.dataset.rarity = contribution.rarity;
      chip.title = `${contribution.name} — ${jokerContributionLabel(contribution)}`;
      chip.innerHTML = `<span class="floor-joker-name">${contribution.name}</span><span class="floor-joker-value">${jokerContributionLabel(contribution)}</span>`;
      list.append(chip);
    }
  }
  if (wrap) wrap.hidden = !contributions.length;

  document.querySelectorAll("#market-joker-cards .market-joker-card").forEach(card => {
    const id = card.dataset.jokerId;
    const effect = byId.get(id);
    if (!card.dataset.baseLabel) card.dataset.baseLabel = card.getAttribute("aria-label") || "";
    const base = card.dataset.baseLabel;
    card.classList.toggle("is-contributing", Boolean(effect));
    const oldBadge = card.querySelector(".market-joker-contrib-badge");
    if (oldBadge) oldBadge.remove();
    if (effect) {
      const badge = document.createElement("span");
      badge.className = "market-joker-contrib-badge";
      badge.textContent = jokerContributionLabel(effect);
      card.append(badge);
      card.setAttribute("aria-label", `${base} — contributing ${jokerContributionLabel(effect)}`);
    } else {
      card.setAttribute("aria-label", base);
    }
  });
  return contributions;
}

// A short tactile reaction when a trade makes a Joker newly relevant. The
// card flashes and the existing joker cue plays; no score is recalculated here.
function flashJokerContributions(beforeIds, afterContributions) {
  const added = afterContributions.filter(contribution => !beforeIds.has(contribution.jokerId));
  if (!added.length) return;
  cue("joker");
  if (reducedMotion.matches) return;
  for (const contribution of added) {
    const card = document.querySelector(`#market-joker-cards .market-joker-card[data-joker-id="${contribution.jokerId}"]`);
    if (!card) continue;
    card.classList.remove("joker-fires");
    void card.offsetWidth;
    card.classList.add("joker-fires");
    setTimeout(() => card.classList.remove("joker-fires"), 560);
  }
}

function unrealizedProfit(company) {
  return company.price * company.shares - (playerStats.costBasis[company.ticker] || 0);
}

function totalProfitLoss() {
  return playerStats.realizedProfit + state.companies.reduce((sum, company) => sum + unrealizedProfit(company), 0);
}

function profitMarkup(value) {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  const sign = value > 0 ? "+$" : value < 0 ? "-$" : "$";
  return `<span class="change ${direction}">${sign}${money(Math.abs(value))}</span>`;
}

function priceChange(ticker, currentPrice) {
  const points = marketHistory[ticker] || [];
  if (points.length < 2) return null;
  const previousPrice = points[points.length - 2]?.price;
  if (!Number.isFinite(previousPrice)) return null;
  const amount = currentPrice - previousPrice;
  return {
    amount,
    percent: previousPrice ? (amount / previousPrice) * 100 : 0,
  };
}

function changeMarkup(change) {
  if (!change) return '<span class="change neutral">—</span>';
  const direction = change.amount > 0 ? "up" : change.amount < 0 ? "down" : "neutral";
  const amountSign = change.amount > 0 ? "+$" : change.amount < 0 ? "-$" : "$";
  const percentSign = change.percent > 0 ? "+" : "";
  return `<span class="change ${direction}">${amountSign}${money(Math.abs(change.amount))} (${percentSign}${change.percent.toFixed(2)}%)</span>`;
}

function setDeveloperControls(authorized) {
  $("dev-auth").hidden = authorized;
  $("dev-auth-error").hidden = authorized;
  $("dev-controls").hidden = !authorized;
  if (authorized) {
    $("dev-auth-error").textContent = "";
    $("dev-feedback").textContent = "Developer controls armed.";
  }
}

// Collapsing the drawer releases the layout column it reserves.
function setDevPanelOpen(open) {
  $("dev-console").classList.toggle("collapsed", !open);
  document.body.classList.toggle("dev-open", open);
  $("dev-toggle").textContent = open ? "Hide" : "Open";
  $("dev-toggle").setAttribute("aria-expanded", String(open));
}
$("dev-toggle").addEventListener("click", () => setDevPanelOpen($("dev-console").classList.contains("collapsed")));

async function loadDeveloperAccess() {
  if (!isDeveloper()) return;
  $("dev-console").hidden = false;
  setDevPanelOpen(true);
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/dev/status`, { credentials: "include" });
    const status = await response.json();
    setDeveloperControls(Boolean(response.ok && status.authorized));
  } catch {
    setDeveloperControls(false);
  }
}

async function developerRequest(path, body) {
  const response = await fetch(`${BACKEND_HTTP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Developer control rejected");
  return result;
}

function setRollingMoney(id, target, profit = false) {
  const element = $(id);
  const previous = hudValues.get(id);
  if (!Number.isFinite(previous) || reducedMotion.matches) {
    hudValues.set(id, target);
    element.textContent = profit ? `${target > 0 ? "+$" : target < 0 ? "-$" : "$"}${money(Math.abs(target))}` : money(target);
    if (profit) element.className = target > 0 ? "up" : target < 0 ? "down" : "neutral";
    return;
  }
  if (previous === target) return;

  cancelAnimationFrame(hudFrames.get(id));
  const startedAt = performance.now();
  const duration = Math.min(520, Math.max(220, Math.abs(target - previous) * 1.6));
  element.classList.remove("number-roll");
  void element.offsetWidth;
  element.classList.add("number-roll");

  const update = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    // Ease out like a slot counter settling, without overshooting fake values.
    const eased = 1 - Math.pow(1 - progress, 4);
    const value = previous + (target - previous) * eased;
    element.textContent = profit ? `${value > 0 ? "+$" : value < 0 ? "-$" : "$"}${money(Math.abs(value))}` : money(value);
    if (profit) element.className = `${value > 0 ? "up" : value < 0 ? "down" : "neutral"} number-roll`;
    if (progress < 1) {
      hudFrames.set(id, requestAnimationFrame(update));
    } else {
      hudValues.set(id, target);
      element.classList.remove("number-roll");
      if (profit) element.className = target > 0 ? "up" : target < 0 ? "down" : "neutral";
    }
  };
  hudFrames.set(id, requestAnimationFrame(update));
}

// The chart's selected company is also the highlighted security on the board.
// One source of truth keeps the market directory and the tape in sync.
function applySecuritySelection() {
  const ticker = $("chart-stock")?.value;
  if (!ticker) return;
  document.querySelectorAll("#market tr[data-ticker]").forEach(row => {
    const selected = row.dataset.ticker === ticker;
    row.classList.toggle("is-selected", selected);
    if (selected) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  });
}

function selectSecurity(ticker) {
  const select = $("chart-stock");
  if (!select || !state.companies.some(company => company.ticker === ticker)) return;
  if (select.value !== ticker) {
    select.value = ticker;
    drawChart();
  }
  applySecuritySelection();
}

// Fill feedback lives past a table redraw so a real market tick cannot erase
// the visual consequence of an order that just landed.
function applyFillMarker() {
  if (!filledMarker.ticker || Date.now() >= filledMarker.until) return;
  const row = document.querySelector(`#market tr[data-ticker="${filledMarker.ticker}"]`);
  if (row) row.classList.add("is-filled");
}

function render() {
  $("day").textContent = state.day;
  const portfolio = portfolioValue();
  setRollingMoney("cash", state.cash);
  setRollingMoney("portfolio", portfolio);
  setRollingMoney("total", state.cash + portfolio);
  setRollingMoney("profit-loss", totalProfitLoss(), true);
  $("market").innerHTML = state.companies.map((company, index) => `
    <tr data-ticker="${company.ticker}">
      <td class="company"><span class="company-name">${company.name}</span><span class="ticker">${company.ticker}</span></td>
      <td class="num price" data-label="Price">$${money(company.price)}</td>
      <td class="num" data-label="Change">${changeMarkup(priceChange(company.ticker, company.price))}</td>
      <td class="num" data-label="Owned">${company.shares}</td>
      <td class="num col-detail" data-label="Value">$${money(company.price * company.shares)}</td>
      <td class="num col-detail" data-label="P/L">${profitMarkup(unrealizedProfit(company))}</td>
      <td class="trade">
        <input id="amount-${index}" type="number" min="1" value="1" aria-label="Shares of ${company.name}">
        <button data-action="buy" data-index="${index}" ${pendingTrade ? "disabled" : ""}>Buy</button>
        <button data-action="sell" data-index="${index}" ${pendingTrade ? "disabled" : ""}>Sell</button>
      </td>
    </tr>`).join("");
  applySecuritySelection();
  applyFillMarker();
  drawChart();
  renderRunStrip();
  if (activeScreen === "portfolio") renderPortfolioScreen();
}

// The next repricing is the only timer in the game, so it gets its own strip.
// The deadline is anchored to the arrival of each real tick rather than the
// local clock, and the first frame interpolates from the server's last tick.
function renderTickMeter() {
  const strip = document.querySelector(".tick-strip");
  if (!strip || !state) return;
  const live = state.tickDeadline > 0;
  strip.hidden = !live;
  if (!live) return;
  const left = Math.max(0, state.tickDeadline - Date.now());
  const ratio = Math.min(1, Math.max(0, left / TICK_MS));
  $("tick-fill").style.width = `${ratio * 100}%`;
  $("tick-count").textContent = `${Math.max(0, left / 1000).toFixed(1)}s`;
  strip.classList.toggle("urgent", left <= 3000);
}
setInterval(renderTickMeter, 100);

// Repaints a price cell once per move, including moves caused by another
// player's order landing on the tape between ticks.
function flashPrices(previous) {
  state.companies.forEach((company, index) => {
    const before = previous[index];
    if (typeof before !== "number" || before === company.price) return;
    const cell = document.querySelector(`#market tr[data-ticker="${company.ticker}"] td:nth-child(2)`);
    if (!cell) return;
    cell.classList.remove("price-up", "price-down");
    void cell.offsetWidth;
    cell.classList.add(company.price > before ? "price-up" : "price-down");
  });
}

// Mirrors the server's thinning rule so a long-lived tab never keeps a bigger
// series than the server does. Duplicate frames (a trade echoed back over the
// socket) are ignored.
const HISTORY_RECENT = 720;
function appendPoint(ticker, time, price) {
  const points = marketHistory[ticker] || (marketHistory[ticker] = []);
  const last = points[points.length - 1];
  if (last && (last.time >= time || (last.price === price && time - last.time < 10000))) return;
  points.push({ time, price });
  if (points.length > HISTORY_RECENT * 2) {
    const recent = points.slice(-HISTORY_RECENT);
    const older = points
      .slice(0, points.length - HISTORY_RECENT)
      .filter((_, index) => index % 2 === 0);
    marketHistory[ticker] = [...older, ...recent];
  }
}

// Day resets at UTC midnight to match the server's game day; Week is a trailing
// seven days. Points carrying a day number instead of a timestamp are the old
// seed marker, not real ticks, so they never reach the plot.
function chartPoints(ticker) {
  const points = (marketHistory[ticker] || []).filter(point => point.time > 1e12);
  if (chartRange === "all") return points;
  let cutoff = Date.now() - 7 * 86400000;
  if (chartRange === "day") {
    const now = new Date();
    cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  return points.filter(point => point.time >= cutoff);
}

function setChartRange(range) {
  if (!["day", "week", "all"].includes(range)) return;
  chartRange = range;
  localStorage.setItem("pocket-market-chart-range", range);
  document.querySelectorAll(".chart-tab").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.range === range));
  });
  drawChart();
}

// A range should show that range, not stretch whatever data exists to fill the
// panel. The plot is anchored to the window, so a young record sits at the
// right edge of Week instead of pretending to cover seven days.
function chartWindow(points) {
  const end = Date.now();
  if (chartRange === "week") return { start: end - 7 * 86400000, end };
  if (chartRange === "day") {
    const now = new Date();
    return { start: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), end };
  }
  return { start: points.length ? points[0].time : end, end };
}

function chartAxisLabel(time) {
  if (chartRange === "day") return "00:00 UTC";
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The tab can look inert while the record is younger than the range, so the
// chart states how much it is actually covering.
function chartSpanNote(points) {
  const label = chartRange === "day" ? "Day" : chartRange === "week" ? "Week" : "All";
  if (points.length < 2) return `${label} · ${points.length} point${points.length === 1 ? "" : "s"} · —`;
  const spanMs = points[points.length - 1].time - points[0].time;
  const minutes = spanMs / 60000;
  const span = minutes < 90
    ? `${Math.max(1, Math.round(minutes))}m`
    : spanMs < 48 * 3600000
      ? `${(spanMs / 3600000).toFixed(1)}h`
      : `${(spanMs / 86400000).toFixed(1)}d`;
  return `${label} · ${points.length} points · ${span}`;
}

function drawChart() {
  const canvas = $("price-chart");
  if (!canvas) return;
  const ticker = $("chart-stock").value;
  const points = chartPoints(ticker);
  $("chart-span").textContent = chartSpanNote(points);
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const left = 62;
  const right = 18;
  const top = 24;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#14120e";
  ctx.fillRect(0, 0, width, height);

  ctx.font = "10px Consolas, \"Liberation Mono\", monospace";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#262119";
  ctx.fillStyle = "#a3937a";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (index / 4) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#3a3224";
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, height - bottom);
  ctx.lineTo(width - right, height - bottom);
  ctx.stroke();

  if (points.length < 2) {
    ctx.fillStyle = "#a3937a";
    ctx.textAlign = "center";
    ctx.fillText("No data", left + plotWidth / 2, top + plotHeight / 2);
    ctx.textAlign = "left";
    return;
  }

  const values = points.map(point => point.price);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin || Math.max(rawMax * 0.08, 1);
  const min = Math.max(0, rawMin - rawRange * 0.12);
  const max = rawMax + rawRange * 0.12;
  const range = max - min || 1;
  // Space points by real time against the selected window, not by array
  // position, so a thinned or young record lands where it happened.
  const view = chartWindow(points);
  const span = Math.max(1, view.end - view.start);
  const xFor = point => left + Math.max(0, Math.min(1, (point.time - view.start) / span)) * plotWidth;
  const yFor = price => top + (1 - (price - min) / range) * plotHeight;

  ctx.fillStyle = "#a3937a";
  ctx.textAlign = "right";
  for (let index = 0; index <= 4; index += 1) {
    const value = max - (index / 4) * range;
    const y = top + (index / 4) * plotHeight;
    ctx.fillText(`$${money(value)}`, left - 10, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(chartAxisLabel(view.start), left, height - 12);
  ctx.textAlign = "right";
  ctx.fillText("Now", width - right, height - 12);
  ctx.textAlign = "left";

  const last = points[points.length - 1];
  const first = points[0];
  const trendColor = last.price >= first.price ? "#5fe0a0" : "#ff6b84";
  const line = points.map(point => ({ x: xFor(point), y: yFor(point.price) }));

  ctx.beginPath();
  ctx.moveTo(line[0].x, height - bottom);
  line.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(line[line.length - 1].x, height - bottom);
  ctx.closePath();
  const area = ctx.createLinearGradient(0, top, 0, height - bottom);
  area.addColorStop(0, last.price >= first.price ? "rgba(95, 224, 160, 0.18)" : "rgba(255, 107, 132, 0.16)");
  area.addColorStop(1, "rgba(20, 18, 14, 0)");
  ctx.fillStyle = area;
  ctx.fill();

  ctx.beginPath();
  line.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = trendColor;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  const endpoint = line[line.length - 1];
  ctx.beginPath();
  ctx.arc(endpoint.x, endpoint.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#14120e";
  ctx.fill();
  ctx.strokeStyle = trendColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "left";
}

function setMessage(text) { $("message").textContent = text; }

function renderDailySummary(summary) {
  if (!summary) return;
  const ticker = summary.biggestMover || "MTA";
  const opening = summary.opening?.[ticker];
  const closing = summary.closing?.[ticker];
  const move = Number.isFinite(opening) && Number.isFinite(closing) && opening
    ? ((closing - opening) / opening) * 100
    : 0;
  const low = summary.low?.[ticker];
  const high = summary.high?.[ticker];
  const range = Number.isFinite(low) && Number.isFinite(high) ? ` · $${money(low)}–$${money(high)}` : "";
  const direction = move > 0 ? "up" : move < 0 ? "down" : "neutral";
  $("daily-summary").className = direction;
  $("daily-summary").textContent = `Day ${summary.day} · ${ticker} ${move >= 0 ? "+" : ""}${move.toFixed(1)}%${range}`;
}

async function loadDailySummary() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/market/summary`);
    if (!response.ok) return;
    const summaries = await response.json();
    renderDailySummary(summaries[0]);
  } catch {
    // The live market and game continue normally if a recap is unavailable.
  }
}

async function trade(index, action) {
  if (pendingTrade) return;
  unlockAudio();
  const contributingBefore = new Set(previewJokerContributions().map(contribution => contribution.jokerId));
  const company = state.companies[index];
  const amount = Math.floor(Number($(`amount-${index}`).value));
  if (!Number.isFinite(amount) || amount < 1) {
    cue("reject");
    return setMessage("Whole shares only.");
  }

  pendingTrade = { index, action };
  setMessage(`${action === "buy" ? "Buying" : "Selling"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name}…`);
  render();

  let filledTicker = "";
  let filledHeavy = false;
  const realizedBefore = playerStats.realizedProfit;
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ticker: company.ticker, action, quantity: amount })
    });
    const result = await response.json();
    if (!response.ok) {
      cue("reject");
      return setMessage(result.error || "Trade rejected.");
    }
    state.cash = result.player.cash;
    playerStats.costBasis = result.player.costBasis || {};
    playerStats.realizedProfit = result.player.realizedProfit || 0;
    state.companies.forEach(item => { item.shares = result.player.holdings[item.ticker] || 0; });
    // Keep the local run snapshot in step with the fill so leaving and
    // re-entering the floor does not redraw the pre-trade account.
    if (isRunTrading()) {
      runState.cash = result.player.cash;
      runState.holdings = { ...result.player.holdings };
      runState.costBasis = result.player.costBasis || {};
      runState.realizedProfit = result.player.realizedProfit || 0;
    }
    // Apply the fill to the tape immediately; the broadcast from the server
    // will confirm the same price a moment later.
    if (Number.isFinite(result.marketPrice)) {
      appendPoint(company.ticker, Date.now(), result.marketPrice);
      state.companies[index].price = result.marketPrice;
    }
    const realizedGain = (result.player.realizedProfit || 0) - realizedBefore;
    const heavy = Math.abs(result.impact || 0) >= 0.035 || Math.abs(realizedGain) >= 250;
    cue(action === "buy" ? "buy" : "sell");
    if (heavy) cue("fill");
    filledTicker = company.ticker;
    filledHeavy = heavy;
    const slipped = Number.isFinite(result.marketPrice) && result.marketPrice !== result.price;
    setMessage(`${action === "buy" ? "Bought" : "Sold"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name} at $${money(result.price)}${slipped ? ` · tape moved to $${money(result.marketPrice)}` : ""}.`);
  } catch {
    cue("reject");
    setMessage("No connection.");
  } finally {
    pendingTrade = null;
    render();
    // The fill is a game event: light up the newly held position on the board
    // after the table redraw so the consequence is actually visible.
    document.querySelectorAll("#market tr.is-filled").forEach(row => row.classList.remove("is-filled"));
    clearTimeout(fillMarkerCleanup);
    filledMarker = { ticker: filledTicker, until: filledTicker ? Date.now() + 900 : 0 };
    applyFillMarker();
    if (filledTicker) {
      const filledRow = document.querySelector(`#market tr[data-ticker="${filledTicker}"]`);
      if (filledRow) shake(filledRow, filledHeavy ? "md" : "sm");
      fillMarkerCleanup = setTimeout(() => {
        document.querySelectorAll("#market tr.is-filled").forEach(row => row.classList.remove("is-filled"));
        filledMarker = { ticker: "", until: 0 };
      }, 900);
    }
    flashJokerContributions(contributingBefore, previewJokerContributions());
  }
}

async function loadPlayer() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/player`, { credentials: "include" });
    if (!response.ok) {
      // Not signed in: show the login/register form. The gate is hidden briefly
      // on boot so a failed auth request can never leave a permanent black screen.
      if (savedPlayerName) {
        $("name-input").value = savedPlayerName;
        authMode = "login";
        $("auth-title").textContent = "Log in";
        $("auth-submit").textContent = "Log in";
        $("auth-toggle").textContent = "Create an account";
        $("password-input").autocomplete = "current-password";
      }
      await loadRunState();
      renderMenu();
      $("identity-gate").hidden = false;
      return;
    }
    const player = await response.json();
    localStorage.setItem("pocket-market-player-name", player.name);
    applyAccount(player);
    await loadJokerCatalog();
    $("identity-gate").hidden = true;
    loadDeveloperAccess();
    await loadRunState();
    await loadShopState();
    if (runState) applyRunAccount();
    renderMenu();
    render();
    renderLeaderboard();
    await routeAfterAuth();
  } catch {
    if (savedPlayerName) $("name-input").value = savedPlayerName;
    renderMenu();
    $("identity-gate").hidden = true;
  }
}

function connectToMarket() {
  const socket = new WebSocket(BACKEND_WS_URL);

  socket.addEventListener("open", () => {
    setMessage("");
  });

  socket.addEventListener("message", event => {
    const update = JSON.parse(event.data);
    if (update.type !== "market_update") return;
    updateDevConsole(update);

    // The backend owns the calendar; the browser only displays it.
    if (typeof update.day === "number") state.day = Math.max(state.day, update.day);
    if (update.history) {
      marketHistory = update.history;
    } else if (update.prices && typeof update.updatedAt === "number") {
      // Live frames omit history to stay small; fold their prices into the
      // local record instead of replacing it.
      Object.entries(update.prices).forEach(([ticker, price]) => {
        if (typeof price === "number") appendPoint(ticker, update.updatedAt, price);
      });
    }
    if (typeof update.sentiment === "number") {
      const mood = update.sentiment > 35 ? "Hype" : update.sentiment < -35 ? "Panic" : "Neutral";
      $("sentiment").textContent = `${mood} (${Math.round(update.sentiment)})`;
    }
    if (update.event) {
      const eventKey = `${update.event.expiresAt}:${update.event.headline}`;
      if (eventKey !== lastEventKey) {
        lastEventKey = eventKey;
        shake($("featured-news"), Math.abs(update.event.effect || 0) >= 0.06 ? "lg" : "md");
        punctuate(update.event);
        cue(update.event.kind === "boom" ? "boom" : "crash");
      }
      $("news-headline").textContent = update.event.headline;
      $("news-detail").textContent = update.event.detail || "";
      $("featured-news").classList.remove("boom", "crash");
      $("featured-news").classList.add(update.event.kind);
    } else {
      $("news-headline").textContent = "—";
      $("news-detail").textContent = "";
      $("featured-news").classList.remove("boom", "crash");
    }

    const previousPrices = state.companies.map(company => company.price);
    const hadLiveState = state.tick > 0;
    if (typeof update.tick === "number") {
      if (!state.tickDeadline) {
        // The first frame is a snapshot: interpolate what is left of the cycle.
        const remaining = Math.max(0, Math.min(TICK_MS, (update.updatedAt || Date.now()) + TICK_MS - Date.now()));
        state.tickDeadline = Date.now() + remaining;
      } else if (update.tick !== state.tick) {
        state.tickDeadline = Date.now() + TICK_MS;
      }
      state.tick = update.tick;
    }

    state.companies.forEach(company => {
      const nextPrice = update.prices[company.ticker];
      if (typeof nextPrice === "number") company.price = nextPrice;
    });

    renderTickMeter();
    if (activeScreen === "floor") {
      render();
      if (hadLiveState) flashPrices(previousPrices);
    }
  });

  socket.addEventListener("error", () => {
    setMessage("Market unavailable.");
  });

  socket.addEventListener("close", () => {
    state.tick = 0;
    state.tickDeadline = 0;
    renderTickMeter();
    if (!state.finished) setMessage("Disconnected.");
  });
}

async function renderLeaderboard() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/leaderboard`, { credentials: "include" });
    const scores = await response.json();
    const list = $("leaderboard");
    list.replaceChildren();
    if (!scores.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "—";
      list.append(empty);
      return;
    }
    scores.forEach((entry, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const player = document.createElement("span");
      player.className = "name";
      player.textContent = entry.name;
      const detail = document.createElement("span");
      detail.className = "score";
      detail.textContent = `$${money(entry.score)}`;
      const movement = document.createElement("span");
      movement.className = `move ${entry.rankChange > 0 ? "up" : entry.rankChange < 0 ? "down" : "neutral"}`;
      movement.textContent = entry.rankChange > 0 ? `▲${entry.rankChange}` : entry.rankChange < 0 ? `▼${Math.abs(entry.rankChange)}` : "—";
      movement.title = entry.rankChange === 0 ? "No rank change" : `${Math.abs(entry.rankChange)} place${Math.abs(entry.rankChange) === 1 ? "" : "s"} ${entry.rankChange > 0 ? "up" : "down"}`;
      item.append(rank, player, detail, movement);
      list.append(item);
    });
  } catch {
    const list = $("leaderboard");
    list.replaceChildren();
    const error = document.createElement("li");
    error.className = "empty";
    error.textContent = "Leaderboard unavailable.";
    list.append(error);
  }
}

/* ---------- Screens and runs ---------- */

const RUN_VIEW_SCREENS = ["floor", "portfolio", "jokers"];

function updateGameTabs(name) {
  document.querySelectorAll("[data-nav-screen]").forEach(button => {
    button.classList.toggle("is-current", button.dataset.navScreen === name);
    button.setAttribute("aria-current", button.dataset.navScreen === name ? "page" : "false");
  });
}

function setScreen(name) {
  activeScreen = name;
  updateGameTabs(name);
  document.querySelectorAll(".screen").forEach(section => {
    const isActive = section.dataset.screen === name;
    section.classList.toggle("is-active", isActive);
    section.classList.remove("is-exiting", "is-entering");
    if (!isActive) section.hidden = true;
  });
  document.body.dataset.screen = name;
  const active = document.querySelector(`[data-screen="${name}"]`);
  if (active) active.hidden = false;
}

function transitionScreen(nextName, opts = {}) {
  return new Promise(resolve => {
    if (transitioning) {
      resolve();
      return;
    }
    const current = document.body.dataset.screen || "menu";
    if (current === nextName) {
      resolve();
      return;
    }
    transitioning = true;
    const activeEl = document.querySelector("[data-screen=\"" + current + "\"]");
    const nextEl = document.querySelector("[data-screen=\"" + nextName + "\"]");
    const dramatic = !!opts.dramatic;
    if (activeEl) {
      activeEl.classList.add("is-exiting");
      if (dramatic) activeEl.classList.add("dramatic");
    }
    if (nextEl) {
      nextEl.hidden = false;
      nextEl.classList.add("is-entering");
      if (dramatic) nextEl.classList.add("dramatic");
    }
    const duration = reducedMotion.matches ? 0 : (dramatic ? 340 : 240);
    setTimeout(() => {
      activeScreen = nextName;
      document.body.dataset.screen = nextName;
      document.querySelectorAll(".screen").forEach(section => {
        section.classList.remove("is-active", "is-exiting", "is-entering", "dramatic");
        section.hidden = section.dataset.screen !== nextName;
      });
      if (nextEl) nextEl.hidden = false;
      transitioning = false;
      if (opts.onEnter) opts.onEnter();
      resolve();
    }, duration);
  });
}

function runRulesFrom(payload) {
  if (!payload?.rules) return;
  runRules = { ...runRules, ...payload.rules };
}

const JOKER_ART_COLORS = {
  common: "#8a7c6a",
  uncommon: "#3d7d5a",
  rare: "#7d9fd0",
  epic: "#a779d0",
  legendary: "#ffca63",
};

function jokerArtwork(joker) {
  const seed = Array.from(joker.id || "").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const variant = seed % 6;
  const color = JOKER_ART_COLORS[joker.rarity] || "#d7a24a";
  const stroke = `stroke="${color}" fill="none" stroke-width="3"`;
  const motifs = [
    `<circle cx="60" cy="60" r="34" ${stroke}/><circle cx="60" cy="60" r="18" ${stroke}/><circle cx="60" cy="60" r="5" fill="${color}"/><path d="M60 8v18M60 94v18M8 60h18M94 60h18" ${stroke}/>`,
    `<path d="M24 84V46m0 0 12-20 12 20v38" ${stroke}/><path d="M56 84V32m0 0 12-16 12 16v52" ${stroke}/><path d="M16 92h88" ${stroke}/>`,
    `<path d="M16 88 44 60l18 14 42-46" ${stroke}/><circle cx="16" cy="88" r="5" fill="${color}"/><circle cx="44" cy="60" r="5" fill="${color}"/><circle cx="62" cy="74" r="5" fill="${color}"/><circle cx="104" cy="28" r="5" fill="${color}"/>`,
    `<path d="M60 12 104 60 60 108 16 60Z" ${stroke}/><path d="M60 34 84 60 60 86 36 60Z" ${stroke}/><path d="M16 60h88M60 12v96" ${stroke} opacity="0.45"/>`,
    `<path d="M16 60h88M16 60l22-26v52Zm88 0L82 34v52Z" ${stroke}/><circle cx="60" cy="60" r="10" fill="${color}"/>`,
    `<path d="M20 92c8-48 28-68 40-68s32 20 40 68" ${stroke}/><path d="M30 92c6-34 18-50 30-50s24 16 30 50" ${stroke} opacity="0.65"/><circle cx="60" cy="24" r="6" fill="${color}"/>`,
  ];
  return `<svg viewBox="0 0 120 120" aria-hidden="true">${motifs[variant]}</svg>`;
}

function jokerArtMarkup(joker, className = "joker-art") {
  return `<span class="${className}">${jokerArtwork(joker)}</span>`;
}

let marketJokerRailKey = "";

// The last scored round is read from server history, so the Market screen can
// show which Jokers fired without recalculating anything in the browser.
function lastScoringJokerEffects() {
  const history = runState?.roundHistory || [];
  const result = history[history.length - 1] || null;
  const fired = new Map();
  if (result) {
    (result.effects || []).forEach(effect => {
      if (!effect?.jokerId) return;
      const amount = Number(effect.value) || 0;
      const unit = effect.kind === "chips" || effect.kind === "chips-add" ? " chips" : " mult";
      const label = `${formatEffectAmount(effect.kind, amount)}${unit}`;
      fired.set(effect.jokerId, fired.has(effect.jokerId) ? `${fired.get(effect.jokerId)} · ${label}` : label);
    });
    if (!fired.size && Array.isArray(result.jokerIds)) {
      result.jokerIds.forEach(id => fired.set(id, "fired"));
    }
  }
  return { fired, result };
}

function renderMarketJokerRail(live) {
  const rail = $("market-joker-rail");
  const cards = $("market-joker-cards");
  if (!rail || !cards) return;
  const owned = live ? (runState?.jokers || []) : [];
  const { fired, result } = lastScoringJokerEffects();
  const firedKey = [...fired].map(([id, label]) => `${id}=${label}`).join(";");
  const key = `${owned.join("|")}:${jokerCatalog?.jokers?.length || 0}:${firedKey}`;
  if (key === marketJokerRailKey) return;
  marketJokerRailKey = key;
  rail.hidden = !owned.length;
  if (!owned.length) {
    cards.replaceChildren();
    return;
  }
  const byId = {};
  (jokerCatalog?.jokers || []).forEach(joker => { byId[joker.id] = joker; });
  cards.replaceChildren();
  owned.forEach(id => {
    const joker = byId[id];
    if (!joker) return;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "market-joker-card";
    card.dataset.jokerId = id;
    card.dataset.rarity = joker.rarity;
    const firedLabel = fired.get(id);
    if (firedLabel) card.classList.add("is-fired");
    card.setAttribute("aria-label", firedLabel
      ? `${joker.name} — fired last round (${firedLabel}) — open jokers`
      : `${joker.name} — open jokers`);
    card.innerHTML = `
      <span class="market-joker-art">${jokerArtwork(joker)}</span>
      <span class="market-joker-name">${joker.name}</span>
    `;
    if (firedLabel) {
      const badge = document.createElement("span");
      badge.className = "market-joker-badge";
      badge.textContent = firedLabel;
      card.append(badge);
    }
    card.addEventListener("click", () => navigate("jokers"));
    cards.append(card);
  });
  if ($("market-joker-count")) $("market-joker-count").textContent = String(cards.children.length);
  const lastLabel = $("market-joker-last");
  if (lastLabel) {
    const showLastRound = Boolean(result && fired.size);
    lastLabel.hidden = !showLastRound;
    lastLabel.textContent = showLastRound ? `Last round · ${fired.size} fired` : "";
  }
}

function renderActiveJokerDetail(joker) {
  const detail = $("active-joker-detail");
  if (!detail || !joker) return;
  detail.hidden = false;
  detail.dataset.rarity = joker.rarity;
  $("active-detail-art").innerHTML = jokerArtwork(joker);
  $("active-detail-rarity").textContent = joker.rarity;
  $("active-detail-name").textContent = joker.name;
  $("active-detail-desc").textContent = joker.description;
  $("active-detail-trigger").textContent = humanizeToken(joker.trigger);
  $("active-detail-effect").textContent = jokerEffectLabel(joker.effectKind);
  $("active-detail-value").textContent = jokerValueLabel(joker);
}

function renderJokersScreen() {
  const grid = $("jokers-grid");
  if (!grid) return false;
  const empty = $("jokers-empty");
  const detail = $("active-joker-detail");
  const owned = runState?.jokers || [];
  if ($("jokers-run-label")) {
    $("jokers-run-label").textContent = runState ? `Ante ${runState.ante} · Round ${runState.round}` : "No active run";
  }
  if ($("jokers-count")) $("jokers-count").textContent = String(owned.length);
  grid.replaceChildren();
  if (!jokerCatalog?.jokers || !owned.length) {
    if (empty) empty.hidden = false;
    if (detail) detail.hidden = true;
    return true;
  }
  if (empty) empty.hidden = true;
  const byId = {};
  jokerCatalog.jokers.forEach(joker => { byId[joker.id] = joker; });
  let first = null;
  owned.forEach((id, index) => {
    const joker = byId[id];
    if (!joker) return;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "active-joker-card joker-card card";
    card.dataset.rarity = joker.rarity;
    card.style.setProperty("--deal-index", String(index));
    card.innerHTML = `
      <span class="joker-art">${jokerArtwork(joker)}</span>
      <h3 class="joker-name">${joker.name}</h3>
      <span class="joker-rarity">${joker.rarity}</span>
      <p class="joker-desc">${joker.description}</p>
      <span class="joker-effect-line">
        <span class="joker-effect-kind">${jokerEffectLabel(joker.effectKind)}</span>
        <strong class="joker-effect-value">${jokerValueLabel(joker)}</strong>
      </span>
    `;
    card.addEventListener("click", () => {
      [...grid.querySelectorAll(".is-selected")].forEach(other => other.classList.remove("is-selected"));
      card.classList.add("is-selected");
      renderActiveJokerDetail(joker);
      cue("tick");
    });
    grid.append(card);
    if (!first) first = joker;
  });
  if (first) {
    grid.firstElementChild.classList.add("is-selected");
    renderActiveJokerDetail(first);
  } else if (detail) {
    detail.hidden = true;
  }
  return true;
}

function renderPortfolioScreen() {
  const container = $("portfolio-holdings");
  if (!container) return false;
  const cash = state.cash;
  const holdingsValue = portfolioValue();
  if ($("portfolio-cash")) $("portfolio-cash").textContent = `$${money(cash)}`;
  if ($("portfolio-holdings-value")) $("portfolio-holdings-value").textContent = `$${money(holdingsValue)}`;
  if ($("portfolio-net")) $("portfolio-net").textContent = `$${money(cash + holdingsValue)}`;
  if ($("portfolio-pl")) $("portfolio-pl").textContent = `${totalProfitLoss() >= 0 ? "+" : "-"}$${money(Math.abs(totalProfitLoss()))}`;
  if ($("portfolio-run-label")) {
    $("portfolio-run-label").textContent = runState ? `Ante ${runState.ante} · Round ${runState.round}` : "Classic board";
  }
  if ($("portfolio-target")) {
    $("portfolio-target").textContent = runState ? `Target ${Number(runState.target).toLocaleString()}` : "—";
  }
  const preview = previewRoundScore();
  if ($("portfolio-preview-chips")) $("portfolio-preview-chips").textContent = preview ? preview.chips.toLocaleString() : "—";
  if ($("portfolio-preview-mult")) $("portfolio-preview-mult").textContent = preview ? `×${preview.mult}` : "—";
  if ($("portfolio-preview-score")) $("portfolio-preview-score").textContent = preview ? preview.score.toLocaleString() : "—";
  if ($("portfolio-lock")) $("portfolio-lock").disabled = runBusy || floorMode !== "run" || !isRunTrading();

  container.replaceChildren();
  const held = state.companies.filter(company => company.shares > 0);
  if (!held.length) {
    if ($("portfolio-empty")) $("portfolio-empty").hidden = false;
    return true;
  }
  if ($("portfolio-empty")) $("portfolio-empty").hidden = true;
  held.forEach(company => {
    const profit = unrealizedProfit(company);
    const direction = profit > 0 ? "up" : profit < 0 ? "down" : "neutral";
    const card = document.createElement("article");
    card.className = "holding-card";
    card.innerHTML = `
      <div class="holding-top"><h3>${company.name}</h3><span>${company.ticker}</span></div>
      <div class="holding-row"><span>Shares</span><strong>${company.shares}</strong></div>
      <div class="holding-row"><span>Price</span><strong>$${money(company.price)}</strong></div>
      <div class="holding-row"><span>Value</span><strong>$${money(company.price * company.shares)}</strong></div>
      <div class="holding-row"><span>Unrealised</span><strong class="${direction}">${profit >= 0 ? "+" : "-"}$${money(Math.abs(profit))}</strong></div>
    `;
    container.append(card);
  });
  return true;
}

function renderRunStrip() {
  const strip = $("run-strip");
  if (!strip) return;
  const live = floorMode === "run" && isRunTrading();
  strip.hidden = !live;
  const hud = $("floor-score-hud");
  if (hud) hud.hidden = !live;
  renderMarketJokerRail(live);
  renderJokerPreview();
  if (!live) return;
  $("run-ante").textContent = `${runState.ante} / ${runRules.antes}`;
  $("run-round").textContent = `${runState.round} / ${runRules.roundsPerAnte}`;
  $("run-target").textContent = Number(runState.target).toLocaleString();
  $("run-score").textContent = Number(runState.scoreTotal || 0).toLocaleString();
  const preview = previewRoundScore();
  $("run-preview").textContent = preview ? preview.score.toLocaleString() : "—";
  $("run-preview-formula").textContent = preview ? `${preview.chips.toLocaleString()} × ${preview.mult}` : "—";
  if ($("floor-preview-chips")) $("floor-preview-chips").textContent = preview ? preview.chips.toLocaleString() : "—";
  if ($("floor-preview-mult")) $("floor-preview-mult").textContent = preview ? `×${preview.mult}` : "—";
  if ($("floor-preview-score")) $("floor-preview-score").textContent = preview ? preview.score.toLocaleString() : "—";
  if ($("floor-preview-target")) $("floor-preview-target").textContent = Number(runState.target).toLocaleString();
  const targetBar = $("floor-preview-bar");
  if (targetBar) {
    const ratio = preview && runState.target > 0 ? preview.score / runState.target : 0;
    targetBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }
  const targetPlaque = $("floor-target-plaque");
  if (targetPlaque) targetPlaque.classList.toggle("is-pass", Boolean(preview && preview.score >= runState.target));
  strip.classList.toggle("pass", Boolean(preview && preview.score >= runState.target));
  $("run-lock").disabled = runBusy;

  const bossEl = $("run-boss");
  const bossNameEl = $("run-boss-name");
  const isBoss = runState.round === runRules.roundsPerAnte;
  const boss = isBoss ? bossForAnteClient(runState.ante) : null;
  if (boss) {
    bossEl.hidden = false;
    bossNameEl.textContent = boss.name;
    bossEl.className = "run-cell boss-cell";
    strip.classList.add("boss-round");
  } else {
    bossEl.hidden = true;
    strip.classList.remove("boss-round");
  }

  const jokersEl = $("run-jokers");
  const jokerCountEl = $("run-joker-count");
  const ownedJokers = runState.jokers || [];
  if (ownedJokers.length) {
    jokersEl.hidden = false;
    jokerCountEl.textContent = ownedJokers.length;
  } else {
    jokersEl.hidden = true;
  }
}

function renderMenu() {
  const summary = $("menu-summary");
  const resultsButton = $("menu-results");
  const classicButton = $("menu-classic");
  const collectionButton = $("menu-collection");
  const shopButton = $("menu-shop");
  const statsButton = $("menu-stats");
  const primary = $("menu-primary");
  const label = $("menu-primary-label");

  summary.hidden = true;
  resultsButton.hidden = true;
  classicButton.hidden = false;
  collectionButton.hidden = false;
  collectionButton.disabled = runBusy;
  shopButton.hidden = !runState;
  shopButton.disabled = runBusy;
  statsButton.hidden = false;
  statsButton.disabled = runBusy;
  primary.disabled = runBusy;

  if (!runState) {
    label.textContent = "Start run";
    primary.dataset.action = "start";
    return;
  }

  if (runState.phase === "trading" || runState.phase === "scoring") {
    summary.hidden = false;
    $("menu-ante").textContent = `${runState.ante} / ${runRules.antes}`;
    $("menu-round").textContent = `${runState.round} / ${runRules.roundsPerAnte}`;
    $("menu-target").textContent = Number(runState.target).toLocaleString();
    $("menu-score").textContent = Number(runState.scoreTotal || 0).toLocaleString();
    classicButton.hidden = true;
    if (runState.phase === "trading") {
      label.textContent = "Continue run";
      primary.dataset.action = "continue";
    } else {
      label.textContent = "View scoring";
      primary.dataset.action = "scoring";
    }
    return;
  }

  label.textContent = "Start new run";
  primary.dataset.action = "start";
  resultsButton.hidden = false;
  classicButton.hidden = false;
}

function currentRoundResult() {
  if (lastRoundResult) return lastRoundResult;
  if (!runState?.roundHistory?.length) return null;
  return runState.roundHistory[runState.roundHistory.length - 1];
}

function formatEffectAmount(kind, value) {
  if (kind === "chips") return Math.round(value).toLocaleString();
  if (kind === "chips-add") return `+${Math.round(value).toLocaleString()}`;
  if (kind === "mult") return `${value.toFixed(2)}×`;
  return `+${value.toFixed(2)}×`;
}

function cancelNumberAnimations() {
  numberAnimGeneration += 1;
}

function animateNumber(element, from, to, format, duration = 420) {
  if (!element) return;
  const generation = numberAnimGeneration;
  const token = (numberAnimTokens.get(element) || 0) + 1;
  numberAnimTokens.set(element, token);
  const current = () => numberAnimGeneration === generation && numberAnimTokens.get(element) === token;
  if (reducedMotion.matches) {
    element.textContent = format(to);
    return;
  }
  const startedAt = performance.now();
  const update = now => {
    if (!current()) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
    else element.textContent = format(to);
  };
  requestAnimationFrame(update);
}

function setScoreVerdict(result, { clear = false, silent = false } = {}) {
  const verdict = $("score-verdict");
  if (clear) {
    verdict.textContent = "";
    verdict.className = "score-verdict";
    return;
  }
  verdict.textContent = result.pass ? "Cleared" : "Missed";
  verdict.className = `score-verdict ${result.pass ? "pass" : "fail"}`;
  if (!silent) cue(result.pass ? "score" : "fail");
}

function setScoreMeter(result) {
  const fill = $("score-meter-fill");
  const ratio = result.target > 0 ? Math.min(1, result.score / result.target) : 1;
  fill.style.width = `${ratio * 100}%`;
  fill.style.background = result.pass ? "var(--green)" : "var(--red)";
}

function revealScoreImmediately(result) {
  cancelNumberAnimations();
  [...$("score-effects").children].forEach(row => {
    row.classList.add("revealed");
    const amount = Number(row.dataset.value);
    row.querySelector(".value").textContent = formatEffectAmount(row.dataset.kind, amount);
  });
  [...$("score-joker-grid").children].forEach(card => card.classList.add("is-activated"));
  $("score-chips").textContent = Number(result.chips).toLocaleString();
  $("score-mult").textContent = `×${Number(result.mult).toFixed(2)}`;
  $("score-final").textContent = Number(result.score).toLocaleString();
  setScoreMeter(result);
  setScoreVerdict(result, { silent: true });
}

function playScoreSequence(result) {
  scoreAnimationToken += 1;
  cancelNumberAnimations();
  const token = scoreAnimationToken;
  const rows = [...$("score-effects").children];
  rows.forEach(row => row.classList.remove("revealed"));
  clearScoreJokers();
  $("score-final").textContent = "0";
  $("score-chips").textContent = "0";
  $("score-mult").textContent = "×1";
  $("score-meter-fill").style.width = "0%";
  setScoreVerdict(result, { clear: true });

  // Reduced motion (or nothing to reveal) goes straight to the final numbers.
  if (reducedMotion.matches || !rows.length) {
    revealScoreImmediately(result);
    return;
  }

  const chipEffects = rows.filter(r => r.dataset.kind === "chips" || r.dataset.kind === "chips-add");
  const multEffects = rows.filter(r => r.dataset.kind === "mult" || r.dataset.kind === "mult-add");
  const otherEffects = rows.filter(r => !chipEffects.includes(r) && !multEffects.includes(r));

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const active = () => token === scoreAnimationToken;

  const revealRow = row => {
    row.classList.add("revealed");
    animateNumber(row.querySelector(".value"), 0, Number(row.dataset.value), v => formatEffectAmount(row.dataset.kind, v), 220);
    const jokerId = row.dataset.jokerId;
    const card = jokerId ? $(`score-joker-${jokerId}`) : null;
    if (card) {
      card.classList.add("is-activated");
      setTimeout(() => card.classList.remove("is-activated"), 440);
      cue("joker");
    } else {
      cue("tick");
    }
  };

  (async () => {
    // Act 1 — chips pile up. The server's total drives the counter, so what the
    // player reads can never drift from the authoritative calculation.
    cue("chips");
    animateNumber($("score-chips"), 0, result.chips, v => Math.round(v).toLocaleString(), 700);
    for (const row of [...chipEffects, ...otherEffects]) {
      await wait(140);
      if (!active()) return;
      revealRow(row);
    }

    // Act 2 — multiplier slams in once the chips are on the table.
    await wait(360);
    if (!active()) return;
    animateNumber($("score-mult"), 1, result.mult, v => `×${v.toFixed(2)}`, 520);
    cue("mult");
    for (const row of multEffects) {
      await wait(150);
      if (!active()) return;
      revealRow(row);
    }

    // Act 3 — the total lands. A result that clears by a mile hits harder.
    await wait(multEffects.length ? 460 : 360);
    if (!active()) return;
    const shake = result.score >= result.target * 2 ? "shake-lg"
      : result.score >= result.target ? "shake-md" : "shake-sm";
    const scoreTotal = document.querySelector(".score-total") || $("score-final");
    if (scoreTotal) {
      scoreTotal.classList.add(shake);
      setTimeout(() => scoreTotal.classList.remove(shake), 320);
    }
    animateNumber($("score-final"), 0, result.score, v => Math.round(v).toLocaleString(), 760);

    await wait(780);
    if (!active()) return;
    setScoreMeter(result);
    setScoreVerdict(result, { silent: true });
    cue(result.pass ? "score" : "fail");
  })();
}

function skipScoreSequence() {
  const result = currentRoundResult();
  if (!result) return;
  scoreAnimationToken += 1;
  revealScoreImmediately(result);
}

function renderScoreScreen() {
  const result = currentRoundResult();
  if (!result) return false;
  const isBoss = result.round === runRules.roundsPerAnte;
  const bossEl = $("score-boss");
  const boss = isBoss ? bossForAnteClient(result.ante) : null;
  if (boss) {
    bossEl.hidden = false;
    bossEl.textContent = `Boss round — ${boss.name}: ${boss.detail}`;
  } else {
    bossEl.hidden = true;
  }
  $("score-round").textContent = `Ante ${result.ante} · Round ${result.round}`;
  $("score-target").textContent = Number(result.target).toLocaleString();
  const list = $("score-effects");
  list.replaceChildren();
  const activeJokerIds = [];
  result.effects.forEach((effect, index) => {
    const row = document.createElement("li");
    row.className = "score-effect";
    row.dataset.kind = effect.kind;
    row.dataset.value = String(effect.value);
    if (effect.jokerId) {
      row.dataset.jokerId = effect.jokerId;
      if (!activeJokerIds.includes(effect.jokerId)) activeJokerIds.push(effect.jokerId);
    }
    const step = document.createElement("span");
    step.className = "score-effect-step";
    step.textContent = String(index + 1).padStart(2, "0");
    const info = document.createElement("span");
    info.className = "score-effect-info";
    const label = document.createElement("span");
    label.className = "score-effect-label";
    label.textContent = effect.label;
    info.append(label);
    if (effect.jokerId) {
      const joker = jokerCatalog?.jokers?.find(item => item.id === effect.jokerId);
      const source = document.createElement("span");
      source.className = "score-effect-source";
      source.textContent = joker ? joker.name : "Joker";
      info.append(source);
    }
    const value = document.createElement("span");
    value.className = "score-effect-value";
    const amount = document.createElement("span");
    amount.className = "value";
    amount.textContent = "0";
    const unit = document.createElement("small");
    unit.textContent = effect.kind === "chips" || effect.kind === "chips-add" ? "chips" : "mult";
    value.append(amount, unit);
    row.append(step, info, value);
    list.append(row);
  });

  renderScoreJokers(activeJokerIds);

  const lastRound = result.round >= runRules.roundsPerAnte;
  const lastAnte = result.ante >= runRules.antes;
  $("score-next").textContent = !result.pass
    ? "See results"
    : lastRound && lastAnte
      ? "Finish run"
      : lastRound
        ? "Next ante"
        : "Next round";

  const key = `${runState?.runId}:${result.roundId}:${result.score}`;
  if (scoreRenderKey === key) revealScoreImmediately(result);
  else {
    scoreRenderKey = key;
    playScoreSequence(result);
  }
  return true;
}

function renderScoreJokers(jokerIds) {
  const grid = $("score-joker-grid");
  const shell = $("score-jokers");
  if (!grid || !shell) return;
  grid.replaceChildren();
  if (!jokerCatalog || !jokerIds.length) {
    shell.hidden = true;
    return;
  }
  shell.hidden = false;
  const byId = {};
  jokerCatalog.jokers.forEach(j => { byId[j.id] = j; });
  for (const id of jokerIds) {
    const joker = byId[id];
    if (!joker) continue;
    const card = document.createElement("article");
    card.className = "score-joker-card card";
    card.dataset.rarity = joker.rarity;
    card.id = `score-joker-${joker.id}`;
    card.innerHTML = `
      ${jokerArtMarkup(joker, "score-joker-art joker-art")}
      <div class="score-joker-name">${joker.name}</div>
      <span class="score-joker-rarity">${joker.rarity.charAt(0).toUpperCase() + joker.rarity.slice(1)}</span>
      <span class="score-joker-value">+${joker.value}</span>
    `;
    grid.append(card);
  }
}

function clearScoreJokers() {
  const grid = $("score-joker-grid");
  if (!grid) return;
  [...grid.children].forEach(card => card.classList.remove("is-activated"));
}

// ---------- New screen renderers ----------

function renderRunSetupScreen() {
  const bankroll = $("setup-bankroll");
  const target = $("setup-target");
  const jokerCount = $("setup-joker-count");
  const button = $("setup-start");
  if (!bankroll || !target || !jokerCount || !button) return false;

  bankroll.textContent = money(RUN_RULES.startingCash);
  target.textContent = Number(targetForRoundClient(1, 1)).toLocaleString();
  const owned = runState ? (runState.jokers || []).length : 0;
  jokerCount.textContent = String(owned);
  button.textContent = runState ? "Resume Run" : "Start Run";
  return true;
}

function renderRoundIntroScreen() {
  const roundEl = $("intro-round");
  const anteEl = $("intro-ante");
  const targetEl = $("intro-target");
  const modifiers = $("intro-modifiers");
  const button = $("intro-start");
  if (!roundEl || !anteEl || !targetEl || !modifiers || !button) return false;

  const ante = runState.ante;
  const round = runState.round;
  const target = Number(runState.target).toLocaleString();
  roundEl.textContent = String(round);
  anteEl.textContent = `Ante ${ante}`;
  targetEl.textContent = target;

  modifiers.replaceChildren();
  const isBoss = round === runRules.roundsPerAnte;
  if (isBoss) {
    const boss = bossForAnteClient(ante);
    if (boss) {
      const item = document.createElement("div");
      item.className = "intro-modifier";
      item.innerHTML = `
        <span class="intro-modifier-label">Boss Rule</span>
        <span class="intro-modifier-value">${boss.name}</span>
        <span class="intro-modifier-desc">${boss.detail}</span>
      `;
      modifiers.append(item);
    }
  } else {
    const item = document.createElement("div");
    item.className = "intro-modifier";
    item.innerHTML = `
      <span class="intro-modifier-label">Target</span>
      <span class="intro-modifier-value">${target} chips</span>
    `;
    modifiers.append(item);
  }
  button.textContent = isBoss ? "Face Boss" : "Enter Market";
  return true;
}

function renderAnteCompleteScreen() {
  const numberEl = $("ante-complete-number");
  const scoreEl = $("ante-complete-score");
  const roundsEl = $("ante-complete-rounds");
  const nextTargetEl = $("ante-complete-next-target");
  const button = $("ante-complete-continue");
  if (!numberEl || !scoreEl || !roundsEl || !nextTargetEl || !button) return false;

  numberEl.textContent = String(runState.ante);
  scoreEl.textContent = Number(runState.scoreTotal || 0).toLocaleString();
  roundsEl.textContent = String(runRules.roundsPerAnte);
  const nextTarget = runState.ante >= runRules.antes
    ? "—"
    : Number(targetForRoundClient(runState.ante + 1, 1)).toLocaleString();
  nextTargetEl.textContent = nextTarget;
  button.textContent = runState.ante >= runRules.antes ? "Finish Run" : "Continue";
  return true;
}

function renderVictoryScreen() {
  const scoreEl = $("victory-score");
  const antesEl = $("victory-antes");
  const bestEl = $("victory-best-round");
  const grid = $("victory-joker-grid");
  if (!scoreEl || !antesEl || !bestEl || !grid) return false;

  scoreEl.textContent = Number(runState.scoreTotal || 0).toLocaleString();
  antesEl.textContent = String(runRules.antes);
  bestEl.textContent = Number(runState.bestRoundScore || 0).toLocaleString();

  grid.replaceChildren();
  const owned = runState.jokers || [];
  if (!owned.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "—";
    grid.append(empty);
    return true;
  }
  const byId = {};
  jokerCatalog.jokers.forEach(j => { byId[j.id] = j; });
  for (const id of owned) {
    const joker = byId[id];
    if (!joker) continue;
    const card = document.createElement("article");
    card.className = "victory-joker-card card";
    card.dataset.rarity = joker.rarity;
    card.innerHTML = `
      <div class="victory-joker-glyph">${joker.glyph}</div>
      <div class="victory-joker-name">${joker.name}</div>
      <span class="victory-joker-rarity">${joker.rarity.charAt(0).toUpperCase() + joker.rarity.slice(1)}</span>
    `;
    grid.append(card);
  }
  return true;
}

function renderFailureScreen() {
  const scoreEl = $("failure-score");
  const antesEl = $("failure-antes");
  const roundsEl = $("failure-rounds");
  const grid = $("failure-joker-grid");
  if (!scoreEl || !antesEl || !roundsEl || !grid) return false;

  const completedAntes = runState.completedAntes || 0;
  const reachedRound = runState.round;
  scoreEl.textContent = Number(runState.scoreTotal || 0).toLocaleString();
  antesEl.textContent = `${completedAntes} / ${runRules.antes}`;
  roundsEl.textContent = String(reachedRound);

  grid.replaceChildren();
  const owned = runState.jokers || [];
  if (!owned.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "—";
    grid.append(empty);
    return true;
  }
  const byId = {};
  jokerCatalog.jokers.forEach(j => { byId[j.id] = j; });
  for (const id of owned) {
    const joker = byId[id];
    if (!joker) continue;
    const card = document.createElement("article");
    card.className = "failure-joker-card card";
    card.dataset.rarity = joker.rarity;
    card.innerHTML = `
      <div class="failure-joker-glyph">${joker.glyph}</div>
      <div class="failure-joker-name">${joker.name}</div>
      <span class="failure-joker-rarity">${joker.rarity.charAt(0).toUpperCase() + joker.rarity.slice(1)}</span>
    `;
    grid.append(card);
  }
  return true;
}

function renderStatsScreen() {
  const totalRunsEl = $("stats-total-runs");
  const bestScoreEl = $("stats-best-score");
  const antesClearedEl = $("stats-antes-cleared");
  const roundsSurvivedEl = $("stats-rounds-survived");
  const grid = $("stats-joker-grid");
  if (!totalRunsEl || !bestScoreEl || !antesClearedEl || !roundsSurvivedEl || !grid) return false;

  // Career stats live in localStorage so they survive run resets.
  const stats = JSON.parse(localStorage.getItem("pocket-market-career-stats") || "{}");
  const totalRuns = Number(stats.totalRuns || 0);
  const bestScore = Number(stats.bestScore || 0);
  const antesCleared = Number(stats.antesCleared || 0);
  const roundsSurvived = Number(stats.roundsSurvived || 0);

  totalRunsEl.textContent = String(totalRuns);
  bestScoreEl.textContent = Number(bestScore).toLocaleString();
  antesClearedEl.textContent = `${antesCleared} / ${runRules.antes}`;
  roundsSurvivedEl.textContent = String(roundsSurvived);

  grid.replaceChildren();
  const allJokers = jokerCatalog ? jokerCatalog.jokers : [];
  const discovered = new Set(stats.discoveredJokers || []);
  let any = false;
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) {
    const group = allJokers.filter(j => j.rarity === rarity);
    if (!group.length) continue;
    const header = document.createElement("h3");
    header.className = "stats-rarity";
    header.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    grid.append(header);
    for (const joker of group) {
      const card = document.createElement("article");
      card.className = "stats-joker-card card";
      card.dataset.rarity = joker.rarity;
      card.style.opacity = discovered.has(joker.id) ? "1" : "0.35";
      card.innerHTML = `
        <div class="stats-joker-glyph">${joker.glyph}</div>
        <div class="stats-joker-name">${joker.name}</div>
        <span class="stats-joker-rarity">${joker.rarity.charAt(0).toUpperCase() + joker.rarity.slice(1)}</span>
      `;
      grid.append(card);
      any = true;
    }
  }
  if (!any) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "—";
    grid.append(empty);
  }
  return true;
}

function recordCareerStats(run) {
  const stats = JSON.parse(localStorage.getItem("pocket-market-career-stats") || "{}");
  stats.totalRuns = Number(stats.totalRuns || 0) + 1;
  stats.bestScore = Math.max(Number(stats.bestScore || 0), Number(run.scoreTotal || 0));
  stats.antesCleared = Math.max(Number(stats.antesCleared || 0), Number(run.completedAntes || 0));
  stats.roundsSurvived = Number(stats.roundsSurvived || 0) + (run.roundHistory ? run.roundHistory.length : 0);
  const discovered = new Set(stats.discoveredJokers || []);
  for (const id of run.jokers || []) discovered.add(id);
  stats.discoveredJokers = [...discovered];
  localStorage.setItem("pocket-market-career-stats", JSON.stringify(stats));
}

function targetForRoundClient(ante, round) {
  const index = (ante - 1) * runRules.roundsPerAnte + (round - 1);
  return Math.round((120 + 15 * index + 0.6 * index * index) / 5) * 5;
}

function renderResultsScreen() {
  if (!runState) return false;
  const titles = { completed: "Run complete", failed: "Run ended", retired: "Run retired" };
  $("results-title").textContent = titles[runState.endedReason] || "Run ended";
  $("results-score").textContent = Number(runState.scoreTotal || 0).toLocaleString();
  $("results-antes").textContent = `${runState.completedAntes || 0} / ${runRules.antes}`;
  $("results-best").textContent = Number(runState.bestRoundScore || 0).toLocaleString();
  $("results-reached").textContent = `Ante ${runState.ante} · Round ${runState.round}`;
  const holdingsValue = state.companies.reduce((sum, company) => sum + company.price * (runState.holdings?.[company.ticker] || 0), 0);
  $("results-portfolio").textContent = `$${money((Number(runState.cash) || 0) + holdingsValue)}`;
  $("results-new-run").disabled = runBusy;

  const list = $("results-rounds");
  list.replaceChildren();
  const history = [...(runState.roundHistory || [])].reverse().slice(0, 12);
  if (!history.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "—";
    list.append(empty);
    return true;
  }
  history.forEach(result => {
    const item = document.createElement("li");
    const round = document.createElement("span");
    round.className = "round";
    round.textContent = `A${result.ante}R${result.round}`;
    const verdict = document.createElement("span");
    verdict.className = `verdict ${result.pass ? "pass" : "fail"}`;
    verdict.textContent = result.pass ? "Pass" : "Miss";
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = Number(result.score).toLocaleString();
    const target = document.createElement("span");
    target.className = "target";
    target.textContent = `/ ${Number(result.target).toLocaleString()}`;
    item.append(round, verdict, score, target);
    list.append(item);
  });
  return true;
}

async function loadJokerCatalog() {
  if (jokerCatalog) return jokerCatalog;
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/jokers`, { credentials: "include" });
    if (!response.ok) return null;
    jokerCatalog = await response.json();
    return jokerCatalog;
  } catch {
    return null;
  }
}

async function loadShopState() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/shop`, { credentials: "include" });
    if (!response.ok) return null;
    const data = await response.json();
    shopState = data.shop || null;
    return shopState;
  } catch {
    return null;
  }
}

function humanizeToken(value) {
  return String(value || "—").replace(/-/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function jokerEffectLabel(kind) {
  if (kind === "chips-add") return "+ Chips";
  if (kind === "mult-add") return "+ Mult";
  if (kind === "mult") return "× Mult";
  return humanizeToken(kind);
}

function jokerValueLabel(joker) {
  const value = Number(joker.value);
  if (!Number.isFinite(value)) return "—";
  if (joker.effectKind === "mult") return `×${Number(value.toFixed(2))}`;
  return `+${value.toLocaleString()}`;
}

function showJokerDetail(joker, owned) {
  const detail = $("collection-detail");
  if (!detail || !joker) return;
  detail.hidden = false;
  detail.dataset.rarity = joker.rarity;
  $("detail-glyph").textContent = joker.glyph || "◇";
  $("detail-rarity").textContent = joker.rarity;
  $("detail-name").textContent = joker.name;
  $("detail-desc").textContent = joker.description;
  $("detail-trigger").textContent = humanizeToken(joker.trigger);
  $("detail-effect").textContent = jokerEffectLabel(joker.effectKind);
  $("detail-value").textContent = jokerValueLabel(joker);
  const status = $("detail-status");
  status.textContent = owned ? "Owned" : "Not owned";
  status.classList.toggle("is-owned", Boolean(owned));
}

function renderCollectionScreen() {
  const grid = $("collection-grid");
  const count = $("collection-count");
  const empty = $("collection-empty");
  if (!grid) return false;
  if (!jokerCatalog) {
    grid.replaceChildren();
    count.textContent = "—";
    empty.hidden = false;
    if ($("collection-detail")) $("collection-detail").hidden = true;
    return true;
  }
  empty.hidden = true;
  const ownedIds = new Set([...(shopState?.owned || []), ...(runState?.jokers || [])]);
  const ownedCount = jokerCatalog.jokers.filter(joker => ownedIds.has(joker.id)).length;
  count.textContent = ownedIds.size ? `${ownedCount} / ${jokerCatalog.jokers.length} owned` : `${jokerCatalog.jokers.length} jokers`;
  grid.replaceChildren();
  const byRarity = {};
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) {
    byRarity[rarity] = jokerCatalog.jokers.filter(joker => joker.rarity === rarity);
  }
  let dealIndex = 0;
  let first = null;
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) {
    const group = byRarity[rarity];
    if (!group.length) continue;
    const header = document.createElement("h3");
    header.className = "collection-rarity";
    header.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    grid.append(header);
    for (const joker of group) {
      const owned = ownedIds.has(joker.id);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "joker-card card";
      if (owned) card.classList.add("is-owned");
      card.dataset.rarity = rarity;
      card.style.setProperty("--deal-index", String(dealIndex++));
      card.innerHTML = `
        ${jokerArtMarkup(joker)}
        <h3 class="joker-name">${joker.name}</h3>
        <span class="joker-rarity">${rarity.charAt(0).toUpperCase() + rarity.slice(1)}</span>
        <p class="joker-desc">${joker.description}</p>
      `;
      card.addEventListener("click", () => {
        [...grid.querySelectorAll(".joker-card.is-selected")].forEach(other => other.classList.remove("is-selected"));
        card.classList.add("is-selected");
        showJokerDetail(joker, owned);
        cue("tick");
      });
      grid.append(card);
      if (!first) first = { card, joker, owned };
    }
  }
  if (first) {
    first.card.classList.add("is-selected");
    showJokerDetail(first.joker, first.owned);
  } else if ($("collection-detail")) {
    $("collection-detail").hidden = true;
  }
  return true;
}

let shopToastTimer = 0;

function shopWait(ms) {
  return reducedMotion.matches ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms));
}

function showShopToast(text, kind = "buy") {
  const toast = $("shop-toast");
  if (!toast) return;
  clearTimeout(shopToastTimer);
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.classList.remove("is-visible");
  void toast.offsetWidth;
  toast.classList.add("is-visible");
  shopToastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function animateShopCurrency(from, to) {
  const element = $("shop-currency");
  const pill = element?.closest(".shop-currency");
  if (!element || !pill) return;
  pill.classList.add("is-spending");
  animateNumber(element, from, to, value => Math.round(value).toLocaleString(), 440);
  setTimeout(() => pill.classList.remove("is-spending"), 520);
}

function renderShopScreen() {
  const grid = $("shop-grid");
  const currency = $("shop-currency");
  const rerollBtn = $("shop-reroll");
  const rerollCost = $("shop-reroll-cost");
  const empty = $("shop-empty");
  if (!grid) return false;
  if (!shopState) {
    grid.replaceChildren();
    currency.textContent = "—";
    rerollCost.textContent = "—";
    rerollBtn.disabled = true;
    empty.hidden = false;
    return true;
  }
  empty.hidden = true;
  let dealIndex = 0;
  currency.textContent = shopState.currency.toLocaleString();
  rerollCost.textContent = "15";
  rerollBtn.disabled = shopState.currency < 15;
  grid.replaceChildren();
  if (!jokerCatalog) {
    grid.replaceChildren();
    return true;
  }
  const byRarity = {};
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) {
    byRarity[rarity] = [];
  }
  for (const offer of shopState.offers) {
    const joker = jokerCatalog.jokers.find(j => j.id === offer.jokerId);
    if (!joker) continue;
    byRarity[joker.rarity] = byRarity[joker.rarity] || [];
    byRarity[joker.rarity].push({ joker, offer });
  }
  let any = false;
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) {
    const group = byRarity[rarity];
    if (!group || !group.length) continue;
    const header = document.createElement("h3");
    header.className = "shop-rarity";
    header.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    grid.append(header);
    for (const { joker, offer } of group) {
      const card = document.createElement("article");
      card.className = "shop-card card";
      card.dataset.rarity = rarity;
      card.style.setProperty("--deal-index", String(dealIndex++));
      const owned = shopState.owned.includes(joker.id);
      const affordable = shopState.currency >= offer.price;
      if (owned) card.classList.add("is-owned");
      else if (!affordable) {
        card.classList.add("is-unaffordable");
        card.dataset.need = String(Math.max(0, offer.price - shopState.currency));
      }
      const buyLabel = owned ? "Owned" : affordable ? "Buy" : `Need ${Math.max(0, offer.price - shopState.currency)}`;
      card.innerHTML = `
        ${jokerArtMarkup(joker, "shop-art joker-art")}
        <h3 class="shop-name">${joker.name}</h3>
        <span class="shop-rarity-chip">${rarity.charAt(0).toUpperCase() + rarity.slice(1)}</span>
        <p class="shop-desc">${joker.description}</p>
        <div class="shop-price">$${offer.price}</div>
        <button class="shop-buy" type="button" ${owned ? "disabled" : ""} ${!affordable ? "disabled" : ""} data-joker-id="${joker.id}">${buyLabel}</button>
      `;
      grid.append(card);
      any = true;
    }
  }
  return true;
}

function renderBossScreen() {
  const boss = bossForAnteClient(runState ? runState.ante : 1);
  const nameEl = $("boss-name");
  const detailEl = $("boss-detail");
  const anteEl = $("boss-ante");
  if (!boss) {
    return false;
  }
  nameEl.textContent = boss.name;
  detailEl.textContent = boss.detail;
  anteEl.textContent = `Ante ${runState.ante} · Round ${runRules.roundsPerAnte}`;
  return true;
}

async function runRequest(path) {
  const response = await fetch(`${BACKEND_HTTP_URL}${path}`, { method: "POST", credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Run action rejected.");
  runRulesFrom(data);
  return data;
}

async function loadRunState() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/run`, { credentials: "include" });
    if (!response.ok) {
      runState = null;
      return null;
    }
    const data = await response.json();
    runRulesFrom(data);
    runState = data.run || null;
    lastRoundResult = runState?.phase === "scoring"
      ? runState.roundHistory?.[runState.roundHistory.length - 1] || null
      : null;
    if (runState) applyRunAccount();
    return runState;
  } catch {
    runState = null;
    return null;
  }
}

async function loadClassicAccount() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/player`, { credentials: "include" });
    if (!response.ok) return;
    const player = await response.json();
    localStorage.setItem("pocket-market-player-name", player.name);
    applyAccount(player);
  } catch {
    // The default starting account stays visible if the server is unreachable.
  }
}

async function prepareFloor() {
  if (!runState) {
    floorMode = "classic";
    await loadClassicAccount();
  
    return;
  }
  if (isRunTrading()) {
    floorMode = "run";
    applyRunAccount();
  } else {
    floorMode = "classic";
    await loadClassicAccount();
  }

}

async function navigate(name, { hash = true } = {}) {
  if (!SCREEN_NAMES.includes(name)) name = "menu";
  if ((name === "score" || name === "results") && !runState) name = "menu";
  if (RUN_VIEW_SCREENS.includes(name) && runState?.phase === "scoring") name = "score";

  // Round 3 of each ante is a boss round: present the challenge screen first.
  if (RUN_VIEW_SCREENS.includes(name) && runState && runState.round === runRules.roundsPerAnte && !proceedToFloorAfterBoss) {
    await navigate("boss", { hash: false });
    return;
  }
  proceedToFloorAfterBoss = false;

  // Hide all screens, show target
  document.querySelectorAll(".screen").forEach(s => s.hidden = true);
  const target = document.getElementById("screen-" + name);
  if (target) target.hidden = false;
  activeScreen = name;
  document.body.dataset.screen = name;
  updateGameTabs(name);

  // Render the target screen's content
  try {
    if (RUN_VIEW_SCREENS.includes(name)) {
      await prepareFloor();
      render();
      renderRunStrip();
      if (name === "portfolio") renderPortfolioScreen();
      if (name === "jokers") renderJokersScreen();
    } else if (name === "menu") {
      renderMenu();
    } else if (name === "score") {
      renderScoreScreen();
    } else if (name === "results") {
      renderResultsScreen();
    } else if (name === "collection") {
      renderCollectionScreen();
    } else if (name === "shop") {
      renderShopScreen();
    } else if (name === "boss") {
      renderBossScreen();
    } else if (name === "run-setup") {
      renderRunSetupScreen();
    } else if (name === "round-intro") {
      renderRoundIntroScreen();
    } else if (name === "ante-complete") {
      renderAnteCompleteScreen();
    } else if (name === "run-victory") {
      renderVictoryScreen();
    } else if (name === "run-failure") {
      renderFailureScreen();
    } else if (name === "run-stats") {
      renderStatsScreen();
    }
  } catch (error) {
    console.error("Render error for " + name + ":", error);
  }

  if (hash) history.replaceState(null, "", "#" + name);
  if (name !== "floor") window.scrollTo(0, 0);
}

async function routeAfterAuth() {
  const hash = location.hash.replace(/^#/, "");
  if (SCREEN_NAMES.includes(hash)) {
    await navigate(hash);
    return;
  }
  if (!runState) {
    await navigate("menu");
    return;
  }
  if (runState.phase === "scoring") {
    await navigate("score");
    return;
  }
  if (runState.phase === "results") {
    await navigate("results");
    return;
  }
  await navigate("floor");
}

async function startRun() {
  if (runBusy) return;
  runBusy = true;
  $("menu-error").textContent = "";
  renderMenu();
  try {
    const data = await runRequest("/api/run/start");
    runState = data.run;
    lastRoundResult = null;
    scoreRenderKey = "";
    applyRunAccount();
    await loadShopState();
    await navigate("run-setup");
  } catch (error) {
    $("menu-error").textContent = error instanceof Error ? error.message : "Run unavailable.";
    await loadRunState();
    renderMenu();
  } finally {
    runBusy = false;
    renderMenu();
    renderRunStrip();
  }
}

async function lockRunRound() {
  if (runBusy || !isRunTrading()) return;
  runBusy = true;
  const button = $("run-lock");
  button.disabled = true;
  button.textContent = "Locking…";
  try {
    const data = await runRequest("/api/run/round/lock");
    runState = data.run;
    lastRoundResult = data.result || runState.roundHistory?.[runState.roundHistory.length - 1] || null;
    scoreRenderKey = "";
    applyRunAccount();
    await navigate("score");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Lock failed.");
  } finally {
    runBusy = false;
    button.disabled = false;
    button.textContent = "Lock round";
    renderRunStrip();
  }
}

async function advanceRunRound() {
  if (runBusy) return;
  runBusy = true;
  const button = $("score-next");
  button.disabled = true;
  try {
    const data = await runRequest("/api/run/round/advance");
    runState = data.run;
    lastRoundResult = null;
    scoreRenderKey = "";
    applyRunAccount();
    if (runState.phase === "results") {
      await navigate("results");
    } else {
      await navigate("shop");
    }
  } catch (error) {
    $("score-verdict").textContent = error instanceof Error ? error.message : "Advance failed.";
    $("score-verdict").className = "score-verdict fail";
  } finally {
    button.disabled = false;
    runBusy = false;
    renderRunStrip();
    renderMenu();
  }
}

async function retireCurrentRun() {
  if (runBusy || !runState) return;
  if (!confirm("Retire this run?")) return;
  runBusy = true;
  try {
    const data = await runRequest("/api/run/retire");
    runState = data.run;
    lastRoundResult = null;
    scoreRenderKey = "";
    await navigate("results");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Retire failed.");
  } finally {
    runBusy = false;
    renderRunStrip();
    renderMenu();
  }
}

async function purchaseJoker(jokerId, card = null) {
  if (runBusy) return;
  const previousCurrency = shopState?.currency ?? 0;
  const joker = jokerCatalog?.jokers?.find(item => item.id === jokerId);
  const rare = joker?.rarity === "epic" || joker?.rarity === "legendary";
  const button = card?.querySelector("button.shop-buy");
  runBusy = true;
  card?.classList.add("is-purchasing");
  if (button) button.disabled = true;
  cue(rare ? "epic" : "buy");
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/shop/purchase`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jokerId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Purchase rejected.");
    runRulesFrom(data);
    shopState = data.shop || null;
    runState = data.run || null;
    if (data.marketEvent) {
      pendingMarketEvent = data.marketEvent;
      setMessage(`${data.marketEvent.headline} ${data.marketEvent.detail}`);
      cue("fail");
    }
    card?.classList.remove("is-purchasing");
    card?.classList.add("is-sold");
    await shopWait(380);
    renderShopScreen();
    renderMenu();
    animateShopCurrency(previousCurrency, shopState?.currency ?? previousCurrency);
    showShopToast(`Bought · ${joker?.name || jokerId}`);
  } catch (error) {
    card?.classList.remove("is-purchasing", "is-sold");
    if (button) button.disabled = false;
    cue("reject");
    showShopToast("Purchase failed", "reject");
    setMessage(error instanceof Error ? error.message : "Purchase failed.");
  } finally {
    runBusy = false;
  }
}

async function rerollShop() {
  if (runBusy) return;
  const previousCurrency = shopState?.currency ?? 0;
  const grid = $("shop-grid");
  const rerollButton = $("shop-reroll");
  runBusy = true;
  cue("reroll");
  grid?.classList.add("is-rerolling");
  rerollButton?.classList.add("is-spinning");
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/shop/reroll`, {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Reroll rejected.");
    runRulesFrom(data);
    shopState = data.shop || null;
    runState = data.run || null;
    await shopWait(200);
    grid?.classList.remove("is-rerolling");
    rerollButton?.classList.remove("is-spinning");
    renderShopScreen();
    renderMenu();
    animateShopCurrency(previousCurrency, shopState?.currency ?? previousCurrency);
    showShopToast("Shop rerolled");
  } catch (error) {
    grid?.classList.remove("is-rerolling");
    rerollButton?.classList.remove("is-spinning");
    cue("reject");
    showShopToast("Reroll failed", "reject");
    setMessage(error instanceof Error ? error.message : "Reroll failed.");
  } finally {
    runBusy = false;
  }
}

$("market").addEventListener("click", event => {
  const row = event.target.closest("tr[data-ticker]");
  const button = event.target.closest("button");
  if (row) selectSecurity(row.dataset.ticker);
  if (button) trade(Number(button.dataset.index), button.dataset.action);
});
$("chart-stock").addEventListener("change", () => {
  applySecuritySelection();
  drawChart();
});
document.querySelectorAll(".chart-tab").forEach(button => {
  button.addEventListener("click", () => setChartRange(button.dataset.range));
});
setChartRange(chartRange);

$("floor-menu").addEventListener("click", () => navigate("menu"));
$("portfolio-menu").addEventListener("click", () => navigate("menu"));
$("jokers-menu").addEventListener("click", () => navigate("menu"));
$("jokers-browse").addEventListener("click", () => navigate("collection"));
$("portfolio-lock").addEventListener("click", lockRunRound);
document.addEventListener("click", event => {
  const button = event.target instanceof Element ? event.target.closest("[data-nav-screen]") : null;
  if (button) navigate(button.dataset.navScreen);
});
$("run-lock").addEventListener("click", lockRunRound);
$("run-retire").addEventListener("click", retireCurrentRun);
$("menu-primary").addEventListener("click", () => {
  const action = $("menu-primary").dataset.action;
  if (action === "continue") return navigate("floor");
  if (action === "scoring") return navigate("score");
  return startRun();
});
$("menu-results").addEventListener("click", () => navigate("results"));
$("menu-classic").addEventListener("click", () => navigate("floor"));
$("menu-collection").addEventListener("click", () => navigate("collection"));
$("menu-shop").addEventListener("click", () => navigate("shop"));
$("menu-stats").addEventListener("click", () => navigate("run-stats"));
$("score-menu").addEventListener("click", () => navigate("menu"));
$("score-skip").addEventListener("click", skipScoreSequence);
$("score-next").addEventListener("click", advanceRunRound);
$("results-new-run").addEventListener("click", startRun);
$("results-classic").addEventListener("click", () => navigate("floor"));
$("results-menu").addEventListener("click", () => navigate("menu"));
$("collection-back").addEventListener("click", () => navigate("menu"));
$("shop-back").addEventListener("click", async () => {
  if (!runState) { await navigate("menu"); return; }
  if (runState.phase === "results") { await navigate("results"); return; }
  if (runState.round === runRules.roundsPerAnte) { await navigate("boss"); return; }
  if (runState.round === 1 && runState.ante > 1) { await navigate("ante-complete"); return; }
  await navigate("floor");
});
$("boss-back").addEventListener("click", () => navigate("menu"));
$("boss-start").addEventListener("click", async () => {
  proceedToFloorAfterBoss = true;
  try {
    await navigate("floor");
  } catch (error) {
    console.error("Boss start error:", error);
    // Fallback: force floor visible
    try {
      await prepareFloor();
      setScreen("floor");
      render();
      renderRunStrip();
      history.replaceState(null, "", "#floor");
      window.scrollTo(0, 0);
    } catch (e) {
      console.error("Boss start fallback error:", e);
    }
  }
});
$("setup-start").addEventListener("click", () => navigate("floor"));
$("intro-start").addEventListener("click", () => navigate("floor"));
$("ante-complete-continue").addEventListener("click", () => navigate("floor"));
$("victory-new-run").addEventListener("click", startRun);
$("victory-menu").addEventListener("click", () => navigate("menu"));
$("failure-new-run").addEventListener("click", startRun);
$("failure-menu").addEventListener("click", () => navigate("menu"));
$("stats-back").addEventListener("click", () => navigate("menu"));
$("stats-new-run").addEventListener("click", startRun);
$("shop-reroll").addEventListener("click", rerollShop);
$("shop-grid").addEventListener("click", event => {
  const button = event.target.closest("button.shop-buy");
  if (button) purchaseJoker(button.dataset.jokerId, button.closest(".shop-card"));
});
window.addEventListener("hashchange", () => {
  const name = location.hash.replace(/^#/, "");
  if (SCREEN_NAMES.includes(name)) navigate(name, { hash: false });
});

$("dev-auth").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await developerRequest("/api/dev/login", { password: $("dev-password").value });
    $("dev-password").value = "";
    setDeveloperControls(true);
  } catch (error) {
    $("dev-auth-error").textContent = error instanceof Error ? error.message : "Developer sign-in failed.";
  }
});
$("dev-console").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button?.dataset.devAction && !button?.dataset.devEvent) return;
  try {
    if (button.dataset.devEvent) {
      await developerRequest("/api/dev/market", {
        action: "event",
        kind: button.dataset.devEvent,
        ticker: $("dev-event-ticker").value || undefined,
      });
      $("dev-feedback").textContent = `${button.dataset.devEvent} sent to the live market.`;
    } else if (button.dataset.devAction === "sentiment") {
      await developerRequest("/api/dev/market", { action: "sentiment", sentiment: Number($("dev-sentiment").value) });
      $("dev-feedback").textContent = "Sentiment updated.";
    } else if (button.dataset.devAction === "cash") {
      const player = await developerRequest("/api/dev/player", { action: "cash", cash: Number($("dev-cash").value) });
      state.cash = player.cash;
      render();
      $("dev-feedback").textContent = "Test cash updated.";
    } else if (button.dataset.devAction === "holding") {
      const player = await developerRequest("/api/dev/player", {
        action: "holding",
        ticker: $("dev-holding-ticker").value,
        quantity: Number($("dev-holding-quantity").value),
      });
      playerStats.costBasis = player.costBasis || {};
      playerStats.realizedProfit = player.realizedProfit || 0;
      state.companies.forEach(company => { company.shares = player.holdings[company.ticker] || 0; });
      render();
      $("dev-feedback").textContent = "Test holding updated.";
    } else if (button.dataset.devAction === "reset") {
      const player = await developerRequest("/api/dev/player", { action: "reset" });
      state.cash = player.cash;
      playerStats.costBasis = {};
      playerStats.realizedProfit = 0;
      state.companies.forEach(company => { company.shares = 0; });
      render();
      $("dev-feedback").textContent = "Player reset to the starting balance.";
    } else if (button.dataset.devAction === "run-reset") {
      await developerRequest("/api/dev/run", { action: "reset" });
      runState = null;
      lastRoundResult = null;
      scoreRenderKey = "";
      await loadClassicAccount();
      await navigate("menu");
      $("dev-feedback").textContent = "Run cleared.";
    } else if (button.dataset.devAction === "delete") {
      const name = $("dev-delete-name").value.trim();
      if (!name) throw new Error("Enter an account name first.");
      if (!confirm(`Delete the account "${name}" and its leaderboard entry?`)) return;
      const result = await developerRequest("/api/dev/player", { action: "delete", name });
      $("dev-delete-name").value = "";
      renderLeaderboard();
      $("dev-feedback").textContent = `Deleted ${result.deleted}.`;
    }
  } catch (error) {
    $("dev-feedback").textContent = error instanceof Error ? error.message : "Developer control rejected.";
  }
});
let authMode = "register";
$("auth-toggle").addEventListener("click", () => {
  authMode = authMode === "register" ? "login" : "register";
  $("auth-title").textContent = authMode === "register" ? "Create account" : "Log in";
  $("auth-submit").textContent = authMode === "register" ? "Create account" : "Log in";
  $("auth-toggle").textContent = authMode === "register" ? "Log in instead" : "Create an account";
  $("password-input").autocomplete = authMode === "register" ? "new-password" : "current-password";
});
$("name-form").addEventListener("submit", event => {
  event.preventDefault();
  claimName($("name-input").value.trim(), $("password-input").value);
});
showUpdateDialog();
try {
  newGame();
  renderMenu();
  setScreen("menu");
} catch (error) {
  console.error("Initialization error:", error);
  // Bulletproof: force menu visible no matter what
  try {
    document.querySelectorAll(".screen").forEach(s => s.hidden = true);
    document.getElementById("screen-menu").hidden = false;
    document.body.dataset.screen = "menu";
    activeScreen = "menu";
  } catch {
    // If even this fails, nothing we can do
  }
}
// Always hide the identity gate immediately so it never blocks the UI
$("identity-gate").hidden = true;
connectToMarket();
loadPlayer();
loadDailySummary();
setInterval(renderLeaderboard, 30000);

// Global error handler: if anything throws, force menu visible
window.addEventListener("error", event => {
  console.error("Uncaught error:", event.error);
  try {
    document.querySelectorAll(".screen").forEach(s => s.hidden = true);
    document.getElementById("screen-menu").hidden = false;
    document.body.dataset.screen = "menu";
    activeScreen = "menu";
  } catch {
    // Last resort
  }
});

if (savedPlayerName) $("name-input").value = savedPlayerName;

$("update-dismiss").addEventListener("click", dismissUpdateDialog);
$("update-continue").addEventListener("click", dismissUpdateDialog);

async function claimName(name, password) {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, password })
    });
    const result = await response.json();
    if (!response.ok) {
      $("name-error").textContent = result.error || "That name is unavailable.";
      return;
    }
    localStorage.setItem("pocket-market-player-name", result.name);
    $("name-error").textContent = "";
    $("identity-gate").hidden = true;
    await loadPlayer();
  } catch {
    $("name-error").textContent = "Could not reach the server.";
  }
}
