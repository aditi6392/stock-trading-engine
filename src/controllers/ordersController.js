const ordersService = require("../services/ordersService");
const matchingEngine = require("../engine/matchingEngine");

// ----------------------------------------------------
// CREATE ORDER (+ matching engine)
// ----------------------------------------------------
exports.createOrder = async (req, res) => {
  try {
    const order = await ordersService.createOrder(req.body);

    // Run matching engine
    let trades = [];
    try {
      trades = await matchingEngine.matchOrder(order);
    } catch (err) {
      console.error("Matching Engine Error:", err);
    }

    res.json({ order, trades });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------------------------------
// GET ORDER BY ID
// ----------------------------------------------------
exports.getOrderById = async (req, res) => {
  try {
    const order = await ordersService.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------------------------------
// GET ALL ORDERS
// ----------------------------------------------------
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await ordersService.getAllOrders();
    res.json(orders);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------------------------------
// GET ORDERS BY CLIENT
// ----------------------------------------------------
exports.getOrdersByClient = async (req, res) => {
  try {
    const orders = await ordersService.getOrdersByClient(req.params.client_id);
    res.json(orders);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------------------------------
// GET ORDERS BY INSTRUMENT
// ----------------------------------------------------
exports.getOrdersByInstrument = async (req, res) => {
  try {
    const orders = await ordersService.getOrdersByInstrument(
      req.params.instrument
    );
    res.json(orders);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ----------------------------------------------------
// GET ORDERBOOK FOR ONE INSTRUMENT
// ----------------------------------------------------
exports.getOrderbook = async (req, res) => {
  try {
    const instrument = req.params.instrument;
    const levels = req.query.levels ? Number(req.query.levels) : 5;

    const result = await ordersService.getOrderbook(instrument, levels);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orderbook" });
  }
};

// ----------------------------------------------------
// GET ORDERBOOK FOR ALL INSTRUMENTS
// ----------------------------------------------------
exports.getFullOrderbook = async (req, res) => {
  try {
    const result = await ordersService.getFullOrderbook();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch full orderbook" });
  }
};
exports.cancelOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const result = await ordersService.cancelOrder(orderId);

    res.json({ message: "Order cancelled", order: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
