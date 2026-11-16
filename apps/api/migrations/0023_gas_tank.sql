-- Gas tank: every refill of a game-created account (email / NEAR Auth), so the daily
-- per-account limit can be enforced and the relayer's spend audited.
CREATE TABLE IF NOT EXISTS auth_topups (
    id           BIGSERIAL PRIMARY KEY,
    account      TEXT NOT NULL,
    amount_yocto TEXT NOT NULL,
    tx           TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_topups_account ON auth_topups (account, created_at);
