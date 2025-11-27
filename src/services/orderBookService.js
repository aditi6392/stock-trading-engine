const redis = require("../config/redis");

// Redis sorted sets store: score = price, value = JSON order
// BUY => high price wins => score = price
// SELL => low price wins => score = price

module.exports = {
  // ---------------------------------------------
  // ADD ORDER TO ORDERBOOK
  // ---------------------------------------------
  addOrder: async (order) => {
    const bookKey = `orderbook:${order.instrument}:${order.side}`;
    const score = order.price || 0;

    await redis.zAdd(bookKey, {
      score,
      value: JSON.stringify(order),
    });

    console.log("Order added to Redis:", bookKey);
  },

  // ---------------------------------------------
  // FETCH TOP ORDER (best price)
  // ---------------------------------------------
  getTopOrder: async (instrument, side) => {
    const key = `orderbook:${instrument}:${side}`;

    let res;

    if (side === "buy") {
      // Highest price
      res = await redis.zRange(key, -1, -1);
    } else {
      // Lowest price
      res = await redis.zRange(key, 0, 0);
    }

    if (!res || res.length === 0) return null;

    return JSON.parse(res[0]);
  },

  // ---------------------------------------------
  // REMOVE ORDER
  // ---------------------------------------------
  removeOrder: async (order) => {
    const key = `orderbook:${order.instrument}:${order.side}`;
    await redis.zRem(key, JSON.stringify(order));
  },

  // ---------------------------------------------
  // GET FULL ORDERBOOK
  // ---------------------------------------------
  getOrderBook: async (instrument) => {
    const buys = await redis.zRange(`orderbook:${instrument}:buy`, 0, -1, {
      withScores: true,
    });

    const sells = await redis.zRange(`orderbook:${instrument}:sell`, 0, -1, {
      withScores: true,
    });

    return { buys, sells };
  },
};
