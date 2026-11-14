const STARTING_CASH = 10000;
const MAX_DAYS = 365;
// Live Cloudflare Worker backend.
const BACKEND_WS_URL = "wss://pocket-market-worker.unpaidandpoor.workers.dev/ws";
const BACKEND_HTTP_URL = "https://pocket-market-worker.unpaidandpoor.workers.dev";
const savedPlayerName = localStorage.getItem("pocket-market-player-name");
const getPlayerName = () => localStorage.getItem("pocket-market-player-name") || "Anonymous";
const isDeveloper = () => getPlayerName().toLowerCase() === "veroteknik";

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
let playerStats = { costBasis: {}, realizedProfit: 0 };
const $ = (id) => document.getElementById(id);
const money = (value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function newGame() {
  state = { day: getCurrentDayOfYear(), cash: STARTING_CASH, companies: companies.map(company => ({ ...company })), finished: false };
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

function render() {
  $("day").textContent = state.day;
  $("cash").textContent = money(state.cash);
  $("portfolio").textContent = money(portfolioValue());
  $("total").textContent = money(state.cash + portfolioValue());
  $("profit-loss").innerHTML = profitMarkup(totalProfitLoss());
  $("market").innerHTML = state.companies.map((company, index) => `
    <tr>
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
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, width, height);

  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#ded9ce";
  ctx.fillStyle = "#7b8179";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (index / 4) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#9d9a91";
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, height - bottom);
  ctx.lineTo(width - right, height - bottom);
  ctx.stroke();

  if (points.length < 2) {
    ctx.fillStyle = "#7b8179";
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

  ctx.fillStyle = "#7b8179";
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
  const trendColor = last.price >= first.price ? "#21634b" : "#a13e37";
  const line = points.map((point, index) => ({ x: xFor(index), y: yFor(point.price) }));

  ctx.beginPath();
  ctx.moveTo(line[0].x, height - bottom);
  line.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(line[line.length - 1].x, height - bottom);
  ctx.closePath();
  const area = ctx.createLinearGradient(0, top, 0, height - bottom);
  area.addColorStop(0, last.price >= first.price ? "rgba(33, 99, 75, 0.18)" : "rgba(161, 62, 55, 0.16)");
  area.addColorStop(1, "rgba(251, 250, 246, 0)");
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
  ctx.fillStyle = "#fbfaf6";
  ctx.fill();
  ctx.strokeStyle = trendColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "left";
}

function setMessage(text) { $("message").textContent = text; }

async function trade(index, action) {
  if (pendingTrade) return;
  const company = state.companies[index];
  const amount = Math.floor(Number($(`amount-${index}`).value));
  if (!Number.isFinite(amount) || amount < 1) return setMessage("Enter a whole number of shares.");

  pendingTrade = { index, action };
  setMessage(`${action === "buy" ? "Buying" : "Selling"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name}…`);
  render();

  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ticker: company.ticker, action, quantity: amount })
    });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Trade rejected.");
    state.cash = result.player.cash;
    playerStats.costBasis = result.player.costBasis || {};
    playerStats.realizedProfit = result.player.realizedProfit || 0;
    state.companies.forEach(item => { item.shares = result.player.holdings[item.ticker] || 0; });
    setMessage(`${action === "buy" ? "Bought" : "Sold"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name} at $${money(result.price)}.`);
  } catch {
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
    if (player.name.toLowerCase() === "veroteknic") $("dev-console").hidden = false;
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
      $("news-kind").textContent = update.event.kind === "boom" ? "MARKET BOOM" : "FLASH CRASH";
      $("news-headline").textContent = update.event.headline;
      $("news-detail").textContent = "React quickly. This event is affecting the live market.";
      $("featured-news").classList.remove("boom", "crash");
      $("featured-news").classList.add(update.event.kind);
      $("message").textContent = update.event.headline;
      $("message").classList.add("event-alert", update.event.kind);
    } else {
      $("news-kind").textContent = "LIVE MARKET";
      $("news-headline").textContent = "The market is open.";
      $("news-detail").textContent = "Watch the tape for the next move.";
      $("featured-news").classList.remove("boom", "crash");
      $("message").classList.remove("event-alert", "boom", "crash");
    }

    state.companies.forEach(company => {
      const nextPrice = update.prices[company.ticker];
      if (typeof nextPrice === "number") company.price = nextPrice;
    });

    const newsItems = [
      `Live market update received — tick ${update.tick}.`,
      "Prices are controlled by the shared server."
    ];
    $("news").replaceChildren(...newsItems.map(text => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    render();
    renderLeaderboard();
  });

  socket.addEventListener("error", () => {
    setMessage("Live market is unavailable. Start the Cloudflare dev server first.");
  });

  socket.addEventListener("close", () => {
    if (!state.finished) setMessage("Live market disconnected.");
  });
}

function finishGame() {
  if (state.finished) return;
  state.finished = true;
  const total = state.cash + portfolioValue();
  const name = getPlayerName();
  const scores = JSON.parse(localStorage.getItem("pocket-market-scores") || "[]");
  scores.push({ name, score: Math.round(total), date: new Date().toLocaleDateString() });
  scores.sort((a, b) => b.score - a.score);
  localStorage.setItem("pocket-market-scores", JSON.stringify(scores.slice(0, 10)));
  setMessage(`Summer break! ${name} finished with $${money(total)}.`);
  renderLeaderboard();
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
let authMode = "register";
$("auth-toggle").addEventListener("click", () => {
  authMode = authMode === "register" ? "login" : "register";
  $("auth-title").textContent = authMode === "register" ? "Create your account" : "Log in to Pocket Market";
  $("auth-copy").textContent = authMode === "register" ? "Choose a unique name and password to enter the market." : "Use your existing market name and password.";
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
    if (isDeveloper()) $("dev-console").hidden = false;
    setMessage(`Welcome, ${result.name}.`);
  } catch {
    setMessage("Could not check that name. Try again.");
  }
}
