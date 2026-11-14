-- ROLLBACK of migration 0021 (ledger out of the snapshot), for redeploying code OLDER than
-- it. Older code loads the newest snapshot and expects the full ledger inside it; a
-- new-format snapshot carries only the last 64 entries, so the older code must never see
-- one as the newest. This appends ONE old-format snapshot (full ledger inline, no
-- ledger_len) rebuilt from the newest new-format snapshot and world_ledger. Nothing is
-- deleted; world_ledger stays (the new code will reuse it if redeployed).
--
-- Order: 1) stop the API (Railway: remove the deployment or scale to 0) so nothing writes;
--        2) run this:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ledger-rollback.sql
--        3) deploy the older code.
BEGIN;
WITH latest AS (
  SELECT tick, version, state, ledger_len FROM world_snapshots ORDER BY id DESC LIMIT 1
), ledger AS (
  SELECT jsonb_agg(entry ORDER BY seq) AS entries, count(*) AS n
  FROM world_ledger, latest WHERE seq < latest.ledger_len
)
INSERT INTO world_snapshots (tick, version, state)
SELECT latest.tick, latest.version, jsonb_set(latest.state, '{ledger}', ledger.entries)
FROM latest, ledger
WHERE latest.ledger_len IS NOT NULL AND ledger.n = latest.ledger_len;  -- complete ledgers only

-- Verify before committing: the newest snapshot must now be old-format with a full ledger.
DO $$ DECLARE l bigint; f bigint; BEGIN
  SELECT ledger_len, jsonb_array_length(state->'ledger') INTO l, f FROM world_snapshots ORDER BY id DESC LIMIT 1;
  IF l IS NOT NULL OR f IS NULL OR f <> (SELECT count(*) FROM world_ledger WHERE seq < f) THEN
    RAISE EXCEPTION 'rollback snapshot not built (ledger_len %, inline %): nothing changed', l, f;
  END IF;
  RAISE NOTICE 'old-format snapshot written with % ledger entries', f;
END $$;
COMMIT;
