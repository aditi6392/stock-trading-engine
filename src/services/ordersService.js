const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

// -----------------------
// Create Order
// -----------------------
exports.createOrder = async (data) => {
  // Basic validation
  if (!data.client_id) throw new Error("client_id required");
  if (!data.instrument) throw new Error("instrument required");
  if (!data.side) throw new Error("side must be buy or sell");
  if (!data.type) throw new Error("type must be limit or market");
  if (data.type === "limit" && !data.price)
    throw new Error("price required for limit order");

  const orderId = data.order_id || uuidv4();
  const price = data.type === "limit" ? data.price : null;

  const result = await pool.query(
    `INSERT INTO orders
      (id, client_id, instrument, side, type, price, quantity)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
    [
      orderId,
      data.client_id,
      data.instrument,
      data.side,
      data.type,
      price,
      data.quantity,
    ]
  );

  return result.rows[0];
};

// -----------------------
// Get Order by ID
// -----------------------
exports.getOrderById = async (id) => {
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
  return result.rows[0];
};

// -----------------------
// Get All Orders
// -----------------------
exports.getAllOrders = async () => {
  const result = await pool.query(
    `SELECT * FROM orders ORDER BY created_at DESC`
  );
  return result.rows;
};

// -----------------------
// Get Orders by Client ID
// -----------------------
exports.getOrdersByClient = async (clientId) => {
  const result = await pool.query(
    `SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at DESC`,
    [clientId]
  );
  return result.rows;
};

// -----------------------
// Get Orders by Instrument
// -----------------------
exports.getOrdersByInstrument = async (instrument) => {
  const result = await pool.query(
    `SELECT * FROM orders 
     WHERE instrument = $1
     ORDER BY created_at DESC`,
    [instrument]
  );
  return result.rows;
};
exports.getOrderbook = async (instrument, levels) => {
  const result = await pool.query(
    `SELECT price, quantity, side 
     FROM orders
     WHERE instrument = $1 
       AND type = 'limit'
       AND (status = 'open' OR status = 'partially_filled')
       AND price IS NOT NULL`,
    [instrument]
  );

  const rows = result.rows;

  const bids = {};
  const asks = {};

  for (let r of rows) {
    const price = Number(r.price);
    const qty = Number(r.quantity);

    if (r.side === "buy") {
      bids[price] = (bids[price] || 0) + qty;
    } else {
      asks[price] = (asks[price] || 0) + qty;
    }
  }

  const bidLevels = Object.keys(bids)
    .map((p) => ({ price: Number(p), quantity: bids[p] }))
    .sort((a, b) => b.price - a.price)
    .slice(0, levels);

  const askLevels = Object.keys(asks)
    .map((p) => ({ price: Number(p), quantity: asks[p] }))
    .sort((a, b) => a.price - b.price)
    .slice(0, levels);

  return {
    bids: bidLevels,
    asks: askLevels,
  };
};
