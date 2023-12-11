CREATE INDEX IF NOT EXISTS idx_systems_by_name ON systems(name);
CREATE INDEX IF NOT EXISTS idx_items_by_id ON items(id);
CREATE INDEX IF NOT EXISTS idx_prices_by_system ON prices(system);
CREATE INDEX IF NOT EXISTS idx_prices_by_item_id ON prices(item_id);
CREATE INDEX IF NOT EXISTS idx_prices_by_item_id_system ON prices(item_id, system);
SELECT name, type, sql FROM sqlite_schema WHERE type IN ('index');
EXPLAIN QUERY PLAN SELECT cost_index FROM systems WHERE name = 'Jita';
EXPLAIN QUERY PLAN SELECT * FROM prices WHERE item_id IN (16663,4312,16643,16647) AND system = 'Jita';
EXPLAIN QUERY PLAN SELECT * FROM items WHERE id IN (16663,4312,16643,16647);