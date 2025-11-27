// controllers/ordersController.js
const ordersService = require("../services/ordersService");
const OrderBook = require("../orderbook/orderBook");
const Engine = require("../engine/Engine");   // ✅ FIXED


console.log("🛠 Engine Imported =", Engine);
console.log("🛠 Engine.run =", Engine.run);
// ----------------------------------------------------
// CREATE ORDER
// ----------------------------------------------------

exports.createOrder = async (req, res) => {
  try {
    const orderData = req.body;

    // Create order in DB + orderbook
    const { order } = await ordersService.createOrder(orderData);

    // Now run matching engine
    const trades = await Engine.run(order.instrument);

    return res.status(201).json({
      message: "Order created",
      order,
      trades_executed: trades,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
// GET ORDERBOOK SNAPSHOT
// ----------------------------------------------------
exports.getOrderbook = async (req, res) => {
  const { instrument } = req.params;

  const book = await OrderBook.getFullBook(instrument);
  return res.json(book);
};

// ----------------------------------------------------
// CANCEL ORDER
// ----------------------------------------------------
exports.cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const cancelledOrder = await ordersService.cancelOrder(id);

    if (!cancelledOrder) {
      return res
        .status(404)
        .json({ error: "Order not found or already completed" });
    }

    return res.json({
      message: "Order cancelled successfully",
      order: cancelledOrder,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};
