#!/usr/bin/env bash
# Move CONTRACT ZERO's Postgres from one provider to another without losing a row.
#
#   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... scripts/db/move-database.sh <step>
#
# Steps, in order (each refuses to run if the previous one's output is missing):
#   preflight   both databases reachable, versions, target empty, API not writing to source
#   backup      pg_dump of the public schema (custom format) into $BACKUP_DIR
#   verify-backup  the dump lists every table, and a scratch restore of it matches the source
#   restore     restore the dump into the (empty) target
#   verify      row counts, sequences and content checksums: source == target
#   retire      mark the SOURCE retired (adds a _cz_retired table; changes nothing else).
#               The API refuses to start on a retired database, so after this the old
#               copy can never run the world or settle on chain again.
#
# Never prints a connection string. Stop the API before `backup` and keep it stopped
# until DATABASE_URL points at the target: the API is the only thing that writes.
set -euo pipefail

STEP="${1:-}"
: "${SOURCE_DATABASE_URL:?set SOURCE_DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./db-backup}"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_dump)")}"
PSQL="$PGBIN/psql"; PG_DUMP="$PGBIN/pg_dump"; PG_RESTORE="$PGBIN/pg_restore"
DUMP="$BACKUP_DIR/contract-zero.dump"
export PGCONNECT_TIMEOUT=30
mkdir -p "$BACKUP_DIR"

q() { "$PSQL" "$1" -X -q -At -v ON_ERROR_STOP=1 -c "$2"; }
# Restore everything in the dump except creating the public schema, which every fresh
# database (and every provider's default one) already has.
restore_into() {
  "$PG_RESTORE" -l "$DUMP" | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > "$BACKUP_DIR/restore.list"
  "$PG_RESTORE" --no-owner --no-privileges --exit-on-error -L "$BACKUP_DIR/restore.list" -d "$1" "$DUMP"
}
need_target() { : "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"; }

# What "the same data" means, per table: exact row count, and a checksum over the
# rows in primary-key order. Large values (settlement evidence, snapshot state, ledger
# entries) are hashed per row first, so the checksum query stays cheap.
fingerprint() {
  local url="$1"
  "$PSQL" "$url" -X -q -At -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout = 0;
SELECT 'tables=' || string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_cz_retired';
DO $$
DECLARE t record; n bigint; pk text; h text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_cz_retired' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.tablename) INTO n;
    SELECT string_agg(quote_ident(a.attname), ',' ORDER BY array_position(i.indkey, a.attnum))
      INTO pk FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = format('public.%I', t.tablename)::regclass AND i.indisprimary;
    EXECUTE format('SELECT md5(coalesce(string_agg(md5(x::text), '''' ORDER BY %s), '''')) FROM public.%I x',
                   coalesce(pk, 'md5(x::text)'), t.tablename) INTO h;
    RAISE NOTICE 'table % rows=% md5=%', t.tablename, n, h;
  END LOOP;
END $$;
SELECT 'seq ' || sequencename || '=' || coalesce(last_value::text, 'unset') FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename;
SQL
}
fp_to() { fingerprint "$1" 2>&1 | sed -E 's/^psql:[^N]*NOTICE: +//; s/^NOTICE: +//' | grep -E '^(tables=|table |seq )' > "$2"; }

case "$STEP" in
  preflight)
    echo "source: $(q "$SOURCE_DATABASE_URL" "select current_setting('server_version')||', '||pg_size_pretty(pg_database_size(current_database()))")"
    echo "pg_dump: $("$PG_DUMP" --version)"
    retired=$(q "$SOURCE_DATABASE_URL" "select to_regclass('public._cz_retired') is not null")
    [ "$retired" = "f" ] || { echo "source is already retired"; exit 1; }
    # The API holds this advisory lock for as long as it runs (WORLD_WRITER_LOCK).
    writer=$(q "$SOURCE_DATABASE_URL" "select count(*) from pg_locks where locktype='advisory' and granted and ((classid::bigint << 32) | objid::bigint) = $((0x0C2E0001))")
    echo "API world-writer lock holders on source: $writer (must be 0 before backup)"
    if [ -n "${TARGET_DATABASE_URL:-}" ]; then
      echo "target: $(q "$TARGET_DATABASE_URL" "select current_setting('server_version')")"
      echo "target public tables: $(q "$TARGET_DATABASE_URL" "select count(*) from pg_tables where schemaname='public'") (must be 0)"
    fi
    ;;
  backup)
    writer=$(q "$SOURCE_DATABASE_URL" "select count(*) from pg_locks where locktype='advisory' and granted and ((classid::bigint << 32) | objid::bigint) = $((0x0C2E0001))")
    [ "$writer" = "0" ] || { echo "the API is still running against the source (world lock held); stop it first"; exit 1; }
    "$PG_DUMP" "$SOURCE_DATABASE_URL" -Fc -Z 6 --schema=public --no-owner --no-privileges -f "$DUMP"
    fp_to "$SOURCE_DATABASE_URL" "$BACKUP_DIR/source.fingerprint"
    shasum -a 256 "$DUMP" > "$DUMP.sha256"
    echo "backup: $(ls -la "$DUMP" | awk '{print $5}') bytes; $(grep -c '^table ' "$BACKUP_DIR/source.fingerprint") tables fingerprinted"
    ;;
  verify-backup)
    : "${SCRATCH_DATABASE_URL:?set SCRATCH_DATABASE_URL (an empty throwaway database)}"
    shasum -a 256 -c "$DUMP.sha256"
    "$PG_RESTORE" -l "$DUMP" | grep -c 'TABLE DATA' | sed 's/^/table data entries: /'
    restore_into "$SCRATCH_DATABASE_URL"
    fp_to "$SCRATCH_DATABASE_URL" "$BACKUP_DIR/scratch.fingerprint"
    diff -u "$BACKUP_DIR/source.fingerprint" "$BACKUP_DIR/scratch.fingerprint" && echo "backup verified: scratch restore == source"
    ;;
  restore)
    need_target
    [ -f "$BACKUP_DIR/scratch.fingerprint" ] || { echo "run verify-backup first"; exit 1; }
    n=$(q "$TARGET_DATABASE_URL" "select count(*) from pg_tables where schemaname='public'")
    [ "$n" = "0" ] || { echo "target is not empty ($n tables); refusing to restore over it"; exit 1; }
    restore_into "$TARGET_DATABASE_URL"
    echo "restored"
    ;;
  verify)
    need_target
    fp_to "$TARGET_DATABASE_URL" "$BACKUP_DIR/target.fingerprint"
    diff -u "$BACKUP_DIR/source.fingerprint" "$BACKUP_DIR/target.fingerprint" && echo "target verified: target == source"
    ;;
  retire)
    need_target
    diff -q "$BACKUP_DIR/source.fingerprint" "$BACKUP_DIR/target.fingerprint" >/dev/null || { echo "target not verified; not retiring the source"; exit 1; }
    q "$SOURCE_DATABASE_URL" "CREATE TABLE IF NOT EXISTS public._cz_retired (retired_at timestamptz NOT NULL DEFAULT now(), note text NOT NULL); INSERT INTO public._cz_retired (note) VALUES ('moved to another database on ' || now()::date || '; see docs/contract-zero/DATABASE_MOVE.md')"
    echo "source retired: $(q "$SOURCE_DATABASE_URL" "select count(*) from public._cz_retired") marker row(s)"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
