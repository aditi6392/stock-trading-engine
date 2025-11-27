// src/engine/redisEngine.js

const OrderBook = require("../orderbook/orderBook");
const tradesService = require("../services/tradesService");
const ordersService = require("../services/ordersService");

module.exports = {
  // --------------------------
  // INIT
  // --------------------------
  init: async () => {
    console.log("Redis Engine initialized");
  },

  // --------------------------
  // Main matching loop
  // --------------------------
  run: async (instrument) => {
    const trades = [];

    while (true) {
      const bestBuy = await OrderBook.getBestBuy(instrument);
      const bestSell = await OrderBook.getBestSell(instrument);

      if (!bestBuy || !bestSell) break;
      if (Number(bestBuy.price) < Number(bestSell.price)) break;

      const matchQty = Math.min(
        Number(bestBuy.remaining_quantity),
        Number(bestSell.remaining_quantity)
      );

      const price = Number(bestSell.price);

      // Create the trade
      const trade = await tradesService.createTrade({
        instrument,
        buy_order_id: bestBuy.order_id,
        sell_order_id: bestSell.order_id,
        quantity: matchQty,
        price,
      });

      trades.push(trade);

      // Update qty in memory
      bestBuy.remaining_quantity -= matchQty;
      bestSell.remaining_quantity -= matchQty;

      // Update qty in database
      await ordersService.updateRemaining(
        bestBuy.order_id,
        bestBuy.remaining_quantity
      );
      await ordersService.updateRemaining(
        bestSell.order_id,
        bestSell.remaining_quantity
      );

      // Update Redis book
      await OrderBook.updateAfterTrade(bestBuy, bestSell, matchQty);
    }

    return trades;
  },

  // --------------------------
  // matchOrder (called when new order arrives)
  // --------------------------
  matchOrder: async (order) => {
    // Add order to redis order book
    await OrderBook.add(order);

    // Run instrument matching
    return await module.exports.run(order.instrument);
  },

  // --------------------------
  // cancelOrder
  // --------------------------
  cancelOrder: async (orderId, instrument) => {
    return await OrderBook.cancel(orderId, instrument);
  },

  // --------------------------
  // getOrderBook
  // --------------------------
  getOrderBook: async (instrument) => {
    return await OrderBook.getFullBook(instrument);
  },
};
