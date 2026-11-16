-- Email sign-in through Privy: a session proven by a NEP-413 signature from the
-- player's Privy-held key, for that key's implicit account. Identities reuse
-- auth_identities (subject = the Privy user id, provider = 'privy').
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_method_check;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_method_check CHECK (method IN ('wallet', 'near_auth', 'privy', 'dev'));
