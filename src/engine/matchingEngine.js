// engine/matchingEngine.js
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");
const OrderBook = require("../orderbook/orderBook");
const tradesService = require("../services/tradesService");
const ordersService = require("../services/ordersService");
// -------------------------
// In-memory structures
// -------------------------
const books = {};
const queues = {};
const running = {};

// -------------------------
// Helpers: price-array ops
// -------------------------
function insertPriceSorted(prices, price, descending = false) {
  const p = Number(price);
  if (prices.includes(p)) return;
  prices.push(p);
  prices.sort((a, b) => (descending ? b - a : a - b));
}

function removePrice(prices, price) {
  const p = Number(price);
  const idx = prices.indexOf(p);
  if (idx !== -1) prices.splice(idx, 1);
}

// -------------------------
// Book helpers
// -------------------------
function ensureBook(instrument) {
  if (!books[instrument]) {
    books[instrument] = {
      bids: new Map(),
      asks: new Map(),
      bidPrices: [],
      askPrices: [],
    };
    queues[instrument] = [];
    running[instrument] = false;
  }
  return books[instrument];
}

function addOrderToBook(order) {
  if (order.type !== "limit" || order.price == null) return;
  const book = ensureBook(order.instrument);
  const priceKey = String(order.price);
  const sideMap = order.side === "buy" ? book.bids : book.asks;
  const pricesArr = order.side === "buy" ? book.bidPrices : book.askPrices;

  if (!sideMap.has(priceKey)) sideMap.set(priceKey, []);
  sideMap.get(priceKey).push(order);
  insertPriceSorted(pricesArr, Number(order.price), order.side === "buy");
}

function removeOrderFromBook(orderId, instrument, side, price) {
  const book = ensureBook(instrument);
  const priceKey = String(price);
  const sideMap = side === "buy" ? book.bids : book.asks;
  const pricesArr = side === "buy" ? book.bidPrices : book.askPrices;

  if (!sideMap.has(priceKey)) return;
  const arr = sideMap.get(priceKey);
  const idx = arr.findIndex((o) => o.id === orderId);
  if (idx !== -1) arr.splice(idx, 1);

  if (arr.length === 0) {
    sideMap.delete(priceKey);
    removePrice(pricesArr, Number(price));
  }
}

// -------------------------
// DB loading
// -------------------------
async function loadOpenOrdersFromDb() {
  const res = await pool.query(
    `SELECT * FROM orders
     WHERE type='limit'
       AND status IN ('open','partially_filled')
       AND price IS NOT NULL
     ORDER BY created_at ASC`
  );

  for (const row of res.rows) {
    const orderEntry = {
      id: row.id,
      client_id: row.client_id,
      instrument: row.instrument,
      side: row.side,
      type: row.type,
      price: Number(row.price),
      quantity: Number(row.quantity),
      remaining_quantity: Number(row.remaining_quantity),
      created_at: row.created_at,
      status: row.status,
    };
    addOrderToBook(orderEntry);
  }
}

// -------------------------
// Matching core
// -------------------------
async function processIncomingOrder(incoming) {
  const trades = [];
  const instrument = incoming.instrument;
  const isBuy = incoming.side === "buy";
  const book = ensureBook(instrument);

  let incomingRemaining = Number(incoming.remaining_quantity);

  while (incomingRemaining > 0) {
    const oppPrices = isBuy ? book.askPrices : book.bidPrices;
    if (!oppPrices || oppPrices.length === 0) break;

    const bestPrice = oppPrices[0];

    if (incoming.type === "limit") {
      if (isBuy && Number(bestPrice) > Number(incoming.price)) break;
      if (!isBuy && Number(bestPrice) < Number(incoming.price)) break;
    }

    const priceKey = String(bestPrice);
    const oppList = (isBuy ? book.asks : book.bids).get(priceKey);
    if (!oppList || oppList.length === 0) {
      if (isBuy) removePrice(book.askPrices, bestPrice);
      else removePrice(book.bidPrices, bestPrice);
      continue;
    }

    const resting = oppList[0];
    const avail = Number(resting.remaining_quantity);

    if (avail <= 0) {
      oppList.shift();
      if (oppList.length === 0) {
        (isBuy ? book.asks : book.bids).delete(priceKey);
        if (isBuy) removePrice(book.askPrices, bestPrice);
        else removePrice(book.bidPrices, bestPrice);
      }
      continue;
    }

    const tradeQty = Math.min(incomingRemaining, avail);
    const tradePrice = Number(resting.price);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const rres = await client.query(
        `SELECT id, remaining_quantity, status FROM orders WHERE id=$1 FOR UPDATE`,
        [resting.id]
      );
      if (rres.rows.length === 0) {
        await client.query("ROLLBACK");
        client.release();
        oppList.shift();
        continue;
      }

      const rRow = rres.rows[0];
      const dbAvail = Number(rRow.remaining_quantity);

      if (dbAvail <= 0) {
        await client.query("ROLLBACK");
        client.release();
        oppList.shift();
        continue;
      }

      const finalTradeQty = Math.min(tradeQty, dbAvail);

      const tradeId = uuidv4();
      await client.query(
        `INSERT INTO trades (id,buy_order_id,sell_order_id,instrument,price,quantity,traded_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [
          tradeId,
          isBuy ? incoming.id : resting.id,
          isBuy ? resting.id : incoming.id,
          instrument,
          tradePrice,
          finalTradeQty,
        ]
      );

      const newRestingRemaining = dbAvail - finalTradeQty;
      const restingStatus =
        newRestingRemaining === 0 ? "filled" : "partially_filled";

      await client.query(
        `UPDATE orders
         SET remaining_quantity=$1, status=$2, updated_at=NOW()
         WHERE id=$3`,
        [newRestingRemaining, restingStatus, resting.id]
      );

      const inRes = await client.query(
        `SELECT remaining_quantity FROM orders WHERE id=$1 FOR UPDATE`,
        [incoming.id]
      );
      if (inRes.rows.length === 0) {
        await client.query("ROLLBACK");
        client.release();
        throw new Error("Incoming order missing");
      }

      const dbIncomingRem = Number(inRes.rows[0].remaining_quantity);
      const newIncomingRemaining = Math.max(0, dbIncomingRem - finalTradeQty);

      const incomingStatus =
        newIncomingRemaining === 0 ? "filled" : "partially_filled";

      await client.query(
        `UPDATE orders
         SET remaining_quantity=$1, status=$2, updated_at=NOW()
         WHERE id=$3`,
        [newIncomingRemaining, incomingStatus, incoming.id]
      );

      await client.query("COMMIT");

      resting.remaining_quantity = newRestingRemaining;
      if (newRestingRemaining === 0) {
        oppList.shift();
        if (oppList.length === 0) {
          (isBuy ? book.asks : book.bids).delete(priceKey);
          if (isBuy) removePrice(book.askPrices, bestPrice);
          else removePrice(book.bidPrices, bestPrice);
        }
      }

      incomingRemaining -= finalTradeQty;

      trades.push({
        id: tradeId,
        buy_order_id: isBuy ? incoming.id : resting.id,
        sell_order_id: isBuy ? resting.id : incoming.id,
        instrument,
        price: tradePrice,
        quantity: finalTradeQty,
        traded_at: new Date().toISOString(),
      });

      client.release();
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      client.release();
      throw err;
    }
  }

  return trades;
}

// -------------------------
// Queue processor
// -------------------------
function enqueueOrder(order) {
  const instrument = order.instrument;
  ensureBook(instrument);
  queues[instrument].push(order);

  if (!running[instrument]) {
    runInstrumentQueue(instrument).catch((err) =>
      console.error("Queue error:", err)
    );
  }
}

async function runInstrumentQueue(instrument) {
  if (running[instrument]) return;
  running[instrument] = true;

  try {
    while (queues[instrument].length > 0) {
      const order = queues[instrument].shift();

      if (order.type === "limit" && Number(order.remaining_quantity) > 0) {
        addOrderToBook(order);
      }

      await processIncomingOrder(order);
    }
  } finally {
    running[instrument] = false;
  }
}
const matchingEngine = {
  loadOpenOrdersFromDb,
  enqueueOrder,
  processIncomingOrder,
};

module.exports = matchingEngine;
