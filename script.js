/* =========================================================
TRADEDOLLARS.PRO — PUBLIC MARKET MONITOR
Public ticks + price chart + digit statistics
SIGNAL-ONLY: no account login, no orders.
Real-money trading remains disabled.
========================================================= */

"use strict";

const WS_URL =
"wss://ws.derivws.com/websockets/v3?app_id=1089";

const DEFAULT_SYMBOL = "1HZ100V";
const MAX_DIGITS = 2000;
const MAX_PRICES = 100;
const MIN_ANALYSIS_TICKS = 20;

const state = {
socket: null,
symbol: DEFAULT_SYMBOL,
connected: false,
totalTicks: 0,
latestPrice: null,
latestDigit: null,
pipSize: 2,
digitHistory: [],
priceHistory: [],
reconnectTimer: null,
connectionTimer: null,
reconnectDelay: 2000,
manuallyReconnecting: false
};

const $ = id => document.getElementById(id);

function setStatus(message, connected = false) {
const status = $("connectionStatus");
const dot = $("statusDot");

if (status) status.textContent = message;

if (dot) {
dot.style.background = connected ? "#22c55e" : "#f59e0b";
}
}

function formatPrice(value) {
return Number(value).toFixed(state.pipSize);
}

function extractLastDigit(price) {
const formatted = formatPrice(price);
const digits = formatted.replace(/\D/g, "");
return Number(digits.slice(-1));
}

function clearTimers() {
if (state.reconnectTimer) {
clearTimeout(state.reconnectTimer);
state.reconnectTimer = null;
}

if (state.connectionTimer) {
clearTimeout(state.connectionTimer);
state.connectionTimer = null;
}
}

function resetAnalysis() {
state.totalTicks = 0;
state.latestPrice = null;
state.latestDigit = null;
state.digitHistory = [];
state.priceHistory = [];

renderPrice();
renderChart();
renderDigits();
renderHistory();
analyseMarket();
}

function connect() {
clearTimers();

if (!navigator.onLine) {
setStatus("Device offline — waiting for connection");
scheduleReconnect();
return;
}

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
setStatus("Connecting to public market data…");

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
if (socket.readyState === WebSocket.CONNECTING) {
setStatus("Connection timed out — retrying");
socket.close();
}
}, 15000);

socket.onopen = () => {
if (state.socket !== socket) return;

clearTimers();
state.connected = true;
state.reconnectDelay = 2000;
setStatus("Connected — subscribing to market ticks", true);

socket.send(JSON.stringify({
  ticks: state.symbol,
  subscribe: 1
}));

};

socket.onmessage = event => {
if (state.socket !== socket) return;

let message;

try {
  message = JSON.parse(event.data);
} catch (_) {
  return;
}

if (message.error) {
  setStatus("Market feed error: " + message.error.message);
  return;
}

if (message.msg_type === "tick" && message.tick) {
  processTick(message.tick);
}

};

socket.onerror = () => {
if (state.socket === socket) {
setStatus("Market connection error — retrying");
}
};

socket.onclose = () => {
if (state.socket !== socket) return;

clearTimers();
state.connected = false;
setStatus("Connection closed — reconnecting");
scheduleReconnect();

};
}

function scheduleReconnect() {
if (state.reconnectTimer) return;

const delay = state.reconnectDelay;
state.reconnectDelay = Math.min(delay * 2, 30000);

state.reconnectTimer = setTimeout(() => {
state.reconnectTimer = null;
connect();
}, delay);
}

function processTick(tick) {
const price = Number(tick.quote);

if (!Number.isFinite(price)) return;

if (Number.isInteger(tick.pip_size)) {
state.pipSize = Math.max(0, Math.min(10, tick.pip_size));
}

state.latestPrice = price;
state.latestDigit = extractLastDigit(price);
state.totalTicks++;

state.priceHistory.push(price);
if (state.priceHistory.length > MAX_PRICES) {
state.priceHistory.shift();
}

state.digitHistory.push(state.latestDigit);
if (state.digitHistory.length > MAX_DIGITS) {
state.digitHistory.shift();
}

renderPrice();
renderChart();
renderDigits();
renderHistory();
analyseMarket();
}

function renderPrice() {
const priceElement = $("price");
const changeElement = $("priceChange");
const digitElement = $("lastDigit");
const countElement = $("tickCount");
const sampleElement = $("sampleSize");

if (priceElement) {
priceElement.textContent =
state.latestPrice === null
? "Waiting for ticks…"
: formatPrice(state.latestPrice);
}

if (digitElement) {
digitElement.textContent =
state.latestDigit === null ? "—" : state.latestDigit;
}

if (countElement) {
countElement.textContent = state.totalTicks.toLocaleString();
}

if (sampleElement) {
sampleElement.textContent = state.digitHistory.length;
}

if (changeElement) {
if (state.priceHistory.length >= 2) {
const first = state.priceHistory[0];
const last = state.priceHistory[state.priceHistory.length - 1];
const difference = last - first;
const sign = difference > 0 ? "+" : "";

  changeElement.textContent =
    sign + difference.toFixed(state.pipSize);
} else {
  changeElement.textContent = "—";
}

}
}

function renderChart() {
const chart = $("chart");
if (!chart) return;

const values = state.priceHistory;

if (values.length < 2) {
chart.innerHTML = "";
return;
}

const width = 700;
const height = 190;
const padding = 8;

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

chart.innerHTML =
"<polyline points="${points}" fill="none" " +
"stroke="#22d3ee" stroke-width="2.5" " +
"stroke-linejoin="round" stroke-linecap="round"/>";
}

function renderHistory() {
const container = $("history");
if (!container) return;

const recent = state.digitHistory.slice(-30).reverse();

if (!recent.length) {
container.textContent = "Waiting for live digits…";
return;
}

container.innerHTML = "";

recent.forEach(digit => {
const item = document.createElement("span");
item.textContent = String(digit);
item.style.cssText =
"display:inline-flex;align-items:center;justify-content:center;" +
"width:30px;height:30px;margin:3px;border-radius:7px;" +
"background:#172b40;color:#e5faff;font-weight:700;";

container.appendChild(item);

});
}

function renderDigits() {
const container = $("digits");
if (!container) return;

if (state.digitHistory.length === 0) {
container.textContent = "Waiting for ticks to begin analysis.";
return;
}

const counts = Array(10).fill(0);

state.digitHistory.forEach(digit => {
counts[digit]++;
});

const total = state.digitHistory.length;
const maxCount = Math.max(...counts);
const minCount = Math.min(...counts);

const most = counts.indexOf(maxCount);
const least = counts.indexOf(minCount);

const even = state.digitHistory.filter(d => d % 2 === 0).length;
const odd = total - even;

const overFive = state.digitHistory.filter(d => d > 5).length;
const underFive = state.digitHistory.filter(d => d < 5).length;

const pct = count => (count / total * 100).toFixed(1) + "%";

container.innerHTML = "<p>Sample size: <strong>${total}</strong></p> <p>Most frequent digit: <strong>${most}</strong> (${maxCount} times, ${pct(maxCount)})</p> <p>Least frequent digit: <strong>${least}</strong> (${minCount} times, ${pct(minCount)})</p> <p>Even / Odd: <strong>${pct(even)} / ${pct(odd)}</strong></p> <p>Over 5 / Under 5: <strong>${pct(overFive)} / ${pct(underFive)}</strong></p> <p>These are historical sample frequencies, not predictions of the next digit.</p>";
}

function analyseMarket() {
const trendElement = $("trend");
const reasonElement = $("trendReason");
const supportElement = $("support");
const resistanceElement = $("resistance");
const signalElement = $("signal");
const signalReasonElement = $("signalReason");
const historyCountElement = $("historyCount");
const reconnectElement = $("reconnect");

const prices = state.priceHistory;

if (historyCountElement) {
historyCountElement.textContent = state.totalTicks;
}

if (reconnectElement) {
reconnectElement.textContent = state.connected
? "Connected"
: "Reconnecting…";
}

if (prices.length) {
if (supportElement) {
supportElement.textContent = formatPrice(Math.min(...prices));
}

if (resistanceElement) {
  resistanceElement.textContent = formatPrice(Math.max(...prices));
}

} else {
if (supportElement) supportElement.textContent = "—";
if (resistanceElement) resistanceElement.textContent = "—";
}

if (state.totalTicks < MIN_ANALYSIS_TICKS || prices.length < 10) {
if (trendElement) trendElement.textContent = "COLLECTING DATA";
if (reasonElement) {
reasonElement.textContent =
"Waiting for at least ${MIN_ANALYSIS_TICKS} ticks.";
}
if (signalElement) signalElement.textContent = "WAIT";
if (signalReasonElement) {
signalReasonElement.textContent =
"Collecting data: ${state.totalTicks}/${MIN_ANALYSIS_TICKS} ticks. " +
"No order will be placed.";
}
return;
}

const recent = prices.slice(-5);
const previous = prices.slice(-10, -5);

const average = list =>
list.reduce((sum, value) => sum + value, 0) / list.length;

const recentAverage = average(recent);
const previousAverage = average(previous);

let direction = "SIDEWAYS";

if (recentAverage > previousAverage) direction = "BULLISH";
if (recentAverage < previousAverage) direction = "BEARISH";

if (trendElement) trendElement.textContent = direction;

if (reasonElement) {
reasonElement.textContent =
"Based on the comparison of recent and previous price averages. " +
"This is descriptive analysis, not a forecast.";
}

if (signalElement) signalElement.textContent = "WAIT";

if (signalReasonElement) {
signalReasonElement.textContent =
"Signal-only monitor: ${direction.toLowerCase()} short-term movement. " +
"No entry recommendation or order is generated.";
}
}

function changeMarket() {
const select = $("market");
if (!select) return;

const nextSymbol = select.value;
if (!nextSymbol || nextSymbol === state.symbol) return;

state.symbol = nextSymbol;
resetAnalysis();

if (state.socket) {
clearTimers();

try {
  state.socket.close();
} catch (_) {}

}

state.socket = null;
state.connected = false;
connect();
}

function initialise() {
const marketSelect = $("market");

if (marketSelect) {
marketSelect.value = DEFAULT_SYMBOL;
marketSelect.addEventListener("change", changeMarket);
}

const reconnectButton = $("reconnect");

if (reconnectButton && reconnectButton.tagName === "BUTTON") {
reconnectButton.addEventListener("click", () => {
clearTimers();

  if (state.socket) {
    try {
      state.socket.close();
    } catch (_) {}
  }

  state.socket = null;
  connect();
});

}

window.addEventListener("online", connect);

window.addEventListener("offline", () => {
setStatus("Device offline — market data paused");
});

resetAnalysis();
connect();

console.log("TradeDollars.pro public market monitor initialized.");
console.log("Signal-only mode: enabled.");
console.log("Automatic order placement: disabled.");
console.log("Real-money trading: disabled.");
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", initialise);
} else {
initialise();
}
