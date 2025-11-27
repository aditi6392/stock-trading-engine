const pool = require("../db");
const { v4: uuidv4 } = require("uuid");
const OrderBook = require("../services/orderBookService");
const matchingEngine = require("../engine/matchingEngine");

//create order
exports.createOrder = async (data, opts = {}) => {
  const idempotencyKey = opts.idempotency_key || data.idempotency_key || null;

  if (!data.client_id) throw new Error("client_id required");
  if (!data.instrument) throw new Error("instrument required");
  if (!data.side) throw new Error("side must be buy or sell");
  if (!data.type) throw new Error("type must be limit or market");
  if (data.type === "limit" && !data.price)
    throw new Error("price required for limit order");

  // Check idempotency
  if (idempotencyKey) {
    const existing = await pool.query(
      `SELECT * FROM orders WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const existingOrder = existing.rows[0];
      const tradesRes = await pool.query(
        `SELECT * FROM trades WHERE buy_order_id=$1 OR sell_order_id=$1 ORDER BY traded_at DESC`,
        [existingOrder.id]
      );
      return { order: existingOrder, trades: tradesRes.rows };
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderId = uuidv4();
    const price = data.type === "limit" ? data.price : null;

    const insertResult = await client.query(
      `INSERT INTO orders
        (id, client_id, instrument, side, type, price, quantity, remaining_quantity, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'open', $8)
       RETURNING *`,
      [
        orderId,
        data.client_id,
        data.instrument,
        data.side,
        data.type,
        price,
        data.quantity,
        idempotencyKey,
      ]
    );

    const newOrder = insertResult.rows[0];

    await client.query("COMMIT");

    // ----------------------------------------------------
    // ADD ORDER TO REDIS ORDERBOOK
    // ----------------------------------------------------
    await OrderBook.addOrder(newOrder);

    // ----------------------------------------------------
    // MATCHING ENGINE CALL
    // ----------------------------------------------------
    const trades = await matchingEngine.matchOrder(newOrder);

    return { order: newOrder, trades };
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.code === "23505" && idempotencyKey) {
      const existing = await pool.query(
        `SELECT * FROM orders WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const existingOrder = existing.rows[0];
        const tradesRes = await pool.query(
          `SELECT * FROM trades WHERE buy_order_id=$1 OR sell_order_id=$1 ORDER BY traded_at DESC`,
          [existingOrder.id]
        );
        return { order: existingOrder, trades: tradesRes.rows };
      }
    }

    throw err;
  } finally {
    client.release();
  }
};

// ----------------------------------------------------
// GET ORDER BY ID
// ----------------------------------------------------
exports.getOrderById = async (id) => {
  const result = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  return result.rows[0];
};

// ----------------------------------------------------
// GET ALL ORDERS
// ----------------------------------------------------
exports.getAllOrders = async () => {
  const result = await pool.query(
    `SELECT * FROM orders ORDER BY created_at DESC`
  );
  return result.rows;
};

// ----------------------------------------------------
// GET ORDERS BY CLIENT
// ----------------------------------------------------
exports.getOrdersByClient = async (clientId) => {
  const result = await pool.query(
    `SELECT * FROM orders WHERE client_id=$1 ORDER BY created_at DESC`,
    [clientId]
  );
  return result.rows;
};

// ----------------------------------------------------
// GET ORDERS BY INSTRUMENT
// ----------------------------------------------------
exports.getOrdersByInstrument = async (instrument) => {
  const result = await pool.query(
    `SELECT * FROM orders WHERE instrument=$1 ORDER BY created_at DESC`,
    [instrument]
  );
  return result.rows;
};

// Cancel order (remove from db + remove from orderbook)
exports.cancelOrder = async (orderId) => {
  // 1. Fetch order from DB
  const order = await db.oneOrNone("SELECT * FROM orders WHERE id = $1", [orderId]);

  if (!order) return null;

  // 2. Remove/mark cancelled in DB
  await db.none(
    "UPDATE orders SET status = 'cancelled' WHERE id = $1",
    [orderId]
  );

  // 3. Remove from orderbook
  await OrderBook.removeOrder(order.instrument, order.id, order.side);

  return order;
};

//db helper 
exports.updateRemaining = async (orderId, remainingQty) => {
  await pool.query(
    `UPDATE orders SET remaining_quantity = $1,
     status = CASE WHEN $1 = 0 THEN 'filled' ELSE 'open' END
     WHERE id = $2`,
    [remainingQty, orderId]
  );
};
