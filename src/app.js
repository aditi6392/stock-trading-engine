const express = require("express");
const app = express();
require("dotenv").config();

// --------------------
// Matching Engine Loader (engine.js)
// --------------------
const matchingEngine = require("./engine/Engine");

// Initialize matching engine BEFORE loading any routes
(async () => {
  try {
    await matchingEngine.init();
    console.log("⚡ Matching engine initialized");
  } catch (err) {
    console.error("❌ Failed to initialize matching engine:", err);
    process.exit(1); // Stop the server if engine fails to load
  }
})();

// --------------------
// Middleware
// --------------------
app.use(express.json());

// --------------------
// ROUTES
// --------------------
const ordersRoute = require("./routes/orders");
app.use("/orders", ordersRoute);

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
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
