// services/ordersService.js
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");
const OrderBook = require("../orderbook/orderBook");
const Engine = require("../engine/Engine.js");

// ----------------------------------------------------
// CREATE ORDER
// ----------------------------------------------------
exports.createOrder = async (data, opts = {}) => {
  const idempotencyKey = opts.idempotency_key || data.idempotency_key || null;

  if (!data.client_id) throw new Error("client_id required");
  if (!data.instrument) throw new Error("instrument required");
  if (!data.side) throw new Error("side must be buy or sell");
  if (!data.type) throw new Error("type must be limit or market");

  if (
    data.type === "limit" &&
    (data.price === undefined || data.price === null)
  )
    throw new Error("price required for limit order");

  // ------------------------------------------
  // IDEMPOTENCY CHECK
  // ------------------------------------------
  if (idempotencyKey) {
    const existing = await pool.query(
      `SELECT * FROM orders WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const existingOrder = existing.rows[0];
      const trades = await pool.query(
        `SELECT * FROM trades WHERE buy_order_id=$1 OR sell_order_id=$1 ORDER BY traded_at DESC`,
        [existingOrder.order_id]
      );
      return { order: existingOrder, trades: trades.rows };
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderId = uuidv4();

    const insert = await client.query(
      `INSERT INTO orders
        (order_id, client_id, instrument, side, type, price, quantity, remaining_quantity, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'open',$8)
       RETURNING *`,
      [
        orderId, // $1
        data.client_id, // $2
        data.instrument, // $3
        data.side, // $4
        data.type, // $5
        data.price || null, // $6
        data.quantity, // $7
        idempotencyKey, // $8
      ]
    );

    const newOrder = insert.rows[0];

    await client.query("COMMIT");

    // Ensure remaining_quantity exists on returned object
    if (
      newOrder.remaining_quantity === null ||
      newOrder.remaining_quantity === undefined
    ) {
      newOrder.remaining_quantity = newOrder.quantity;
    }

    // 1️⃣ Add to OrderBook (Redis) — OrderBook must persist order JSON keyed by order_id
    await OrderBook.addOrder(newOrder);

    // 2️⃣ Trigger matching engine for that instrument.
    // Engine.run will fetch orders from OrderBook itself and perform matching.
    // It returns any trades executed for this instrument during this run.
    console.log("🔍 Engine Loaded =", Engine);

    const trades = await Engine.run(newOrder.instrument);

    return { order: newOrder, trades };
  } catch (err) {
    await client.query("ROLLBACK");

    // Idempotency fallback
    if (idempotencyKey) {
      const existing = await pool.query(
        `SELECT * FROM orders WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const existingOrder = existing.rows[0];
        const trades = await pool.query(
          `SELECT * FROM trades WHERE buy_order_id=$1 OR sell_order_id=$1 ORDER BY traded_at DESC`,
          [existingOrder.order_id]
        );
        return { order: existingOrder, trades: trades.rows };
      }
    }

    throw err;
  } finally {
    client.release();
  }
};

// ----------------------------------------------------
// GET ORDER FUNCTIONS
// ----------------------------------------------------
exports.getOrderById = async (orderId) => {
  const result = await pool.query(`SELECT * FROM orders WHERE order_id=$1`, [
    orderId,
  ]);
  return result.rows[0];
};

exports.getAllOrders = async () => {
  const result = await pool.query(
    `SELECT * FROM orders ORDER BY created_at DESC`
  );
  return result.rows;
};

exports.getOrdersByClient = async (clientId) => {
  const result = await pool.query(
    `SELECT * FROM orders WHERE client_id=$1 ORDER BY created_at DESC`,
    [clientId]
  );
  return result.rows;
};

exports.getOrdersByInstrument = async (instrument) => {
  const result = await pool.query(
    `SELECT * FROM orders WHERE instrument=$1 ORDER BY created_at DESC`,
    [instrument]
  );
  return result.rows;
};

// ----------------------------------------------------
// CANCEL ORDER
// ----------------------------------------------------
exports.cancelOrder = async (orderId) => {
  const orderRes = await pool.query(`SELECT * FROM orders WHERE order_id=$1`, [
    orderId,
  ]);

  if (orderRes.rows.length === 0) return null;

  const order = orderRes.rows[0];

  if (order.status === "filled" || Number(order.remaining_quantity) === 0)
    return null;

  // Update DB
  await pool.query(`UPDATE orders SET status='cancelled' WHERE order_id=$1`, [
    orderId,
  ]);

  // Remove from OrderBook (best-effort)
  try {
    if (OrderBook && typeof OrderBook.removeOrder === "function") {
      await OrderBook.removeOrder(order);
    }
  } catch (err) {
    console.error("Failed to remove order from orderbook:", err.message || err);
  }

  return order;
};

// ----------------------------------------------------
// UPDATE REMAINING QTY (Used by Matching Engine)
// ----------------------------------------------------
exports.updateRemaining = async (orderId, remainingQty) => {
  await pool.query(
    `UPDATE orders
     SET remaining_quantity = $1,
         status = CASE WHEN $1 = 0 THEN 'filled' ELSE 'open' END,
         updated_at = now()
     WHERE order_id = $2`,
    [remainingQty, orderId]
  );
};
