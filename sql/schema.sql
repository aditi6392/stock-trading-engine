CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    client_id VARCHAR(50) NOT NULL,
    instrument VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    type VARCHAR(10) NOT NULL,
    price NUMERIC,
    quantity NUMERIC NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
