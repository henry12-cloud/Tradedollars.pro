
"use strict";

/* =====================================================
   TRADEDOLLARS — PUBLIC MARKET MONITOR
   Signal-only mode. No trading orders are permitted.
   ===================================================== */

const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";
const $ = (id) => document.getElementById(id);

const MAX_PRICE_HISTORY = 200;
const MAX_DIGIT_HISTORY = 2000;
const RECONNECT_DELAY_MAX = 30000;

const state = {
  socket: null,
  symbol: "1HZ100V",
  prices: [],
  digits: [],
  counts: Array(10).fill(0),
  totalTicks: 0,
  pipSize: 2,
  reconnectTimer: null,
  connectionTimer: null,
  reconnectAttempts: 0,
  manuallyReconnecting: false
};

function setStatus(message, connected = false) {
  const status = $("connectionStatus");
  const dot = $("statusDot");

  if (status) status.textContent = message;

  if (dot) {
    dot.style.background = connected
      ? "var(--green)"
      : "var(--gold)";
  }
}

function formatPrice(value) {
  if (!Number.isFinite(Number(value))) return "—";

  const decimals = Math.max(
    0,
    Math.min(10, Number(state.pipSize) || 0)
  );

  return Number(value).toFixed(decimals);
}

function extractDigit(quote, pipSize) {
  const decimals = Math.max(
    0,
    Math.min(10, Number(pipSize) || 0)
  );

  const fixed = Number(quote).toFixed(decimals);
  const match = fixed.match(/(\d)$/);

  return match ? Number(match[1]) : 0;
}

function clearConnectionTimers() {
  clearTimeout(state.connectionTimer);
  clearTimeout(state.reconnectTimer);

  state.connectionTimer = null;
  state.reconnectTimer = null;
}

function resetAnalysis() {
  state.prices = [];
  state.digits = [];
  state.counts = Array(10).fill(0);
  state.totalTicks = 0;

  if ($("price")) $("price").textContent = "Waiting for ticks…";
  if ($("priceChange")) $("priceChange").textContent = "—";
  if ($("lastDigit")) $("lastDigit").textContent = "—";
  if ($("sampleSize")) $("sampleSize").textContent = "0";
  if ($("historyCount")) $("historyCount").textContent = "0";

  if ($("trend")) $("trend").textContent = "COLLECTING DATA";
  if ($("trendReason")) {
    $("trendReason").textContent =
      "Waiting for enough independent price ticks.";
  }

  if ($("signal")) $("signal").textContent = "WAIT";
  if ($("signalReason")) {
    $("signalReason").textContent =
      "Collecting market data. No trades will be placed.";
  }

  if ($("support")) $("support").textContent = "—";
  if ($("resistance")) $("resistance").textContent = "—";

  renderChart();
  renderDigits();
  renderHistory();
}

function connect() {
  clearConnectionTimers();
  state.manuallyReconnecting = false;

  if (state.socket) {
    const oldSocket = state.socket;
    state.socket = null;

    oldSocket.onopen = null;
    oldSocket.onmessage = null;
    oldSocket.onerror = null;
    oldSocket.onclose = null;

    try {
      oldSocket.close();
    } catch (_) {}
  }

  if (!navigator.onLine) {
    setStatus("Device offline — waiting for internet");
    scheduleReconnect();
    return;
  }

  setStatus("Connecting to Deriv public market data…");

  let socket;

  try {
    socket = new WebSocket(WS_URL);
  } catch (error) {
    setStatus("Could not create market connection");
    scheduleReconnect();
    return;
  }

  state.socket = socket;

  state.connectionTimer = setTimeout(() => {
    if (
      state.socket === socket &&
      socket.readyState !== WebSocket.OPEN
    ) {
      setStatus("Connection timed out — reconnecting");
      try {
        socket.close();
      } catch (_) {}
    }
  }, 12000);

  socket.onopen = () => {
    if (state.socket !== socket) return;

    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;
    state.reconnectAttempts = 0;

    setStatus("Connected — waiting for market ticks…", true);

    socket.send(JSON.stringify({
      ticks: state.symbol,
      subscribe: 1
    }));
  };

  socket.onmessage = (event) => {
    if (state.socket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (_) {
      setStatus("Received an unreadable market response");
      return;
    }

    if (message.error) {
      const code = message.error.code || "API error";
      const detail = message.error.message || "Unknown error";

      setStatus(`${code}: ${detail}`);
      return;
    }

    if (message.msg_type === "tick" && message.tick) {
      processTick(message.tick);
    }
  };

  socket.onerror = () => {
    if (state.socket === socket) {
      setStatus("Market connection error — reconnecting");
    }
  };

  socket.onclose = () => {
    if (state.socket !== socket) return;

    state.socket = null;
    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;

    setStatus("Disconnected — reconnecting");
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;

  state.reconnectAttempts += 1;

  const delay = Math.min(
    2000 * Math.pow(2, state.reconnectAttempts - 1),
    RECONNECT_DELAY_MAX
  );

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

function processTick(tick) {
  const quote = Number(tick.quote);

  if (!Number.isFinite(quote)) return;

  if (tick.symbol && tick.symbol !== state.symbol) return;

  const previous = state.prices.length
    ? state.prices[state.prices.length - 1].quote
    : null;

  const pipSize = Number(tick.pip_size);

  if (Number.isFinite(pipSize)) {
    state.pipSize = pipSize;
  }

  const digit = extractDigit(quote, state.pipSize);

  state.totalTicks += 1;

  state.prices.push({
    quote,
    digit,
    time: Number(tick.epoch) || Math.floor(Date.now() / 1000)
  });

  if (state.prices.length > MAX_PRICE_HISTORY) {
    state.prices.shift();
  }

  state.digits.push(digit);
  state.counts[digit] += 1;

  if (state.digits.length > MAX_DIGIT_HISTORY) {
    const removedDigit = state.digits.shift();
    state.counts[removedDigit] -= 1;
  }

  render(quote, digit, previous);
  renderChart();
  renderDigits();
  renderHistory();
  analyse();

  setStatus(
    `Live market connected · ${state.totalTicks} ticks received`,
    true
  );
}

function render(quote, digit, previous) {
  if ($("price")) {
    $("price").textContent = formatPrice(quote);
  }

  if ($("lastDigit")) {
    $("lastDigit").textContent = String(digit);
  }

  if ($("sampleSize")) {
    $("sampleSize").textContent = String(state.digits.length);
  }

  if ($("historyCount")) {
    $("historyCount").textContent = String(state.prices.length);
  }

  if ($("priceChange")) {
    if (previous === null) {
      $("priceChange").textContent = "First tick";
    } else {
      const difference = quote - previous;
      const sign = difference > 0 ? "+" : "";

      $("priceChange").textContent =
        `${sign}${difference.toFixed(state.pipSize)}`;
    }
  }
}

function renderChart() {
  const svg = $("chart");
  if (!svg) return;

  const width = 700;
  const height = 220;
  const padding = 12;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  if (state.prices.length < 2) {
    svg.innerHTML = `
      <text x="${width / 2}" y="${height / 2}"
        text-anchor="middle"
        fill="currentColor" opacity="0.65"
        font-size="14">
        Waiting for live price data…
      </text>`;
    return;
  }

  const values = state.prices.map(item => item.quote);
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }

  const points = values.map((value, index) => {
    const x = padding +
      (index / (values.length - 1)) * (width - padding * 2);

    const y = height - padding -
      ((value - min) / (max - min)) * (height - padding * 2);

    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  const lastValue = values[values.length - 1];
  const firstValue = values[0];

  const lineColor = lastValue >= firstValue
    ? "var(--green)"
    : "var(--gold)";

  svg.innerHTML = `
    <polyline
      points="${points}"
      fill="none"
      stroke="${lineColor}"
      stroke-width="2.5"
      stroke-linejoin="round"
      stroke-linecap="round" />
  `;
}

function renderDigits() {
  const container = $("digits");
  if (!container) return;

  if (state.digits.length === 0) {
    container.textContent = "Waiting for digit data…";
    return;
  }

  const total = state.digits.length;

  container.innerHTML = state.counts.map((count, digit) => {
    const percent = total ? (count / total) * 100 : 0;

    return `
      <div class="digit-row">
        <span>${digit}</span>
        <span>${count} (${percent.toFixed(1)}%)</span>
        <div class="digit-bar"
          style="width:${percent.toFixed(2)}%;"></div>
      </div>
    `;
  }).join("");
}

function renderHistory() {
  const container = $("history");
  if (!container) return;

  if (state.prices.length === 0) {
    container.textContent = "No ticks received yet.";
    return;
  }

  const recent = state.prices.slice(-20).reverse();

  container.innerHTML = recent.map(item => {
    const time = new Date(item.time * 1000).toLocaleTimeString();

    return `
      <div class="history-row">
        <span>${time}</span>
        <span>${formatPrice(item.quote)}</span>
        <span>Digit ${item.digit}</span>
      </div>
    `;
  }).join("");
}

function analyse() {
  const prices = state.prices.map(item => item.quote);

  if (prices.length < 20) {
    if ($("trend")) $("trend").textContent = "COLLECTING DATA";

    if ($("trendReason")) {
      $("trendReason").textContent =
        `Collecting ticks: ${prices.length}/20 needed for an initial review.`;
    }

    if ($("signal")) $("signal").textContent = "WAIT";

    if ($("signalReason")) {
      $("signalReason").textContent =
        "Insufficient data. This monitor does not predict the next tick.";
    }

    return;
  }

  const recent20 = prices.slice(-20);
  const previous10 = recent20.slice(0, 10);
  const latest10 = recent20.slice(10);

  const average = values =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  const previousAverage = average(previous10);
  const latestAverage = average(latest10);

  const support = Math.min(...recent20);
  const resistance = Math.max(...recent20);

  if ($("support")) {
    $("support").textContent = formatPrice(support);
  }

  if ($("resistance")) {
    $("resistance").textContent = formatPrice(resistance);
  }

  const difference = latestAverage - previousAverage;
  const scale = Math.max(Math.abs(previousAverage), 1);
  const threshold = scale * 0.00001;

  let direction = "SIDEWAYS";

  if (difference > threshold) direction = "UPWARD";
  if (difference < -threshold) direction = "DOWNWARD";

  if ($("trend")) {
    $("trend").textContent = direction;
  }

  if ($("trendReason")) {
    $("trendReason").textContent =
      `Review of 20 recent prices. ` +
      `Latest 10-price average: ${formatPrice(latestAverage)}; ` +
      `previous 10-price average: ${formatPrice(previousAverage)}.`;
  }

  if ($("signal")) {
    $("signal").textContent = "WAIT";
  }

  if ($("signalReason")) {
    const directionText = direction === "SIDEWAYS"
      ? "No clear directional movement in this basic comparison."
      : `The recent average is moving ${direction.toLowerCase()}.`;

    $("signalReason").textContent =
      `${directionText} This is observation only, not a trade instruction. ` +
      `Digit frequencies describe past ticks and do not guarantee the next digit.`;
  }
}

function changeMarket() {
  const selector = $("market");
  if (!selector) return;

  state.symbol = selector.value || "1HZ100V";

  resetAnalysis();
  connect();
}

if ($("market")) {
  state.symbol = $("market").value || "1HZ100V";
  $("market").addEventListener("change", changeMarket);
}

if ($("reconnect")) {
  $("reconnect").addEventListener("click", () => {
    clearConnectionTimers();
    state.reconnectAttempts = 0;
    setStatus("Reconnecting to public market data…");
    connect();
  });
}

window.addEventListener("online", () => {
  if (!state.socket || state.socket.readyState === WebSocket.CLOSED) {
    clearConnectionTimers();
    connect();
  }
});

window.addEventListener("offline", () => {
  setStatus("Device offline — market data paused");
});

resetAnalysis();
connect();
       
