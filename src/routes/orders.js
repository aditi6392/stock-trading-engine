const express = require("express");
const router = express.Router();

const {
  createOrder,
  getOrderById,
  getAllOrders,
  getOrdersByClient,
  getOrdersByInstrument,
  getOrderbook,
  getFullOrderbook,
  cancelOrder
} = require("../controllers/ordersController");

// Orderbook for all instruments
router.get("/orderbook", getFullOrderbook);

// Orderbook for one instrument
router.get("/orderbook/:instrument", getOrderbook);

// Client orders
router.get("/client/:client_id", getOrdersByClient);

// Orders by instrument
router.get("/instrument/:instrument", getOrdersByInstrument);

// Create order
router.post("/", createOrder);

// All orders
router.get("/", getAllOrders);

// Order by ID
router.get("/:id", getOrderById);

// Cancel an order
router.delete("/:id/cancel", cancelOrder);


module.exports = router;
