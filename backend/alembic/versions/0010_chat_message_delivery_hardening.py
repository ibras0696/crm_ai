"""chat message delivery hardening

Revision ID: 0010_chat_delivery_harden
Revises: 0009_add_users_avatar_url
Create Date: 2026-05-25 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0010_chat_delivery_harden"
down_revision = "0009_add_users_avatar_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("last_seq_no", sa.Integer(), nullable=False, server_default=sa.text("0")))

    op.execute(
        """
        UPDATE chats c
        SET last_seq_no = sub.max_seq
        FROM (
            SELECT chat_id, COALESCE(MAX(seq_no), 0) AS max_seq
            FROM chat_messages
            GROUP BY chat_id
        ) AS sub
        WHERE c.id = sub.chat_id
        """
    )

    op.add_column("chat_messages", sa.Column("client_message_id", sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        "uq_chat_messages_chat_client_message",
        "chat_messages",
        ["chat_id", "client_message_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_chat_messages_chat_client_message", "chat_messages", type_="unique")
    op.drop_column("chat_messages", "client_message_id")
    op.drop_column("chats", "last_seq_no")
