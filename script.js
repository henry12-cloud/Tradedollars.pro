
/* =========================================================
   TRADEDOLLARS.PRO — LIVE MARKET MONITOR + SHARP BOT
   Public market data only.
   Signal-only mode: no order placement.
   Real-money trading: DISABLED.
   ========================================================= */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const APP_ID = "1089";
const WS_URL =
  `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const DEFAULT_SYMBOL = "1HZ100V";
const MAX_DIGITS = 2000;
const MAX_PRICES = 100;
const MIN_ANALYSIS_TICKS = 50;
const RECONNECT_DELAY = 2500;
const MAX_RECONNECT_DELAY = 30000;

/* Safety locks: this script contains no trading requests. */
const ORDERS_ENABLED = false;
const REAL_MONEY_TRADING_ENABLED = false;

/* ---------------- ELEMENT HELPERS ---------------- */

const $ = id => document.getElementById(id);

const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = String(value);
};

const setClass = (id, className) => {
  const element = $(id);
  if (element) element.className = className;
};

/* ---------------- APPLICATION STATE ---------------- */

const state = {
  socket: null,
  symbol: DEFAULT_SYMBOL,
  symbolName: "Volatility 100 (1s) Index",
  connected: false,
  manuallyStopped: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  requestId: 1,
  subscriptionId: null,

  totalTicks: 0,
  lastPrice: null,
  previousPrice: null,
  lastDigit: null,
  pipSize: 2,

  prices: [],
  digits: [],
  digitCounts: Array(10).fill(0)
};

/* ---------------- STATUS DISPLAY ---------------- */

function updateConnection(message, color) {
  setText("connectionStatus", message);

  const dot = $("statusDot");
  if (dot) dot.style.background = color;
}

function updateApp(message, color) {
  updateConnection(message, color);
}

/* ---------------- SAFE SOCKET SEND ---------------- */

function sendRequest(payload) {
  if (
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  try {
    state.socket.send(JSON.stringify({
      ...payload,
      req_id: state.requestId++
    }));
    return true;
  } catch (error) {
    console.error("Market request failed:", error);
    return false;
  }
}

/* ---------------- CONNECTION ---------------- */

function connectMarket() {
  state.manuallyStopped = false;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;

  if (
    state.socket &&
    (
      state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING
    )
  ) {
    try {
      state.socket.close();
    } catch (_) {}
  }

  state.connected = false;
  updateConnection("Connecting to Deriv market data…", "#ffc76b");
  setText("price", "Connecting…");

  let socket;

  try {
    socket = new WebSocket(WS_URL);
    state.socket = socket;
  } catch (error) {
    console.error("Could not create market connection:", error);
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;

    state.connected = true;
    state.reconnectAttempts = 0;

    updateConnection("Connected — loading markets…", "#35d49a");

    const sent = sendRequest({
      active_symbols: "brief",
      product_type: "basic"
    });

    if (!sent) scheduleReconnect();
  });

  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Unreadable market response:", error);
      return;
    }

    handleMessage(message);
  });

  socket.addEventListener("error", error => {
    console.error("Market WebSocket error:", error);
    updateConnection("Market connection error", "#ff6b7a");
  });

  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;

    state.socket = null;
    state.connected = false;
    state.subscriptionId = null;

    if (!state.manuallyStopped) {
      updateConnection("Disconnected — reconnecting…", "#ffc76b");
      scheduleReconnect();
    }
  });
}

function scheduleReconnect() {
  if (state.manuallyStopped || state.reconnectTimer) return;

  const delay = Math.min(
    RECONNECT_DELAY * Math.pow(2, state.reconnectAttempts),
    MAX_RECONNECT_DELAY
  );

  state.reconnectAttempts++;

  updateConnection(
    `Disconnected — retrying in ${Math.ceil(delay / 1000)}s…`,
    "#ffc76b"
  );

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectMarket();
  }, delay);
}

/* ---------------- MESSAGE HANDLING ---------------- */

function handleMessage(message) {
  if (message.error) {
    const reason =
      message.error.message || "Unknown market API error";

    console.error("Deriv API error:", message.error);

    updateConnection(`Market API: ${reason}`, "#ff6b7a");
    return;
  }

  if (message.msg_type === "active_symbols") {
    loadMarkets(message.active_symbols || []);
    return;
  }

  if (message.msg_type === "tick" && message.tick) {
    handleTick(message.tick);
  }
}

/* ---------------- MARKET SELECTOR ---------------- */

function loadMarkets(markets) {
  const select = $("market");

  if (!Array.isArray(markets) || markets.length === 0) {
    updateConnection("Connected, but no markets were returned", "#ff6b7a");
    return;
  }

  if (!select) {
    updateConnection("Market selector was not found", "#ff6b7a");
    return;
  }

  const validMarkets = markets
    .filter(item => item && item.symbol && item.display_name)
    .sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );

  if (!validMarkets.length) {
    updateConnection("No usable markets in the response", "#ff6b7a");
    return;
  }

  const previousSelection = state.symbol;

  select.innerHTML = "";

  validMarkets.forEach(market => {
    const option = document.createElement("option");
    option.value = market.symbol;
    option.textContent = market.display_name;
    select.appendChild(option);
  });

  const selected =
    validMarkets.find(item => item.symbol === previousSelection) ||
    validMarkets.find(item => item.symbol === DEFAULT_SYMBOL) ||
    validMarkets[0];

  select.value = selected.symbol;
  state.symbol = selected.symbol;
  state.symbolName = selected.display_name;

  updateConnection(
    `Connected — ${validMarkets.length} markets available`,
    "#35d49a"
  );

  subscribeToMarket();
}

/* ---------------- TICK SUBSCRIPTION ---------------- */

function subscribeToMarket() {
  if (
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN
  ) {
    updateConnection("Waiting for market connection…", "#ffc76b");
    return;
  }

  /* Forget only the previous tick subscription. */
  if (state.subscriptionId) {
    sendRequest({
      forget: state.subscriptionId
    });
    state.subscriptionId = null;
  }

  state.totalTicks = 0;
  state.lastPrice = null;
  state.previousPrice = null;
  state.lastDigit = null;
  state.prices = [];
  state.digits = [];
  state.digitCounts = Array(10).fill(0);

  renderAll();

  setText("price", "Waiting for ticks…");
  setText("priceChange", "Price change: —");
  setText("tickCount", "0 ticks");

  updateConnection(`Subscribing to ${state.symbolName}…`, "#ffc76b");

  const sent = sendRequest({
    ticks: state.symbol,
    subscribe: 1
  });

  if (!sent) {
    updateConnection("Could not subscribe to market ticks", "#ff6b7a");
  }
}

/* ---------------- LIVE TICK PROCESSING ---------------- */

function handleTick(tick) {
  if (tick.symbol && tick.symbol !== state.symbol) return;

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  if (Number.isInteger(tick.pip_size)) {
    state.pipSize = tick.pip_size;
  }

  const formatted = price.toFixed(state.pipSize);
  const digit = Number(formatted.slice(-1));

  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return;

  state.previousPrice = state.lastPrice;
  state.lastPrice = price;
  state.lastDigit = digit;
  state.totalTicks++;

  state.prices.push({
    price,
    time: Number(tick.epoch) || Date.now() / 1000
  });

  if (state.prices.length > MAX_PRICES) {
    state.prices.shift();
  }

  state.digits.push(digit);
  state.digitCounts[digit]++;

  if (state.digits.length > MAX_DIGITS) {
    const removed = state.digits.shift();
    state.digitCounts[removed]--;
  }

  if (state.totalTicks % 10 === 0) {
    console.debug("TradeDollars ticks received:", state.totalTicks);
  }

  updateConnection("Connected — live feed active", "#35d49a");
  renderAll();
}

/* ---------------- LIVE PRICE ---------------- */

function renderPrice() {
  if (state.lastPrice === null) {
    setText("price", "Waiting for ticks…");
    setText("priceChange", "Price change: —");
    return;
  }

  setText("price", state.lastPrice.toFixed(state.pipSize));

  if (state.previousPrice === null) {
    setText("priceChange", "Price change: collecting baseline");
    setClass("priceChange", "small muted");
    return;
  }

  const difference = state.lastPrice - state.previousPrice;
  const prefix = difference > 0 ? "+" : "";

  setText(
    "priceChange",
    `Price change: ${prefix}${difference.toFixed(state.pipSize)}`
  );

  setClass(
    "priceChange",
    `small ${difference > 0 ? "up" : difference < 0 ? "down" : "neutral"}`
  );

  setText("tickCount", `${state.totalTicks} ticks`);
  setText("historyCount", state.digits.length);
}

/* ---------------- SVG PRICE CHART ---------------- */

function renderChart() {
  const chart = $("chart");
  if (!chart) return;

  if (state.prices.length < 2) {
    chart.innerHTML = `
      <text x="350" y="95" fill="#9eb0ca"
        text-anchor="middle">Waiting for live market data…</text>`;
    return;
  }

  const values = state.prices.map(item => item.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 0.000001;

  const left = 18;
  const right = 682;
  const top = 16;
  const bottom = 158;

  const points = values.map((value, index) => {
    const x = left + index / (values.length - 1) * (right - left);
    const y = top + (max - value) / spread * (bottom - top);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const direction =
    values[values.length - 1] > values[0] ? "#35d49a" :
    values[values.length - 1] < values[0] ? "#ff6b7a" : "#55e4ef";

  chart.innerHTML = `
    <defs>
      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${direction}" stop-opacity=".25"/>
        <stop offset="100%" stop-color="${direction}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g stroke="#263b59" stroke-width="1">
      <line x1="18" y1="50" x2="682" y2="50"/>
      <line x1="18" y1="90" x2="682" y2="90"/>
      <line x1="18" y1="130" x2="682" y2="130"/>
    </g>
    <polygon points="${left},${bottom} ${points} ${right},${bottom}"
      fill="url(#chartFill)"/>
    <polyline points="${points}" fill="none"
      stroke="${direction}" stroke-width="2.5"
      stroke-linejoin="round" stroke-linecap="round"/>
    <text x="18" y="180" fill="#9eb0ca" font-size="11">
      Low: ${min.toFixed(state.pipSize)}
    </text>
    <text x="682" y="180" fill="#9eb0ca" font-size="11"
      text-anchor="end">High: ${max.toFixed(state.pipSize)}</text>
  `;
}

/* ---------------- DIGIT STATISTICS ---------------- */

function renderDigits() {
  const container = $("digits");
  if (!container) return;

  const total = state.digits.length;

  if (!total) {
    container.innerHTML = Array.from({ length: 10 }, (_, digit) => `
      <div class="digit">
        ${digit}
        <div class="bar"><i style="width:0%"></i></div>
        <small class="muted">0%</small>
      </div>
    `).join("");
    return;
  }

  container.innerHTML = state.digitCounts.map((count, digit) => {
    const percent = count / total * 100;
    const color = digit % 2 === 0 ? "#55e4ef" : "#4b9cff";

    return `
      <div class="digit">
        ${digit}
        <div class="bar">
          <i style="width:${percent}%;background:${color}"></i>
        </div>
        <small class="muted">${percent.toFixed(1)}%</small>
      </div>
    `;
  }).join("");
}

/* ---------------- MOMENTUM ANALYSIS ---------------- */

function renderAnalysis() {
  const sample = state.prices;
  const count = sample.length;

  setText("sampleSize", state.digits.length);
  setText("lastDigit", state.lastDigit === null ? "—" : state.lastDigit);

  if (count < MIN_ANALYSIS_TICKS) {
    setText("trend", "COLLECTING DATA");
    setClass("trend", "neutral");
    setText(
      "trendReason",
      `Collecting price observations: ${count}/${MIN_ANALYSIS_TICKS}. No directional conclusion yet.`
    );
    setText("support", "—");
    setText("resistance", "—");
    return;
  }

  const prices = sample.map(item => item.price);
  const recent = prices.slice(-20);
  const earlier = prices.slice(-40, -20);

  const average = list =>
    list.reduce((sum, value) => sum + value, 0) / list.length;

  const recentAverage = average(recent);
  const earlierAverage = earlier.length ? average(earlier) : recentAverage;
  const change = recentAverage - earlierAverage;

  const scale = Math.max(Math.abs(recentAverage), 1);
  const threshold = scale * 0.00001;

  let trend = "SIDEWAYS";
  let trendClass = "neutral";

  if (change > threshold) {
    trend = "UPWARD MOMENTUM";
    trendClass = "up";
  } else if (change < -threshold) {
    trend = "DOWNWARD MOMENTUM";
    trendClass = "down";
  }

  setText("trend", trend);
  setClass("trend", trendClass);

  setText(
    "trendReason",
    `Recent 20-tick average compared with the preceding observations. Change: ${change.toFixed(state.pipSize)}. This is descriptive, not a prediction.`
  );

  setText("support", Math.min(...recent).toFixed(state.pipSize));
  setText("resistance", Math.max(...recent).toFixed(state.pipSize));
}

/* ---------------- SHARP BOT: SIGNAL ONLY ---------------- */

function renderSharpBot() {
  const count = state.digits.length;

  /* Always WAIT: statistics alone do not establish an edge. */
  setText("signal", "WAIT");
  setClass("signal", "neutral");

  let reason;

  if (!count) {
    reason = "Waiting for live market data. No orders will be placed.";
  } else if (count < MIN_ANALYSIS_TICKS) {
    reason =
      `Sharp Bot is collecting ${count}/${MIN_ANALYSIS_TICKS} observations. Signal-only mode; no orders.`;
  } else {
    reason =
      `Monitoring ${count} observed digits on ${state.symbolName}. WAIT means no actionable signal has been validated. No orders will be placed.`;
  }

  setText("signalReason", reason);
  setText("historyCount", count);

  /* Keep trading permanently disabled in this build. */
  const buyButton = $("buyBtn", "confirmBuy", "confirmBuyButton");

  if (buyButton) {
    buyButton.disabled = true;
    buyButton.textContent = "ORDERS DISABLED";
  }

  if (ORDERS_ENABLED || REAL_MONEY_TRADING_ENABLED) {
    console.error("Safety check failed: trading must remain disabled.");
  }
}

/* ---------------- RECENT DIGIT HISTORY ---------------- */

function renderHistory() {
  const container = $("history");
  if (!container) return;

  if (!state.digits.length) {
    container.innerHTML = '<span class="muted">Waiting for market ticks…</span>';
    return;
  }

  container.innerHTML = state.digits.slice(-30).reverse().map(digit => {
    const color = digit % 2 === 0 ? "#55e4ef" : "#4b9cff";

    return `
      <span style="border:1px solid #263b59;color:${color}">
        ${digit}
      </span>
    `;
  }).join("");
}

/* ---------------- RENDER ALL ---------------- */

function renderAll() {
  renderPrice();
  renderChart();
  renderDigits();
  renderAnalysis();
  renderSharpBot();
  renderHistory();
}

/* ---------------- MARKET CHANGES ---------------- */

function changeMarket() {
  const select = $("market");
  if (!select) return;

  state.symbol = select.value;

  const option = select.options[select.selectedIndex];
  state.symbolName = option ? option.textContent : state.symbol;

  subscribeToMarket();
}

/* ---------------- INITIALISATION ---------------- */

function initialise() {
  const select = $("market");
  const reconnectButton = $("reconnect");

  if (select) {
    select.value = DEFAULT_SYMBOL;
    select.addEventListener("change", changeMarket);
  }

  if (reconnectButton) {
    reconnectButton.addEventListener("click", () => {
      state.manuallyStopped = false;
      state.reconnectAttempts = 0;
      connectMarket();
    });
  }

  renderAll();

  if (ORDERS_ENABLED || REAL_MONEY_TRADING_ENABLED) {
    console.error("Trading safety lock must remain enabled.");
  }

  connectMarket();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else {
  initialise();
    }
    
