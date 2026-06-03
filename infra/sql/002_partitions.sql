-- ─── Create partitions for today and tomorrow ─────────────────────────────────
-- These cover local dev. The worker auto-creates future partitions at midnight.

DO $$
DECLARE
    today           DATE := CURRENT_DATE;
    tomorrow        DATE := CURRENT_DATE + INTERVAL '1 day';
    day_after       DATE := CURRENT_DATE + INTERVAL '2 days';
    tbl_today       TEXT;
    tbl_tomorrow    TEXT;
BEGIN
    tbl_today := 'votes_' || TO_CHAR(today,    'YYYY_MM_DD');
    tbl_tomorrow := 'votes_' || TO_CHAR(tomorrow, 'YYYY_MM_DD');

    -- Today
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE tablename = tbl_today
    ) THEN
        EXECUTE FORMAT(
            'CREATE TABLE %I PARTITION OF votes FOR VALUES FROM (%L) TO (%L)',
            tbl_today, today, tomorrow
        );
        RAISE NOTICE 'Created partition: %', tbl_today;
    END IF;

    -- Tomorrow
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE tablename = tbl_tomorrow
    ) THEN
        EXECUTE FORMAT(
            'CREATE TABLE %I PARTITION OF votes FOR VALUES FROM (%L) TO (%L)',
            tbl_tomorrow, tomorrow, day_after
        );
        RAISE NOTICE 'Created partition: %', tbl_tomorrow;
    END IF;
END $$;