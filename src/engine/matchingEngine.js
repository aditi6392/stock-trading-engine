// src/engine/matchingEngine.js
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

/**
 * In-memory orderbook matching engine
 *
 * Design summary:
 * - On start call init() to load open/partially_filled limit orders from DB.
 * - Use per-instrument in-memory order books:
 *     { bids: Map<price, Array<orderEntry>>, asks: Map<price, Array<orderEntry>> }
 *   Price keys are strings to use as Map keys.
 * - An orderEntry: { id, client_id, instrument, side, type, price, quantity, remaining_quantity, created_at }
 * - Use per-instrument queue and a running flag (mutex) so only one matcher runs for an instrument at a time.
 * - enqueueOrder(order) pushes the order into the instrument queue and triggers processing.
 * - match loop matches incoming order against the in-memory opposite book, creates trades and persists them
 *   inside a single DB transaction for each incoming order processed.
 *
 * Notes:
 * - This is single-node in-memory matching. To scale to multiple nodes you'd need partitioning + distributed locks.
 * - The engine persists all state changes (trades and order updates) to Postgres.
 * - The engine assumes orders are inserted into DB before enqueueOrder is called (we follow that pattern).
 */

// In-memory structures
const books = {}; // instrument -> { bids: Map, asks: Map, bidPrices: SortedArray(desc), askPrices: SortedArray(asc) }
const queues = {}; // instrument -> Array<order>
const running = {}; // instrument -> boolean (processing flag)

/* -------------------------
   Helpers: price-array ops
   ------------------------- */

function insertPriceSorted(prices, price, descending = false) {
  // prices is an array of numbers (unique). Keep sorted.
  // descending true: biggest first
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

/* -------------------------
   Book manipulation helpers
   ------------------------- */

function ensureBook(instrument) {
  if (!books[instrument]) {
    books[instrument] = {
      bids: new Map(), // price -> [orderEntry...], price numeric string
      asks: new Map(),
      bidPrices: [], // sorted desc
      askPrices: [], // sorted asc
    };
    queues[instrument] = [];
    running[instrument] = false;
  }
  return books[instrument];
}

function addOrderToBook(order) {
  // only limit orders with price belong to book (market orders handled immediately)
  if (order.type !== "limit" || order.price == null) return;
  const book = ensureBook(order.instrument);
  const priceKey = String(order.price);
  const sideMap = order.side === "buy" ? book.bids : book.asks;
  const pricesArr = order.side === "buy" ? book.bidPrices : book.askPrices;
  if (!sideMap.has(priceKey)) sideMap.set(priceKey, []);
  // push at tail (older orders first). created_at should give FIFO.
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

/* -------------------------
   DB helpers
   ------------------------- */

async function loadOpenOrdersFromDb() {
  // load limit orders with status open/partially_filled and price not null
  const res = await pool.query(
    `SELECT * FROM orders
     WHERE type = 'limit' AND status IN ('open','partially_filled') AND price IS NOT NULL
     ORDER BY created_at ASC`
  );

  for (const row of res.rows) {
    // normalize row fields to expected order entry shape
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

/* -------------------------
   Matching core
   ------------------------- */

/**
 * Try to match an incoming order against the in-memory opposite book.
 * Persists trades and updates in a DB transaction.
 *
 * incoming: order object (must include id, instrument, side, type, price?, quantity, remaining_quantity)
 *
 * returns: array of trade objects created
 */
async function processIncomingOrder(incoming) {
  const trades = [];
  const instrument = incoming.instrument;
  const isBuy = incoming.side === "buy";
  const book = ensureBook(instrument);

  // incomingRemaining is mutable local
  let incomingRemaining = Number(incoming.remaining_quantity);

  // We'll loop while incomingRemaining > 0 and there are matchable levels
  while (incomingRemaining > 0) {
    // pick best opposite price level
    const oppPrices = isBuy ? book.askPrices : book.bidPrices;
    if (!oppPrices || oppPrices.length === 0) break; // nothing to match

    // best price depends on side
    const bestPrice = oppPrices[0];

    // price check for limit orders
    if (incoming.type === "limit") {
      if (isBuy && Number(bestPrice) > Number(incoming.price)) break; // best ask too expensive
      if (!isBuy && Number(bestPrice) < Number(incoming.price)) break; // best bid too low
    }

    const priceKey = String(bestPrice);
    const oppList = (isBuy ? book.asks : book.bids).get(priceKey);
    if (!oppList || oppList.length === 0) {
      // no orders at this price (shouldn't happen), remove price level and continue
      if (isBuy) removePrice(book.askPrices, bestPrice);
      else removePrice(book.bidPrices, bestPrice);
      continue;
    }

    // Take the oldest resting order at this level (FIFO)
    const resting = oppList[0];
    const avail = Number(resting.remaining_quantity);
    if (avail <= 0) {
      // remove it and continue
      oppList.shift();
      if (oppList.length === 0) {
        (isBuy ? book.asks : book.bids).delete(priceKey);
        if (isBuy) removePrice(book.askPrices, bestPrice);
        else removePrice(book.bidPrices, bestPrice);
      }
      continue;
    }

    const tradeQty = Math.min(incomingRemaining, avail);
    const tradePrice = Number(resting.price); // trade at resting price (common convention)

    // Persist this match in DB inside a transaction that updates both orders and inserts trade.
    // We will use a DB client for a short transaction per trade (could be batched, but keep simple & safe).
    // Use SELECT ... FOR UPDATE to ensure DB row values match what we expect (protecting if other actors modify DB).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Re-fetch resting order FOR UPDATE to confirm remaining_quantity hasn't changed
      const rres = await client.query(
        `SELECT id, remaining_quantity, status FROM orders WHERE id = $1 FOR UPDATE`,
        [resting.id]
      );
      if (rres.rows.length === 0) {
        // resting disappeared, rollback and continue outer loop
        await client.query("ROLLBACK");
        client.release();
        // remove resting from memory and continue
        oppList.shift();
        if (oppList.length === 0) {
          (isBuy ? book.asks : book.bids).delete(priceKey);
          if (isBuy) removePrice(book.askPrices, bestPrice);
          else removePrice(book.bidPrices, bestPrice);
        }
        continue;
      }

      const rRow = rres.rows[0];
      const dbAvail = Number(rRow.remaining_quantity);

      if (dbAvail <= 0) {
        // nothing left, rollback and remove in-memory
        await client.query("ROLLBACK");
        client.release();
        oppList.shift();
        if (oppList.length === 0) {
          (isBuy ? book.asks : book.bids).delete(priceKey);
          if (isBuy) removePrice(book.askPrices, bestPrice);
          else removePrice(book.bidPrices, bestPrice);
        }
        continue;
      }

      const finalTradeQty = Math.min(tradeQty, dbAvail);

      // Insert trade
      const tradeId = uuidv4();
      await client.query(
        `INSERT INTO trades (id, buy_order_id, sell_order_id, instrument, price, quantity, traded_at)
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

      // Update resting order
      const newRestingRemaining = dbAvail - finalTradeQty;
      const restingStatus =
        newRestingRemaining === 0 ? "filled" : "partially_filled";
      await client.query(
        `UPDATE orders SET remaining_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [newRestingRemaining, restingStatus, resting.id]
      );

      // Update incoming order row in DB (we'll update later final state; but update partial fills progressively)
      // Fetch incoming row FOR UPDATE to synchronize
      const inRes = await client.query(
        `SELECT remaining_quantity FROM orders WHERE id = $1 FOR UPDATE`,
        [incoming.id]
      );
      if (inRes.rows.length === 0) {
        // incoming missing in DB (shouldn't happen). rollback and throw.
        await client.query("ROLLBACK");
        client.release();
        throw new Error("Incoming order not found in DB during matching");
      }
      const dbIncomingRem = Number(inRes.rows[0].remaining_quantity);
      const newIncomingRemaining = Math.max(0, dbIncomingRem - finalTradeQty);
      const incomingStatus =
        newIncomingRemaining === 0 ? "filled" : "partially_filled";
      await client.query(
        `UPDATE orders SET remaining_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [newIncomingRemaining, incomingStatus, incoming.id]
      );

      await client.query("COMMIT");

      // Commit succeeded — reflect changes in-memory
      // adjust resting.remaining_quantity in memory (and remove if filled)
      resting.remaining_quantity = newRestingRemaining;
      if (newRestingRemaining === 0) {
        // pop it from oppList
        oppList.shift();
        if (oppList.length === 0) {
          (isBuy ? book.asks : book.bids).delete(priceKey);
          if (isBuy) removePrice(book.askPrices, bestPrice);
          else removePrice(book.bidPrices, bestPrice);
        }
      }

      // adjust incomingRemaining
      incomingRemaining -= finalTradeQty;

      // push trade into returned trades array
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
  } // end while incomingRemaining

  // After attempting matches, update incoming order DB row final remaining/status if changed
  // Note: if nothing matched, incomingRemaining equals original remaining_quantity.
  const finalClient = await pool.connect();
  try {
    await finalClient.query("BEGIN");
    // Re-fetch current incoming remaining
    const inCheck = await finalClient.query(
      `SELECT remaining_quantity FROM orders WHERE id = $1 FOR UPDATE`,
      [incoming.id]
    );
    if (inCheck.rows.length === 0) {
      await finalClient.query("ROLLBACK");
      finalClient.release();
      throw new Error("Incoming order missing during final update");
    }
    const dbIncomingRemNow = Number(inCheck.rows[0].remaining_quantity);
    // If DB value differs from incomingRemaining (could have changed if other processes touched it),
    // choose the smaller remaining (conservative)
    const finalRem = Math.min(dbIncomingRemNow, incomingRemaining);
    const finalStatus =
      finalRem === 0
        ? "filled"
        : finalRem === Number(incoming.quantity)
        ? "open"
        : "partially_filled";
    await finalClient.query(
      `UPDATE orders SET remaining_quantity = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [finalRem, finalStatus, incoming.id]
    );
    await finalClient.query("COMMIT");
    finalClient.release();
  } catch (err) {
    try {
      await finalClient.query("ROLLBACK");
    } catch (_) {}
    finalClient.release();
    throw err;
  }

  return trades;
}

/* -------------------------
   Queue + runner
   ------------------------- */

function enqueueOrder(order) {
  const instrument = order.instrument;
  ensureBook(instrument);
  queues[instrument].push(order);
  // trigger processor if not running for instrument
  if (!running[instrument]) {
    runInstrumentQueue(instrument).catch((err) => {
      console.error("Error in runInstrumentQueue:", err);
    });
  }
}

async function runInstrumentQueue(instrument) {
  if (running[instrument]) return;
  running[instrument] = true;

  try {
    while (queues[instrument].length > 0) {
      const order = queues[instrument].shift();
      // If the order is a limit order, ensure it's in the book before matching resting matches
      // For market orders we don't add to book
      if (order.type === "limit" && Number(order.remaining_quantity) > 0) {
        // add to book as resting so matching logic sees it if it's not immediately matched
        addOrderToBook(order);
      }

      // process matching. processIncomingOrder will persist trades & update DB and mutate in-memory book
      const trades = await processIncomingOrder(order);

      // Optionally: notify SSE/WS or update any caches here
      if (trades.length > 0) {
        // console.log("Trades created for", instrument, trades);
      }

      // If after matching the incoming order still has remaining > 0 and is limit,
      // it should remain in the book (it was added previously). For market orders with remaining,
      // they remain open (or we could mark rejected) — current behavior: leave as-is.
    }
  } finally {
    running[instrument] = false;
  }
}

/* -------------------------
   Public API
   ------------------------- */

module.exports = {
  init: async () => {
    // load existing limit orders into memory
    await loadOpenOrdersFromDb();
  },
  enqueueOrder,
  // legacy helper if you want synchronous matching call (not queued)
  // use carefully — it will run matching immediately
  matchOrderSync: async (order) => {
    ensureBook(order.instrument);
    // if limit, add to book first
    if (order.type === "limit" && Number(order.remaining_quantity) > 0) {
      addOrderToBook(order);
    }
    const trades = await processIncomingOrder(order);
    return trades;
  },
};
