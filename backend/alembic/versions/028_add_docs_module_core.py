"""add_docs_module_core

Revision ID: 028
Revises: 027
Create Date: 2026-02-27 06:10:00.000000

"""
# ruff: noqa: TC003

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "028"
down_revision: str | None = "027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "folders",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["folders.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_folders_org_id"), "folders", ["org_id"], unique=False)
    op.create_index(op.f("ix_folders_parent_id"), "folders", ["parent_id"], unique=False)
    op.create_index(op.f("ix_folders_created_by"), "folders", ["created_by"], unique=False)

    op.create_table(
        "file_versions",
        sa.Column("file_id", sa.UUID(), nullable=False),
        sa.Column("s3_key", sa.String(length=1000), nullable=False),
        sa.Column("s3_bucket", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=128), nullable=True),
        sa.Column("mime", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("s3_key", name="uq_file_versions_s3_key"),
    )
    op.create_index(op.f("ix_file_versions_file_id"), "file_versions", ["file_id"], unique=False)
    op.create_index(op.f("ix_file_versions_created_by"), "file_versions", ["created_by"], unique=False)

    op.create_table(
        "org_storage_usage",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("used_bytes", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("reserved_bytes", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("used_bytes >= 0", name="ck_org_storage_usage_used_non_negative"),
        sa.CheckConstraint("reserved_bytes >= 0", name="ck_org_storage_usage_reserved_non_negative"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", name="uq_org_storage_usage_org_id"),
    )
    op.create_index(op.f("ix_org_storage_usage_org_id"), "org_storage_usage", ["org_id"], unique=False)

    op.add_column("files", sa.Column("folder_id", sa.UUID(), nullable=True))
    op.add_column("files", sa.Column("type", sa.String(length=20), nullable=True))
    op.add_column("files", sa.Column("status", sa.String(length=32), nullable=True))
    op.add_column("files", sa.Column("title", sa.String(length=500), nullable=True))
    op.add_column("files", sa.Column("current_version_id", sa.UUID(), nullable=True))

    op.create_index(op.f("ix_files_folder_id"), "files", ["folder_id"], unique=False)
    op.create_index(op.f("ix_files_type"), "files", ["type"], unique=False)
    op.create_index(op.f("ix_files_status"), "files", ["status"], unique=False)
    op.create_index(op.f("ix_files_current_version_id"), "files", ["current_version_id"], unique=False)

    op.create_foreign_key("fk_files_folder_id", "files", "folders", ["folder_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(
        "fk_files_current_version_id",
        "files",
        "file_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION crm_enforce_folders_depth()
        RETURNS trigger AS $$
        DECLARE
            v_parent_parent_id uuid;
            v_parent_org_id uuid;
        BEGIN
            IF NEW.parent_id IS NULL THEN
                RETURN NEW;
            END IF;

            IF NEW.parent_id = NEW.id THEN
                RAISE EXCEPTION 'INVALID_PARENT_SELF';
            END IF;

            SELECT parent_id, org_id
              INTO v_parent_parent_id, v_parent_org_id
              FROM folders
             WHERE id = NEW.parent_id;

            IF v_parent_org_id IS NULL THEN
                RAISE EXCEPTION 'PARENT_FOLDER_NOT_FOUND';
            END IF;

            IF v_parent_org_id <> NEW.org_id THEN
                RAISE EXCEPTION 'PARENT_FOLDER_ORG_MISMATCH';
            END IF;

            IF v_parent_parent_id IS NOT NULL THEN
                RAISE EXCEPTION 'MAX_DEPTH_EXCEEDED';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_folders_depth_insert
        BEFORE INSERT ON folders
        FOR EACH ROW
        EXECUTE FUNCTION crm_enforce_folders_depth();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_folders_depth_update
        BEFORE UPDATE OF parent_id, org_id ON folders
        FOR EACH ROW
        EXECUTE FUNCTION crm_enforce_folders_depth();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_folders_depth_update ON folders;")
    op.execute("DROP TRIGGER IF EXISTS trg_folders_depth_insert ON folders;")
    op.execute("DROP FUNCTION IF EXISTS crm_enforce_folders_depth;")

    op.drop_constraint("fk_files_current_version_id", "files", type_="foreignkey")
    op.drop_constraint("fk_files_folder_id", "files", type_="foreignkey")

    op.drop_index(op.f("ix_files_current_version_id"), table_name="files")
    op.drop_index(op.f("ix_files_status"), table_name="files")
    op.drop_index(op.f("ix_files_type"), table_name="files")
    op.drop_index(op.f("ix_files_folder_id"), table_name="files")

    op.drop_column("files", "current_version_id")
    op.drop_column("files", "title")
    op.drop_column("files", "status")
    op.drop_column("files", "type")
    op.drop_column("files", "folder_id")

    op.drop_index(op.f("ix_org_storage_usage_org_id"), table_name="org_storage_usage")
    op.drop_table("org_storage_usage")

    op.drop_index(op.f("ix_file_versions_created_by"), table_name="file_versions")
    op.drop_index(op.f("ix_file_versions_file_id"), table_name="file_versions")
    op.drop_table("file_versions")

    op.drop_index(op.f("ix_folders_created_by"), table_name="folders")
    op.drop_index(op.f("ix_folders_parent_id"), table_name="folders")
    op.drop_index(op.f("ix_folders_org_id"), table_name="folders")
    op.drop_table("folders")
