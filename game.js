const STARTING_CASH = 10000;
const MAX_DAYS = 365;
const TICK_MS = 15000;
const BACKEND_WS_URL = "wss://pocket-market-worker.unpaidandpoor.workers.dev/ws";
const BACKEND_HTTP_URL = "https://pocket-market-worker.unpaidandpoor.workers.dev";
const savedPlayerName = localStorage.getItem("pocket-market-player-name");
const getPlayerName = () => localStorage.getItem("pocket-market-player-name") || "Anonymous";
const isDeveloper = () => ["veroteknik", "veroteknic"].includes(getPlayerName().toLowerCase());

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
let pendingTrade = null;
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

// Three-tier screenshake. Magnitude scales with the impulse, and the whole
// thing is skipped when the OS asks for reduced motion.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let shakeCleanup = 0;
function shake(intensity = "sm") {
  if (reducedMotion.matches) return;
  const shell = document.querySelector("main");
  shell.classList.remove("shake-sm", "shake-md", "shake-lg");
  void shell.offsetWidth;
  shell.classList.add(`shake-${intensity}`);
  clearTimeout(shakeCleanup);
  shakeCleanup = setTimeout(() => shell.classList.remove("shake-sm", "shake-md", "shake-lg"), 400);
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
  }
}

function applySound(enabled, persist = true) {
  sound.enabled = enabled;
  $("sound-toggle").textContent = `Sound: ${enabled ? "on" : "off"}`;
  $("sound-toggle").setAttribute("aria-pressed", String(enabled));
  if (persist) localStorage.setItem("pocket-market-sound", enabled ? "on" : "off");
}
applySound(sound.enabled, false);
$("sound-toggle").addEventListener("click", () => {
  applySound(!sound.enabled);
  if (sound.enabled) {
    unlockAudio();
    cue("buy");
  }
});
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });

function newGame() {
  state = { day: getCurrentDayOfYear(), cash: STARTING_CASH, companies: companies.map(company => ({ ...company })), tick: 0, tickDeadline: 0, finished: false };
  marketHistory = {};
  render();
  setMessage(`Live market: Day ${state.day} / ${MAX_DAYS}.`);
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

function render() {
  $("day").textContent = state.day;
  const portfolio = portfolioValue();
  setRollingMoney("cash", state.cash);
  setRollingMoney("portfolio", portfolio);
  setRollingMoney("total", state.cash + portfolio);
  setRollingMoney("profit-loss", totalProfitLoss(), true);
  $("market").innerHTML = state.companies.map((company, index) => `
    <tr data-ticker="${company.ticker}">
      <td><strong>${company.name}</strong> (${company.ticker})</td>
      <td>$${money(company.price)}</td>
      <td>${changeMarkup(priceChange(company.ticker, company.price))}</td>
      <td>${company.shares}</td>
      <td>$${money(company.price * company.shares)}</td>
      <td>${profitMarkup(unrealizedProfit(company))}</td>
      <td class="trade">
        <input id="amount-${index}" type="number" min="1" value="1" aria-label="Shares of ${company.name}">
        <button data-action="buy" data-index="${index}" ${pendingTrade ? "disabled" : ""}>Buy</button>
        <button data-action="sell" data-index="${index}" ${pendingTrade ? "disabled" : ""}>Sell</button>
      </td>
    </tr>`).join("");
  drawChart();
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
  $("tick-count").textContent = left > 0 ? `Move in ${(left / 1000).toFixed(1)}s` : "Moving…";
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

function drawChart() {
  const canvas = $("price-chart");
  if (!canvas) return;
  const ticker = $("chart-stock").value;
  const points = marketHistory[ticker] || [];
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
  ctx.fillStyle = "#1b1710";
  ctx.fillRect(0, 0, width, height);

  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#3d3324";
  ctx.fillStyle = "#c8b897";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (index / 4) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#75603d";
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, height - bottom);
  ctx.lineTo(width - right, height - bottom);
  ctx.stroke();

  if (points.length < 2) {
    ctx.fillStyle = "#c8b897";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for live price history…", left + plotWidth / 2, top + plotHeight / 2);
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
  const xFor = index => left + (index / (points.length - 1)) * plotWidth;
  const yFor = price => top + (1 - (price - min) / range) * plotHeight;

  ctx.fillStyle = "#c8b897";
  ctx.textAlign = "right";
  for (let index = 0; index <= 4; index += 1) {
    const value = max - (index / 4) * range;
    const y = top + (index / 4) * plotHeight;
    ctx.fillText(`$${money(value)}`, left - 10, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Older", left, height - 12);
  ctx.textAlign = "right";
  ctx.fillText("Latest", width - right, height - 12);

  const last = points[points.length - 1];
  const first = points[0];
  const trendColor = last.price >= first.price ? "#62edac" : "#ff5c7d";
  const line = points.map((point, index) => ({ x: xFor(index), y: yFor(point.price) }));

  ctx.beginPath();
  ctx.moveTo(line[0].x, height - bottom);
  line.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(line[line.length - 1].x, height - bottom);
  ctx.closePath();
  const area = ctx.createLinearGradient(0, top, 0, height - bottom);
  area.addColorStop(0, last.price >= first.price ? "rgba(98, 237, 172, 0.24)" : "rgba(255, 92, 125, 0.22)");
  area.addColorStop(1, "rgba(27, 23, 16, 0)");
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
  ctx.arc(endpoint.x, endpoint.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#1b1710";
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
  const range = Number.isFinite(low) && Number.isFinite(high) ? ` Range: $${money(low)}–$${money(high)}.` : "";
  const direction = move > 0 ? "up" : move < 0 ? "down" : "neutral";
  const status = summary.inProgress ? "so far" : "closed";
  $("daily-summary").className = direction;
  $("daily-summary").textContent = `Day ${summary.day} ${status}: ${ticker} is the biggest mover (${move >= 0 ? "+" : ""}${move.toFixed(1)}%).${range}`;
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
  const company = state.companies[index];
  const amount = Math.floor(Number($(`amount-${index}`).value));
  if (!Number.isFinite(amount) || amount < 1) {
    cue("reject");
    return setMessage("Enter a whole number of shares.");
  }

  pendingTrade = { index, action };
  setMessage(`${action === "buy" ? "Buying" : "Selling"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name}…`);
  render();

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
    // Apply the fill to the tape immediately; the broadcast from the server
    // will confirm the same price a moment later.
    if (Number.isFinite(result.marketPrice)) {
      const points = marketHistory[company.ticker];
      const last = points && points[points.length - 1];
      if (last && last.price !== result.marketPrice) points.push({ time: Date.now(), price: result.marketPrice });
      state.companies[index].price = result.marketPrice;
    }
    const realizedGain = (result.player.realizedProfit || 0) - realizedBefore;
    const heavy = Math.abs(result.impact || 0) >= 0.035 || Math.abs(realizedGain) >= 250;
    shake(heavy ? "md" : "sm");
    cue(action === "buy" ? "buy" : "sell");
    if (heavy) cue("fill");
    const slipped = Number.isFinite(result.marketPrice) && result.marketPrice !== result.price;
    setMessage(`${action === "buy" ? "Bought" : "Sold"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name} at $${money(result.price)}${slipped ? ` · tape moved to $${money(result.marketPrice)}` : ""}.`);
  } catch {
    cue("reject");
    setMessage("Could not reach the live market server.");
  } finally {
    pendingTrade = null;
    render();
  }
}

async function loadPlayer() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/player`, { credentials: "include" });
    if (!response.ok) {
      if (savedPlayerName) $("name-input").value = savedPlayerName;
      return;
    }
    const player = await response.json();
    localStorage.setItem("pocket-market-player-name", player.name);
    state.cash = player.cash;
    playerStats.costBasis = player.costBasis || {};
    playerStats.realizedProfit = player.realizedProfit || 0;
    state.companies.forEach(company => { company.shares = player.holdings[company.ticker] || 0; });
    $("identity-gate").hidden = true;
    loadDeveloperAccess();
    render();
  } catch {
    if (savedPlayerName) $("name-input").value = savedPlayerName;
  }
}

function connectToMarket() {
  const socket = new WebSocket(BACKEND_WS_URL);

  socket.addEventListener("open", () => {
    setMessage("Live market connected. Prices are synchronized with everyone.");
  });

  socket.addEventListener("message", event => {
    const update = JSON.parse(event.data);
    if (update.type !== "market_update") return;
    updateDevConsole(update);

    // The backend owns the calendar; the browser only displays it.
    if (typeof update.day === "number") state.day = Math.max(state.day, update.day);
    if (update.history) marketHistory = update.history;
    if (typeof update.sentiment === "number") {
      const mood = update.sentiment > 35 ? "Hype" : update.sentiment < -35 ? "Panic" : "Neutral";
      $("sentiment").textContent = `${mood} (${Math.round(update.sentiment)})`;
    }
    if (update.event) {
      const eventKey = `${update.event.expiresAt}:${update.event.headline}`;
      if (eventKey !== lastEventKey) {
        lastEventKey = eventKey;
        shake(Math.abs(update.event.effect || 0) >= 0.06 ? "lg" : "md");
        punctuate(update.event);
        cue(update.event.kind === "boom" ? "boom" : "crash");
      }
      $("news-headline").textContent = update.event.headline;
      $("news-detail").textContent = update.event.detail || "Prices are already moving on this one.";
      $("featured-news").classList.remove("boom", "crash");
      $("featured-news").classList.add(update.event.kind);
      $("message").textContent = update.event.headline;
      $("message").classList.add("event-alert", update.event.kind);
    } else {
      $("news-headline").textContent = "All quiet on the board.";
      $("news-detail").textContent = "Company and market events land here the moment they happen.";
      $("featured-news").classList.remove("boom", "crash");
      $("message").classList.remove("event-alert", "boom", "crash");
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

    render();
    renderTickMeter();
    if (hadLiveState) flashPrices(previousPrices);
    renderLeaderboard();
  });

  socket.addEventListener("error", () => {
    setMessage("Live market is unavailable. Refresh to reconnect.");
  });

  socket.addEventListener("close", () => {
    state.tick = 0;
    state.tickDeadline = 0;
    renderTickMeter();
    if (!state.finished) setMessage("Live market disconnected.");
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
      empty.textContent = "No scores yet today.";
      list.append(empty);
      return;
    }
    scores.forEach((entry, index) => {
      const item = document.createElement("li");
      const player = document.createElement("strong");
      player.textContent = `${index + 1}. ${entry.name}`;
      const movement = entry.rankChange > 0 ? `▲ ${entry.rankChange}` : entry.rankChange < 0 ? `▼ ${Math.abs(entry.rankChange)}` : "—";
      const detail = document.createElement("small");
      detail.textContent = ` — $${money(entry.score)} ${movement}`;
      item.append(player, detail);
      list.append(item);
    });
  } catch {
    const list = $("leaderboard");
    list.replaceChildren();
    const error = document.createElement("li");
    error.textContent = "Leaderboard unavailable.";
    list.append(error);
  }
}

$("market").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button) trade(Number(button.dataset.index), button.dataset.action);
});
$("chart-stock").addEventListener("change", drawChart);
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
  $("auth-title").textContent = authMode === "register" ? "Create your account" : "Log in to Pocket Market";
  $("auth-copy").textContent = authMode === "register" ? "Pick a name and a password. No email, no real money." : "Use the name and password you signed up with.";
  $("auth-submit").textContent = authMode === "register" ? "Create account" : "Log in";
  $("auth-toggle").textContent = authMode === "register" ? "Already have an account? Log in" : "Need an account? Create one";
  $("password-input").autocomplete = authMode === "register" ? "new-password" : "current-password";
});
$("name-form").addEventListener("submit", event => {
  event.preventDefault();
  claimName($("name-input").value.trim(), $("password-input").value);
});
newGame();
connectToMarket();
loadPlayer();
loadDailySummary();

if (savedPlayerName) $("name-input").value = savedPlayerName;

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
    loadDeveloperAccess();
    setMessage(`Welcome, ${result.name}.`);
  } catch {
    setMessage("Could not check that name. Try again.");
  }
}
