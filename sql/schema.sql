CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL,
    instrument VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    type VARCHAR(10) NOT NULL,
    price NUMERIC,
    quantity NUMERIC NOT NULL,
     remaining_quantity NUMERIC NOT NULL ,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY,
    buy_order_id UUID NOT NULL,
    sell_order_id UUID NOT NULL,
    instrument VARCHAR(20) NOT NULL,
    price NUMERIC NOT NULL,
    quantity NUMERIC NOT NULL,
    traded_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (buy_order_id) REFERENCES orders(id),
    FOREIGN KEY (sell_order_id) REFERENCES orders(id)
);
