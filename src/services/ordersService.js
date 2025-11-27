const pool = require("../db");
const { v4: uuidv4 } = require("uuid");
const OrderBook = require("../orderbook/orderBook");
const matchingEngine = require("../engine/matchingEngine");

// ----------------------------------------------------
// CREATE ORDER
// ----------------------------------------------------
exports.createOrder = async (data, opts = {}) => {
  const idempotencyKey = opts.idempotency_key || data.idempotency_key || null;

  if (!data.client_id) throw new Error("client_id required");
  if (!data.instrument) throw new Error("instrument required");
  if (!data.side) throw new Error("side must be buy or sell");
  if (!data.type) throw new Error("type must be limit or market");

  if (data.type === "limit" && !data.price)
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
        [existingOrder.id]
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
        (id, client_id, instrument, side, type, price, quantity, remaining_quantity, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'open',$8)
       RETURNING *`,
      [
        orderId,
        data.client_id,
        data.instrument,
        data.side,
        data.type,
        data.type === "limit" ? data.price : null,
        data.quantity,
        idempotencyKey,
      ]
    );

    const newOrder = insert.rows[0];

    await client.query("COMMIT");

    // Add to Redis orderbook
    await OrderBook.addOrder(newOrder);

    // Run matching engine
    const trades = await matchingEngine.matchOrder(newOrder);

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
          [existingOrder.id]
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
exports.getOrderById = async (id) => {
  const result = await pool.query(`SELECT * FROM orders WHERE id=$1`, [id]);
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
  const orderRes = await pool.query(`SELECT * FROM orders WHERE id=$1`, [
    orderId,
  ]);

  if (orderRes.rows.length === 0) return null;

  const order = orderRes.rows[0];

  if (order.status === "filled" || order.remaining_quantity === 0) return null;

  // Update DB
  await pool.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [
    orderId,
  ]);

  // Remove from Redis
  await OrderBook.removeOrder(order.id, order.instrument, order.side);

  return order;
};

// ----------------------------------------------------
// UPDATE REMAINING QTY (Used by Matching Engine)
// ----------------------------------------------------
exports.updateRemaining = async (orderId, remainingQty) => {
  await pool.query(
    `UPDATE orders 
     SET remaining_quantity=$1,
         status = CASE WHEN $1 = 0 THEN 'filled' ELSE 'open' END
     WHERE id=$2`,
    [remainingQty, orderId]
  );
};
