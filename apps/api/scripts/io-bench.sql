-- Persistence I/O benchmark on a restored production copy (never run against production).
-- Each design persists the REAL latest world N times, one transaction per tick, and is
-- measured by WAL bytes (what the disk must absorb), block I/O and time.
--   psql <restored-db> -v n=60 -f scripts/io-bench.sql
\set ON_ERROR_STOP on
\timing off
SET client_min_messages = warning;

-- The real world and its per-tick ledger growth (production: ~16 entries a tick).
DROP TABLE IF EXISTS bench_src;
CREATE TABLE bench_src AS SELECT state FROM world_snapshots ORDER BY id DESC LIMIT 1;
DROP TABLE IF EXISTS bench_new_entries;
CREATE TABLE bench_new_entries AS
  SELECT e FROM bench_src, jsonb_array_elements(state->'ledger') WITH ORDINALITY AS t(e, i)
  ORDER BY i DESC LIMIT 16;

-- Tables per design, each starting from the same full retention (500 rows for A/C/D,
-- one row plus checkpoints for B). Rows vary by tick so nothing is deduplicated.
CREATE OR REPLACE FUNCTION bench_state(t int, with_ledger bool) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN with_ledger THEN jsonb_set(state, '{tick}', to_jsonb(t))
              ELSE jsonb_set(state - 'ledger', '{tick}', to_jsonb(t)) || jsonb_build_object('ledger_len', jsonb_array_length(state->'ledger')) END
  FROM bench_src $$;

DROP TABLE IF EXISTS snap_a, snap_b_current, snap_b_ckpt, snap_c, snap_d, ledger_d;
CREATE TABLE snap_a (id bigserial PRIMARY KEY, tick bigint, version bigint, state jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE snap_c (LIKE snap_a INCLUDING ALL);
CREATE TABLE snap_d (LIKE snap_a INCLUDING ALL);
CREATE TABLE snap_b_ckpt (LIKE snap_a INCLUDING ALL);
CREATE TABLE snap_b_current (id int PRIMARY KEY, tick bigint, version bigint, state jsonb);
CREATE TABLE ledger_d (seq bigint PRIMARY KEY, tick bigint, entry jsonb NOT NULL);
INSERT INTO snap_a (tick, version, state) SELECT g, g, bench_state(g, true) FROM generate_series(1, 500) g;
INSERT INTO snap_c (tick, version, state) SELECT tick, version, state FROM snap_a;
INSERT INTO snap_d (tick, version, state) SELECT g, g, bench_state(g, false) FROM generate_series(1, 500) g;
INSERT INTO ledger_d (seq, tick, entry) SELECT i, 0, e FROM bench_src, jsonb_array_elements(state->'ledger') WITH ORDINALITY AS t(e, i);
INSERT INTO snap_b_current VALUES (1, 0, 0, bench_state(0, true));
INSERT INTO snap_b_ckpt (tick, version, state) SELECT g, g, bench_state(g, true) FROM generate_series(1, 48) g;
VACUUM (FREEZE, ANALYZE) snap_a, snap_c, snap_d, ledger_d, snap_b_current, snap_b_ckpt;
-- No background vacuum inside the measured windows (WAL is counted database-wide).
ALTER TABLE snap_a SET (autovacuum_enabled = false, toast.autovacuum_enabled = false);
ALTER TABLE snap_c SET (autovacuum_enabled = false, toast.autovacuum_enabled = false);
ALTER TABLE snap_d SET (autovacuum_enabled = false, toast.autovacuum_enabled = false);
ALTER TABLE ledger_d SET (autovacuum_enabled = false);
ALTER TABLE snap_b_current SET (autovacuum_enabled = false, toast.autovacuum_enabled = false);
ALTER TABLE snap_b_ckpt SET (autovacuum_enabled = false, toast.autovacuum_enabled = false);
CHECKPOINT;

-- A: today. Insert the whole world, prune beyond 500.
CREATE OR REPLACE PROCEDURE bench_a(n int) LANGUAGE plpgsql AS $$ BEGIN
  FOR i IN 1..n LOOP
    INSERT INTO snap_a (tick, version, state) VALUES (1000 + i, 1000 + i, bench_state(1000 + i, true));
    DELETE FROM snap_a WHERE id <= (SELECT max(id) FROM snap_a) - 500;
    COMMIT;
  END LOOP; END $$;
-- B: one current row updated in place (UPSERT), plus a checkpoint row every 60 ticks.
CREATE OR REPLACE PROCEDURE bench_b(n int) LANGUAGE plpgsql AS $$ BEGIN
  FOR i IN 1..n LOOP
    INSERT INTO snap_b_current VALUES (1, 1000 + i, 1000 + i, bench_state(1000 + i, true))
      ON CONFLICT (id) DO UPDATE SET tick = excluded.tick, version = excluded.version, state = excluded.state;
    IF i % 60 = 0 THEN
      INSERT INTO snap_b_ckpt (tick, version, state) VALUES (1000 + i, 1000 + i, bench_state(1000 + i, true));
      DELETE FROM snap_b_ckpt WHERE id <= (SELECT max(id) FROM snap_b_ckpt) - 48;
    END IF;
    COMMIT;
  END LOOP; END $$;
-- C: insert the whole world, prune in batches every 30 ticks.
CREATE OR REPLACE PROCEDURE bench_c(n int) LANGUAGE plpgsql AS $$ BEGIN
  FOR i IN 1..n LOOP
    INSERT INTO snap_c (tick, version, state) VALUES (1000 + i, 1000 + i, bench_state(1000 + i, true));
    IF i % 30 = 0 THEN DELETE FROM snap_c WHERE id <= (SELECT max(id) FROM snap_c) - 500; END IF;
    COMMIT;
  END LOOP; END $$;
-- D: the world WITHOUT its ledger history, plus only the new ledger entries appended
-- (same transaction), prune beyond 500.
CREATE OR REPLACE PROCEDURE bench_d(n int) LANGUAGE plpgsql AS $$ DECLARE base bigint; BEGIN
  SELECT max(seq) INTO base FROM ledger_d;
  FOR i IN 1..n LOOP
    INSERT INTO ledger_d (seq, tick, entry) SELECT base + (i - 1) * 16 + row_number() OVER (), 1000 + i, e FROM bench_new_entries;
    INSERT INTO snap_d (tick, version, state) VALUES (1000 + i, 1000 + i, bench_state(1000 + i, false));
    DELETE FROM snap_d WHERE id <= (SELECT max(id) FROM snap_d) - 500;
    COMMIT;
  END LOOP; END $$;
