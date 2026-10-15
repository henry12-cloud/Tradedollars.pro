
/* =========================================================
   TRADEDOLLARS — OLD DASHBOARD COMPATIBLE SCRIPT
   Public market feed + digit analysis + Sharp Bot
   Signal-only mode. No orders. Real trading disabled.
   ========================================================= */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const APP_ID = "34qPaViEQZZw84Mc5thoO";
const PUBLIC_WS_URL =
  `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}`;

const DEFAULT_SYMBOL = "1HZ100V";
const MAX_DIGITS = 2000;
const MAX_PRICES = 100;
const MIN_ANALYSIS_TICKS = 50;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

/* Permanent safety locks */
const ORDERS_ENABLED = false;
const REAL_MONEY_TRADING_ENABLED = false;

/* ---------------- ELEMENT HELPERS ---------------- */

const $ = (...ids) => {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
};

function setText(ids, value) {
  const element = Array.isArray(ids) ? $(...ids) : $(ids);
  if (element) element.textContent = String(value);
}

function setStatus(ids, message, color) {
  const element = Array.isArray(ids) ? $(...ids) : $(ids);
  if (!element) return;

  element.textContent = message;

  if (color) element.style.color = color;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

/* ---------------- STATE ---------------- */

const state = {
  socket: null,
  symbol: DEFAULT_SYMBOL,
  symbolName: "Volatility 100 (1s) Index",

  connected: false,
  manuallyStopped: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  connectionTimer: null,

  requestId: 1,
  subscriptionId: null,

  totalTicks: 0,
  lastPrice: null,
  previousPrice: null,
  lastDigit: null,
  pipSize: 2,

  priceHistory: [],
  digitHistory: [],
  digitCounts: Array(10).fill(0),

  monitorRunning: false,
  observations: []
};

/* ---------------- STATUS HELPERS ---------------- */

function setAppStatus(message, color) {
  setStatus("appStatus", message, color);
}

function setMarketStatus(message, color) {
  setStatus("marketStatus", message, color);
}

function setPriceStatus(message, color) {
  setStatus("priceStatus", message, color);
}

function setBotStatus(message, color) {
  setStatus("botStatus", message, color);
}

function setConnectionStatus(message, color) {
  setStatus(
    ["connectionStatus", "publicConnectionStatus"],
    message,
    color
  );
}

function updateConnectionDisplay(message, color) {
  setConnectionStatus(message, color);
  setMarketStatus(message, color);
}

/* ---------------- WEBSOCKET REQUESTS ---------------- */

function sendRequest(payload) {
  if (!state.socket ||
      state.socket.readyState !== WebSocket.OPEN) {
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

/* ---------------- CONNECT TO PUBLIC MARKET DATA ---------------- */

function connectPublicSocket() {
  if (state.socket &&
      (state.socket.readyState === WebSocket.OPEN ||
       state.socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  state.manuallyStopped = false;
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.connectionTimer);

  updateConnectionDisplay(
    "Connecting to public market data...",
    "#d97706"
  );

  setPriceStatus("Connecting to live market data...", "#d97706");
  setAppStatus("Connecting to market feed...", "#d97706");

  let socket;

  try {
    socket = new WebSocket(PUBLIC_WS_URL);
    state.socket = socket;
  } catch (error) {
    console.error("Could not create WebSocket:", error);
    handleConnectionFailure("Could not start market connection.");
    return;
  }

  state.connectionTimer = setTimeout(() => {
    if (state.socket === socket &&
        socket.readyState !== WebSocket.OPEN) {
      try {
        socket.close();
      } catch (_) {}

      handleConnectionFailure(
        "Market connection timed out. Retrying..."
      );
    }
  }, 12000);

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;

    clearTimeout(state.connectionTimer);
    state.connected = true;
    state.reconnectAttempts = 0;

    updateConnectionDisplay(
      "Connected. Loading available markets...",
      "#15803d"
    );

    setAppStatus("Public market connection established.", "#15803d");

    const sent = sendRequest({
      active_symbols: "brief",
      product_type: "basic"
    });

    if (!sent) {
      handleConnectionFailure(
        "Could not request available markets."
      );
    }
  });

  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid market response:", error);
      setMarketStatus("Received an unreadable market response.", "#dc2626");
      return;
    }

    handlePublicMessage(message);
  });

  socket.addEventListener("error", error => {
    console.error("Public market socket error:", error);
    setConnectionStatus("Market connection error.", "#dc2626");
  });

  socket.addEventListener("close", event => {
    if (state.socket !== socket) return;

    clearTimeout(state.connectionTimer);
    state.socket = null;
    state.connected = false;
    state.subscriptionId = null;

    if (!state.manuallyStopped) {
      const reason = event.reason
        ? `Connection closed: ${event.reason}`
        : `Connection closed (code ${event.code}).`;

      handleConnectionFailure(`${reason} Reconnecting...`);
    }
  });
}

function handleConnectionFailure(message) {
  clearTimeout(state.connectionTimer);

  updateConnectionDisplay(message, "#dc2626");
  setPriceStatus(message, "#dc2626");
  setAppStatus(message, "#dc2626");

  if (!state.manuallyStopped) scheduleReconnect();
}

function scheduleReconnect() {
  if (state.manuallyStopped || state.reconnectTimer) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, state.reconnectAttempts),
    MAX_RECONNECT_DELAY_MS
  );

  state.reconnectAttempts++;

  setConnectionStatus(
    `Reconnecting in ${Math.ceil(delay / 1000)} seconds...`,
    "#d97706"
  );

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectPublicSocket();
  }, delay);
}

function stopPublicSocket() {
  state.manuallyStopped = true;
  clearTimeout(state.connectionTimer);
  clearTimeout(state.reconnectTimer);

  state.connectionTimer = null;
  state.reconnectTimer = null;

  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    state.connected = false;

    try {
      socket.close();
    } catch (error) {
      console.warn("Socket close issue:", error);
    }
  }

  updateConnectionDisplay("Market feed stopped.", "#64748b");
}

/* ---------------- HANDLE PUBLIC MESSAGES ---------------- */

function handlePublicMessage(message) {
  if (message.error) {
    const code = message.error.code || "API error";
    const reason = message.error.message || "Unknown market error";

    console.error("Deriv market error:", code, reason);

    const errorText = `Market API error (${code}): ${reason}`;

    setMarketStatus(errorText, "#dc2626");
    setConnectionStatus(errorText, "#dc2626");
    setPriceStatus(errorText, "#dc2626");
    return;
  }

  if (message.msg_type === "active_symbols") {
    handleActiveSymbols(message.active_symbols || []);
    return;
  }

  if (message.msg_type === "tick" && message.tick) {
    if (message.subscription && message.subscription.id) {
      state.subscriptionId = message.subscription.id;
    }

    handleTick(message.tick);
  }
}

/* ---------------- AVAILABLE MARKETS ---------------- */

function handleActiveSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    setMarketStatus(
      "Connected, but no markets were returned by the API.",
      "#dc2626"
    );
    return;
  }

  state.markets = symbols
    .filter(item => item && item.symbol && item.display_name)
    .sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))
    );

  const select = $("marketSelect", "market");

  if (!select) {
    setMarketStatus(
      `${state.markets.length} markets received, but the market selector was not found.`,
      "#dc2626"
    );
    return;
  }

  const previousSymbol = state.symbol;

  select.innerHTML = "";

  state.markets.forEach(market => {
    const option = document.createElement("option");
    option.value = market.symbol;
    option.textContent = market.display_name;
    select.appendChild(option);
  });

  const chosen =
    state.markets.find(item => item.symbol === previousSymbol) ||
    state.markets.find(item => item.symbol === DEFAULT_SYMBOL) ||
    state.markets[0];

  state.symbol = chosen.symbol;
  state.symbolName = chosen.display_name;
  select.value = state.symbol;

  setMarketStatus(
    `${state.markets.length} markets loaded.`,
    "#15803d"
  );

  setText(
    ["selectedMarket"],
    `Selected market: ${state.symbolName}`
  );

  subscribeToSelectedMarket();
}

/* ---------------- SUBSCRIBE TO SELECTED MARKET ---------------- */

function subscribeToSelectedMarket() {
  if (!state.socket ||
      state.socket.readyState !== WebSocket.OPEN) {
    setPriceStatus(
      "Markets loaded. Waiting for public connection...",
      "#d97706"
    );
    return;
  }

  if (state.subscriptionId) {
    sendRequest({ forget: state.subscriptionId });
    state.subscriptionId = null;
  }

  state.totalTicks = 0;
  state.priceHistory = [];
  state.digitHistory = [];
  state.digitCounts = Array(10).fill(0);
  state.lastPrice = null;
  state.previousPrice = null;
  state.lastDigit = null;

  renderAll();

  setPriceStatus(`Subscribing to ${state.symbolName}...`, "#d97706");

  const sent = sendRequest({
    ticks: state.symbol,
    subscribe: 1
  });

  if (!sent) {
    setPriceStatus("Could not request market ticks.", "#dc2626");
  }
}

/* ---------------- PROCESS LIVE TICKS ---------------- */

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

  state.priceHistory.push({
    price,
    time: Number(tick.epoch) || Date.now() / 1000
  });

  if (state.priceHistory.length > MAX_PRICES) {
    state.priceHistory.shift();
  }

  state.digitHistory.push(digit);
  state.digitCounts[digit]++;

  if (state.digitHistory.length > MAX_DIGITS) {
    const removed = state.digitHistory.shift();
    state.digitCounts[removed]--;
  }

  setPriceStatus(
    `Live feed active. Received ${state.totalTicks} ticks.`,
    "#15803d"
  );

  setConnectionStatus("Connected — live feed active.", "#15803d");

  renderAll();
}

/* ---------------- LIVE VALUES ---------------- */

function renderLiveValues() {
  setText(
    ["livePrice", "latestPrice"],
    state.lastPrice === null ? "--" : state.lastPrice.toFixed(state.pipSize)
  );

  setText(
    ["activeDigit", "liveDigit", "lastDigit"],
    state.lastDigit === null ? "--" : state.lastDigit
  );

  setText(
    ["ticksReceived", "tickCount", "totalTicks"],
    state.totalTicks
  );

  setText(
    ["selectedMarket"],
    `Selected market: ${state.symbolName}`
  );
}

/* ---------------- RECENT DIGITS ---------------- */

function renderDigitHistory() {
  const container = $("digitHistory", "history");

  if (!container) return;

  if (!state.digitHistory.length) {
    container.textContent = "Waiting for live digits...";
    return;
  }

  container.innerHTML = state.digitHistory
    .slice(-30)
    .reverse()
    .map(digit => {
      const parity = digit % 2 === 0 ? "even" : "odd";
      return `<span class="digit-item ${parity}">${digit}</span>`;
    })
    .join("");
}

/* ---------------- PRICE CHART ---------------- */

function renderPriceChart() {
  const canvas = $("priceChart");

  if (canvas && typeof canvas.getContext === "function") {
    renderCanvasChart(canvas);
    return;
  }

  const svg = $("chart");

  if (!svg) return;

  if (state.priceHistory.length < 2) {
    svg.innerHTML = `
      <text x="350" y="95" fill="#9eb0ca" text-anchor="middle">
        Waiting for live market data...
      </text>`;
    return;
  }

  const values = state.priceHistory.map(item => item.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 0.000001;

  const points = values.map((value, index) => {
    const x = 18 + index / (values.length - 1) * 664;
    const y = 16 + (max - value) / spread * 142;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const color =
    values[values.length - 1] > values[0] ? "#35d49a" :
    values[values.length - 1] < values[0] ? "#ff6b7a" : "#55e4ef";

  svg.innerHTML = `
    <g stroke="#263b59" stroke-width="1">
      <line x1="18" y1="50" x2="682" y2="50"/>
      <line x1="18" y1="90" x2="682" y2="90"/>
      <line x1="18" y1="130" x2="682" y2="130"/>
    </g>
    <polyline points="${points}" fill="none" stroke="${color}"
      stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="18" y="180" fill="#9eb0ca" font-size="11">
      Low: ${min.toFixed(state.pipSize)}
    </text>
    <text x="682" y="180" fill="#9eb0ca" font-size="11" text-anchor="end">
      High: ${max.toFixed(state.pipSize)}
    </text>`;
}

function renderCanvasChart(canvas) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 220;
  const ratio = window.devicePixelRatio || 1;

  if (canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (state.priceHistory.length < 2) {
    context.fillStyle = "#9eb0ca";
    context.font = "12px sans-serif";
    context.fillText("Waiting for price movement...", 12, 24);
    return;
  }

  const values = state.priceHistory.map(item => item.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 0.000001;
  const padding = 14;

  context.beginPath();
  context.strokeStyle = "#263b59";

  for (let line = 0; line < 4; line++) {
    const y = padding + (height - padding * 2) * line / 3;
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
  }

  context.stroke();

  context.beginPath();
  context.strokeStyle =
    values[values.length - 1] >= values[0] ? "#35d49a" : "#ff6b7a";
  context.lineWidth = 2;

  values.forEach((value, index) => {
    const x = padding + index / (values.length - 1) * (width - padding * 2);
    const y = padding + (max - value) / spread * (height - padding * 2);

    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
}

/* ---------------- DIGIT ANALYSIS ---------------- */

function renderDigitAnalysis() {
  const digits = state.digitHistory;
  const size = digits.length;

  setText(["sampleSize", "analysisSampleSize"], size);

  if (!size) {
    setText(["mostFrequentDigit"], "—");
    setText(["evenOdd"], "--");
    setText(["overUnder"], "--");
    setText(
      ["digitAnalysis", "analysisStatus"],
      "Waiting for ticks to begin analysis."
    );
    return;
  }

  const counts = state.digitCounts;
  const highest = Math.max(...counts);

  const mostFrequent = counts
    .map((count, digit) => ({ digit, count }))
    .filter(item => item.count === highest)
    .map(item => item.digit);

  const even = digits.filter(digit => digit % 2 === 0).length;
  const odd = size - even;
  const overFive = digits.filter(digit => digit > 5).length;
  const underFive = digits.filter(digit => digit < 5).length;
  const equalFive = digits.filter(digit => digit === 5).length;

  const percent = count => `${(count / size * 100).toFixed(1)}%`;

  setText(
    ["mostFrequentDigit"],
    `${mostFrequent.join(", ")} (${highest}, ${percent(highest)})`
  );

  setText(
    ["evenOdd"],
    `Even ${even} (${percent(even)}) / Odd ${odd} (${percent(odd)})`
  );

  setText(
    ["overUnder"],
    `Over 5: ${overFive} (${percent(overFive)}) / Under 5: ${underFive} (${percent(underFive)}) / 5: ${equalFive}`
  );

  setText(
    ["digitAnalysis", "analysisStatus"],
    size < MIN_ANALYSIS_TICKS
      ? `Collecting data: ${size}/${MIN_ANALYSIS_TICKS} ticks.`
      : `Analysis based on ${size} observed ticks. Frequencies describe this sample; they do not predict the next digit.`
  );
}

/* ---------------- SHARP BOT: SIGNAL ONLY ---------------- */

function renderSignal() {
  setText(["signal", "currentSignal"], "WAIT");

  const size = state.digitHistory.length;

  const reason = size < MIN_ANALYSIS_TICKS
    ? `Collecting data: ${size}/${MIN_ANALYSIS_TICKS} ticks. No order will be placed.`
    : `Sharp Bot is monitoring ${size} observed digits. WAIT remains active because sample frequencies alone do not validate an edge. No order will be placed.`;

  setText(["signalReason"], reason);

  setBotStatus(
    state.monitorRunning
      ? "SHARP BOT · SIGNAL-ONLY · MONITORING"
      : "SHARP BOT · SIGNAL-ONLY · STOPPED",
    state.monitorRunning ? "#15803d" : "#64748b"
  );

  const buyButton = $("buyBtn", "confirmBuy", "confirmBuyButton");

  if (buyButton) {
    buyButton.disabled = true;
    buyButton.textContent = "CONFIRM BUY — DISABLED";
    buyButton.title = "Trading orders are disabled.";
  }

  if (ORDERS_ENABLED || REAL_MONEY_TRADING_ENABLED) {
    console.error("Safety lock error: orders must remain disabled.");
  }
}

function startSignalMonitor() {
  state.monitorRunning = true;
  renderSignal();
  setAppStatus("Sharp Bot started in signal-only mode. No orders will be placed.", "#15803d");
}

function stopSignalMonitor() {
  state.monitorRunning = false;
  renderSignal();
  setAppStatus("Sharp Bot monitoring stopped. No orders were placed.", "#64748b");
}

/* ---------------- TESTING JOURNAL ---------------- */

function recordObservation() {
  const strategyElement = $("strategy", "strategySelect");
  const notesElement = $("observationNotes", "notes");

  const strategy = strategyElement
    ? strategyElement.value
    : "Digits Over / Under";

  const notes = notesElement
    ? notesElement.value.trim()
    : "";

  if (!notes) {
    setText(
      ["journalStatus", "observationStatus"],
      "Enter observation notes before recording."
    );
    return;
  }

  const observation = {
    time: new Date().toLocaleString(),
    market: state.symbolName,
    strategy,
    sampleSize: state.digitHistory.length,
    lastDigit: state.lastDigit,
    notes
  };

  state.observations.unshift(observation);
  renderObservations();

  if (notesElement) notesElement.value = "";

  setText(
    ["journalStatus", "observationStatus"],
    "Observation recorded for this session. No order was placed."
  );
}


function renderObservations() {
  const container = $("observationList", "journalEntries");
  if (!container) return;

  if (!state.observations.length) {
    container.textContent = "No observations recorded this session.";
    return;
  }

  container.innerHTML = state.observations.map(item => `
    <article style="
 padding:12px;
      margin:10px 0;
      border:1px solid #263449;
      border-radius:10px;
      background:#111827;
    ">
      <div style="
        display:flex;
        justify-content:space-between;
        gap:10px;
        flex-wrap:wrap;
        margin-bottom:8px;
      ">
        <strong style="color:#60a5fa;">
          ${escapeHTML(item.strategy || "General Observation")}
        </strong>
        <small style="color:#9ca3af;">
          ${escapeHTML(item.time || item.timestamp || "")}
        </small>
      </div>

      <p style="
        margin:0;
        color:#e5e7eb;
        white-space:pre-wrap;
        overflow-wrap:anywhere;
      ">${escapeHTML(item.notes || item.observation || "")}</p>
    </article>
  `).join("");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
                       }
          
