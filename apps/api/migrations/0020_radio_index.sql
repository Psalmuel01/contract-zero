-- The strategic radio reads the latest accepted faction decisions (GET /radio, and the
-- voice warm-up loop). Most decisions are "no action", so walking (kind, seq) to find 60
-- accepted ones read far back through large JSON payloads; on a small database instance
-- that cost seconds per call and helped exhaust its disk IO. This index holds exactly the
-- rows the query wants, newest first. The predicate matches radio::decision_lines.
CREATE INDEX IF NOT EXISTS idx_world_events_accepted_decisions
    ON world_events (seq DESC)
    WHERE kind = 'agent_decision' AND payload->>'validation' = 'accepted';
