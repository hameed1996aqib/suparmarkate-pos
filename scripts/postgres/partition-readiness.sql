-- Run monthly against the production database.
-- Partition only after measurements show a real maintenance or latency problem.
SELECT
  relname AS table_name,
  n_live_tup::bigint AS estimated_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_indexes_size(relid)) AS index_size,
  n_dead_tup::bigint AS estimated_dead_rows,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN (
  'JournalLine',
  'StockMovement',
  'MoneyTransaction',
  'AuditLog',
  'SaleItem',
  'PurchaseItem',
  'AttendanceRecord'
)
ORDER BY pg_total_relation_size(relid) DESC;
