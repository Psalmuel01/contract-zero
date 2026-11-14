#!/bin/bash
# Runs scripts/io-bench.sql's designs on a RESTORED copy and reports, per persisted tick:
# WAL bytes, blocks read/written (pg_stat_database), time, and table size after.
#   scripts/io-bench.sh <restored-db-url> [ticks]
set -euo pipefail
DB=$1; N=${2:-60}
case "$DB" in *supabase*) echo "refusing: never benchmark against production"; exit 1;; esac
P=/opt/homebrew/opt/postgresql@17/bin
q() { $P/psql "$DB" -X -Atq -c "$1"; }
$P/psql "$DB" -X -q -f "$(dirname "$0")/io-bench.sql"
printf "%-34s %12s %10s %10s %10s %10s\n" design "WAL/tick" "read/tick" "dirty/tick" "ms/tick" "table"
for d in ${ORDER:-d c b a}; do
  q "CHECKPOINT"
  l0=$(q "select pg_current_wal_insert_lsn()"); r0=$(q "select blks_read from pg_stat_database where datname=current_database()")
  w0=$(q "select buffers_backend + buffers_checkpoint + buffers_clean from pg_stat_bgwriter" 2>/dev/null || echo 0)
  t0=$(python3 -c 'import time; print(time.time())')
  q "CALL bench_$d($N)"
  t1=$(python3 -c 'import time; print(time.time())')
  q "CHECKPOINT"
  wal=$(q "select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), '$l0')"); r1=$(q "select blks_read from pg_stat_database where datname=current_database()")
  w1=$(q "select buffers_backend + buffers_checkpoint + buffers_clean from pg_stat_bgwriter" 2>/dev/null || echo 0)
  case $d in a) t=snap_a; label="A current (insert+prune 500)";; b) t=snap_b_current; label="B single row + hourly checkpoint";; c) t=snap_c; label="C insert + batched prune";; d) t=snap_d; label="D no ledger in snapshot + append";; esac
  size=$(q "select pg_size_pretty(pg_total_relation_size('$t') $( [ $d = d ] && echo "+ pg_total_relation_size('ledger_d')" ) $( [ $d = b ] && echo "+ pg_total_relation_size('snap_b_ckpt')" ))")
  python3 - "$label" "$wal" "$r0" "$r1" "$w0" "$w1" "$t0" "$t1" "$N" "$size" <<'EOF'
import sys
label, wal, r0, r1, w0, w1, t0, t1, n, size = sys.argv[1:]
n = int(n)
print(f"{label:<34} {int(wal)/n/1024:9.0f} kB {(int(r1)-int(r0))/n:10.1f} {(int(w1)-int(w0))/n:10.1f} {(float(t1)-float(t0))*1000/n:10.0f} {size:>10}")
EOF
done
