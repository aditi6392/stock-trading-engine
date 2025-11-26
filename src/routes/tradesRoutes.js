const express = require("express");
const router = express.Router();
const tradesService = require("../services/tradesService");
const tradesController = require("../controllers/tradesController");

// GET all trades
router.get("/", async (req, res) => {
  try {
    const trades = await tradesService.getAllTrades();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET trades by orderId (must be before /:id)
router.get("/order/:orderId", tradesController.getTradesByOrder);

// GET trade by ID
router.get("/:id", async (req, res) => {
  try {
    const trade = await tradesService.getTradeById(req.params.id);
    if (!trade) return res.status(404).json({ error: "Trade not found" });
    res.json(trade);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
