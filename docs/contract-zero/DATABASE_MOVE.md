# Moving the database (Supabase → Neon)

This keeps every row: the schema and migration history, player accounts and sessions, the world, its ledger and market, and the settlement queue with its NEAR transaction hashes. Nothing on chain changes.

**Two rules:**
- **One database settles at a time.** The API is the only process that writes or settles. It stays stopped from the backup until it starts again on the new database. Then the old database is marked retired, and the API refuses to start on a retired database.
- **No switch without proof.** The switch happens only after a scratch restore of the backup and the new database both match the source, table by table.

Everything runs through [scripts/db/move-database.sh](../../scripts/db/move-database.sh). It never prints a connection string.

## You need

- **Postgres 17 client tools.** Supabase runs 17, and `pg_dump` must be at least the server's version. Point the script at them with `PGBIN=/opt/homebrew/opt/postgresql@17/bin`.
- **Three connection strings,** kept in variables and never pasted into chat:
  - `SOURCE_DATABASE_URL`: Supabase's **session** pooler (port 5432). While the API runs, the session pool is full; once the API stops, it has room.
  - `TARGET_DATABASE_URL`: Neon's **direct** connection, the host without `-pooler`, with `?sslmode=require`.
  - `SCRATCH_DATABASE_URL`: any empty throwaway Postgres 17, local is fine, for proving the backup.

## Steps

```sh
export PGBIN=/opt/homebrew/opt/postgresql@17/bin BACKUP_DIR=./db-backup
export SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... SCRATCH_DATABASE_URL=...
```

1. **Stop the API on Railway:** the service → Deployments → ⋮ → Remove (or `railway down`). The site shows the API as unreachable until step 7.
2. `scripts/db/move-database.sh preflight`
   - Prints both server versions and checks the target is empty.
   - Shows how many processes hold the world-writer lock on the source. It must be **0**.
3. `scripts/db/move-database.sh backup`
   - Takes a `pg_dump` of the public schema, with a SHA-256 checksum.
   - Fingerprints the source: every table's row count, a content checksum in primary-key order, and every sequence value.
   - Refuses to run while the API still holds the world lock.
4. `scripts/db/move-database.sh verify-backup`
   - Restores the dump into the scratch database and requires its fingerprint to equal the source's.
5. `scripts/db/move-database.sh restore`, then `scripts/db/move-database.sh verify`
   - Restores into the empty target, then requires target = source.
6. `scripts/db/move-database.sh retire`
   - Adds a `_cz_retired` table to the **source**; nothing else changes there.
   - From now on, an API pointed at Supabase by mistake exits at boot with "this database was retired".
7. **Point the API at Neon and start it.**
   - Railway → contract-zero → Variables:
     - `DATABASE_URL` = the Neon direct URL;
     - `FRONTEND_ORIGIN` = `https://contractzero.netlify.app,https://contract-zero.vercel.app`.
   - Deploy. The log should show `world ledger: N entries loaded and checked` and `world: loaded at tick T`, with the same tick as the source.
8. **Check:**
   - `GET https://contract-zero.up.railway.app/ready` returns `{"db":"up"}`;
   - `https://contractzero.netlify.app` → Contracts lists contracts;
   - sign in, run a mission, extract, and see the settlement confirm (War Room, or `GET /settlements` on the API).
9. **Afterwards:**
   - Pause the Supabase project (Settings → General → Pause project).
   - Keep `db-backup/` somewhere safe. It's the full pre-move record, including the long evidence histories that the fix in PR #8 compacts.

## Rolling back

Before step 6, nothing has changed on Supabase. Set `DATABASE_URL` back to it and deploy.

After step 6, delete the marker on Supabase (`DROP TABLE public._cz_retired;`) only after making sure no API is running against Neon. Otherwise both databases would settle.
