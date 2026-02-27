-- Critical indexes for performance optimization
-- Sprint 1: TASK-101

-- Tables module indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tables_org_created 
ON tables (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tables_org_archived 
ON tables (org_id, is_archived) WHERE is_archived = false;

-- Table records indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_table_position 
ON table_records (table_id, position);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_org_created 
ON table_records (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_data_gin 
ON table_records USING GIN (data);

-- Auth module indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_user_active 
ON refresh_tokens (user_id, is_revoked) WHERE is_revoked = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_expires 
ON refresh_tokens (expires_at) WHERE is_revoked = false;

-- Org module indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memberships_org_role 
ON memberships (org_id, role);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memberships_user_org 
ON memberships (user_id, org_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invites_email_status 
ON invites (email, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invites_org_status 
ON invites (org_id, status);

-- AI module indexes (if tables exist)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_chats_org_created 
ON ai_chats (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_messages_chat_created 
ON ai_messages (chat_id, created_at);

-- Knowledge base indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kb_pages_org_created 
ON knowledge_pages (org_id, created_at DESC);

-- Schedule indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_schedule_events_org_start 
ON schedule_events (org_id, start_time);

-- Soft delete indexes (for all tables with deleted_at)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tables_deleted_at 
ON tables (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_table_records_deleted_at 
ON table_records (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_pages_deleted_at 
ON knowledge_pages (deleted_at) WHERE deleted_at IS NOT NULL;
