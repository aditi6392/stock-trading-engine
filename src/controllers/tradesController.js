const tradesService = require("../services/tradesService");

exports.getAllTrades = async (req, res) => {
  try {
    const trades = await tradesService.getAllTrades();
    return res.json(trades);
  } catch (err) {
    console.error("Error fetching trades:", err);
    return res.status(500).json({ error: "Failed to fetch trades" });
  }
};

exports.getTradesByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const trades = await tradesService.getTradesByOrderId(orderId);
    return res.json(trades);
  } catch (err) {
    console.error("Error fetching order trades:", err);
    return res.status(500).json({ error: "Failed to fetch trades for order" });
  }
};
