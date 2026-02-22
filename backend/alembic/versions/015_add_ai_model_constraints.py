"""Add AI model constraints for role/token safety and message/session consistency.

Revision ID: 015
Revises: 014
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op


revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Keep strict consistency: message (session_id, org_id, user_id) must match chat session owner.
    op.create_unique_constraint(
        "uq_ai_chat_sessions_id_org_user",
        "ai_chat_sessions",
        ["id", "org_id", "user_id"],
    )
    op.create_foreign_key(
        "fk_ai_chat_messages_session_org_user",
        "ai_chat_messages",
        "ai_chat_sessions",
        ["session_id", "org_id", "user_id"],
        ["id", "org_id", "user_id"],
        ondelete="CASCADE",
    )

    # Data sanity guards for chat/usage counters.
    op.create_check_constraint(
        "ck_ai_chat_messages_role_valid",
        "ai_chat_messages",
        "role IN ('user', 'assistant', 'system', 'tool')",
    )
    op.create_check_constraint(
        "ck_ai_chat_messages_token_count_non_negative",
        "ai_chat_messages",
        "token_count IS NULL OR token_count >= 0",
    )
    op.create_check_constraint(
        "ck_ai_usage_logs_prompt_tokens_non_negative",
        "ai_usage_logs",
        "prompt_tokens >= 0",
    )
    op.create_check_constraint(
        "ck_ai_usage_logs_completion_tokens_non_negative",
        "ai_usage_logs",
        "completion_tokens >= 0",
    )
    op.create_check_constraint(
        "ck_ai_usage_logs_total_tokens_non_negative",
        "ai_usage_logs",
        "total_tokens >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_usage_logs_total_tokens_non_negative", "ai_usage_logs", type_="check")
    op.drop_constraint("ck_ai_usage_logs_completion_tokens_non_negative", "ai_usage_logs", type_="check")
    op.drop_constraint("ck_ai_usage_logs_prompt_tokens_non_negative", "ai_usage_logs", type_="check")
    op.drop_constraint("ck_ai_chat_messages_token_count_non_negative", "ai_chat_messages", type_="check")
    op.drop_constraint("ck_ai_chat_messages_role_valid", "ai_chat_messages", type_="check")
    op.drop_constraint("fk_ai_chat_messages_session_org_user", "ai_chat_messages", type_="foreignkey")
    op.drop_constraint("uq_ai_chat_sessions_id_org_user", "ai_chat_sessions", type_="unique")

