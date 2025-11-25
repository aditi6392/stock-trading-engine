const express=require("express");
const app=express();
require("dotenv").config();

app.use(express.json());

//Routes
const ordersRoute=require("./routes/orders");
app.use("/orders",ordersRoute);

//health cheeck
app.get("/healthz",(req,res)=>res.json({status:"ok"}));

const PORT=process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on port",PORT));

module.exports=app;
