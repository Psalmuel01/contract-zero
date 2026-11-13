-- Synthesized radio voice, cached: each distinct (voice version, speaker, text) is
-- synthesized once and served from here after. Only lines the server itself stored
-- (a mission's story, a faction's logged broadcast) are ever voiced.
CREATE TABLE IF NOT EXISTS voice_cache (
    key        TEXT PRIMARY KEY,          -- sha256(voice_version | speaker | text)
    speaker    TEXT NOT NULL,
    text       TEXT NOT NULL,
    audio      BYTEA NOT NULL,            -- audio/mpeg
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
