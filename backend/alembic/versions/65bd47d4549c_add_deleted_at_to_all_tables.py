"""add_deleted_at_to_all_tables

Revision ID: 65bd47d4549c
Revises: 030
Create Date: 2026-02-27 14:26:46.632770

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '65bd47d4549c'
down_revision: Union[str, None] = '030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tables that already have deleted_at: users, plans, token_balances, token_ledger, token_packages, token_purchases
    # Add to all others
    tables = [
        'access_rules', 'ai_chat_messages', 'ai_chat_sessions', 'ai_org_limits',
        'ai_runtime_audits', 'ai_runtime_secrets', 'ai_runtime_settings', 'ai_usage_logs',
        'ai_user_limits', 'audit_logs', 'billing_runtime_audits', 'billing_runtime_secrets',
        'billing_runtime_settings', 'docs_ai_generation_jobs', 'events', 'file_versions',
        'files', 'folders', 'invites', 'kb_pages', 'memberships', 'notifications',
        'org_storage_usage', 'organizations', 'refresh_tokens', 'report_dashboards',
        'report_widgets', 'subscriptions', 'table_columns', 'table_folders',
        'table_records', 'table_views', 'tables', 'token_usage_idempotency'
    ]
    
    for table in tables:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE")


def downgrade() -> None:
    tables = [
        'access_rules', 'ai_chat_messages', 'ai_chat_sessions', 'ai_org_limits',
        'ai_runtime_audits', 'ai_runtime_secrets', 'ai_runtime_settings', 'ai_usage_logs',
        'ai_user_limits', 'audit_logs', 'billing_runtime_audits', 'billing_runtime_secrets',
        'billing_runtime_settings', 'docs_ai_generation_jobs', 'events', 'file_versions',
        'files', 'folders', 'invites', 'kb_pages', 'memberships', 'notifications',
        'org_storage_usage', 'organizations', 'refresh_tokens', 'report_dashboards',
        'report_widgets', 'subscriptions', 'table_columns', 'table_folders',
        'table_records', 'table_views', 'tables', 'token_usage_idempotency'
    ]
    
    for table in tables:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS deleted_at")
