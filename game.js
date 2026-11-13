const STARTING_CASH = 10000;
const MAX_DAYS = 365;
// Live Cloudflare Worker backend.
const BACKEND_WS_URL = "wss://pocket-market-worker.unpaidandpoor.workers.dev/ws";
const BACKEND_HTTP_URL = "https://pocket-market-worker.unpaidandpoor.workers.dev";
const playerId = localStorage.getItem("pocket-market-player-id") || crypto.randomUUID();
localStorage.setItem("pocket-market-player-id", playerId);
const savedPlayerName = localStorage.getItem("pocket-market-player-name");
const getPlayerName = () => localStorage.getItem("pocket-market-player-name") || "Anonymous";
const isDeveloper = () => getPlayerName().toLowerCase() === "veroteknik";

function updateDevConsole(data) {
  if (!isDeveloper()) return;
  $("dev-console").hidden = false;
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

function render() {
  $("day").textContent = state.day;
  $("cash").textContent = money(state.cash);
  $("portfolio").textContent = money(portfolioValue());
  $("total").textContent = money(state.cash + portfolioValue());
  $("market").innerHTML = state.companies.map((company, index) => `
    <tr>
      <td><strong>${company.name}</strong> (${company.ticker})</td>
      <td>$${money(company.price)}</td>
      <td>${company.shares}</td>
      <td class="trade">
        <input id="amount-${index}" type="number" min="1" value="1" aria-label="Shares of ${company.name}">
        <button data-action="buy" data-index="${index}">Buy</button>
        <button data-action="sell" data-index="${index}">Sell</button>
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
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(42, 12); ctx.lineTo(42, height - 28); ctx.lineTo(width - 12, height - 28);
  ctx.stroke();
  if (points.length < 2) return;

  const values = points.map(point => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = 42 + (index / (points.length - 1)) * (width - 54);
    const y = 12 + (1 - (point.price - min) / range) * (height - 40);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "#111111";
  ctx.font = "12px Arial";
  ctx.fillText(`$${money(max)}`, 4, 18);
  ctx.fillText(`$${money(min)}`, 4, height - 30);
}

function setMessage(text) { $("message").textContent = text; }

async function trade(index, action) {
  const company = state.companies[index];
  const amount = Math.floor(Number($(`amount-${index}`).value));
  if (!Number.isFinite(amount) || amount < 1) return setMessage("Enter a whole number of shares.");

  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, playerName: getPlayerName(), ticker: company.ticker, action, quantity: amount })
    });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Trade rejected.");
    state.cash = result.player.cash;
    state.companies.forEach(item => { item.shares = result.player.holdings[item.ticker] || 0; });
    setMessage(`${action === "buy" ? "Bought" : "Sold"} ${amount} share${amount === 1 ? "" : "s"} of ${company.name} at $${money(result.price)}.`);
    render();
  } catch {
    setMessage("Could not reach the live market server.");
  }
}

async function loadPlayer() {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/player?playerId=${encodeURIComponent(playerId)}`);
    const player = await response.json();
    state.cash = player.cash;
    state.companies.forEach(company => { company.shares = player.holdings[company.ticker] || 0; });
    render();
  } catch {
    setMessage("Could not load your portfolio from the live server.");
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
      $("message").textContent = update.event.headline;
      $("message").classList.add("event-alert", update.event.kind);
    } else {
      $("message").classList.remove("event-alert", "boom", "crash");
    }

    state.companies.forEach(company => {
      const nextPrice = update.prices[company.ticker];
      if (typeof nextPrice === "number") company.price = nextPrice;
    });

    $("news").innerHTML = [
      `<li>Live market update received — tick ${update.tick}.</li>`,
      "<li>Prices are controlled by the shared server.</li>"
    ].join("");
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
    const response = await fetch(`${BACKEND_HTTP_URL}/api/leaderboard`);
    const scores = await response.json();
    $("leaderboard").innerHTML = scores.length
      ? scores.map((entry, index) => {
          const movement = entry.rankChange > 0 ? `▲ ${entry.rankChange}` : entry.rankChange < 0 ? `▼ ${Math.abs(entry.rankChange)}` : "—";
          return `<li><strong>${index + 1}. ${entry.name}</strong> — $${money(entry.score)} <small>${movement}</small></li>`;
        }).join("")
      : "<li>No scores yet today.</li>";
  } catch {
    $("leaderboard").innerHTML = "<li>Leaderboard unavailable.</li>";
  }
}

$("market").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button) trade(Number(button.dataset.index), button.dataset.action);
});
$("chart-stock").addEventListener("change", drawChart);
$("name-form").addEventListener("submit", event => {
  event.preventDefault();
  claimName($("name-input").value.trim());
});
newGame();
connectToMarket();
loadPlayer();

if (savedPlayerName) {
  claimName(savedPlayerName);
}

async function claimName(name) {
  try {
    const response = await fetch(`${BACKEND_HTTP_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, name })
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
