#!/bin/bash
# PostgreSQL Primary initialization script
# Sets up replication user and configuration

set -e

echo "Initializing PostgreSQL Primary for replication..."

# Create replication user
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD '${POSTGRES_REPLICATION_PASSWORD}';
EOSQL

# Configure pg_hba.conf for replication
cat >> "$PGDATA/pg_hba.conf" <<EOF

# Replication connections
host    replication     replicator      0.0.0.0/0               md5
EOF

# Configure postgresql.conf for replication
cat >> "$PGDATA/postgresql.conf" <<EOF

# Replication settings
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
hot_standby = on
wal_keep_size = 1GB
EOF

echo "PostgreSQL Primary initialized successfully"
