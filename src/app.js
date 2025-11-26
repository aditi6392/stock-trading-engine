const express = require("express");
const app = express();
require("dotenv").config();

// --------------------
// Matching Engine
// --------------------
const matchingEngine = require("./engine/matchingEngine");

// Initialize matching engine BEFORE routes
(async () => {
  try {
    await matchingEngine.init();
    console.log("⚡ Matching engine initialized");
  } catch (err) {
    console.error("❌ Failed to initialize matching engine:", err);
    process.exit(1); // Stop server if engine isn't ready
  }
})();

// --------------------
// Middleware
// --------------------
app.use(express.json());

// --------------------
// ROUTES
// --------------------

// Orders routes
const ordersRoute = require("./routes/orders");
app.use("/orders", ordersRoute);

// Trades routes
const tradesRoutes = require("./routes/tradesRoutes");
app.use("/trades", tradesRoutes);

// --------------------
// HEALTH CHECK
// --------------------
app.get("/healthz", (req, res) => res.json({ status: "ok" }));

// --------------------
// START SERVER
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));

module.exports = app;
