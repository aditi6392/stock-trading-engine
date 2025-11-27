// orderbook/orderBook.js
const redis = require("../config/redis");

module.exports = {
  // Generate Redis key based on instrument + side
  _getBookKey(instrument, side) {
    return `orderbook:${instrument}:${side}`;
  },

  // Convert price into score for Redis Sorted Set
  // BUY -> highest price first (so score = price)
  // SELL -> lowest price first (score = price)
  _score(price) {
    return parseFloat(price);
  },

  // ---------------------------------------------
  // ADD ORDER TO ORDERBOOK
  // ---------------------------------------------
  async addOrder(order) {
    const key = this._getBookKey(order.instrument, order.side);

    const value = JSON.stringify(order);
    const score = this._score(order.price);

    await redis.zadd(key, score, value);
  },

  // ---------------------------------------------
  // REMOVE ORDER FROM ORDERBOOK
  // ---------------------------------------------
  async removeOrder(order) {
    const key = this._getBookKey(order.instrument, order.side);
    const value = JSON.stringify(order);
    await redis.zrem(key, value);
  },

  // ---------------------------------------------
  // GET BEST BUY/SELL ORDER
  // BUY → Highest price
  // SELL → Lowest price
  // ---------------------------------------------
  async getTopOrder(instrument, side) {
    const key = this._getBookKey(instrument, side);

    let result;

    if (side === "buy") {
      // Highest price is last element
      result = await redis.zrevrange(key, 0, 0);
    } else {
      // Lowest price is first element
      result = await redis.zrange(key, 0, 0);
    }

    if (!result || result.length === 0) return null;

    return JSON.parse(result[0]);
  },

  // ---------------------------------------------
  // GET FULL ORDERBOOK FOR AN INSTRUMENT
  // ---------------------------------------------
  async getFullBook(instrument) {
    const buyKey = this._getBookKey(instrument, "buy");
    const sellKey = this._getBookKey(instrument, "sell");

    const buyOrders = await redis.zrevrange(buyKey, 0, -1); // Highest first
    const sellOrders = await redis.zrange(sellKey, 0, -1); // Lowest first

    return {
      instrument,
      buy: buyOrders.map((o) => JSON.parse(o)),
      sell: sellOrders.map((o) => JSON.parse(o)),
    };
  },
};
