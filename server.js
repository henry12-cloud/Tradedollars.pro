
"use strict";

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------- SAFETY SETTINGS ---------------- */

const REAL_MONEY_TRADING_ENABLED = false;
const ORDERS_ENABLED = false;

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.json({ limit: "20kb" }));

/* ---------------- BASIC SECURITY HEADERS ---------------- */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

/* ---------------- HEALTH CHECK ---------------- */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "TradeDollars",
    mode: "signal-only",
    real_trading_enabled: REAL_MONEY_TRADING_ENABLED,
    orders_enabled: ORDERS_ENABLED,
    timestamp: new Date().toISOString()
  });
});

/* ---------------- PUBLIC CONFIGURATION ---------------- */

app.get("/api/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.json({
    configured: true,
    real_trading_enabled: REAL_MONEY_TRADING_ENABLED,
    orders_enabled: ORDERS_ENABLED,
    mode: "signal-only"
  });
});

/* ---------------- ACCOUNT STATUS ---------------- */

app.get("/api/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.json({
    authenticated: false,
    account_id: null,
    account: null,
    message: "Account integration has not been configured."
  });
});

app.get("/api/account", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.status(401).json({
    connected: false,
    account_id: null,
    balance: null,
    message: "Please configure and complete Deriv OAuth login."
  });
});

/* ---------------- DISABLE ORDER ROUTES ---------------- */

app.all("/api/buy", (req, res) => {
  res.status(403).json({
    ok: false,
    error: "Orders are disabled in signal-only mode."
  });
});

app.all("/api/trade", (req, res) => {
  res.status(403).json({
    ok: false,
    error: "Trading is disabled in this build."
  });
});

/* ---------------- STATIC WEBSITE ---------------- */

app.use(express.static(path.join(__dirname), {
  index: "index.html"
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ---------------- NOT FOUND ---------------- */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint not found."
    });
  }

  res.status(404).send("Page not found.");
});

/* ---------------- ERROR HANDLER ---------------- */

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "An internal server error occurred."
  });
});

/* ---------------- START SERVER ---------------- */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TradeDollars server listening on port ${PORT}`);
  console.log("Mode: signal-only");
  console.log("Real-money trading: disabled");
  console.log("Order placement: disabled");
});
