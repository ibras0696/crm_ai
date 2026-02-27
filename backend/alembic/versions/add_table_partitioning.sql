-- Database partitioning for large tables
-- Sprint 3: TASK-304

-- 1. Create partitioned table for table_records
CREATE TABLE IF NOT EXISTS table_records_partitioned (
    LIKE table_records INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- 2. Create initial partitions (last 6 months + next 6 months)
CREATE TABLE IF NOT EXISTS table_records_2025_09 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE IF NOT EXISTS table_records_2025_10 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE IF NOT EXISTS table_records_2025_11 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE IF NOT EXISTS table_records_2025_12 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS table_records_2026_01 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS table_records_2026_02 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS table_records_2026_03 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS table_records_2026_04 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS table_records_2026_05 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS table_records_2026_06 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS table_records_2026_07 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS table_records_2026_08 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- 3. Function to automatically create next month's partition
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS void AS $$
DECLARE
    partition_date date;
    partition_name text;
    start_date text;
    end_date text;
BEGIN
    -- Calculate next month
    partition_date := date_trunc('month', CURRENT_DATE + interval '1 month');
    partition_name := 'table_records_' || to_char(partition_date, 'YYYY_MM');
    start_date := to_char(partition_date, 'YYYY-MM-DD');
    end_date := to_char(partition_date + interval '1 month', 'YYYY-MM-DD');
    
    -- Create partition if it doesn't exist
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF table_records_partitioned
         FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        start_date,
        end_date
    );
    
    RAISE NOTICE 'Created partition % for range % to %', partition_name, start_date, end_date;
END;
$$ LANGUAGE plpgsql;

-- 4. Create archive table for old records
CREATE TABLE IF NOT EXISTS table_records_archive (
    LIKE table_records INCLUDING ALL
);

-- 5. Function to archive old partitions
CREATE OR REPLACE FUNCTION archive_old_partition(months_old integer DEFAULT 24)
RETURNS void AS $$
DECLARE
    partition_date date;
    partition_name text;
    row_count bigint;
BEGIN
    -- Calculate cutoff date
    partition_date := date_trunc('month', CURRENT_DATE - (months_old || ' months')::interval);
    partition_name := 'table_records_' || to_char(partition_date, 'YYYY_MM');
    
    -- Check if partition exists
    IF EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = partition_name
    ) THEN
        -- Move data to archive
        EXECUTE format(
            'INSERT INTO table_records_archive SELECT * FROM %I',
            partition_name
        );
        
        GET DIAGNOSTICS row_count = ROW_COUNT;
        
        -- Drop partition
        EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
        
        RAISE NOTICE 'Archived % rows from partition % to archive table', row_count, partition_name;
    ELSE
        RAISE NOTICE 'Partition % does not exist', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Create indexes on archive table
CREATE INDEX IF NOT EXISTS idx_archive_org_created ON table_records_archive (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_table_id ON table_records_archive (table_id);
CREATE INDEX IF NOT EXISTS idx_archive_deleted_at ON table_records_archive (deleted_at) WHERE deleted_at IS NOT NULL;

-- 7. Migration notes
COMMENT ON TABLE table_records_partitioned IS 'Partitioned version of table_records by created_at (monthly)';
COMMENT ON TABLE table_records_archive IS 'Archive for old table_records (>24 months)';
COMMENT ON FUNCTION create_monthly_partition() IS 'Automatically creates next months partition';
COMMENT ON FUNCTION archive_old_partition(integer) IS 'Archives partitions older than specified months';

-- To migrate existing data (run manually when ready):
-- INSERT INTO table_records_partitioned SELECT * FROM table_records WHERE created_at >= '2025-09-01';
-- ALTER TABLE table_records RENAME TO table_records_old;
-- ALTER TABLE table_records_partitioned RENAME TO table_records;
