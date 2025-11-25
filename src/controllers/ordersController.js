const ordersService = require("../services/ordersService");

exports.createOrder = async (req, res) => {
  try {
    const order = await ordersService.createOrder(req.body);
    return res.json(order);
  } catch (err) {
    console.log("Order creation error:", err);
    return res.status(400).json({ error: err.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await ordersService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    return res.json(order);
  } catch (err) {
    console.log("Fetch order error:", err);
    return res.status(400).json({ error: err.message });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await ordersService.getAllOrders();
    return res.json(orders);
  } catch (err) {
    console.log("Fetch orders error:", err);
    return res.status(400).json({ error: err.message });
  }
};
exports.getOrdersByClient=async(req,res)=>{
    try{
        const orders=await ordersService.getOrdersByClient(req.params.client_id);
        return res.json(orders);

    }catch(err){
        console.log("Client orders error:",err);
        return res.status(400).json({error:err.message});
    }
}
exports.getOrdersByInstrument = async (req, res) => {
  try {
    const orders = await ordersService.getOrdersByInstrument(
      req.params.instrument
    );
    return res.json(orders);
  } catch (err) {
    console.log("Instrument orders error:", err);
    return res.status(400).json({ error: err.message });
  }
};
exports.getOrderbook = async (req, res) => {
  try {
    const instrument = req.query.instrument;
    const levels = parseInt(req.query.levels || "20");

    if (!instrument)
      return res.status(400).json({ error: "instrument query required" });

    const data = await ordersService.getOrderbook(instrument, levels);
    return res.json(data);
  } catch (err) {
    console.log("Orderbook fetch error:", err);
    return res.status(400).json({ error: err.message });
  }
};
