


// engine/Engine.js

const redisMatchingEngine = require("./redisEngine");

module.exports = {
  // Initialize underlying engine
  init: async () => {
    if (redisMatchingEngine.init) {
      await redisMatchingEngine.init();
    }
  },

  // 🔥 Called by ordersService after adding order to OrderBook
  run: async (instrument) => {
    if (redisMatchingEngine.run) {
      return await redisMatchingEngine.run(instrument);
    }
    throw new Error("redisMatchingEngine.run is missing");
  },

  matchOrder: async (order) => {
    if (redisMatchingEngine.matchOrder) {
      return await redisMatchingEngine.matchOrder(order);
    }
  },

  cancelOrder: async (order) => {
    if (redisMatchingEngine.cancelOrder) {
      return await redisMatchingEngine.cancelOrder(order);
    }
  },

  getOrderBook: async (instrument) => {
    if (redisMatchingEngine.getOrderBook) {
      return await redisMatchingEngine.getOrderBook(instrument);
    }
  },
};
