-- Table: prices
DROP TABLE IF EXISTS prices;
CREATE TABLE prices (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, item_id INTEGER NOT NULL REFERENCES items (id), system TEXT REFERENCES systems (name) NOT NULL, sell REAL NOT NULL, buy REAL NOT NULL);

-- Index: idx_prices_by_item_id
DROP INDEX IF EXISTS idx_prices_by_item_id;
CREATE INDEX idx_prices_by_item_id ON prices (item_id);

-- Index: idx_prices_by_item_id_system
DROP INDEX IF EXISTS idx_prices_by_item_id_system;
CREATE INDEX idx_prices_by_item_id_system ON prices (item_id, system);

-- Index: idx_prices_by_system
DROP INDEX IF EXISTS idx_prices_by_system;
CREATE INDEX idx_prices_by_system ON prices (system);

