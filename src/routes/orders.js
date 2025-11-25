const express = require("express");
const router = express.Router();

const {
  createOrder,
  getOrderById,
  getAllOrders,
  getOrdersByClient,
  getOrdersByInstrument,
  getOrderbook,
} = require("../controllers/ordersController");

//get order book
router.get("/orderbook", getOrderbook);

// GET /orders/client/:client_id (client orders)
router.get("/client/:client_id", getOrdersByClient);

//get by instrument
router.get("/instrument/:instrument", getOrdersByInstrument);


// POST /orders
router.post("/", createOrder);

// GET /orders (all orders)
router.get("/", getAllOrders);


// GET /orders/:id (single order by ID)
router.get("/:id", getOrderById);
// POST /orders
router.post("/", createOrder);


module.exports = router;
