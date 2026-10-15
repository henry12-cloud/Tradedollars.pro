
/* =========================================================
   TRADEDOLLARS.PRO
   Public Deriv market data + analysis + signal-only monitor
   NO ORDERS | NO ACCOUNT TOKENS | REAL TRADING DISABLED
   ========================================================= */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const WS_URL =
  "wss://ws.derivws.com/websockets/v3?app_id=1089";

const DEFAULT_SYMBOL = "1HZ100V";
const MAX_DIGIT_HISTORY = 2000;
const MAX_PRICE_HISTORY = 100;
const MIN_ANALYSIS_TICKS = 20;
const CONNECTION_TIMEOUT_MS = 15000;
const MAX_RECONNECT_DELAY_MS = 30000;

/* ---------------- APPLICATION STATE ---------------- */

const state = {
  socket: null,
  symbol: DEFAULT_SYMBOL,
  connected: false,
  intentionalClose: false,
  reconnectTimer: null,
  connectionTimer: null,
  reconnectAttempts: 0,
  totalTicks: 0,
  latestPrice: null,
  latestDigit: null,
  pipSize: 2,
  digitHistory: [],
  priceHistory: [],
  lastEpoch: null
};

const $ = id => document.getElementById(id);

/* ---------------- STATUS DISPLAY ---------------- */

function setStatus(message, connected = false) {
  const status = $("connectionStatus");
  const dot = $("statusDot");

  if (status) status.textContent = message;

  if (dot) {
    dot.style.background = connected
      ? "#35d49a"
      : "#ffc76b";
  }

  state.connected = connected;
}

function clearConnectionTimers() {
  if (state.connectionTimer) {
    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

/* ---------------- PRICE FORMATTING ---------------- */

function formatPrice(value) {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("en-US", {
    minimumFractionDigits: state.pipSize,
    maximumFractionDigits: state.pipSize
  });
}

function extractLastDigit(value, pipSize) {
  const decimals = Math.max(0, Math.min(10, Number(pipSize) || 0));
  const formatted = Number(value).toFixed(decimals);
  const digits = formatted.replace(/\D/g, "");

  return digits.length ? Number(digits[digits.length - 1]) : null;
}

/* ---------------- RESET ANALYSIS ---------------- */

function resetAnalysis() {
  state.totalTicks = 0;
  state.latestPrice = null;
  state.latestDigit = null;
  state.pipSize = 2;
  state.digitHistory = [];
  state.priceHistory = [];
  state.lastEpoch = null;

  if ($("price")) $("price").textContent = "Waiting for ticks…";
  if ($("priceChange")) $("priceChange").textContent = "Price change: —";
  if ($("tickCount")) $("tickCount").textContent = "0 ticks";
  if ($("lastDigit")) $("lastDigit").textContent = "—";
  if ($("sampleSize")) $("sampleSize").textContent = "0";
  if ($("support")) $("support").textContent = "—";
  if ($("resistance")) $("resistance").textContent = "—";
  if ($("historyCount")) $("historyCount").textContent = "0";

  if ($("trend")) {
    $("trend").textContent = "COLLECTING DATA";
    $("trend").className = "neutral";
  }

  if ($("trendReason")) {
    $("trendReason").textContent =
      "Collecting new market observations. No prediction is guaranteed.";
  }

  if ($("signal")) {
    $("signal").textContent = "WAIT";
    $("signal").className = "neutral";
  }

  if ($("signalReason")) {
    $("signalReason").textContent =
      "Signal-only monitoring. No orders will be placed.";
  }

  if ($("chart")) {
    $("chart").innerHTML =
      '<text x="350" y="95" fill="#9eb0ca" text-anchor="middle">' +
      "Waiting for live market data…" +
      "</text>";
  }

  if ($("digits")) $("digits").innerHTML = "";

  if ($("history")) {
    $("history").innerHTML =
      '<span class="muted">Waiting for market ticks…</span>';
  }
}

/* ---------------- CONNECT TO PUBLIC FEED ---------------- */

function connect() {
  clearConnectionTimers();

  state.intentionalClose = true;

  if (state.socket) {
    try {
      state.socket.close();
    } catch (_) {
      // Continue opening a fresh connection.
    }
  }

  state.intentionalClose = false;

  if (!navigator.onLine) {
    setStatus("Device offline — waiting for internet");
    scheduleReconnect();
    return;
  }

  setStatus("Connecting to public market data…");

  let socket;

  try {
    socket = new WebSocket(WS_URL);
  } catch (error) {
    setStatus("Could not open market connection");
    scheduleReconnect();
    return;
  }

  state.socket = socket;

  state.connectionTimer = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      try {
        socket.close();
      } catch (_) {
        // Reconnection is handled by close.
      }
    }
  }, CONNECTION_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;

    if (state.connectionTimer) {
      clearTimeout(state.connectionTimer);
      state.connectionTimer = null;
    }

    state.reconnectAttempts = 0;
    setStatus("Connected — waiting for market ticks", true);

    // Public tick subscription only. No account authorization.
    socket.send(JSON.stringify({
      ticks: state.symbol,
      subscribe: 1
    }));
  });

  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (message.error) {
      const errorMessage =
        message.error.message || "Market data request failed";

      setStatus("Market feed error: " + errorMessage);
      return;
    }

    if (message.msg_type === "tick" && message.tick) {
      processTick(message.tick);
    }
  });

  socket.addEventListener("error", () => {
    if (state.socket === socket) {
      setStatus("Market connection error — reconnecting");
    }
  });

  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;

    state.socket = null;
    setStatus("Connection closed — reconnecting");
    scheduleReconnect();
  });
}

/* ---------------- RECONNECT ---------------- */

function scheduleReconnect() {
  if (state.reconnectTimer) return;

  const delay = Math.min(
    1000 * Math.pow(2, state.reconnectAttempts),
    MAX_RECONNECT_DELAY_MS
  );

  state.reconnectAttempts += 1;

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

/* ---------------- PROCESS EACH TICK ---------------- */

function processTick(tick) {
  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  state.pipSize = Number.isFinite(Number(tick.pip_size))
    ? Number(tick.pip_size)
    : state.pipSize;

  const previousPrice = state.latestPrice;
  const digit = extractLastDigit(price, state.pipSize);

  state.latestPrice = price;
  state.latestDigit = digit;
  state.lastEpoch = tick.epoch ?? null;
  state.totalTicks += 1;

  state.priceHistory.push(price);

  if (state.priceHistory.length > MAX_PRICE_HISTORY) {
    state.priceHistory.shift();
  }

  if (digit !== null) {
    state.digitHistory.push(digit);

    if (state.digitHistory.length > MAX_DIGIT_HISTORY) {
      state.digitHistory.shift();
    }
  }

  renderPrice(previousPrice);
  renderChart();
  renderDigits();
  renderHistory();
  analyseMarket();
}

/* ---------------- LIVE PRICE ---------------- */

function renderPrice(previousPrice) {
  if ($("price")) {
    $("price").textContent = formatPrice(state.latestPrice);
  }

  if ($("tickCount")) {
    $("tickCount").textContent =
      state.totalTicks.toLocaleString() + " ticks";
  }

  if ($("lastDigit")) {
    $("lastDigit").textContent =
      state.latestDigit === null ? "—" : String(state.latestDigit);
  }

  if ($("sampleSize")) {
    $("sampleSize").textContent =
      state.digitHistory.length.toLocaleString();
  }

  if ($("historyCount")) {
    $("historyCount").textContent =
      state.digitHistory.length.toLocaleString() +
      " / " + MAX_DIGIT_HISTORY;
  }

  if ($("priceChange")) {
    if (previousPrice === null || previousPrice === undefined) {
      $("priceChange").textContent = "Price change: collecting baseline";
      $("priceChange").className = "small muted";
    } else {
      const difference = state.latestPrice - previousPrice;
      const sign = difference > 0 ? "+" : "";

      $("priceChange").textContent =
        "Price change: " + sign + formatPrice(difference);

      $("priceChange").className =
        "small " +
        (difference > 0 ? "up" : difference < 0 ? "down" : "muted");
    }
  }
}

/* ---------------- SVG PRICE CHART ---------------- */

function renderChart() {
  const svg = $("chart");
  if (!svg) return;

  const values = state.priceHistory;

  if (values.length < 2) {
    svg.innerHTML =
      '<text x="350" y="95" fill="#9eb0ca" text-anchor="middle">' +
      "Collecting price points…" +
      "</text>";
    return;
  }

  const width = 700;
  const height = 190;
  const padding = 12;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = padding +
      (index / (values.length - 1)) * (width - padding * 2);

    const y = height - padding -
      ((value - min) / range) * (height - padding * 2);

    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  const color = values[values.length - 1] >= values[0]
    ? "#35d49a"
    : "#ff6b7a";

  svg.innerHTML =
    `<polyline points="${points}" fill="none" stroke="${color}" ` +
    'stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
}

/* ---------------- DIGIT FREQUENCIES ---------------- */

function renderDigits() {
  const container = $("digits");
  if (!container) return;

  const counts = Array(10).fill(0);

  for (const digit of state.digitHistory) {
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9) {
      counts[digit] += 1;
    }
  }

  const total = state.digitHistory.length;

  if (!total) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = counts.map((count, digit) => {
    const percentage = (count / total) * 100;

    return `
      <div class="digit">
        ${digit}
        <div class="small muted">${percentage.toFixed(1)}%</div>
        <div class="bar"><i style="width:${percentage.toFixed(1)}%"></i></div>
      </div>
    `;
  }).join("");
}

/* ---------------- RECENT DIGITS ---------------- */

function renderHistory() {
  const container = $("history");
  if (!container) return;

  const recent = state.digitHistory.slice(-30).reverse();

  if (!recent.length) {
    container.innerHTML =
      '<span class="muted">Waiting for market ticks…</span>';
    return;
  }

  container.innerHTML = recent.map(digit =>
    `<span>${digit}</span>`
  ).join("");
}

/* ---------------- MARKET ANALYSIS ---------------- */

function average(values) {
  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function analyseMarket() {
  const prices = state.priceHistory;
  const digits = state.digitHistory;

  if (prices.length < MIN_ANALYSIS_TICKS) {
    if ($("trend")) {
      $("trend").textContent = "COLLECTING DATA";
      $("trend").className = "neutral";
    }

    if ($("trendReason")) {
      $("trendReason").textContent =
        `Need at least ${MIN_ANALYSIS_TICKS} recent price observations. ` +
        `Current chart sample: ${prices.length}.`;
    }

    if ($("signal")) {
      $("signal").textContent = "WAIT";
      $("signal").className = "neutral";
    }

    if ($("signalReason")) {
      $("signalReason").textContent =
        "Insufficient observations. Signal-only mode; no orders are placed.";
    }

    return;
  }

  const recent = prices.slice(-10);
  const earlier = prices.slice(-20, -10);

  const recentAverage = average(recent);
  const earlierAverage = average(earlier);
  const difference = recentAverage - earlierAverage;

  // Small movements are treated as unclear rather than a strong signal.
  const threshold = Math.abs(earlierAverage) * 0.00002;

  let direction = "SIDEWAYS";

  if (difference > threshold) direction = "UPWARD";
  if (difference < -threshold) direction = "DOWNWARD";

  if ($("trend")) {
    $("trend").textContent = direction;
    $("trend").className =
      direction === "UPWARD"
        ? "up"
        : direction === "DOWNWARD"
          ? "down"
          : "neutral";
  }

  if ($("trendReason")) {
    $("trendReason").textContent =
      `Recent 10-point average: ${formatPrice(recentAverage)}. ` +
      `Previous 10-point average: ${formatPrice(earlierAverage)}. ` +
      "This is a simple description of recent movement, not a forecast.";
  }

  const sample = prices.slice(-20);
  const supportEstimate = Math.min(...sample);
  const resistanceEstimate = Math.max(...sample);

  if ($("support")) {
    $("support").textContent = formatPrice(supportEstimate);
  }

  if ($("resistance")) {
    $("resistance").textContent = formatPrice(resistanceEstimate);
  }

  // Digit statistics are descriptive only.
  const evenCount = digits.filter(d => d % 2 === 0).length;
  const oddCount = digits.length - evenCount;
  const overFiveCount = digits.filter(d => d > 5).length;
  const underFiveCount = digits.filter(d => d < 5).length;

  const evenPercent = digits.length
    ? (evenCount / digits.length) * 100
    : 0;

  const oddPercent = digits.length
    ? (oddCount / digits.length) * 100
    : 0;

  const overFivePercent = digits.length
    ? (overFiveCount / digits.length) * 100
    : 0;

  const underFivePercent = digits.length
    ? (underFiveCount / digits.length) * 100
    : 0;

  if ($("signal")) {
    $("signal").textContent = "OBSERVE";
    $("signal").className = "neutral";
  }

  if ($("signalReason")) {
    $("signalReason").textContent =
      `Direction: ${direction}. Even ${evenPercent.toFixed(1)}%, ` +
      `odd ${oddPercent.toFixed(1)}%, over 5 ${overFivePercent.toFixed(1)}%, ` +
      `under 5 ${underFivePercent.toFixed(1)}%. ` +
      "These are historical observations, not instructions to trade.";
  }
}

/* ---------------- MARKET SELECTION ---------------- */

function changeMarket() {
  const selector = $("market");
  if (!selector) return;

  const newSymbol = selector.value;

  if (!newSymbol || newSymbol === state.symbol) return;

  state.symbol = newSymbol;

  resetAnalysis();
  connect();
}

/* ---------------- UI EVENTS ---------------- */

if ($("market")) {
  state.symbol = $("market").value || DEFAULT_SYMBOL;
  $("market").addEventListener("change", changeMarket);
}

if ($("reconnect")) {
  $("reconnect").addEventListener("click", () => {
    state.reconnectAttempts = 0;
    clearConnectionTimers();

    if (state.socket) {
      state.intentionalClose = true;

      try {
        state.socket.close();
      } catch (_) {
        // connect() will create a new socket.
      }

      state.socket = null;
    }

    state.intentionalClose = false;
    connect();
  });
}

window.addEventListener("online", () => {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    connect();
  }
});

window.addEventListener("offline", () => {
  setStatus("Device offline — market data paused");
});

/* ---------------- START APPLICATION ---------------- */

resetAnalysis();
connect();
