-- ─── Votes table with time-based partitioning ────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
    id              BIGSERIAL,
    choice          TEXT            NOT NULL CHECK (choice IN ('tabs', 'spaces')),
    user_id         UUID            NOT NULL,
    zone            TEXT            NOT NULL DEFAULT 'unknown', -- which api zone ingested the vote
    worker_id       TEXT            NOT NULL DEFAULT 'unknown', -- which worker processed the vote
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)                                -- multi-column primary key created at required for partitioning
) PARTITION BY RANGE (created_at);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_choice ON votes (choice);

-- ─── Totals view (fast reads for the frontend) ───────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS vote_totals AS
    SELECT
        choice, 
        COUNT(*) AS total
    FROM votes
    GROUP BY choice;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_totals_choice ON vote_totals (choice);