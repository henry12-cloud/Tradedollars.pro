
/* =========================================================
   TRADEDOLLARS — SCRIPT.JS
   Public market feed + digit analysis + signal-only monitor
   No orders. Real-money trading is disabled.
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
const CONNECTION_TIMEOUT_MS = 12000;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

/* No order placement is implemented in this file. */
const REAL_MONEY_TRADING_ENABLED = false;
const ORDERS_ENABLED = false;

/* ---------------- ELEMENT HELPERS ---------------- */

const $ = (...ids) => {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
};

const setText = (ids, value) => {
  const element = $(...ids);
  if (element) element.textContent = String(value);
};

const setStatus = (ids, message, color) => {
  const element = $(...ids);
  if (!element) return;

  element.textContent = message;

  if (color) {
    element.style.color = color;
  }
};

const escapeHTML = value =>
  String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

/* ---------------- APPLICATION STATE ---------------- */

const state = {
  socket: null,
  connectionTimer: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  manuallyStopped: false,
  connectionOpened: false,

  markets: [],
  symbol: DEFAULT_SYMBOL,
  symbolName: "Volatility 100 (1s) Index",

  priceHistory: [],
  digitHistory: [],
  totalTicks: 0,

  lastPrice: null,
  lastDigit: null,
  pipSize: 2,

  monitorRunning: false,
  observations: [],

  requestId: 1,
  pendingRequests: new Map()
};

/* ---------------- STATUS DISPLAY ---------------- */

function setAppStatus(message, color) {
  setStatus(["appStatus"], message, color);
}

function setMarketStatus(message, color) {
  setStatus(["marketStatus"], message, color);
}

function setPriceStatus(message, color) {
  setStatus(["priceStatus"], message, color);
}

function setBotStatus(message, color) {
  setStatus(["botStatus"], message, color);
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

/* ---------------- SAFE WEBSOCKET SEND ---------------- */

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
    console.error("WebSocket send failed:", error);
    return false;
  }
}

/* ---------------- MARKET CONNECTION ---------------- */

function connectPublicSocket() {
  if (
    state.socket &&
    (
      state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  state.manuallyStopped = false;
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.connectionTimer);

  updateConnectionDisplay(
    "Connecting to public market data...",
    "#d97706"
  );

  setPriceStatus(
    "Connecting to live market data...",
    "#d97706"
  );

  setAppStatus("Connecting to market feed...", "#d97706");

  let socket;

  try {
    socket = new WebSocket(PUBLIC_WS_URL);
    state.socket = socket;
  } catch (error) {
    console.error("Could not create WebSocket:", error);
    handleConnectionFailure(
      "Could not start market connection. Check the app ID and browser connection."
    );
    return;
  }

  state.connectionOpened = false;

  state.connectionTimer = setTimeout(() => {
    if (
      state.socket === socket &&
      socket.readyState !== WebSocket.OPEN
    ) {
      try {
        socket.close();
      } catch (_) {
        // The connection may already be closed.
      }

      handleConnectionFailure(
        "Connection timed out. The market server did not respond in time."
      );
    }
  }, CONNECTION_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;

    clearTimeout(state.connectionTimer);
    state.connectionOpened = true;
    state.reconnectAttempts = 0;

    updateConnectionDisplay(
      "Connected. Requesting available markets...",
      "#15803d"
    );

    setAppStatus("Market connection established.", "#15803d");

    const sent = sendRequest({
      active_symbols: "brief",
      product_type: "basic"
    });

    if (!sent) {
      handleConnectionFailure(
        "Connected, but the market-list request could not be sent."
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
      setMarketStatus(
        "Received an unreadable market response.",
        "#dc2626"
      );
      return;
    }

    handlePublicMessage(message);
  });

  socket.addEventListener("error", event => {
    console.error("Public WebSocket error:", event);

    setConnectionStatus(
      "Market connection error. Waiting for connection details...",
      "#dc2626"
    );
  });

  socket.addEventListener("close", event => {
    if (state.socket !== socket) return;

    clearTimeout(state.connectionTimer);
    state.socket = null;

    console.warn(
      "Market connection closed:",
      event.code,
      event.reason
    );

    if (state.manuallyStopped) return;

    const reason = event.reason
      ? `Connection closed: ${event.reason}`
      : `Connection closed (code ${event.code}).`;

    handleConnectionFailure(
      `${reason} Reconnecting automatically.`
    );
  });
}

function handleConnectionFailure(message) {
  clearTimeout(state.connectionTimer);

  updateConnectionDisplay(message, "#dc2626");
  setPriceStatus(message, "#dc2626");
  setAppStatus(message, "#dc2626");

  if (state.manuallyStopped) return;

  scheduleReconnect();
}

function scheduleReconnect() {
  if (state.manuallyStopped || state.reconnectTimer) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS *
      Math.pow(2, state.reconnectAttempts),
    MAX_RECONNECT_DELAY_MS
  );

  state.reconnectAttempts += 1;

  const seconds = Math.ceil(delay / 1000);

  setConnectionStatus(
    `Reconnecting in ${seconds} second(s)...`,
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

    try {
      socket.close();
    } catch (error) {
      console.warn("Socket close issue:", error);
    }
  }

  updateConnectionDisplay("Market feed stopped.", "#64748b");
}

/* ---------------- MESSAGE HANDLING ---------------- */

function handlePublicMessage(message) {
  if (message.error) {
    const errorCode = message.error.code || "Unknown error";
    const errorMessage =
      message.error.message || "The market server returned an error.";

    console.error("Market API error:", errorCode, errorMessage);

    setMarketStatus(
      `Market API error (${errorCode}): ${errorMessage}`,
      "#dc2626"
    );

    setConnectionStatus(
      `Market API error (${errorCode}): ${errorMessage}`,
      "#dc2626"
    );

    return;
  }

  if (message.msg_type === "active_symbols") {
    handleActiveSymbols(message.active_symbols || []);
    return;
  }

  if (message.msg_type === "tick" && message.tick) {
    handleTick(message.tick);
  }
}

/* ---------------- MARKET LIST ---------------- */

function handleActiveSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    setMarketStatus(
      "Connected, but no markets were returned. Check API access and response details.",
      "#dc2626"
    );
    return;
  }

  state.markets = symbols
    .filter(item => item && item.symbol && item.display_name)
    .sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))
    );

  const select = $("marketSelect");

  if (!select) {
    setMarketStatus(
      `${state.markets.length} markets received, but marketSelect was not found in index.html.`,
      "#dc2626"
    );
    return;
  }

  const preferred = state.markets.find(
    item => item.symbol === DEFAULT_SYMBOL
  );

  const current = state.markets.find(
    item => item.symbol === state.symbol
  );

  const chosen = current || preferred || state.markets[0];

  select.innerHTML = "";

  state.markets.forEach(market => {
    const option = document.createElement("option");
    option.value = market.symbol;
    option.textContent = market.display_name;
    select.appendChild(option);
  });

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

/* ---------------- TICK SUBSCRIPTION ---------------- */

function subscribeToSelectedMarket() {
  if (
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN
  ) {
    setPriceStatus(
      "Market list loaded. Waiting for the public connection...",
      "#d97706"
    );
    return;
  }

  state.priceHistory = [];
  state.digitHistory = [];
  state.totalTicks = 0;
  state.lastPrice = null;
  state.lastDigit = null;

  renderLiveValues();
  renderDigitHistory();
  renderPriceChart();
  renderDigitAnalysis();
  renderSignal();

  setPriceStatus(
    `Subscribing to ${state.symbolName}...`,
    "#d97706"
  );

  const sent = sendRequest({
    ticks: state.symbol,
    subscribe: 1
  });

  if (!sent) {
    setPriceStatus(
      "Could not request ticks. The connection may have closed.",
      "#dc2626"
    );
  }
}

/* ---------------- LIVE TICK PROCESSING ---------------- */

function handleTick(tick) {
  if (tick.symbol && tick.symbol !== state.symbol) {
    return;
  }

  const rawQuote = Number(tick.quote);

  if (!Number.isFinite(rawQuote)) {
    console.warn("Ignored invalid tick:", tick);
    return;
  }

  if (Number.isInteger(tick.pip_size)) {
    state.pipSize = tick.pip_size;
  }

  const price = rawQuote;
  const formattedPrice = price.toFixed(state.pipSize);
  const lastCharacter = formattedPrice.slice(-1);
  const digit = Number(lastCharacter);

  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    console.warn("Could not extract final digit:", formattedPrice);
    return;
  }

  state.totalTicks += 1;
  state.lastPrice = price;
  state.lastDigit = digit;

  state.priceHistory.push({
    price,
    time: Number(tick.epoch) || Date.now() / 1000
  });

  if (state.priceHistory.length > MAX_PRICES) {
    state.priceHistory.shift();
  }

  state.digitHistory.push(digit);

  if (state.digitHistory.length > MAX_DIGITS) {
    state.digitHistory.shift();
  }

  setPriceStatus(
    `Live feed active. Received ${state.totalTicks} ticks.`,
    "#15803d"
  );

  setConnectionStatus("Connected — live feed active.", "#15803d");

  renderLiveValues();
  renderDigitHistory();
  renderPriceChart();
  renderDigitAnalysis();
  renderSignal();
}

/* ---------------- LIVE VALUES ---------------- */

function renderLiveValues() {
  setText(
    ["livePrice", "latestPrice"],
    state.lastPrice === null
      ? "--"
      : state.lastPrice.toFixed(state.pipSize)
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

/* ---------------- DIGIT HISTORY ---------------- */

function renderDigitHistory() {
  const container = $("digitHistory");

  if (!container) return;

  if (state.digitHistory.length === 0) {
    container.textContent = "Waiting for live digits...";
    return;
  }

  const recent = state.digitHistory.slice(-30).reverse();

  container.innerHTML = recent.map((digit, index) => {
    const parity = digit % 2 === 0 ? "even" : "odd";

    return `
      <span
        class="digit-item ${parity}"
        title="Recent digit ${digit}"
        style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:28px;
          min-height:28px;
          margin:3px;
          padding:3px;
          border:1px solid #64748b;
          border-radius:6px;
        "
      >${escapeHTML(digit)}</span>
    `;
  }).join("");
}

/* ---------------- PRICE CHART ---------------- */

function renderPriceChart() {
  const canvas = $("priceChart", "chart");

  if (!canvas || !canvas.getContext) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 220;
  const pixelRatio = window.devicePixelRatio || 1;

  if (
    canvas.width !== Math.round(width * pixelRatio) ||
    canvas.height !== Math.round(height * pixelRatio)
  ) {
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  context.font = "12px sans-serif";
  context.fillStyle = "#64748b";

  if (state.priceHistory.length < 2) {
    context.fillText("Waiting for price movement...", 12, 24);
    return;
  }

  const values = state.priceHistory.map(item => item.price);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = maximum - minimum || 0.000001;

  const padding = 14;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  context.beginPath();
  context.strokeStyle = "#94a3b8";
  context.lineWidth = 1;

  for (let line = 0; line < 4; line++) {
    const y = padding + (chartHeight * line) / 3;
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
  }

  context.stroke();

  context.beginPath();
  context.strokeStyle = "#2563eb";
  context.lineWidth = 2;

  values.forEach((value, index) => {
    const x = padding +
      (index / (values.length - 1)) * chartWidth;

    const y = padding +
      ((maximum - value) / spread) * chartHeight;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();

  context.fillStyle = "#64748b";
  context.fillText(`High: ${maximum.toFixed(state.pipSize)}`, padding, height - 2);
  context.fillText(`Low: ${minimum.toFixed(state.pipSize)}`, Math.max(padding, width - 150), height - 2);
}

/* ---------------- DIGIT STATISTICS ---------------- */

function renderDigitAnalysis() {
  const digits = state.digitHistory;
  const sampleSize = digits.length;

  setText(["sampleSize", "analysisSampleSize"], sampleSize);

  if (sampleSize === 0) {
    setText(["mostFrequentDigit"], "—");
    setText(["evenOdd"], "--");
    setText(["overUnder"], "--");
    setText(
      ["digitAnalysis", "analysisStatus"],
      "Waiting for ticks to begin analysis."
    );
    return;
  }

  const counts = Array(10).fill(0);

  digits.forEach(digit => {
    counts[digit] += 1;
  });

  const highestCount = Math.max(...counts);
  const mostFrequent = counts
    .map((count, digit) => ({ digit, count }))
    .filter(item => item.count === highestCount)
    .map(item => item.digit);

  const evenCount = digits.filter(digit => digit % 2 === 0).length;
  const oddCount = sampleSize - evenCount;

  const overFive = digits.filter(digit => digit > 5).length;
  const underFive = digits.filter(digit => digit < 5).length;
  const equalFive = digits.filter(digit => digit === 5).length;

  const percentage = count =>
    `${((count / sampleSize) * 100).toFixed(1)}%`;

  setText(
    ["mostFrequentDigit"],
    `${mostFrequent.join(", ")} (${highestCount}, ${percentage(highestCount)})`
  );

  setText(
    ["evenOdd"],
    `Even ${evenCount} (${percentage(evenCount)}) / Odd ${oddCount} (${percentage(oddCount)})`
  );

  setText(
    ["overUnder"],
    `Over 5: ${overFive} (${percentage(overFive)}) / Under 5: ${underFive} (${percentage(underFive)}) / 5: ${equalFive}`
  );

  setText(
    ["digitAnalysis", "analysisStatus"],
    sampleSize < MIN_ANALYSIS_TICKS
      ? `Collecting data: ${sampleSize}/${MIN_ANALYSIS_TICKS} ticks.`
      : `Analysis based on ${sampleSize} observed ticks. These frequencies describe the sample and do not predict the next digit.`
  );
}

/* ---------------- SIGNAL-ONLY MONITOR ---------------- */

function renderSignal() {
  setText(["signal", "currentSignal"], "WAIT");

  const sampleSize = state.digitHistory.length;

  let reason;

  if (sampleSize < MIN_ANALYSIS_TICKS) {
    reason =
      `Collecting data: ${sampleSize}/${MIN_ANALYSIS_TICKS} ticks. No order will be placed.`;
  } else {
    reason =
      `Monitoring ${sampleSize} observed digits. Statistics are descriptive, not predictive. No order will be placed.`;
  }

  setText(["signalReason"], reason);

  if (state.monitorRunning) {
    setBotStatus("SIGNAL-ONLY · MONITORING", "#15803d");
  } else {
    setBotStatus("SIGNAL-ONLY · STOPPED", "#64748b");
  }

  const buyButton = $("buyBtn", "confirmBuy", "confirmBuyButton");

  if (buyButton) {
    buyButton.disabled = true;
    buyButton.textContent = "CONFIRM BUY — DISABLED";
    buyButton.title = "Orders are disabled in this signal-only build.";
  }
}

function startSignalMonitor() {
  state.monitorRunning = true;
  renderSignal();
  setAppStatus("Signal monitor started. No orders will be placed.", "#15803d");
}

function stopSignalMonitor() {
  state.monitorRunning = false;
  renderSignal();
  setAppStatus("Signal monitor stopped. No orders were placed.", "#64748b");
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

  if (state.observations.length === 0) {
    container.textContent = "No observations recorded this session.";
    return;
  }

  container.innerHTML = state.observations.map(item => `
    <article style="padding:10px 0;border-bottom:1px solid #cbd5e1">
      <strong>${escapeHTML(item.strategy)}</strong>
      <div>${escapeHTML(item.time)}</div>
      
