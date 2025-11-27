// controllers/ordersController.js
const ordersService = require("../services/ordersService");
const matchingEngine = require("../engine/matchingEngine");
//const matchingEngine = require("../engine/matchingEngine");
const orderBook=require("../orderbook/orderBook");
console.log("Loaded matchingEngine:", matchingEngine);

exports.createOrder = async (req, res) => {
  try {
    const orderData = req.body;

    // 1️⃣ Create order in PostgreSQL
    const newOrder = await ordersService.createOrder(orderData);

    // Add remaining_quantity property
    newOrder.remaining_quantity = newOrder.quantity;

    // 2️⃣ Insert into Redis OrderBook
    await OrderBook.addOrder(newOrder);

    // 3️⃣ Call Matching Engine
    const trades = await matchingEngine.matchOrder(newOrder);

    // 4️⃣ Response
    return res.status(201).json({
      message: "Order created",
      order: newOrder,
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

const OrderBook = require("../orderbook/orderBook");

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

    // cancel from DB + Redis orderbook
    const result = await ordersService.cancelOrder(id);

    if (!result) {
      return res.status(404).json({ error: "Order not found or already completed" });
    }

    return res.json({ message: "Order cancelled successfully", order: result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};
