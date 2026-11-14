-- The ledger's history moves out of the world snapshot. Each snapshot used to carry
-- every ledger entry since genesis (44k entries, ~85% of a 7 MB snapshot), rewritten in
-- full every tick and again when pruned: ~1.7 MB of WAL a tick, the database's largest
-- source of disk I/O by far. Entries are now appended here once, in the same transaction
-- as the snapshot that first contains them; a snapshot keeps the ledger's length and its
-- last entries (an integrity check on load). Nothing is deleted: a snapshot without
-- ledger_len is the old format and still loads.
CREATE TABLE IF NOT EXISTS world_ledger (
    seq   BIGINT PRIMARY KEY,   -- LedgerEntry.seq: its index in the ledger
    tick  BIGINT NOT NULL,
    entry JSONB  NOT NULL       -- the LedgerEntry exactly as the engine serializes it
);
ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS ledger_len BIGINT;  -- NULL: ledger inline (old format)
