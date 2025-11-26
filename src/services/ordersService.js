const pool = require("../db");
const { v4: uuidv4 } = require("uuid");
const matchingEngine = require("../engine/matchingEngine");

// ----------------------------------------------------
// CREATE ORDER (Supports idempotency)
// ----------------------------------------------------
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

    // MATCHING ENGINE CALL
    const trades = await matchingEngine.matchOrder(newOrder);

    return { order: newOrder, trades };
  } catch (err) {
    await client.query("ROLLBACK");

    // Handle unique violation on idempotency key
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

// ----------------------------------------------------
// ORDERBOOK (ONE INSTRUMENT)
// ----------------------------------------------------
exports.getOrderbook = async (instrument, levels = 5) => {
  const result = await pool.query(
    `SELECT price, remaining_quantity AS quantity, side
     FROM orders
     WHERE instrument = $1
       AND type='limit'
       AND status IN ('open','partially_filled')
       AND price IS NOT NULL`,
    [instrument]
  );

  const bids = {};
  const asks = {};

  for (let row of result.rows) {
    const price = Number(row.price);
    const qty = Number(row.quantity);

    if (row.side === "buy") {
      bids[price] = (bids[price] || 0) + qty;
    } else {
      asks[price] = (asks[price] || 0) + qty;
    }
  }

  return {
    bids: Object.keys(bids)
      .map((p) => ({ price: Number(p), quantity: bids[p] }))
      .sort((a, b) => b.price - a.price)
      .slice(0, levels),

    asks: Object.keys(asks)
      .map((p) => ({ price: Number(p), quantity: asks[p] }))
      .sort((a, b) => a.price - b.price)
      .slice(0, levels),
  };
};

// ----------------------------------------------------
// FULL ORDERBOOK
// ----------------------------------------------------
exports.getFullOrderbook = async () => {
  const result = await pool.query(
    `SELECT instrument, price, remaining_quantity AS quantity, side
     FROM orders
     WHERE type='limit'
       AND status IN ('open','partially_filled')`
  );

  const book = {};

  for (let row of result.rows) {
    if (!book[row.instrument]) {
      book[row.instrument] = { bids: {}, asks: {} };
    }

    const price = Number(row.price);
    const qty = Number(row.quantity);

    if (row.side === "buy") {
      book[row.instrument].bids[price] =
        (book[row.instrument].bids[price] || 0) + qty;
    } else {
      book[row.instrument].asks[price] =
        (book[row.instrument].asks[price] || 0) + qty;
    }
  }

  const final = {};

  for (let inst in book) {
    final[inst] = {
      bids: Object.keys(book[inst].bids)
        .map((p) => ({ price: Number(p), quantity: book[inst].bids[p] }))
        .sort((a, b) => b.price - a.price),

      asks: Object.keys(book[inst].asks)
        .map((p) => ({ price: Number(p), quantity: book[inst].asks[p] }))
        .sort((a, b) => a.price - b.price),
    };
  }

  return final;
};

// ----------------------------------------------------
// CANCEL ORDER
// ----------------------------------------------------
exports.cancelOrder = async (id) => {
  const res = await pool.query(`SELECT * FROM orders WHERE id=$1`, [id]);
  const order = res.rows[0];

  if (!order) throw new Error("Order not found");
  if (order.status === "filled")
    throw new Error("Cannot cancel a filled order");
  if (order.status === "cancelled") throw new Error("Order already cancelled");

  const result = await pool.query(
    `UPDATE orders SET status='cancelled' WHERE id=$1 RETURNING *`,
    [id]
  );

  return result.rows[0];
};
